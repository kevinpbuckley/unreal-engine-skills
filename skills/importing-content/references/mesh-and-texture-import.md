# Mesh and texture import settings reference

Grounded in UE 5.7 engine source under
`Engine/Plugins/Interchange/Runtime/Source/Pipelines/`
and `Engine/Source/Editor/UnrealEd/Classes/Factories/`.
See [../SKILL.md](../SKILL.md) for the mental model and gotchas.

## Interchange mesh pipeline (`UInterchangeGenericMeshPipeline`)

Source: `Engine/Plugins/Interchange/Runtime/Source/Pipelines/Public/InterchangeGenericMeshPipeline.h`

### Static mesh properties

| Property | Type | Default | Notes |
|---|---|---|---|
| `bImportStaticMeshes` | bool | true | Master toggle for SM import |
| `bCombineStaticMeshes` | bool | false | Merge all SM nodes into one asset |
| `LodGroup` | FName | NAME_None | Epic LOD presets: SmallProp, LargeProp, Vista, etc. |
| `bAutoComputeLODScreenSizes` | bool | true | Auto-derive LOD screen-size thresholds |
| `bCollision` | bool | true | Import or generate simple collision |
| `bImportCollisionAccordingToMeshName` | bool | true | Treat `UCX_`, `UBX_`, `USP_`, `UCP_` prefix meshes as collision |
| `bOneConvexHullPerUCX` | bool | true | One hull per UCX mesh vs decompose |
| `Collision` | EInterchangeMeshCollision | Convex18DOP | Fallback collision type if none found |
| `bBuildNanite` | bool | true | Enable Nanite at runtime |
| `NaniteTriangleThreshold` | int64 | 0 | Minimum triangles for Nanite (0 = always) |
| `bBuildReversedIndexBuffer` | bool | false | For backface rendering |
| `bGenerateLightmapUVs` | bool | false | Auto-generate UV channel for Lightmass |
| `MinLightmapResolution` | int32 | 64 | Padding budget for lightmap UV packing |
| `SrcLightmapIndex` | int32 | 0 | Source UV channel for lightmap gen |
| `DstLightmapIndex` | int32 | 1 | Destination UV channel for generated lightmap |
| `BuildScale3D` | FVector | (1,1,1) | Build-time scale applied to mesh |
| `bGenerateDistanceFieldAsIfTwoSided` | bool | false | Prevent open-mesh distance field discard |
| `MaxLumenMeshCards` | int32 | 12 | 0 disables Lumen card generation |

### Common mesh build properties

Set via `UInterchangeGenericCommonMeshesProperties` (shared settings pointer):

| Property | Notes |
|---|---|
| `bRecomputeNormals` | Ignore source normals; UE computes from geometry |
| `bRecomputeTangents` | Ignore source tangents; UE computes (MikkTSpace recommended) |
| `bUseMikkTSpace` | Use MikkTSpace tangent-space standard |
| `bComputeWeightedNormals` | Weight normals by face area × corner angle |
| `bUseHighPrecisionTangentBasis` | 16-bit vs 8-bit tangent storage |
| `bUseFullPrecisionUVs` | 32-bit float UVs vs 16-bit |
| `bRemoveDegenerates` | Remove zero-area triangles |
| `VertexColorImportOption` | `Replace`, `Ignore`, or `Override` vertex colors |

### Skeletal mesh properties

| Property | Type | Default | Notes |
|---|---|---|---|
| `bImportSkeletalMeshes` | bool | true | Master toggle for SKM import |
| `SkeletalMeshImportContentType` | EInterchangeSkeletalMeshContentType | GeometryAndSkinningWeights | Or GeometryOnly / SkinningWeightsOnly |
| `bImportMorphTargets` | bool | true | Import blend shapes |
| `bUpdateSkeletonReferencePose` | bool | false | Update skeleton's ref pose on import |
| `bCreatePhysicsAsset` | bool | true | Auto-generate UPhysicsAsset |
| `bUseHighPrecisionSkinWeights` | bool | false | 16-bit vs 8-bit skin weights |
| `BoneInfluenceLimit` | int32 | 0 (uses project default) | Max bone influences per vertex |

### Common skeletal/animation properties (`UInterchangeGenericCommonSkeletalMeshesAndAnimationsProperties`)

| Property | Notes |
|---|---|
| `Skeleton` | Soft object path to a `USkeleton` asset to reuse; leave empty to create new |
| `bImportMeshesInBoneHierarchy` | Import meshes nested in bone chains as geometry rather than converting to bones |
| `bUseT0AsRefPose` | Use frame 0 of imported animation as reference pose |

## DCC collision naming conventions

Meshes with these name prefixes are treated as custom collision primitives for the mesh
with the same base name:

| Prefix | Shape |
|---|---|
| `UCX_<MeshName>` | Convex hull |
| `UBX_<MeshName>` | Box |
| `USP_<MeshName>` | Sphere |
| `UCP_<MeshName>` | Capsule |

Example: `UCX_SM_Rock` is treated as a convex hull for `SM_Rock`.

## Axis and unit settings (`UInterchangeFbxTranslatorSettings`)

Source: `Engine/Plugins/Interchange/Runtime/Source/Import/Public/Fbx/InterchangeFbxTranslator.h`

| Property | Default | Effect |
|---|---|---|
| `bConvertScene` | true | Remap FBX axes to Unreal's left-handed Z-up system |
| `bConvertSceneUnit` | true | Scale geometry from FBX units to centimetres |
| `bForceFrontXAxis` | false | Force front axis to +X instead of -Y |
| `CoordinateSystemPolicy` | MatchUpForwardAxes | Strategy: MatchUpForwardAxes / MatchUpAxis / KeepXYZAxes |
| `bKeepFbxNamespace` | false | Retain the FBX namespace prefix in asset names |
| `bUseUfbxParser` | false | Use ufbx SDK instead of Autodesk FBX SDK (experimental) |

For glTF the translator uses the glTF 2.0 spec coordinate system (Y-up, right-handed) and
converts to Unreal automatically. No separate settings struct exposes these options in 5.7.

## Texture pipeline (`UInterchangeGenericTexturePipeline`)

Source: `Engine/Plugins/Interchange/Runtime/Source/Pipelines/Public/InterchangeGenericTexturePipeline.h`

| Property | Default | Notes |
|---|---|---|
| `bImportTextures` | true | Master toggle |
| `bDetectNormalMapTexture` | true | Auto-sets sRGB=false, Compression=Normalmap if texture looks like a normal map |
| `bFlipNormalMapGreenChannel` | false | Invert G channel for DirectX-convention normal maps |
| `bImportUDIMs` | true | Import sequences named `_1001`, `_1002`, … as UDIM textures |
| `FileExtensionsToImportAsLongLatCubemap` | `{"hdr"}` | Treat `.hdr` as a long-lat cube map |
| `bPreferCompressedSourceData` | false | Ask translator for compressed source; smaller asset, slower build |
| `bAllowNonPowerOfTwo` | false | Import NPOT textures (not all compression formats support these) |

### sRGB and compression rules

| Texture role | sRGB | Compression |
|---|---|---|
| Albedo / base color | ON | Default (BC1 opaque / BC3 with alpha) |
| Normal map | OFF | Normalmap (BC5) |
| Roughness, metallic, AO, masks | OFF | Masks (BC4/BC5) or Default depending on channels |
| HDR environment / emissive | OFF | HDR (BC6H) |
| UI elements | depends | UserInterface2D (uncompressed or BC7) |
| Height / displacement | OFF | Default or HDR |

The Interchange texture factory node (`UInterchangeTexture2DFactoryNode`) carries
`bSRGB` and `CompressionSettings` as typed attributes written by the texture pipeline.
`bDetectNormalMapTexture = true` overrides these for recognized normal maps.

## Legacy FBX pipeline settings (for reference)

When Interchange FBX is not enabled, import settings are stored in these per-type data structs
under `Engine/Source/Editor/UnrealEd/Classes/Factories/`:

| Struct | Header | Used for |
|---|---|---|
| `UFbxStaticMeshImportData` | `FbxStaticMeshImportData.h` | SM geometry + UV options |
| `UFbxSkeletalMeshImportData` | `FbxSkeletalMeshImportData.h` | SKM geometry + skeleton |
| `UFbxTextureImportData` | `FbxTextureImportData.h` | Texture settings |
| `UFbxAnimSequenceImportData` | `FbxAnimSequenceImportData.h` | Anim clip ranges |
| `UFbxImportUI` | `FbxImportUI.h` | Top-level import dialog: `EFBXImportType` (StaticMesh, SkeletalMesh, Animation) |

Legacy import is driven by `UFbxFactory` (static mesh), `UReimportFbxStaticMeshFactory`,
`UReimportFbxSkeletalMeshFactory`, etc. These factories are editor-only and cannot run at
runtime. The Interchange path is the only option for runtime import.

## Key mesh resolution and quality considerations

- **Normals**: importing DCC normals preserves custom split normals and hard/soft edge marks;
  recomputing discards them. Use `bRecomputeNormals = false` when the DCC has authored clean
  normals (most production workflows).
- **Tangents / MikkTSpace**: MikkTSpace is the standard for consistent normal-map rendering
  across Blender, Maya, and Substance. Enable both `bRecomputeTangents = true` and
  `bUseMikkTSpace = true` if the source tangents were computed with a different method.
- **Lightmap UV channel**: channel index 1 is the conventional destination. Channel 0 is
  typically the diffuse UV. Author a second, non-overlapping UV set in the DCC for maximum
  control; auto-generation works for simple shapes but can fail on complex geometry.
- **Nanite**: enabled by default in the Interchange mesh pipeline. Disable
  `bBuildNanite` for foliage, terrain patches, or assets with complex collision that shouldn't
  use Nanite (see the `nanite-and-rendering` skill).
