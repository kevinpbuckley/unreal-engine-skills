---
name: asset-management
description: Reference and load Unreal assets correctly — hard vs soft references (TObjectPtr vs
  TSoftObjectPtr/TSoftClassPtr), virtual content paths, FSoftObjectPath, async loading with
  FStreamableManager and FStreamableHandle, the Asset Registry for querying without loading,
  ConstructorHelpers::FObjectFinder, UAssetManager/primary data assets, and asset bundles. Use
  when choosing a reference type, fixing load hitches or cook/memory bloat from hard references,
  loading assets on demand (level streaming, DLC, runtime content), enumerating or filtering
  assets without loading, or setting up a managed primary-asset pipeline with UPrimaryDataAsset.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Asset management

Every `.uasset` is a `UObject` in a package addressed by a virtual path. The single most
important decision is **hard vs soft reference**: it determines what loads into memory (and gets
cooked) with your class. Wrong choices here cause load hitches and bloated memory/package sizes.

## When to use this skill

- Choosing how a class references a mesh, material, sound, Blueprint, or data asset.
- Load hitches, or memory/cook size ballooning due to too many hard references.
- Loading content on demand (level-streaming-friendly, plugin/DLC content).
- Enumerating or filtering assets at runtime without loading them.
- Setting up a `UPrimaryDataAsset` pipeline with `UAssetManager` for large-content games.

## Content paths

- `/Game/...` → project `Content/`; `/Engine/...` → engine content; `/PluginName/...` → a plugin.
- Full object reference string: `/Game/Weapons/SM_Rifle.SM_Rifle` (`Package.Object`).
- Never use OS filesystem paths in C++ asset references; always virtual paths.

## Hard vs soft references (the key distinction)

| Kind | Type | When the target loads | Use for |
|---|---|---|---|
| Hard (object) | `TObjectPtr<UTexture2D>` (UPROPERTY) | when the owner loads | small, always-needed assets |
| Soft (object) | `TSoftObjectPtr<UTexture2D>` | only when you load it | heavy/optional/occasional assets |
| Soft (class) | `TSoftClassPtr<AActor>` | only when you load it | classes you spawn conditionally |

```cpp
UPROPERTY(EditAnywhere, Category=Mesh)
TObjectPtr<UStaticMesh> AlwaysMesh;       // hard: loads with owner

UPROPERTY(EditAnywhere, Category=Audio)
TSoftObjectPtr<USoundBase> RareSfx;      // soft: path-only until loaded

UPROPERTY(EditAnywhere, Category=Spawning)
TSoftClassPtr<AActor> BossClass;         // soft class ref
```

A hard reference pulls the target *and all its dependencies* into memory and into the cook
whenever the referencing class loads. A class loaded everywhere (e.g. `GameInstance`, a base
`ACharacter`) holding hard refs to many heavy assets is a classic memory/cook bloat bug — switch
to soft refs there.

`TSoftObjectPtr` stores an `FSoftObjectPath` internally. `IsNull()` checks whether the path is
empty; `IsValid()` checks whether the object is *currently resident in memory*. These are
different: a non-null soft ptr can return `false` for `IsValid()` if the asset hasn't been loaded
yet.

```cpp
// Do NOT confuse IsNull (empty path) with IsValid (loaded and in memory):
if (!RareSfx.IsNull() && !RareSfx.IsValid())
{
    // Path is set but asset is not loaded — load it before use.
}
if (USoundBase* S = RareSfx.Get())      // returns nullptr if not in memory
{
    // asset is resident
}
```

## Loading soft references

**Sync — use sparingly, blocks the game thread:**
```cpp
if (UStaticMesh* M = MeshSoftPtr.LoadSynchronous())
{
    // M is now resident; do not call in hot paths
}
```

**Async (preferred) via the streamable manager:**
```cpp
#include "Engine/AssetManager.h"
TSharedPtr<FStreamableHandle> Handle =
    UAssetManager::GetStreamableManager().RequestAsyncLoad(
        RareSfx.ToSoftObjectPath(),
        FStreamableDelegate::CreateUObject(this, &AMyActor::OnSfxLoaded));
// Store Handle as a UPROPERTY-adjacent member; releasing it may allow GC.
```

Keep the returned `TSharedPtr<FStreamableHandle>` as long as you need the asset resident.
Releasing the handle removes the streamable manager's hard GC reference to the loaded asset.
Call `Handle->ReleaseHandle()` explicitly to unload, or let the `TSharedPtr` go out of scope.

See [references/streamable-manager.md](references/streamable-manager.md) for the full async
loading workflow, batch loading, combined handles, and progress tracking.

## Referencing engine/known content in C++ constructors

`ConstructorHelpers::FObjectFinder` and `FClassFinder` resolve assets **in the constructor only**:
```cpp
#include "UObject/ConstructorHelpers.h"

AMyActor::AMyActor()
{
    static ConstructorHelpers::FObjectFinder<UStaticMesh>
        MeshObj(TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (MeshObj.Succeeded())
        Mesh->SetStaticMesh(MeshObj.Object);
}
```
Use this only for stable engine content or prototypes. For game content, prefer a soft/hard
`UPROPERTY` assigned in a Blueprint subclass — it's data-driven and avoids hard-coding paths.
`FObjectFinder` called outside a constructor fails/asserts at runtime.

## Asset Registry — query without loading

The Asset Registry stores metadata gathered from `.uasset` file headers. Use it to discover
and filter assets without loading them; then load only the ones you need.

```cpp
#include "AssetRegistry/AssetRegistryModule.h"

IAssetRegistry& AR = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry").Get();

// Query all UStaticMesh assets (no load triggered):
TArray<FAssetData> Assets;
AR.GetAssetsByClass(UStaticMesh::StaticClass()->GetClassPathName(), Assets);

// Multi-criterion filter:
FARFilter Filter;
Filter.ClassPaths.Add(UStaticMesh::StaticClass()->GetClassPathName());
Filter.PackagePaths.Add(TEXT("/Game/Meshes"));
Filter.bRecursivePaths = true;
AR.GetAssets(Filter, Assets);

// FAssetData carries: PackageName, PackagePath, AssetName, TagsAndValues, AssetClassPath
// Convert to a loaded object only when needed:
UObject* Loaded = Assets[0].GetAsset();  // loads on call
```

Properties marked `UPROPERTY(AssetRegistrySearchable)` appear in `TagsAndValues` for filtering.
See [references/asset-registry.md](references/asset-registry.md) for filter construction,
searchable tags, async discovery callbacks, and commandlet use.

## UAssetManager & primary assets (for scale)

`UAssetManager` wraps an `FStreamableManager` and adds discovery, typed loading, and asset
bundles. This is the right tool when you have a large content library, DLC, or chunked delivery.

**Primary vs secondary assets:**
- A *primary* asset is one the Asset Manager directly tracks — identified by `FPrimaryAssetId`
  (`FPrimaryAssetType` + `FName`). Only levels (`UWorld`) are primary by default.
- A *secondary* asset is everything else; the engine loads secondaries automatically when they
  are hard-referenced by a primary.

**The minimal primary asset setup** — inherit `UPrimaryDataAsset`:
```cpp
// WeaponData.h
UCLASS(BlueprintType)
class MYGAME_API UWeaponData : public UPrimaryDataAsset
{
    GENERATED_BODY()
public:
    UPROPERTY(EditDefaultsOnly, Category=Display,
              meta=(AssetBundles="UI"))
    TSoftObjectPtr<UTexture2D> Icon;

    UPROPERTY(EditDefaultsOnly, Category=Display,
              meta=(AssetBundles="Game"))
    TSoftObjectPtr<UStaticMesh> WeaponMesh;
};
```

Register the type in Project Settings → Asset Manager, then load by ID:
```cpp
FPrimaryAssetId WeaponId(TEXT("WeaponData"), TEXT("Rifle_01"));
UAssetManager::Get().LoadPrimaryAsset(WeaponId, {TEXT("UI")},
    FStreamableDelegate::CreateUObject(this, &AMyHUD::OnWeaponLoaded));
```

Asset bundles let you load only the assets each context needs (UI vs in-game vs offline).

See [references/asset-manager-and-bundles.md](references/asset-manager-and-bundles.md) for full
`UPrimaryDataAsset`, bundle registration, `LoadPrimaryAssetsWithType`, `UnloadPrimaryAssets`, and
`ChangeBundleStateForPrimaryAssets`.

## Module dependencies

Add to your `Build.cs` as needed:

| Module | Needed for |
|---|---|
| `"Engine"` | `UAssetManager`, `FStreamableManager`, `ConstructorHelpers` |
| `"AssetRegistry"` | `IAssetRegistry`, `FAssetData`, `FARFilter` |
| `"CoreUObject"` | `TSoftObjectPtr`, `TSoftClassPtr`, `FSoftObjectPath` |

## Gotchas

- **Hard refs from widely-loaded classes** → memory/cook bloat. Put heavy assets behind soft refs.
- **`LoadSynchronous` during gameplay** → frame hitch. Load async ahead of when you need it.
- **Hard-coded path strings in C++** → brittle. Expose `UPROPERTY` refs that designers can change.
- **`IsNull` vs `IsValid` confusion** — `IsNull()` tests whether the path is empty; `IsValid()`
  tests whether the object is *resident in memory*. A non-null soft ptr may not be valid yet.
- **Dropping the streamable handle** → loaded assets can be GC'd; keep the handle alive.
- **`FObjectFinder` outside a constructor** → fails/asserts; constructor-only.
- **Forgetting `AssetRegistry` module dep** → `IAssetRegistry` link errors at compile time.
- **Asset Registry in cooked builds** → the in-memory database reflects the cook; queries work
  but the registry is read-only and populated from the cook's serialized registry data.
- **`GetAssetsByClass` with UE5 class path API** — pass `GetClassPathName()` (returns
  `FTopLevelAssetPath`), not `GetFName()`, to match the 5.1+ API.

## Version notes

- `TObjectPtr<T>` is the UE5+ idiom for hard-reference UPROPERTYs; older code uses raw `T*`
  (still valid). See `memory-and-gc`.
- `FSoftObjectPath` replaced `FStringAssetReference` (UE4 name, deprecated).
- `GetClassPathName()` returning `FTopLevelAssetPath` was introduced in UE 5.1; legacy code may
  pass `GetFName()` to `GetAssetsByClass` — this still compiles but uses the old overload.
- `IsValid()` was deprecated as a static (`UAssetManager::IsValid()`) in UE 5.3; call
  `UAssetManager::IsInitialized()` instead.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/Engine/Classes/Engine/StreamableManager.h` — `FStreamableManager`:705,
  `FStreamableHandle`:190, `RequestAsyncLoad`:730, `LoadSynchronous`:774,
  `FStreamableDelegate` alias:32.
- `Runtime/Engine/Classes/Engine/AssetManager.h` — `UAssetManager`:83,
  `GetStreamableManager()`:105, `LoadPrimaryAsset`:315, `UnloadPrimaryAssets`:342,
  `ChangeBundleStateForPrimaryAssets`:386.
- `Runtime/CoreUObject/Public/UObject/SoftObjectPtr.h` — `FSoftObjectPtr`:44,
  `TSoftObjectPtr`:173, `TSoftClassPtr`:762, `LoadSynchronous`:82/514, `IsValid`:538/900,
  `IsNull`:559/921, `ToSoftObjectPath`:96/571.
- `Runtime/CoreUObject/Public/UObject/PrimaryAssetId.h` — `FPrimaryAssetType`:27,
  `FPrimaryAssetId`:125.
- `Runtime/Engine/Classes/Engine/DataAsset.h` — `UDataAsset`:20, `UPrimaryDataAsset`:46,
  `GetPrimaryAssetId`:52.
- `Runtime/AssetRegistry/Public/AssetRegistry/IAssetRegistry.h` — `GetAssetsByClass`:333,
  `GetAssets`:361, `GetDependencies`:511, `GetReferencers`:574.
- `Runtime/AssetRegistry/Public/AssetRegistry/AssetRegistryModule.h` — `FAssetRegistryModule`:26,
  `Get()`:34.
- `Runtime/CoreUObject/Public/UObject/ConstructorHelpers.h` — `FObjectFinder`:77,
  `FClassFinder`:157.

Official docs (UE 5.7):
- Asset Management — <https://dev.epicgames.com/documentation/unreal-engine/asset-management-in-unreal-engine>
- Async Asset Loading — <https://dev.epicgames.com/documentation/unreal-engine/asynchronous-asset-loading-in-unreal-engine>
- Referencing Assets — <https://dev.epicgames.com/documentation/unreal-engine/referencing-assets-in-unreal-engine>
- Asset Registry — <https://dev.epicgames.com/documentation/unreal-engine/asset-registry-in-unreal-engine>
- Data Assets — <https://dev.epicgames.com/documentation/unreal-engine/data-assets-in-unreal-engine>

Deep-dive references in this skill:
- [references/streamable-manager.md](references/streamable-manager.md) — async loading workflow,
  batch loads, combined handles, handle lifecycle, priority.
- [references/asset-registry.md](references/asset-registry.md) — filter construction, searchable
  tags, async discovery, dependency/referencer queries.
- [references/asset-manager-and-bundles.md](references/asset-manager-and-bundles.md) — primary
  asset setup, bundle metadata, load/unload, bundle-state switching.
