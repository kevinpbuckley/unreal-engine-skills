---
name: importing-content
description: Import external assets into Unreal using the Interchange framework (UInterchangeManager,
  UInterchangePipelineBase, UInterchangeFactoryBase, UInterchangeTranslatorBase, UInterchangeSourceData)
  and the legacy FBX pipeline (UFbxFactory / UnFbx::FFbxImporter). Covers the three-stage
  Interchange pipeline (translate → pipeline → factory), pipeline stacks, format support
  (FBX, glTF/GLB, OBJ, USD, images, audio), mesh and texture import settings (units/axes,
  normals, lightmap UVs, Nanite, sRGB/compression), skeletal mesh skeleton assignment,
  import asset data (UInterchangeAssetImportData / UAssetImportData), and programmatic
  runtime import via C++, Blueprint, and Python. Use when importing DCC content, troubleshooting
  wrong scale/rotation/shading after import, scripting automated batch import, customising
  an import pipeline, or setting up a repeatable reimport workflow.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Importing content

Most "it looks wrong in Unreal" problems are import-settings problems. Know the Interchange
framework's data flow, the settings that change geometry and shading, and how assets store
their import provenance so reimport stays predictable.

## When to use this skill

- Importing static meshes, skeletal meshes, textures, or audio from Blender, Maya, Substance
  Painter, or other DCC tools.
- Wrong scale, rotation, flipped normals, or washed-out/over-saturated textures after import.
- Setting up skeleton assignment and morph targets for character assets.
- Writing automated batch import via `UInterchangeManager` in C++, Blueprint, or Python.
- Customising an import pipeline (C++ subclass, Blueprint, or Python) to enforce project
  conventions.
- Debugging why reimport does not pick up the expected source file or settings.

## Pipelines: Interchange vs legacy

**Interchange** (default for glTF, GLB, OBJ, most images, audio; experimental opt-in for FBX)
is the modern framework. Every import passes through three stages:

1. **Translator** — reads the file into a format-neutral `UInterchangeBaseNodeContainer` (a
   graph of `UInterchangeBaseNode` objects representing meshes, bones, textures, etc.).
2. **Pipeline stack** — a user-configured ordered list of `UInterchangePipelineBase` objects
   that transform translator nodes into *factory nodes* (what to create, with what settings).
3. **Factory** — a `UInterchangeFactoryBase` subclass that creates the final `UObject` asset
   (e.g. `UInterchangeStaticMeshFactory`, `UInterchangeTextureFactory`).

The **legacy FBX importer** (`UFbxFactory` / `UnFbx::FFbxImporter`) handles FBX by default
when Interchange FBX is not opted in. It has its own import dialog and options struct
(`UFbxImportUI`). Both paths record source file data in a `UAssetImportData`-derived object on
the asset.

See [references/interchange-framework.md](references/interchange-framework.md) for a full
breakdown of all Interchange classes, module locations, and the factory six-step protocol.

## Supported formats

| Asset type | Interchange formats | Legacy/other |
|---|---|---|
| Static mesh | glTF, GLB, OBJ, FBX (experimental) | FBX (legacy) |
| Skeletal mesh + animation | glTF, GLB, FBX (experimental) | FBX (legacy) |
| Texture | PNG, TGA, JPEG, EXR, HDR, DDS, IES, PSD, BMP | — |
| Audio | WAV, AIF/AIFF, FLAC, OGG, OPUS, MP3 | — |
| Scene / level import | glTF, GLB, FBX (experimental), MaterialX | FBX scene legacy |

FBX import via Interchange is experimental in 5.7; enable with the console variable
`Interchange.FeatureFlags.Import.FBX 1` (and `.ToLevel 1` for scene import).

## Units, scale, and axes

Unreal world units are **centimetres**. Meshes exported at the wrong scale require
actor-level rescaling and break physics.

- FBX: `UInterchangeFbxTranslatorSettings::bConvertSceneUnit = true` (default) converts to
  cm automatically. Prefer exporting at 1 unit = 1 cm from the DCC.
- Axis: Unreal is **left-handed, Z-up**. `bConvertScene = true` (default) remaps Y/Z from
  right-handed sources. `EInterchangeCoordinateSystemPolicy` controls the exact strategy:
  `MatchUpForwardAxes` (default), `MatchUpAxis`, or `KeepXYZAxes`.
- Apply all transforms / freeze rotation in the DCC before export; baked-in offsets
  appear as permanent root-bone offsets on skeletal meshes.

## Mesh import settings that matter

These map to properties on `UInterchangeGenericMeshPipeline` (Interchange) or
`UFbxStaticMeshImportData` / `UFbxSkeletalMeshImportData` (legacy):

| Setting | Effect | Common mistake |
|---|---|---|
| **Combine Static Meshes** (`bCombineStaticMeshes`) | Merges all meshes in the file into one SM | Leave off when file has multiple independent assets |
| **Normals / Tangents** (`Build` > Recompute Normals/Tangents) | Trust DCC normals vs let UE recompute | Mismatch causes shading seams at UV splits |
| **Generate Lightmap UVs** (`bGenerateLightmapUVs`) | Auto-generates a second UV channel for Lightmass | Needed for baked lighting; off for pure Lumen |
| **Build Nanite** (`bBuildNanite`) | Enables Nanite on static meshes | On by default in 5.7 Interchange; disable for low-poly props |
| **LOD Group** | Assigns Epic's LOD reduction presets | Pick `SmallProp`, `LargeDetail`, etc. to match use case |
| **Collision** (`bCollision`) | Imports/generates simple collision | Prefix meshes with `UCX_`, `UBX_`, `USP_`, `UCP_` for custom shapes |

Skeletal mesh–specific:

- **Skeleton** (`CommonSkeletalMeshesAndAnimationsProperties`) — reuse one skeleton asset
  across compatible meshes so all animations are shareable.
- **Import Content Type** — `GeometryAndSkinningWeights`, `GeometryOnly`, or
  `SkinningWeightsOnly`. Split imports can be parallelised for large character updates.
- **Import Morph Targets** — imports blend shapes from FBX/glTF morph target data.
- **Create Physics Asset** — auto-generates a `UPhysicsAsset` if none exists.

See [references/mesh-and-texture-import.md](references/mesh-and-texture-import.md) for the
full mesh and texture settings reference with source-verified property names.

## Texture import settings that matter

| Setting | Correct value | Consequence of wrong value |
|---|---|---|
| **sRGB** | ON for color/albedo; OFF for data maps | Data maps (normal, roughness, metallic, masks) with sRGB ON look wrong in lighting |
| **Compression** | `Default` (BC1/BC3) for color; `Normalmap` (BC5) for normals; `Masks`; `HDR` for EXR/HDR | Wrong compression costs memory or quality |
| **Flip Normal Map Green Channel** | Match DCC convention (on for Maya/DirectX, off for Blender/OpenGL-style) | Specular highlight in wrong direction |
| **Detect Normal Map Texture** | ON (default) | Leave on; it sets sRGB=false and compression=Normalmap automatically |
| **UDIM** (`bImportUDIMs`) | ON for assets with UDIM naming (`_1001`, `_1002`, …) | Multi-tile textures import as separate unrelated assets |

Texture compression and LOD group are stored on the `UTexture2D` asset; change them in the
Texture Editor or set them in a custom pipeline's `ExecutePostFactoryPipeline`.

## Import asset data and reimport

Every imported asset stores provenance in a `UAssetImportData`-derived subobject:

- **Interchange path**: `UInterchangeAssetImportData` (subclass of `UAssetImportData`)
  stores the source file path, the translator settings, the pipeline list, and the node
  container snapshot. Accessible with `UInterchangeAssetImportData::GetFromObject(Asset)`.
- **Legacy FBX path**: `UFbxAssetImportData` / `UFbxStaticMeshImportData` (subclasses of
  `UAssetImportData`).
- The base class `UAssetImportData` stores source file path, timestamp, and MD5 hash in
  `FAssetImportInfo::FSourceFile` entries — enabling reimport to detect stale files.

Reimport replays the same pipeline stack and settings stored in the import data. Call
`UInterchangeManager::ReimportAsset` / `ReimportAssetAsync` programmatically; the manager
reads `UInterchangeAssetImportData` to resolve the original source file.

See [references/reimport-and-import-data.md](references/reimport-and-import-data.md) for the
full reimport workflow, programmatic API examples, and how to migrate legacy FBX import data.

## Programmatic import via C++

```cpp
// Create a source data handle pointing to a file on disk.
UInterchangeSourceData* Src =
    UInterchangeManager::CreateSourceData(TEXT("D:/Art/Rock.glb"));

// Build import parameters.
FImportAssetParameters Params;
Params.bIsAutomated = true;  // suppress dialogs

// Synchronous import (editor-only; blocking on game thread).
UInterchangeManager& Mgr = UInterchangeManager::GetInterchangeManager();
TArray<UObject*> Imported;
Mgr.ImportAsset(TEXT("/Game/Meshes"), Src, Params, Imported);

// Async import with a completion callback.
UE::Interchange::FAssetImportResultRef Result =
    Mgr.ImportAssetAsync(TEXT("/Game/Meshes"), Src, Params);
Result->OnDone([](UE::Interchange::FImportResult& R)
{
    for (UObject* Obj : R.GetImportedObjects())
    {
        UE_LOG(LogTemp, Log, TEXT("Imported: %s"), *Obj->GetName());
    }
});
```

Key API points:
- `UInterchangeManager` is a singleton; use `GetInterchangeManager()` (native) or
  `GetInterchangeManagerScripted()` (Blueprint/Python callable).
- `FImportAssetParameters::OverridePipelines` accepts a list of `FSoftObjectPath`s to bypass
  the project-default pipeline stack with a custom one.
- `FImportAssetParameters::bIsAutomated = true` prevents any modal dialog from opening —
  essential for unattended batch import.
- For runtime import in a cooked build, the `Interchange` content folder must be added to
  **Project Settings > Packaging > Additional Asset Directories to Cook**.

## Writing a custom pipeline in C++

Subclass `UInterchangePipelineBase` and override the virtual pipeline hooks:

```cpp
// MyImportPipeline.h
#pragma once
#include "InterchangePipelineBase.h"
#include "MyImportPipeline.generated.h"

UCLASS(BlueprintType, editinlinenew)
class MYMODULE_API UMyImportPipeline : public UInterchangePipelineBase
{
    GENERATED_BODY()

    /** Shown in the Interchange dialog; locked during reimport. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "My Settings",
              meta = (ReimportRestrict = "true"))
    bool bEnforceNamingConvention = true;

protected:
    virtual void ExecutePipeline(
        UInterchangeBaseNodeContainer* NodeContainer,
        const TArray<UInterchangeSourceData*>& SourceDatas,
        const FString& ContentBasePath) override;

    virtual void ExecutePostFactoryPipeline(
        const UInterchangeBaseNodeContainer* NodeContainer,
        const FString& FactoryNodeKey,
        UObject* CreatedAsset,
        bool bIsAReimport) override;
};
```

- `ExecutePipeline` fires after translation; add/modify factory nodes to control what assets
  get created and with what settings.
- `ExecutePostFactoryPipeline` fires after the factory creates the asset but before
  `PostEditChange`; modify the live `UObject` here.
- `ExecutePostImportPipeline` fires after `PostEditChange` and async build; use for
  post-build fixups (e.g. setting socket transforms that depend on render data).
- Mark properties `ReimportRestrict = "true"` to prevent them being changed during reimport.

Register the pipeline asset in your project's pipeline stack via **Project Settings >
Engine > Interchange** or pass it via `FImportAssetParameters::OverridePipelines`.

## Naming conventions

`SM_` static mesh · `SK_` skeletal mesh · `SKEL_` skeleton · `T_` texture · `M_` material ·
`MI_` material instance · `A_` / `S_` sound · `BP_` Blueprint · `DA_` data asset ·
`DT_` data table. Consistent prefixes make content browsable and scriptable.

## Gotchas

- **Wrong scale** — almost always DCC export units or `bConvertSceneUnit` mismatch; fix at
  source, not by scaling actors. A 100× scale error is common when Blender units = meters.
- **sRGB on for normal/data maps** → wrong lighting; `bDetectNormalMapTexture` catches it
  for textures whose names follow conventions, but verify manually.
- **Reimporting against a different skeleton** — animations bound to the old skeleton break;
  keep one skeleton per character rig.
- **bCombineStaticMeshes** on for files with separate per-material meshes → single SM with
  multiple material slots instead of independent assets.
- **Missing lightmap UVs with baked lighting** → splotchy shadows; enable
  `bGenerateLightmapUVs` or author a dedicated UV channel.
- **FBX via Interchange is experimental in 5.7** — if a project needs stable FBX, stay on the
  legacy importer until opting in intentionally.
- **Runtime import without cooking the Interchange folder** → pipelines missing at runtime;
  add `/Engine/Plugins/Interchange/Runtime/Content` to packaging cook paths.
- **Large batches saturate the task graph** — use `ImportAssetAsync` and throttle concurrent
  calls; `UInterchangeManager::IsImporting()` checks whether an import is in flight.

## Version notes

- Interchange is the default importer for glTF/GLB and most textures since UE 5.0; it has
  expanded each release. In 5.7 FBX support via Interchange is experimental (opt-in).
- `UInterchangeAssetImportData` replaces per-format import data classes for Interchange-
  handled assets; legacy paths still produce `UFbxAssetImportData` etc.
- `UInterchangeFbxTranslatorSettings::bUseUfbxParser` (experimental in 5.7) enables the
  ufbx SDK instead of the Autodesk FBX SDK — useful for open-source builds.

## References & source material

Engine source (UE 5.7):

Core Interchange (under `Engine/Source/Runtime/Interchange/`):
- `Engine/Public/InterchangeManager.h` — `UInterchangeManager` singleton, `ImportAsset`:615,
  `ImportAssetAsync`:649, `ReimportAsset`:678, `CreateSourceData`:771, `CanReimport`:601,
  `GetTranslatorForSourceData`:802, `FImportAssetParameters`:382.
- `Core/Public/InterchangeTranslatorBase.h` — `UInterchangeTranslatorBase`:67,
  `Translate()`:102, `GetSupportedFormats()`:94, `CanImportSourceData()`:74.
- `Core/Public/InterchangePipelineBase.h` — `UInterchangePipelineBase`:216,
  `ExecutePipeline`:582, `ExecutePostFactoryPipeline`:591, `ExecutePostImportPipeline`:599,
  `EInterchangePipelineContext`:43, `EInterchangePipelineTask`:34.
- `Core/Public/InterchangeFactoryBase.h` — `UInterchangeFactoryBase`:67,
  `BeginImportAsset_GameThread`:147, `ImportAsset_Async`:175, `EndImportAsset_GameThread`:191,
  `SetupObject_GameThread`:291, `BuildObject_GameThread`:304, `FinalizeObject_GameThread`:320.
- `Core/Public/InterchangeSourceData.h` — `UInterchangeSourceData`:22, `GetFilename()`,
  `SetFilename()`, `GetFileContentHash()`.
- `Engine/Public/InterchangeAssetImportData.h` — `UInterchangeAssetImportData`:20,
  `GetFromObject()`:118, `GetNodeContainer()`:142, `GetPipelines()`:151,
  `GetTranslatorSettings()`:167.
- `Engine/Public/InterchangeProjectSettings.h` — `FInterchangePipelineStack`:31.

Interchange plugin (under `Engine/Plugins/Interchange/Runtime/Source/`):
- `Import/Public/Fbx/InterchangeFbxTranslator.h` — `UInterchangeFbxTranslator`:77,
  `UInterchangeFbxTranslatorSettings`:34 (`bConvertScene`, `bConvertSceneUnit`,
  `bForceFrontXAxis`, `EInterchangeCoordinateSystemPolicy`).
- `Import/Public/Gltf/InterchangeGltfTranslator.h` — `UInterchangeGLTFTranslator`:26.
- `Pipelines/Public/InterchangeGenericMeshPipeline.h` — `UInterchangeGenericMeshPipeline`:32
  (`bImportStaticMeshes`, `bCombineStaticMeshes`, `bBuildNanite`, `bGenerateLightmapUVs`,
  `bCollision`, `bImportSkeletalMeshes`, `SkeletalMeshImportContentType`).
- `Pipelines/Public/InterchangeGenericTexturePipeline.h` — `UInterchangeGenericTexturePipeline`:19
  (`bImportTextures`, `bDetectNormalMapTexture`, `bFlipNormalMapGreenChannel`, `bImportUDIMs`).
- `Pipelines/Public/InterchangeGenericAnimationPipeline.h` — animation settings.
- `FactoryNodes/Public/InterchangeStaticMeshFactoryNode.h` — `UInterchangeStaticMeshFactoryNode`.
- `FactoryNodes/Public/InterchangeSkeletalMeshFactoryNode.h` — `UInterchangeSkeletalMeshFactoryNode`.
- `FactoryNodes/Public/InterchangeTextureFactoryNode.h` — `UInterchangeTextureFactoryNode`.

Legacy FBX (under `Engine/Source/Editor/UnrealEd/Classes/Factories/`):
- `Factory.h` — `UFactory`:45 (base class for all legacy import factories).
- `FbxImportUI.h` — `UFbxImportUI`, `EFBXImportType`.
- `FbxStaticMeshImportData.h`, `FbxSkeletalMeshImportData.h`, `FbxTextureImportData.h`
  — per-type legacy settings structs.

Runtime Engine:
- `Engine/Classes/EditorFramework/AssetImportData.h` — `UAssetImportData`:71,
  `FAssetImportInfo::FSourceFile` (path, timestamp, MD5 hash).

Official docs (UE 5.7, all fetched and verified):
- Interchange Framework —
  <https://dev.epicgames.com/documentation/unreal-engine/interchange-framework-in-unreal-engine>
- Importing Assets Using Interchange —
  <https://dev.epicgames.com/documentation/unreal-engine/importing-assets-using-interchange-in-unreal-engine>
- Interchange Import Reference —
  <https://dev.epicgames.com/documentation/unreal-engine/interchange-import-reference-in-unreal-engine>
- Interchange Development Guides —
  <https://dev.epicgames.com/documentation/unreal-engine/interchange-development-guides>
- FBX Content Pipeline —
  <https://dev.epicgames.com/documentation/unreal-engine/fbx-content-pipeline>
- Working with Content —
  <https://dev.epicgames.com/documentation/unreal-engine/working-with-content-in-unreal-engine>

Deep-dive references in this skill:
- [references/interchange-framework.md](references/interchange-framework.md) — Interchange
  class map, module locations, node types, dispatcher, and factory protocol.
- [references/mesh-and-texture-import.md](references/mesh-and-texture-import.md) — full
  mesh and texture pipeline settings with source-verified property names.
- [references/reimport-and-import-data.md](references/reimport-and-import-data.md) — reimport
  workflow, `UInterchangeAssetImportData` API, and legacy FBX import data migration.

Related skills: `meshes-static-and-skeletal`, `materials-and-shaders`, `asset-management`,
`audio-and-metasounds`, `editor-scripting-and-python`.
