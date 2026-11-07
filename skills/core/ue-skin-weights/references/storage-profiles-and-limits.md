# Skin weight storage, influence limits, and profiles

Where weights actually live, what precision and influence counts survive, and how
alternate weight sets (skin weight profiles) work. UE 5.8.

## Two copies of the weights

1. **Source model** — the editable truth. Per-vertex skin weight attributes on the
   mesh description
   (`Engine/Source/Runtime/SkeletalMeshDescription/Public/SkinWeightsAttributesRef.h`),
   one attribute set per skin weight profile. `USkinWeightModifier`, GeometryScript
   asset copies, and the interactive tools all read/write here; a commit kicks off a
   DDC rebuild of the render data.
2. **Render data** — `FSkinWeightVertexBuffer`
   (`Engine/Source/Runtime/Engine/Public/Rendering/SkinWeightVertexBuffer.h`), a
   packed GPU buffer. Per-influence it stores a bone index (8-bit, or 16-bit when the
   section's bone palette outgrows 256) and a weight (8-bit by default, 16-bit when
   high-precision weights are enabled on the mesh / build settings —
   `Use16BitBoneWeight()`), times `GetMaxBoneInfluences()` per vertex. Never edit
   this side; it is derived.

### Quantization

`FBoneWeight` (`Engine/Source/Runtime/AnimationCore/Public/BoneWeights.h`) keeps raw
weights as `uint16` (`MaxRawBoneWeight = 65535`); float APIs convert with
round-to-nearest. The default 8-bit render buffer further quantizes to 1/255 steps,
and the renormalization pass makes the surviving influences sum exactly to the max
raw value. Consequences:

- Influences below ~0.004 (1/255) can vanish outright in an 8-bit buffer — prune
  them yourself first so normalization redistributes the weight deliberately.
- Comparing weights after a round-trip needs a tolerance of about 1/255 (or 1/65535
  with 16-bit weights); exact float equality will ring false alarms.

## Influence limits

- Hard cap: `MAX_TOTAL_INFLUENCES` = 12
  (`Engine/Source/Runtime/Engine/Public/GPUSkinPublicDefs.h`);
  `UE::AnimationCore::MaxInlineBoneWeightCount` mirrors it.
- Project settings (`Engine/Source/Runtime/Engine/Classes/Engine/RendererSettings.h`):
  - `r.GPUSkin.UnlimitedBoneInfluences` (+ a threshold CVar): imported meshes use a
    variable-length influence stream instead of a fixed per-vertex count.
  - Per-platform `DefaultBoneInfluenceLimit` — applied when a LOD's own
    `BoneInfluenceLimit` is 0.
  - `r.GPUSkin.Limit2BoneInfluences` — hard clamp to 2 for low-end targets.
- Per-LOD: `BoneInfluenceLimit` in the skeletal mesh's LOD info caps influences at
  build time for that LOD.
- Per render **section**, the bone palette (`BoneMap`) is limited; weights that pull
  in many distant bones force extra sections or 16-bit bone indices — keep repairs
  within the region's natural bone chain.

`USkinWeightModifier::EnforceMaxInfluences(-1)` trims to the project-wide value;
GeometryScript's smooth-bind options take `MaxInfluences` directly.

## Skin weight profiles (alternate weight sets)

A skeletal mesh can carry named alternate weight sets alongside the default one —
used for cheaper mobile skinning, cloth-off variants, or A/B testing a re-skin
without touching the original.

- Asset side: `FSkinWeightProfileInfo` (name, per-platform default flags,
  `DefaultProfileFromLODIndex`) in
  `Engine/Source/Runtime/Engine/Public/Rendering/SkinWeightProfile.h`. When a profile
  is marked default for a platform/LOD range, its weights **replace** the mesh's own
  at load.
- Import/management (editor): `FSkinWeightsUtilities`
  (`Engine/Source/Editor/UnrealEd/Public/SkinWeightsUtilities.h`) —
  `ImportAlternateSkinWeight(Mesh, FbxPath, LODIndex, ProfileName, bIsReimport)`,
  `ReimportAlternateSkinWeight`, `RemoveSkinnedWeightProfileData`. The FBX must match
  the mesh's geometry; only its skinning is taken.
- Runtime swap: `USkinnedMeshComponent::SetSkinWeightProfile(Name)` requests the
  profile buffer; `FSkinWeightProfileManager`
  (`Engine/Source/Runtime/Engine/Public/Animation/SkinWeightProfileManager.h`)
  handles async buffer creation.
- GeometryScript reads/writes any profile via the
  `FGeometryScriptBoneWeightProfile` parameter on every bone-weight function, and
  `MeshCopyBoneWeights` duplicates one profile into another — the scripted way to
  build an alternate profile from an edited copy of the default.

`USkinWeightModifier` only touches the default profile.

## After editing: rebuild expectations

- Committing weight edits dirties the asset and rebuilds render data via DDC; large
  meshes take seconds. The commit is a single undo transaction.
- Generated LODs re-derive from LOD0 when regenerated
  (`USkeletalMeshEditorSubsystem::RegenerateLOD`,
  `Engine/Source/Editor/SkeletalMeshEditor/Public/SkeletalMeshEditorSubsystem.h`);
  imported LODs keep independent weights.
- Morph targets store positional deltas against vertex indices — geometry-preserving
  weight edits are safe, but writing a LOD back through
  `CopyMeshToSkeletalMesh` can reorder/weld vertices and orphan morph data.
