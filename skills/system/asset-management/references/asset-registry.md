# Asset Registry — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `IAssetRegistry` in detail: obtaining the
registry, query methods, filter construction, searchable tags, async discovery callbacks,
dependency/referencer queries, and cooked-game behavior. Grounded in UE 5.7
(`Engine/Source/Runtime/AssetRegistry/Public/AssetRegistry/IAssetRegistry.h` and
`AssetRegistryModule.h`).

## What the Asset Registry is

The Asset Registry is an engine subsystem that indexes metadata from `.uasset` file headers
without loading the assets themselves. The editor populates it asynchronously at startup; cooked
games load a serialized snapshot instead. `FAssetData` is the per-asset record it returns.

## Accessing the registry

```cpp
#include "AssetRegistry/AssetRegistryModule.h"

// Module-load approach (works anywhere, safe during editor startup):
IAssetRegistry& AR =
    FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry").Get();

// Static shortcut (UE 5.1+, preferred in gameplay code):
IAssetRegistry& AR = IAssetRegistry::GetChecked();
```

Add `"AssetRegistry"` to `PublicDependencyModuleNames` in `Build.cs`.

## FAssetData fields

| Field | Type | Description |
|---|---|---|
| `PackageName` | `FName` | e.g. `/Game/Weapons/SM_Rifle` |
| `PackagePath` | `FName` | e.g. `/Game/Weapons` |
| `AssetName` | `FName` | e.g. `SM_Rifle` |
| `AssetClassPath` | `FTopLevelAssetPath` | fully-qualified class path (UE5+) |
| `TagsAndValues` | `TMap<FName,FString>` | searchable UPROPERTY values |

Convert to a loaded object with `AssetData.GetAsset()` (triggers a load) or check if already
loaded with `AssetData.IsAssetLoaded()`.

```cpp
FSoftObjectPath Path = AssetData.ToSoftObjectPath();   // use for async loading
```

## Single-criterion query methods

All declared in `IAssetRegistry.h`:

| Method | Signature summary | Line |
|---|---|---|
| `GetAssetsByClass` | `(FTopLevelAssetPath, TArray<FAssetData>&, bool bSubClasses)` | 333 |
| `GetAssetsByPath` | `(FName PackagePath, TArray<FAssetData>&, bool bRecursive)` | 309 |
| `GetAssetsByPackageName` | `(FName PackageName, TArray<FAssetData>&)` | 296 |
| `GetAssetsByTags` | `(TArray<FName> Tags, TArray<FAssetData>&)` | 341 |
| `GetAssetsByTagValues` | `(TMultiMap<FName,FString>, TArray<FAssetData>&)` | 349 |

```cpp
// Find all UStaticMesh assets including subclasses:
TArray<FAssetData> Meshes;
AR.GetAssetsByClass(UStaticMesh::StaticClass()->GetClassPathName(), Meshes, true);
```

## Multi-criterion filter (FARFilter)

`FARFilter` lets you combine class, path, and tag criteria in a single call to `GetAssets()`:

```cpp
#include "AssetRegistry/ARFilter.h"

FARFilter Filter;
Filter.ClassPaths.Add(UStaticMesh::StaticClass()->GetClassPathName());
Filter.PackagePaths.Add(TEXT("/Game/Environment"));
Filter.bRecursivePaths = true;
Filter.bRecursiveClasses = true;           // include UStaticMesh subclasses too

TArray<FAssetData> Results;
AR.GetAssets(Filter, Results);             // IAssetRegistry.h:361
```

An asset passes the filter when it satisfies **all** populated components. Within each component
(e.g. `ClassPaths`), it matches **any** element (OR within, AND across components).

To add tag-value criteria:
```cpp
Filter.TagsAndValues.Add(FName("MyTag"), FString("ExpectedValue"));
```

## Making properties searchable

Mark a `UPROPERTY` with `AssetRegistrySearchable` so its value appears in `TagsAndValues`
without loading the asset:
```cpp
UPROPERTY(AssetRegistrySearchable, EditDefaultsOnly, Category=Meta)
FName WeaponType;
```
Assets must be **resaved** after adding this flag before the value shows up in the registry.
Override `GetAssetRegistryTags()` in your class to add computed or non-property entries:
```cpp
virtual void GetAssetRegistryTags(FAssetRegistryTagsContext Context) const override;
```

## Dependency and referencer queries

Find what an asset depends on (hard/soft references to other packages):
```cpp
TArray<FName> Deps;
AR.GetDependencies(FName("/Game/Weapons/W_Rifle"), Deps,
    UE::AssetRegistry::EDependencyCategory::Package);   // IAssetRegistry.h:511
```

Find which assets reference a given package:
```cpp
TArray<FName> Refs;
AR.GetReferencers(FName("/Game/Materials/M_Metal"), Refs,
    UE::AssetRegistry::EDependencyCategory::Package);   // IAssetRegistry.h:574
```
These are graph queries and can be slow for deep dependency trees. Run offline (editor/commandlet)
or cache results rather than calling per-frame.

## Async discovery and change callbacks

In the editor, the Asset Registry populates asynchronously. Subscribe to events to react
to discovery or changes:

```cpp
AR.OnAssetAdded().AddUObject(this, &UMySubsystem::OnAssetAdded);
AR.OnAssetRemoved().AddUObject(this, &UMySubsystem::OnAssetRemoved);
AR.OnAssetRenamed().AddUObject(this, &UMySubsystem::OnAssetRenamed);
AR.OnFilesLoaded().AddUObject(this, &UMySubsystem::OnRegistryReady);  // initial scan done
```

Check whether the initial scan is still in progress:
```cpp
if (AR.IsLoadingAssets())
{
    // subscribe to OnFilesLoaded and defer work
}
```

Callbacks fire only in **editor** builds (and standalone game builds launched without cooking).
In packaged/cooked games the registry is fully loaded at startup from the serialized cache.

## Cooked games

The Asset Registry is available in cooked games, but:
- It is populated from the baked registry snapshot (`AssetRegistry.bin`), not from disk scans.
- Only assets included in the cook appear; editor-only assets are stripped.
- The registry is read-only; `OnAssetAdded` etc. do not fire.
- Queries return the same `FAssetData` API, so code is identical between editor and packaged.

## Using in commandlets

In a commandlet, `LoadModuleChecked<FAssetRegistryModule>("AssetRegistry")` triggers a
synchronous full scan — no callback subscription needed.

## Version notes

- `FTopLevelAssetPath` (used in `ClassPaths`) replaced `FName`-based class names in UE 5.1.
  Legacy code calling `GetAssetsByClass(ClassName.GetFName(), ...)` still compiles via the
  deprecated overload.
- `GetAssetByObjectPath` accepting `FString` was deprecated in UE 5.1; pass `FSoftObjectPath`.
