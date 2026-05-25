# Interchange framework — class map and data flow

Grounded in UE 5.7 engine source under
`Engine/Source/Runtime/Interchange/` and `Engine/Plugins/Interchange/`.
See [../SKILL.md](../SKILL.md) for usage patterns and gotchas.

## Module map

| Module | Location | Key types |
|---|---|---|
| `InterchangeCore` | `Engine/Source/Runtime/Interchange/Core/` | `UInterchangeTranslatorBase`, `UInterchangePipelineBase`, `UInterchangeFactoryBase`, `UInterchangeSourceData`, `UInterchangeBaseNodeContainer`, `UInterchangeBaseNode` |
| `InterchangeEngine` | `Engine/Source/Runtime/Interchange/Engine/` | `UInterchangeManager`, `UInterchangeAssetImportData`, `UInterchangeProjectSettings`, `FImportAssetParameters`, `UE::Interchange::FImportResult` |
| `InterchangeImport` | `Engine/Plugins/Interchange/Runtime/Source/Import/` | All translators: `UInterchangeFbxTranslator`, `UInterchangeGLTFTranslator`, `UInterchangeImageWrapperTranslator`, `UInterchangeAudioTranslatorBase`; all asset factories |
| `InterchangePipelines` | `Engine/Plugins/Interchange/Runtime/Source/Pipelines/` | `UInterchangeGenericMeshPipeline`, `UInterchangeGenericTexturePipeline`, `UInterchangeGenericAnimationPipeline`, `UInterchangeGenericMaterialPipeline`, `UInterchangeGenericAudioPipeline` |
| `InterchangeNodes` | `Engine/Plugins/Interchange/Runtime/Source/Nodes/` | All node types: `UInterchangeMeshNode`, `UInterchangeTextureNode`, `UInterchangeSkeletonNode`, `UInterchangeAnimationTrackSetNode`, etc. |
| `InterchangeFactoryNodes` | `Engine/Plugins/Interchange/Runtime/Source/FactoryNodes/` | All factory node types: `UInterchangeStaticMeshFactoryNode`, `UInterchangeSkeletalMeshFactoryNode`, `UInterchangeTextureFactoryNode`, etc. |
| `InterchangeDispatcher` | `Engine/Plugins/Interchange/Runtime/Source/Dispatcher/` | Out-of-process worker for FBX SDK parsing: `UE::Interchange::FInterchangeDispatcher` |
| `InterchangeEditor` | `Engine/Plugins/Interchange/Editor/Source/InterchangeEditor/` | Editor-side pipeline dialog, preview window |

## Data flow in detail

```
File on disk
     │
     ▼
UInterchangeSourceData   (wraps file path; also MD5 hash cache)
     │
     ▼  UInterchangeManager::ImportAsset[Async]
UInterchangeTranslatorBase::Translate(NodeContainer)
     │  Fills a UInterchangeBaseNodeContainer with UInterchangeBaseNode objects
     │  (scene graph: UInterchangeMeshNode, UInterchangeTextureNode, …)
     │
     ▼  Per pipeline in the stack (ordered)
UInterchangePipelineBase::ExecutePipeline(NodeContainer, SourceDatas, ContentBasePath)
     │  Reads translator nodes; creates/configures UInterchangeFactoryBaseNode objects
     │  (UInterchangeStaticMeshFactoryNode, UInterchangeTexture2DFactoryNode, …)
     │
     ▼  Per factory node
UInterchangeFactoryBase (6-step protocol):
  1. BeginImportAsset_GameThread   — allocates the UObject (game thread)
  2. ImportAsset_Async             — fills asset data (any thread, may fetch payload)
  3. EndImportAsset_GameThread     — finalizes import data (game thread)
  4. SetupObject_GameThread        — pre-build wiring
  5. BuildObject_GameThread        — triggers async asset build
  6. FinalizeObject_GameThread     — post-build fixups
     │
     ▼  Per pipeline (post-factory hooks)
UInterchangePipelineBase::ExecutePostFactoryPipeline   — before PostEditChange
UInterchangePipelineBase::ExecutePostImportPipeline    — after PostEditChange + build
UInterchangePipelineBase::ExecutePostBroadcastPipeline — after asset registry broadcast
     │
     ▼
UInterchangeAssetImportData stored as subobject on the new asset
```

## Translator classes

| Translator | Header | Formats |
|---|---|---|
| `UInterchangeFbxTranslator` | `Import/Public/Fbx/InterchangeFbxTranslator.h` | `.fbx` (out-of-process dispatcher or ufbx) |
| `UInterchangeGLTFTranslator` | `Import/Public/Gltf/InterchangeGltfTranslator.h` | `.gltf`, `.glb` |
| `UInterchangeImageWrapperTranslator` | `Import/Public/Texture/InterchangeImageWrapperTranslator.h` | PNG, TGA, BMP, JPEG, EXR, HDR |
| `UInterchangeDDSTranslator` | `Import/Public/Texture/InterchangeDDSTranslator.h` | `.dds` |
| `UInterchangeJPGTranslator` | `Import/Public/Texture/InterchangeJPGTranslator.h` | `.jpg`, `.jpeg` |
| `UInterchangePSDTranslator` | `Import/Public/Texture/InterchangePSDTranslator.h` | `.psd` |
| `UInterchangeIESTranslator` | `Import/Public/Texture/InterchangeIESTranslator.h` | `.ies` light profiles |
| `UInterchangeAudioTranslator_WAV` | `Import/Public/Audio/Formats/InterchangeAudioTranslator_WAV.h` | `.wav` |
| `UInterchangeAudioTranslator_FLAC` | `Import/Public/Audio/Formats/InterchangeAudioTranslator_FLAC.h` | `.flac` |
| `UInterchangeAudioTranslator_OGG` | `Import/Public/Audio/Formats/InterchangeAudioTranslator_OGG.h` | `.ogg` |
| `UInterchangeOBJTranslator` | `Import/Public/Mesh/InterchangeOBJTranslator.h` | `.obj` |

Each translator implements `UInterchangeTranslatorBase::Translate(UInterchangeBaseNodeContainer&)`,
filling the node container from the source file. Translators also implement payload interfaces
(`IInterchangeMeshPayloadInterface`, `IInterchangeTexturePayloadInterface`, etc.) so factories
can fetch bulk data (geometry, pixel data) on demand without re-opening the file.

The FBX translator by default spawns an out-of-process `InterchangeWorker` via
`UE::Interchange::FInterchangeDispatcher` to isolate the Autodesk FBX SDK from the editor
process. Setting `bUseUfbxParser = true` bypasses this and uses the open-source ufbx library
in-process (experimental in 5.7).

## Factory node types

Factory nodes are pure data descriptions of the asset to create. The pipeline populates them;
factories consume them.

| Factory node | Header | Creates |
|---|---|---|
| `UInterchangeStaticMeshFactoryNode` | `FactoryNodes/Public/InterchangeStaticMeshFactoryNode.h` | `UStaticMesh` |
| `UInterchangeSkeletalMeshFactoryNode` | `FactoryNodes/Public/InterchangeSkeletalMeshFactoryNode.h` | `USkeletalMesh` |
| `UInterchangeSkeletonFactoryNode` | `FactoryNodes/Public/InterchangeSkeletonFactoryNode.h` | `USkeleton` |
| `UInterchangeTexture2DFactoryNode` | `FactoryNodes/Public/InterchangeTexture2DFactoryNode.h` | `UTexture2D` |
| `UInterchangeTextureCubeFactoryNode` | `FactoryNodes/Public/InterchangeTextureCubeFactoryNode.h` | `UTextureCube` |
| `UInterchangeAnimSequenceFactoryNode` | `FactoryNodes/Public/InterchangeAnimSequenceFactoryNode.h` | `UAnimSequence` |
| `UInterchangeAudioSoundWaveFactoryNode` | `FactoryNodes/Public/InterchangeAudioSoundWaveFactoryNode.h` | `USoundWave` |
| `UInterchangeMaterialFactoryNode` | `FactoryNodes/Public/InterchangeMaterialFactoryNode.h` | `UMaterial` / `UMaterialInstance` |
| `UInterchangePhysicsAssetFactoryNode` | `FactoryNodes/Public/InterchangePhysicsAssetFactoryNode.h` | `UPhysicsAsset` |

## Node container and node graph

`UInterchangeBaseNodeContainer` holds two parallel node trees:
- **Translator nodes** — describe what the source file contains (read by pipelines).
- **Factory nodes** — describe what UE assets to create (written by pipelines, consumed by factories).

Each node has a unique string UID. Pipelines iterate translator nodes, decide which assets to
create, and add/configure corresponding factory nodes. The node container is serialized into
`UInterchangeAssetImportData` for reimport.

## Pipeline context and `AdjustSettingsForContext`

`UInterchangePipelineBase::AdjustSettingsForContext(const FInterchangePipelineContextParams&)`
is called before `ExecutePipeline`. Pipelines use it to change defaults or property
visibility depending on `EInterchangePipelineContext`:

- `AssetImport` / `AssetReimport` — standard content browser import.
- `SceneImport` / `SceneReimport` — Import Into Level.
- `AssetCustomLODImport` — LOD import into an existing mesh.
- `AssetAlternateSkinningImport` — alternate skinning profiles.

## Pipeline stack configuration

Pipeline stacks are configured in **Project Settings > Engine > Interchange** and stored in
`FInterchangePipelineStack` (see `InterchangeProjectSettings.h`). Each stack entry is a
`FSoftObjectPath` to a pipeline asset. The stack can have per-translator overrides via
`FInterchangeTranslatorPipelines`.

Override programmatically by populating `FImportAssetParameters::OverridePipelines`:

```cpp
FImportAssetParameters Params;
Params.OverridePipelines.Add(FSoftObjectPath(TEXT(
    "/Game/ImportPipelines/MyMeshPipeline.MyMeshPipeline")));
```

## Registering custom translators and factories

In a module `StartupModule`:

```cpp
UInterchangeManager& Mgr = UInterchangeManager::GetInterchangeManager();
Mgr.RegisterTranslator(UMyCustomTranslator::StaticClass());
Mgr.RegisterFactory(UMyCustomFactory::StaticClass());
```

`UInterchangeManager` stores one registered factory per target `UClass`
(`RegisteredFactoryClasses` map). The first registered translator whose
`CanImportSourceData` returns true for a given source file is selected.
