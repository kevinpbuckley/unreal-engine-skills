# USkinWeightModifier workflows

Scripted audit / repair / rebind recipes against
`Engine/Plugins/Runtime/MeshModelingToolset/Source/SkeletalMeshModifiers/Public/SkinWeightModifier.h`.
All Python runs in the editor (the class lives in the `SkeletalMeshModifiers` module of
the Mesh Modeling Toolset plugin and is editor-only). Everything below edits **LOD0**;
see the LOD section at the end.

## Setup and teardown

```python
import unreal

mesh = unreal.EditorAssetLibrary.load_asset("/Game/Chars/SK_Jacket")
mod = unreal.SkinWeightModifier()
if not mod.set_skeletal_mesh(mesh):
    raise RuntimeError("failed to load weights")
# ... edits ...
mod.commit_weights_to_skeletal_mesh()        # transactional, dirties the asset
unreal.EditorAssetLibrary.save_loaded_asset(mesh)
```

`GetVertexWeights` returns an `unreal.Map(Name, float)`; normalize the types once at
the read so the rest of the script deals in plain `dict[str, float]`:

```python
def weights_of(mod, vid):
    return {str(k): float(v) for k, v in mod.get_vertex_weights(vid).items()}

def put_weights(mod, vid, w):            # full replacement, not merge
    mod.set_vertex_weights(vid, {unreal.Name(k): v for k, v in w.items()}, True)
```

Passing `bReplaceAll=True` matters: with the default `False` the map is merged into
the existing influences, so "I removed the bone from my dict" does nothing.

## Audit: what does this mesh's skinning actually look like?

```python
from collections import Counter

n = mod.get_num_vertices()
per_bone = Counter()      # how many vertices each bone influences
max_inf = 0
bad_sum = []              # vertices whose weights don't sum to ~1 (pre-commit state)
for vid in range(n):
    w = weights_of(mod, vid)
    per_bone.update(w.keys())
    max_inf = max(max_inf, len(w))
    s = sum(w.values())
    if abs(s - 1.0) > 0.01:
        bad_sum.append((vid, s))

print(f"{n} verts, max influences {max_inf}")
print("top bones:", per_bone.most_common(15))
print(f"{len(bad_sum)} unnormalized verts")
```

Run this **before and after** an edit and diff `per_bone`: a regional fix that moved
weight on thousands of vertices when the region holds dozens means the selection
predicate was wrong. The same loop is the place to snapshot weights to disk (JSON or
`.npz`) if you want to compare an edit numerically or test poses offline with linear
blend skinning (`v' = Σ wᵢ·Mᵢ·v`, `Mᵢ = PoseGlobalᵢ · RefGlobalᵢ⁻¹`).

## Repair: scale back a bone's influence over a region

The classic failure: a collar (hood, pauldron, skirt waistband) is weighted too much
to `head`/`neck_02`, so it rides up when the neck flexes. Scale those influences and
return the freed weight to the strongest surviving influence (usually the spine or
clavicle chain that should own the region):

```python
REDUCE = {"head", "neck_02"}
SCALE = 0.25                               # 0.0 = remove the influence entirely

touched = 0
for vid in range(mod.get_num_vertices()):
    w = weights_of(mod, vid)
    held = {b: x for b, x in w.items() if b in REDUCE}
    if not held:
        continue
    freed = sum(x * (1.0 - SCALE) for x in held.values())
    for b in held:
        w[b] *= SCALE
    rest = [b for b in w if b not in REDUCE]
    if rest:
        w[max(rest, key=lambda b: w[b])] += freed
    put_weights(mod, vid, w)
    touched += 1

print(f"edited {touched} vertices")
mod.normalize_all_weights()
```

Variants:

- **Remove, don't scale:** `w.pop(bone)` for each offender and renormalize — the
  equivalent of the paint tool's flood-to-zero on that bone.
- **Reassign to parent** instead of "strongest remaining": add the freed weight to
  the offender's parent bone (query the hierarchy with
  `unreal.SkeletalMeshEditorSubsystem.get_bone_parent(mesh, bone_name)`,
  `Engine/Source/Editor/SkeletalMeshEditor/Public/SkeletalMeshEditorSubsystem.h`).
  This is what GeometryScript's prune calls `ReassignToParent`.
- **Blend toward a correction** rather than jumping to it: lerp each vertex's old map
  toward the corrected map by a factor — a falloff ramp (by distance from the seam
  vertices) reproduces a soft brush edge and avoids a visible weight cliff.

## Restricting the region

Three predicates, in order of robustness:

1. **By influence** (shown above): the broken vertices are exactly the ones carrying
   the unwanted bone. No geometry needed.
2. **By dominant bone:** `max(w, key=w.get) in REDUCE` — tighter: only vertices the
   bad bone *wins*.
3. **By position:** `USkinWeightModifier` exposes no positions. Read the same LOD
   into a `UDynamicMesh` (`CopyMeshFromSkeletalMesh`,
   `Engine/Plugins/Runtime/GeometryScripting/Source/GeometryScriptingCore/Public/GeometryScript/MeshAssetFunctions.h`)
   and query its vertex positions; on a compact mesh the DynamicMesh vertex IDs
   correspond to the mesh-description vertex IDs the modifier uses. **Verify** the
   correspondence before relying on it: for a handful of IDs, confirm the DynamicMesh
   vertex's largest bone weight (GeometryScript `GetLargestVertexBoneWeight`) names
   the same bone as `GetVertexWeights` from the modifier. If they disagree, the mesh
   was compacted/welded differently — fall back to influence predicates.

## Rigid rebind: force a region onto one bone

For hard accessories (a cap, goggles, a chest plate) every vertex gets exactly one
influence:

```python
TARGET_BONE = "head"
for vid in region_vertex_ids:
    put_weights(mod, vid, {TARGET_BONE: 1.0})
```

No normalization needed — but run `mod.enforce_max_influences(-1)` anyway if other
edits happened, and remember vertices *outside* the region keep their old smooth
weights, so the boundary ring is where any tearing will appear. Blend one or two
rings of vertices between the rigid and smooth sets when the accessory meets skin.

## Prune and cap

```python
mod.prune_all_weights(0.01)        # drop influences under 1% — below 8-bit precision anyway
mod.enforce_max_influences(-1)     # cull smallest influences to the project max
mod.normalize_all_weights()
```

Prune **then** normalize: pruned influences are excluded from receiving weight during
normalization. Pruning below ~0.01 yourself beats letting 8-bit quantization truncate
those weights at commit, because normalization redistributes the removed weight
instead of silently losing it to rounding.

## LODs

`USkinWeightModifier` reads and commits LOD0 only (`LODIndex = 0` is a private
constexpr in the header — there is no LOD parameter). After committing a LOD0 fix:

- **Generated LODs**: regenerate so they re-derive from the fixed LOD0 —
  `unreal.SkeletalMeshEditorSubsystem.regenerate_lod(mesh, new_lod_count=0, regenerate_even_if_imported=False, generate_base_lod=False)`.
- **Imported LODs**: they own independent weights; repeat the repair through
  GeometryScript on that LOD (its asset-copy functions take a LOD index) or re-import.

## What this API does not do

- **No mirror.** Mirroring weights is an interactive-tool feature
  (`Engine/Plugins/Runtime/MeshModelingToolset/Source/MeshModelingToolsEditorOnly/Public/SkeletalMesh/SkinWeightsPaintTool.h`);
  scripted mirroring means computing the symmetric vertex pairs yourself.
- **No relax/smooth.** For Laplacian-style smoothing of weights across neighbors, go
  through GeometryScript or blend vertex maps manually with ring falloff.
- **No positions, no selection geometry** — pair with GeometryScript as above.
- **No skin weight profiles** — it edits the default profile only; alternate
  profiles are covered in [storage-profiles-and-limits](storage-profiles-and-limits.md).
