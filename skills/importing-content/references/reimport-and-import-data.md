# Reimport and import asset data

Grounded in UE 5.7 engine source under
`Engine/Source/Runtime/Interchange/Engine/Public/` and
`Engine/Source/Runtime/Engine/Classes/EditorFramework/`.
See [../SKILL.md](../SKILL.md) for the mental model and import API overview.

## Import provenance model

Every imported asset stores its source file information in a `UAssetImportData`-derived
subobject. This is what enables reimport and what the Interchange manager reads when
`CanReimport` is called.

### Base class: `UAssetImportData`

Source: `Engine/Source/Runtime/Engine/Classes/EditorFramework/AssetImportData.h`

`UAssetImportData` holds a `FAssetImportInfo` containing an array of `FSourceFile` entries:

```cpp
struct FSourceFile
{
    FString RelativeFilename;  // path relative to asset package or BaseDir()
    FDateTime Timestamp;       // UTC timestamp when imported
    FMD5Hash FileHash;         // MD5 of file at import time
    FString DisplayLabelName;  // label shown in Properties panel
};
```

This allows the editor to detect when the source file has changed since the last import.

### Interchange subclass: `UInterchangeAssetImportData`

Source: `Engine/Source/Runtime/Interchange/Engine/Public/InterchangeAssetImportData.h`

`UInterchangeAssetImportData` extends `UAssetImportData` with:

| Member / method | Purpose |
|---|---|
| `NodeUniqueID` (`FString UPROPERTY`) | UID of the factory node that created this asset within the node container |
| `GetNodeContainer()` / `SetNodeContainer()` | Snapshot of the `UInterchangeBaseNodeContainer` used during import — gives pipelines access to the full translated node graph on reimport |
| `GetPipelines()` / `SetPipelines()` | The pipeline stack (`TArray<UObject*>`) used at import time, serialised as JSON pairs `(ClassName, JsonData)` |
| `GetTranslatorSettings()` / `SetTranslatorSettings()` | The `UInterchangeTranslatorSettings` instance (e.g. `UInterchangeFbxTranslatorSettings`) that was active |
| `GetStoredNode(NodeUID)` | Look up a specific translator node from the stored container |
| `GetStoredFactoryNode(NodeUID)` | Look up a factory node from the stored container |
| `GetFromObject(UObject*)` | Static helper — finds the `UInterchangeAssetImportData` subobject on any asset |

Because the pipeline list is serialised as JSON strings (not direct object references),
the pipeline state survives class renames provided the `UClass` name is stable.

### Legacy FBX subclasses

When imported via the legacy FBX path, assets carry:

- `UFbxAssetImportData` (base, under `Editor/UnrealEd/Classes/Factories/FbxAssetImportData.h`)
- `UFbxStaticMeshImportData` — static mesh–specific settings
- `UFbxSkeletalMeshImportData` — skeletal mesh–specific settings
- `UFbxTextureImportData` — texture settings

These do not carry a node container or pipeline list; they store flat property values
matching the `UFbxImportUI` dialog options.

## Reading import data in C++

```cpp
// Find Interchange import data on an existing asset.
if (UInterchangeAssetImportData* ImpData =
        UInterchangeAssetImportData::GetFromObject(MyStaticMesh))
{
    // Source file paths.
    TArray<FString> SourceFiles = ImpData->ScriptExtractFilenames();

    // Pipeline list stored at import time.
    TArray<UObject*> Pipelines = ImpData->GetPipelines();

    // Translator settings (cast to the concrete type).
    if (const UInterchangeFbxTranslatorSettings* FbxSettings =
            Cast<UInterchangeFbxTranslatorSettings>(ImpData->GetTranslatorSettings()))
    {
        bool bWasConvertingScene = FbxSettings->bConvertScene;
    }
}
```

## Reimport workflow

### Programmatic reimport via `UInterchangeManager`

```cpp
// Synchronous reimport (editor only).
UInterchangeManager& Mgr = UInterchangeManager::GetInterchangeManager();
FImportAssetParameters Params;
Params.bIsAutomated = true;
TArray<UObject*> Out;
Mgr.ReimportAsset(MyStaticMesh, Params, Out);

// Async reimport with a completion callback.
UE::Interchange::FAssetImportResultRef Result =
    Mgr.ReimportAssetAsync(MyStaticMesh, Params);
Result->OnDone([](UE::Interchange::FImportResult& R)
{
    UE_LOG(LogTemp, Log, TEXT("Reimport finished, %d assets"), R.GetImportedObjects().Num());
});
```

Key behaviours:
- `ReimportAsset` resolves the source file from `UInterchangeAssetImportData::ScriptGetFirstFilename()`.
- If `bIsAutomated = false` and the source file is missing, a dialog asks the user to locate
  the file. If `bIsAutomated = true`, the call returns false and logs a warning.
- `CanReimport(Object, OutFilenames)` returns true when the object has a compatible
  `UInterchangeAssetImportData` (or a legacy import data subobject that a registered converter
  can migrate).

### Checking whether reimport is available

```cpp
TArray<FString> SourceFiles;
if (UInterchangeManager::GetInterchangeManager().CanReimport(MyAsset, SourceFiles))
{
    // SourceFiles contains resolved absolute paths.
}
```

### Reimport with a different source file

To reimport from a different file, create a new `UInterchangeSourceData` and call `ImportAsset`
with `FImportAssetParameters::ReimportAsset` set:

```cpp
UInterchangeSourceData* NewSrc =
    UInterchangeManager::CreateSourceData(TEXT("D:/Art/Rock_v2.glb"));
FImportAssetParameters Params;
Params.ReimportAsset = MyStaticMesh;
Params.bIsAutomated = true;
Mgr.ImportAsset(TEXT("/Game/Meshes"), NewSrc, Params);
```

## Migrating legacy FBX import data to Interchange

When a project that originally used the legacy FBX importer begins using Interchange,
assets will have `UFbxStaticMeshImportData` instead of `UInterchangeAssetImportData`.
Interchange provides a `UInterchangeAssetImportDataConverterBase` mechanism:

- `UInterchangeManager::RegisterImportDataConverter(ConverterClass)` registers a converter.
- `UInterchangeManager::ConvertImportData(Asset, Extension)` walks registered converters
  until one can migrate the asset's import data.
- The engine ships a built-in FBX → Interchange converter that promotes legacy data when
  reimporting via the Interchange path.

After migration, the asset's `AssetImportData` subobject is replaced with
`UInterchangeAssetImportData`, and subsequent reimports use the Interchange path.

## Source data backup and rollback

`UInterchangeAssetImportData` supports transactional source backup for reimport cancellation:

```cpp
ImpData->BackupSourceData();   // save current source file list before reimport
// … reimport …
ImpData->ClearBackupSourceData();  // on success: drop the backup
// or:
ImpData->ReinstateBackupSourceData();  // on cancel: restore original source list
```

This mechanism keeps the original source path if the user cancels a reimport mid-flight.

## Interchange result object (`UE::Interchange::FImportResult`)

`FImportResult` (in `InterchangeManager.h`) tracks async import progress:

| Method | Purpose |
|---|---|
| `GetStatus()` | `Invalid`, `InProgress`, or `Done` |
| `WaitUntilDone(bSynchronous)` | Block or spin until complete |
| `GetImportedObjects()` | Array of all created `UObject*` (available only after `Done`) |
| `GetFirstAssetOfClass(UClass*)` | Convenience accessor for single-asset imports |
| `GetResults()` | Returns `UInterchangeResultsContainer` with warnings/errors |
| `OnDone(Callback)` | Register a `TFunction<void(FImportResult&)>` fired when complete |

`OnAssetDone` (dynamic delegate) is the Blueprint-callable per-asset callback.

## Runtime import considerations

Interchange supports runtime import in packaged builds; the legacy FBX importer is
editor-only. To enable runtime Interchange:

1. Enable the **Interchange Framework** and **Interchange Editor** plugins.
2. Add `/Engine/Plugins/Interchange/Runtime/Content` to
   **Project Settings > Packaging > Additional Asset Directories to Cook**.
3. Use `UInterchangeManager::ImportAssetAsync` (not `ImportAsset`, which requires the
   game thread to be free for the synchronous phase).
4. Skeletal mesh and animation import is not supported in the runtime Blueprint import
   example; use C++ for full format coverage.
5. For shipping titles, audit which translators are needed and strip unused ones to reduce
   binary size (translators register themselves in plugin startup code).
