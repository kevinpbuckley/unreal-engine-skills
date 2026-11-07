---
name: ue-skin-weights
description: Read, edit, transfer, and rebuild skeletal mesh skin weights (weight
  painting) in Unreal Engine 5.8 — USkinWeightModifier for scripted per-vertex weight
  edits on an asset (Python/Blueprint/C++), GeometryScript bone weight functions on
  a DynamicMesh (TransferBoneWeightsFromMesh with ClosestPointOnSurface or robust
  InpaintWeights, ComputeSmoothBoneWeights, PruneBoneWeights, SetVertexBoneWeights),
  normalization and influence limits, skin weight profiles, and verification by posing.
  Use when clothing or accessories deform wrong (collar lifts off the neck, shoulder
  spikes, candy-wrapper twists), when re-skinning modified or generated geometry to an
  existing skeleton, when binding new meshes to bones, when auditing weights (sums,
  max influences, stray bones), or when a task says weight paint, skinning, bind,
  re-skin, or transfer weights.
metadata:
  engine-version: "5.8"
  category: animation
---

# Skin weights (weight painting)

Skin weights bind each vertex of a skeletal mesh to one or more bones with a
normalized set of influences; linear blend skinning deforms the vertex by the
weighted sum of its bones' transforms. Bad weights show up as geometry that does not
follow the body (a collar that lifts when the neck bends), spikes (a vertex bound to
a far-away bone), or candy-wrapper pinching (too-rigid twist falloff). This skill
covers the engine's scriptable APIs for fixing weights without a DCC round-trip.

## When to use this skill

- A garment, prop, or body part deforms wrongly in a pose and needs targeted weight
  repair (reduce or remove a bone's influence on a region).
- New or modified geometry (generated clothing, kitbashed armor, an edited body)
  must be skinned to an existing skeleton by transferring weights from a reference mesh.
- A new mesh needs weights computed from scratch against a skeleton.
- You need to audit weights: per-vertex influence counts, weight sums, which bones
  actually hold weight, differences after an edit.
- You are deciding between `USkinWeightModifier`, GeometryScript, or the interactive
  Skin Weights paint tool for a weighting task.

## Mental model

- **Source vs. render data.** Editable weights live in the mesh's source model (the
  `FMeshDescription` with per-vertex skin weight attributes,
  `Engine/Source/Runtime/SkeletalMeshDescription/Public/SkinWeightsAttributesRef.h`).
  The renderer consumes a packed `FSkinWeightVertexBuffer`
  (`Engine/Source/Runtime/Engine/Public/Rendering/SkinWeightVertexBuffer.h`). Always
  edit the source and let the engine rebuild render data (committing an edit does
  this); never poke the render buffers.
- **Weights are quantized.** A stored influence is a `uint16` raw weight (or `uint8`
  in the default render buffer); `FBoneWeight` maps float ↔ raw with
  `MaxRawBoneWeight = 65535` (`Engine/Source/Runtime/AnimationCore/Public/BoneWeights.h`).
  Expect ~1/255 or ~1/65535 granularity after a commit — don't chase smaller float deltas.
- **Influences are capped.** The hard engine cap is `MAX_TOTAL_INFLUENCES` (12,
  `Engine/Source/Runtime/Engine/Public/GPUSkinPublicDefs.h`). Project settings
  (`Engine/Source/Runtime/Engine/Classes/Engine/RendererSettings.h`) decide what the
  renderer supports: `r.GPUSkin.UnlimitedBoneInfluences`, the Unlimited Bone
  Influences Threshold, a per-platform `DefaultBoneInfluenceLimit`, and
  `r.GPUSkin.Limit2BoneInfluences`. A per-LOD `BoneInfluenceLimit` on the mesh's LOD
  info overrides the default (0 = use project setting).
- **Normalization is enforced at commit.** APIs let you hold unnormalized weights
  while editing; committing to the asset renormalizes every touched vertex so
  influences sum to 1.
- **Three tool families, one data model:**

| API | Operates on | Best for |
|---|---|---|
| `USkinWeightModifier` | The `USkeletalMesh` asset directly (LOD0) | Targeted per-vertex repair, audits, scripted edits — Python/BP/C++ |
| GeometryScript `GeometryScript_BoneWeights` | A `UDynamicMesh` copied from/to the asset | Whole-mesh transfer, binding, pruning inside a modeling pipeline |
| Skin Weights paint tool (Skeletal Mesh editor → Editing Tools) | Live asset in editor UI | Human-in-the-loop brushing: Add/Replace/Multiply/Relax, flood, mirror |

The interactive tool (`Engine/Plugins/Runtime/MeshModelingToolset/Source/MeshModelingToolsEditorOnly/Public/SkeletalMesh/SkinWeightsPaintTool.h`)
defines the editing vocabulary — `EWeightEditOperation` Add / Replace / Multiply /
Relax, brush falloff modes, mirroring — and the same operations are what you
reproduce in script with the two APIs above.

## Targeted repair with USkinWeightModifier

`Engine/Plugins/Runtime/MeshModelingToolset/Source/SkeletalMeshModifiers/Public/SkinWeightModifier.h`
(`SkeletalMeshModifiers` module, part of the Mesh Modeling Toolset plugin — enabled
by default in the editor). Lifecycle: instantiate → `SetSkeletalMesh(Mesh)` →
get/set/normalize/prune → `CommitWeightsToSkeletalMesh()` → save the asset.

Key API (all `BlueprintCallable`, usable from Python as `unreal.SkinWeightModifier`):

| Function | Notes |
|---|---|
| `SetSkeletalMesh(Mesh)` | Loads LOD0 weights into memory for editing |
| `GetNumVertices()` / `GetAllBoneNames()` | Audit surface |
| `GetVertexWeights(VertexID)` | Returns `TMap<FName, float>` of influences |
| `SetVertexWeights(VertexID, Weights, bReplaceAll=false)` | Stores as given — **not normalized**; `bReplaceAll=false` merges with existing influences |
| `NormalizeVertexWeights(VertexID)` / `NormalizeAllWeights()` | Optional during editing |
| `PruneVertexWeights(VertexID, Threshold)` / `PruneAllWeights(Threshold)` | Drop influences below threshold; pruned bones no longer receive weight from normalization |
| `EnforceMaxInfluences(Max=-1)` | Culls smallest influences; `-1` = project-wide max |
| `CommitWeightsToSkeletalMesh()` | Applies in an undo transaction, dirties the asset, enforces normalization |

The collar-lifts-off-the-neck repair — remove unwanted bone influence from a region
and give the weight back to the influences that should win (Python):

```python
import unreal

mesh = unreal.EditorAssetLibrary.load_asset("/Game/Chars/SK_Jacket")
mod = unreal.SkinWeightModifier()
assert mod.set_skeletal_mesh(mesh)

REDUCE = {"head", "neck_02"}        # bones that must stop dragging the collar
SCALE = 0.25                        # keep 25% of their influence; 0.0 removes it

for vid in range(mod.get_num_vertices()):
    w = {str(k): float(v) for k, v in mod.get_vertex_weights(vid).items()}
    held = {b: x for b, x in w.items() if b in REDUCE}
    if not held:
        continue                    # vertex not in the affected region
    freed = sum(x * (1.0 - SCALE) for x in held.values())
    for b in held:
        w[b] *= SCALE
    # hand the freed weight to the strongest remaining influence
    rest = [b for b in w if b not in REDUCE]
    if rest:
        top = max(rest, key=lambda b: w[b])
        w[top] += freed
    mod.set_vertex_weights(vid, {unreal.Name(b): x for b, x in w.items()}, True)

mod.normalize_all_weights()
mod.commit_weights_to_skeletal_mesh()
unreal.EditorAssetLibrary.save_loaded_asset(mesh)
```

Selecting the region by *influence* (as above) is robust. To select by *position*,
copy the same LOD into a DynamicMesh and read vertex positions; on a compact mesh the
vertex IDs correspond to the mesh description's — spot-check a few vertices' weights
against `GetVertexWeights` before trusting the mapping. Full recipes (audits,
dominant-bone rebinds, LOD handling): see
[skin-weight-modifier-workflows](references/skin-weight-modifier-workflows.md).

## Transfer and binding with GeometryScript

`Engine/Plugins/Runtime/GeometryScripting/Source/GeometryScriptingCore/Public/GeometryScript/MeshBoneWeightFunctions.h`
(`UGeometryScriptLibrary_MeshBoneWeightFunctions`, script name
`GeometryScript_BoneWeights`). The pipeline is: copy the skeletal mesh LOD into a
`UDynamicMesh` (`CopyMeshFromSkeletalMesh` in
`Engine/Plugins/Runtime/GeometryScripting/Source/GeometryScriptingCore/Public/GeometryScript/MeshAssetFunctions.h`),
operate, copy back with `CopyMeshToSkeletalMesh`.

**Re-skin modified or generated geometry** — `TransferBoneWeightsFromMesh(SourceMesh,
TargetMesh, Options)` with `FGeometryScriptTransferBoneWeightsOptions`:

- `TransferMethod = ClosestPointOnSurface`: every target vertex takes barycentric
  weights from the nearest source surface point. Fast; right when the target hugs the
  source (a close-fitting garment over the body it came from).
- `TransferMethod = InpaintWeights`: copies weights only where the closest point
  passes a distance test (`RadiusPercentage` × bounds diagonal) **and** a normal
  agreement test (`NormalThreshold` degrees), then solves smooth weights for every
  unmatched vertex, with optional post-smoothing (`NumSmoothingIterations`,
  `SmoothingStrength`). `LayeredMeshSupport=true` retries with the flipped normal so
  inner/outer cloth layers don't grab each other. Use this when the target strays from
  the source surface — loose sleeves, collars, flaps — exactly where closest-point
  transfer produces the "clothing doesn't follow" artifacts. The underlying op is
  `Engine/Plugins/Runtime/GeometryProcessing/Source/DynamicMesh/Public/Operations/TransferBoneWeights.h`.
- `OutputTargetMeshBones = SourceBones` replaces the target's bone attributes with the
  source's; `TargetBones` re-indexes transferred weights onto the target's existing
  skeleton and **skips** (with an Output Log error) any weight whose bone the target
  lacks — make the target skeleton a superset first (`CopyBonesFromMesh` /
  `CopyBonesFromSkeleton`).

**Bind from scratch** — `ComputeSmoothBoneWeights(TargetMesh, Skeleton, Options)` with
`FGeometryScriptSmoothBoneWeightsOptions`: `DirectDistance` (Euclidean) or
`GeodesicVoxel` (geodesic through a voxelization, `VoxelResolution`), `Stiffness`
(higher = more rigid), `MaxInfluences` (1 = fully rigid binding). The same binding op
backs the editor's Bind Skin tool
(`Engine/Plugins/Runtime/GeometryProcessing/Source/DynamicMesh/Public/Operations/SkinWeightBinding.h`,
`Engine/Plugins/Runtime/MeshModelingToolset/Source/MeshModelingToolsEditorOnly/Public/SkeletalMesh/SkinWeightsBindingTool.h`).

Per-vertex access also exists here (`GetVertexBoneWeights`, `SetVertexBoneWeights`,
`SetAllVertexBoneWeights`, `BlendBoneWeights`, `GetLargestVertexBoneWeight`) using
`FGeometryScriptBoneWeight {BoneIndex, Weight}` pairs — indices, not names; resolve
with `GetBoneIndex`/`GetAllBonesInfo`. Full function and option tables:
[geometry-script-bone-weights](references/geometry-script-bone-weights.md).

## Verifying a weight edit

1. **Invariants:** every vertex's weights sum to ~1 (post-commit they will — check
   *before* commit to catch logic errors), influence count ≤ the intended max, and no
   weight on bones that shouldn't own the region (audit scripts in
   [skin-weight-modifier-workflows](references/skin-weight-modifier-workflows.md)).
2. **Pose test — the only test that matters.** Bad weights are invisible in the ref
   pose. Apply the worst-case pose (neck flexed, arm raised) and measure: either set
   a pose on a `USkeletalMeshComponent` / `UPoseableMeshComponent` and inspect, or
   compute linear blend skinning offline — `v' = Σᵢ wᵢ · Mᵢ · v` with
   `Mᵢ = PoseGlobalᵢ · RefGlobalᵢ⁻¹` — and compare the deformed region against the
   body (e.g. max collar-to-neck distance before vs. after the fix).
3. **Count what changed.** Record per-bone weighted-vertex counts before and after;
   an edit that touched thousands of vertices when the region holds dozens means the
   selection was wrong. `CommitWeightsToSkeletalMesh` is transactional — undo works.

## Gotchas

- **`USkinWeightModifier` edits LOD0 only** (`LODIndex` is a private constexpr in the
  header). Regenerate lower LODs afterwards (`RegenerateLOD` /
  `SkeletalMeshEditorSubsystem`,
  `Engine/Source/Editor/SkeletalMeshEditor/Public/SkeletalMeshEditorSubsystem.h`) so
  they inherit the fix; imported (non-generated) LODs keep their own weights.
- **`SetVertexWeights` merge semantics:** `bReplaceAll=false` (default) merges the map
  into existing influences — removing a bone from the dict does *not* remove its
  influence. Pass `bReplaceAll=true` when you mean "this is the complete new set".
- **Nothing normalizes until you ask or commit.** Intermediate reads return exactly
  what you stored. `PruneVertexWeights` marks influences as no longer eligible for
  normalization weight — prune *then* normalize.
- **Transfer eats bones silently-ish:** with `OutputTargetMeshBones=TargetBones`,
  source weights on bones missing from the target are dropped (error goes to the
  Output Log, the function still "succeeds"). Check the log, or copy bones first.
- **InpaintWeights needs the meshes in the same space.** Both methods match by
  closest point: transfer in the shared bind pose and identical coordinate frame, or
  everything matches the wrong surface.
- **Round-tripping through a DynamicMesh can rebuild vertex order/welding.** When
  using `CopyMeshToSkeletalMesh`, treat the written LOD as new geometry (morph
  targets, cached vertex-index assumptions, and per-vertex external data may no
  longer line up).
- **Quantization will "move" your numbers.** A 0.003 influence may survive commit as
  0 in an 8-bit buffer. Prune below ~0.01 yourself so normalization — not truncation —
  decides where that weight goes.
- **Section bone limits still apply** when adding far-away influences: a render
  section indexes a limited bone palette, and blowing it forces section splits (cost)
  — keep influences local to the region's bone chain.
- **The editor paint tool and these APIs edit the same data** — don't script against
  an asset that is open in the Skin Weights tool with uncommitted brush strokes.

## References & source material

Engine source (UE 5.8):

- `Engine/Plugins/Runtime/MeshModelingToolset/Source/SkeletalMeshModifiers/Public/SkinWeightModifier.h` — `USkinWeightModifier` (full API + Python sample in the class comment)
- `Engine/Plugins/Runtime/GeometryScripting/Source/GeometryScriptingCore/Public/GeometryScript/MeshBoneWeightFunctions.h` — GeometryScript bone-weight functions + option structs
- `Engine/Plugins/Runtime/GeometryScripting/Source/GeometryScriptingCore/Public/GeometryScript/MeshAssetFunctions.h` — `CopyMeshFromSkeletalMesh` / `CopyMeshToSkeletalMesh`
- `Engine/Plugins/Runtime/GeometryProcessing/Source/DynamicMesh/Public/Operations/TransferBoneWeights.h` — closest-point / inpaint transfer operation
- `Engine/Plugins/Runtime/GeometryProcessing/Source/DynamicMesh/Public/Operations/SkinWeightBinding.h` — smooth binding operation
- `Engine/Plugins/Runtime/MeshModelingToolset/Source/MeshModelingToolsEditorOnly/Public/SkeletalMesh/SkinWeightsPaintTool.h` — interactive paint tool (edit operations, falloff, mirror)
- `Engine/Plugins/Runtime/MeshModelingToolset/Source/MeshModelingToolsEditorOnly/Public/SkeletalMesh/SkinWeightsBindingTool.h` — interactive bind tool
- `Engine/Source/Runtime/AnimationCore/Public/BoneWeights.h` — `FBoneWeight`, raw `uint16` weight representation, `MaxInlineBoneWeightCount`
- `Engine/Source/Runtime/Engine/Public/GPUSkinPublicDefs.h` — `MAX_TOTAL_INFLUENCES` (12)
- `Engine/Source/Runtime/Engine/Public/Rendering/SkinWeightVertexBuffer.h` — packed render buffer, 8/16-bit weights and indices
- `Engine/Source/Runtime/SkeletalMeshDescription/Public/SkinWeightsAttributesRef.h` — source-model skin weight attributes
- `Engine/Source/Runtime/Engine/Classes/Engine/RendererSettings.h` — bone-influence project settings
- `Engine/Source/Editor/SkeletalMeshEditor/Public/SkeletalMeshEditorSubsystem.h` — LOD regeneration and skeletal mesh editor scripting

Deep dives in this skill:

- [skin-weight-modifier-workflows](references/skin-weight-modifier-workflows.md) — audit, repair, and rebind recipes with `USkinWeightModifier`
- [geometry-script-bone-weights](references/geometry-script-bone-weights.md) — full GeometryScript function/option reference, transfer + bind pipelines
- [storage-profiles-and-limits](references/storage-profiles-and-limits.md) — weight storage, influence limits, skin weight profiles, alternate weights from FBX
