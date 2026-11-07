# GeometryScript bone weights reference

`UGeometryScriptLibrary_MeshBoneWeightFunctions` — script name
`GeometryScript_BoneWeights` — in
`Engine/Plugins/Runtime/GeometryScripting/Source/GeometryScriptingCore/Public/GeometryScript/MeshBoneWeightFunctions.h`
(GeometryScripting plugin). All functions operate on a `UDynamicMesh` carrying bone
attributes (a skeleton snapshot) and per-vertex bone weight attributes; weights
reference bones **by index** into those attributes, wrapped as
`FGeometryScriptBoneWeight {int32 BoneIndex, float Weight}`. A
`FGeometryScriptBoneWeightProfile` names the skin weight profile to touch (default
profile unless you say otherwise).

## Getting mesh data in and out

From `Engine/Plugins/Runtime/GeometryScripting/Source/GeometryScriptingCore/Public/GeometryScript/MeshAssetFunctions.h`
(script class `GeometryScript_AssetUtils`):

- `CopyMeshFromSkeletalMesh(FromSkeletalMeshAsset, ToDynamicMesh, AssetOptions, RequestedLOD, Outcome)` —
  brings geometry **and** bone/weight attributes in.
- `CopyMeshToSkeletalMesh(FromDynamicMesh, ToSkeletalMeshAsset, Options, TargetLOD, Outcome)` —
  writes a LOD back. Treat the written LOD as new geometry: welding/ordering may be
  rebuilt, so anything keyed to old vertex indices (morph deltas, cached maps) can
  shift.

Both take a LOD, so GeometryScript is the path for fixing **non-zero LODs**
(`USkinWeightModifier` is LOD0-only).

## Function table

Queries:

| Function | Semantics |
|---|---|
| `MeshHasBoneWeights(Mesh, bHas, Profile)` | Does a weight attribute set exist for the profile |
| `MeshCreateBoneWeights(Mesh, Outcome, Profile)` | Create (empty) weight attributes for a profile |
| `MeshCopyBoneWeights(Mesh, Outcome, TargetProfile, SourceProfile)` | Duplicate one profile's weights into another |
| `GetMaxBoneWeightIndex(Mesh, bHasWeights, MaxIndex, Profile)` | Largest bone index referenced by any weight |
| `GetVertexBoneWeights(Mesh, VertexID, Weights[], bHas, Profile)` | Read one vertex's influences |
| `GetLargestVertexBoneWeight(Mesh, VertexID, Weight, bHas, Profile)` | Dominant influence of a vertex |
| `GetBoneIndex(Mesh, BoneName, bValid, Index)` | Name → index against the mesh's bone attributes |
| `GetRootBoneName` / `GetBoneChildren` / `GetBoneInfo` / `GetAllBonesInfo` | Hierarchy queries (`FGeometryScriptBoneInfo`: index, name, parent, local/global transform) |

Writes:

| Function | Semantics |
|---|---|
| `SetVertexBoneWeights(Mesh, VertexID, Weights[], Profile)` | Replace one vertex's influence list |
| `SetAllVertexBoneWeights(Mesh, Weights[], Profile)` | Flood the whole mesh with one influence list |
| `BlendBoneWeights(A[], B[], Alpha, Result[])` | Lerp two influence lists (utility, no mesh) — the building block for falloff ramps |
| `PruneBoneWeights(Mesh, BonesToPrune[], Options, Outcome, Profile)` | Remove named bones from all weights |
| `ComputeSmoothBoneWeights(Mesh, Skeleton, Options, Outcome, Profile)` | Bind the mesh to a skeleton from scratch |
| `TransferBoneWeightsFromMesh(SourceMesh, TargetMesh, Options, Selection)` | Transfer weights source → target (optionally restricted to a selection) |
| `CopyBonesFromMesh(SourceMesh, TargetMesh, Options)` / `CopyBonesFromSkeleton(Skeleton, TargetMesh, Options)` | Install/replace the target's bone attributes |
| `DiscardBonesFromMesh(Mesh)` | Drop bone attributes |

## Prune options

`FGeometryScriptPruneBoneWeightsOptions`:

- `ReassignmentType = RenormalizeRemaining` — delete the bone's weight, renormalize
  the rest (use when the region should never have had that influence).
- `ReassignmentType = ReassignToParent` — move the weight up the chain (use when the
  bone is too granular — e.g. collapse twist-bone weight onto the limb bone).
- `bIgnoredInvalidBones = true` — skip names the mesh doesn't have instead of erroring.

## Smooth binding options

`FGeometryScriptSmoothBoneWeightsOptions`:

| Field | Default | Meaning |
|---|---|---|
| `DistanceWeighingType` | `DirectDistance` | Euclidean bone→vertex distance; `GeodesicVoxel` routes distance through the voxelized interior so the left leg doesn't grab right-leg vertices |
| `Stiffness` | 0.2 | Higher = nearer bones dominate harder (more rigid) |
| `MaxInfluences` | 5 | 1 = fully rigid binding |
| `VoxelResolution` | 256 | GeodesicVoxel only; fidelity vs. time/memory |

`GeodesicVoxel` is the one to use on humanoids and anything with limbs that pass near
each other; `DirectDistance` is fine for mechanical assemblies with separated parts.
The same operation underlies
`Engine/Plugins/Runtime/GeometryProcessing/Source/DynamicMesh/Public/Operations/SkinWeightBinding.h`
and the editor's bind tool
(`Engine/Plugins/Runtime/MeshModelingToolset/Source/MeshModelingToolsEditorOnly/Public/SkeletalMesh/SkinWeightsBindingTool.h`).

## Transfer options

`FGeometryScriptTransferBoneWeightsOptions` — the core of re-skinning generated or
edited geometry. Underlying op:
`Engine/Plugins/Runtime/GeometryProcessing/Source/DynamicMesh/Public/Operations/TransferBoneWeights.h`.

| Field | Default | Meaning |
|---|---|---|
| `TransferMethod` | `ClosestPointOnSurface` | Barycentric copy from nearest source point; `InpaintWeights` copies only confident matches and solves the rest |
| `OutputTargetMeshBones` | `SourceBones` | Replace target bone attributes with source's; `TargetBones` re-indexes onto target bones and **skips** weights whose bone the target lacks (error per bone in the Output Log) |
| `SourceProfile` / `TargetProfile` | default | Which skin weight profile to read/write |
| `RadiusPercentage` | −1 | Inpaint only: match radius as a fraction of the bounds diagonal; −1 = unlimited |
| `NormalThreshold` | −1 | Inpaint only: max normal disagreement in degrees for a direct copy; −1 = ignore normals |
| `LayeredMeshSupport` | true | Inpaint only: retry failed normal test with flipped normal (inner/outer cloth layers) |
| `NumSmoothingIterations` / `SmoothingStrength` | 0 / 0.0 | Inpaint only: post-smooth the solved (unmatched) vertices |
| `InpaintMask` | none | Name of a weight-map attribute; non-zero marks vertices whose weights must be *solved*, never copied |

Method choice:

- **Tight-fitting target** (shirt generated over the same body, shoes over feet):
  `ClosestPointOnSurface` is accurate and cheap.
- **Target strays from the source** (open jacket, collar, cape edge, loose sleeve):
  `InpaintWeights` with a sane radius (start `RadiusPercentage` ≈ 0.05) and
  `NormalThreshold` ≈ 30–45. Direct copies happen where the garment hugs the body;
  the flyaway regions get smoothly-solved weights instead of grabbing whatever
  surface happens to be closest — which is exactly the failure that makes loose
  parts "not follow" or snap to the wrong limb.
- **Surgical re-transfer:** pass a `FGeometryScriptMeshSelection` (vertex selection)
  as the last argument to redo weights on just one region, or set `InpaintMask` to
  force chosen vertices to be solved rather than copied (e.g. a collar that keeps
  matching the head: mask it, let the solver blend it from its neighbors).

## Worked pipeline: re-skin a modified body part (C++)

```cpp
// Modules: GeometryScriptingCore (+ GeometryScriptingEditor for asset copy in-editor)
UDynamicMesh* Src = NewObject<UDynamicMesh>();   // donor: the original skinned mesh
UDynamicMesh* Dst = NewObject<UDynamicMesh>();   // target: edited/generated geometry

FGeometryScriptCopyMeshFromAssetOptions ReadOpts;
FGeometryScriptMeshReadLOD SrcLOD;  // LODType=SourceModel, LODIndex=0
EGeometryScriptOutcomePins Outcome;
UGeometryScriptLibrary_StaticMeshFunctions::CopyMeshFromSkeletalMesh(
    DonorMesh, Src, ReadOpts, SrcLOD, Outcome);
UGeometryScriptLibrary_StaticMeshFunctions::CopyMeshFromSkeletalMesh(
    EditedMesh, Dst, ReadOpts, SrcLOD, Outcome);

FGeometryScriptTransferBoneWeightsOptions Xfer;
Xfer.TransferMethod = ETransferBoneWeightsMethod::InpaintWeights;
Xfer.RadiusPercentage = 0.05;
Xfer.NormalThreshold  = 30.0;
UGeometryScriptLibrary_MeshBoneWeightFunctions::TransferBoneWeightsFromMesh(
    Src, Dst, Xfer);

FGeometryScriptCopyMeshToAssetOptions WriteOpts;
FGeometryScriptMeshWriteLOD DstLOD;  // LODIndex=0
UGeometryScriptLibrary_StaticMeshFunctions::CopyMeshToSkeletalMesh(
    Dst, EditedMesh, WriteOpts, DstLOD, Outcome);
```

Both meshes must be in the **same space and bind pose** — closest-point matching has
no alignment step. If the target's skeleton must be kept (not replaced by the
donor's), run `CopyBonesFromMesh`/`CopyBonesFromSkeleton` first so the target's bone
set is a superset of every bone the donor weights reference, then transfer with
`OutputTargetMeshBones = TargetBones` and read the Output Log for skipped bones.
