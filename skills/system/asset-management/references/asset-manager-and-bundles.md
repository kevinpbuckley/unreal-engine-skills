# UAssetManager and asset bundles — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UAssetManager`, `UPrimaryDataAsset`, primary
asset IDs, asset bundle metadata, the load/unload API, bundle-state switching, and custom Asset
Manager subclassing. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/AssetManager.h` and `DataAsset.h`).

## Mental model: primary vs secondary assets

The Asset Manager classifies content into two tiers:

- **Primary assets** are explicitly tracked by ID. `UWorld` (levels) is the only primary type
  by default. Any `UObject` subclass that overrides `GetPrimaryAssetId()` to return a valid
  `FPrimaryAssetId` becomes primary.
- **Secondary assets** are everything else. They load automatically when hard-referenced by a
  loaded primary asset. You cannot load them by ID through the Asset Manager.

This split lets you load exactly the primaries you need for a given game state (lobby, match,
menu) and have the engine automatically pull in only the secondary content those primaries
reference.

## FPrimaryAssetId

```
FPrimaryAssetId = FPrimaryAssetType (FName) + FName (asset name)
```

Declared in `CoreUObject/Public/UObject/PrimaryAssetId.h`:
- `FPrimaryAssetType` — `PrimaryAssetId.h`:27. A thin `FName` wrapper identifying the
  type group (e.g. `WeaponData`).
- `FPrimaryAssetId` — `PrimaryAssetId.h`:125. Combines type + name, e.g.
  `FPrimaryAssetId(TEXT("WeaponData"), TEXT("Rifle_01"))`.

## UPrimaryDataAsset — the minimal primary class

`UPrimaryDataAsset` (`DataAsset.h`:46) extends `UDataAsset` with a built-in
`GetPrimaryAssetId()` that returns `ClassName:AssetName` automatically. It also maintains
`FAssetBundleData` at save time by scanning `UPROPERTY` members with the `AssetBundles` meta tag.

```cpp
// WeaponData.h
UCLASS(BlueprintType)
class MYGAME_API UWeaponData : public UPrimaryDataAsset
{
    GENERATED_BODY()
public:
    // "UI" bundle — load when showing weapon selection screen:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category=UI,
              meta=(AssetBundles="UI"))
    TSoftObjectPtr<UTexture2D> Icon;

    // "Game" bundle — load when weapon is equipped:
    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category=Gameplay,
              meta=(AssetBundles="Game"))
    TSoftObjectPtr<UStaticMesh> Mesh;

    // Not in any bundle — not asynchronously managed:
    UPROPERTY(EditDefaultsOnly, Category=Data)
    float BaseDamage = 25.f;
};
```

`UPrimaryDataAsset::GetPrimaryAssetId()` (`DataAsset.h`:52) returns the ID automatically. The
`AssetBundles` meta tells the engine which `TSoftObjectPtr` members to include in each named
bundle without loading the assets.

If you want a primary type that is NOT a `UDataAsset` (e.g. an `ACharacter` subclass), override
`GetPrimaryAssetId()` manually and handle `FAssetBundleData` yourself, or study
`UPrimaryDataAsset` as a reference.

## Registering primary asset types

Register in **Project Settings → Asset Manager → Primary Asset Types to Scan**, specifying:
- Type name (must match your `FPrimaryAssetType` string).
- Base class.
- Scan paths (e.g. `/Game/Data/Weapons`).
- Whether the class is a Blueprint class or a data instance.

Alternatively, override `StartInitialLoading()` in a custom `UAssetManager` subclass:
```cpp
void UMyAssetManager::StartInitialLoading()
{
    Super::StartInitialLoading();
    ScanPathsForPrimaryAssets(         // AssetManager.h:154
        TEXT("WeaponData"),
        {TEXT("/Game/Data/Weapons")},
        UWeaponData::StaticClass(),
        false /*not Blueprint classes*/);
}
```

To use a custom `UAssetManager` subclass, set in `DefaultEngine.ini`:
```ini
[/Script/Engine.Engine]
AssetManagerClassName=/Script/MyGame.MyAssetManager
```

## Loading and unloading primary assets

All load functions return `TSharedPtr<FStreamableHandle>`. Store it to keep assets resident;
let it go or call `ReleaseHandle()` to allow unloading.

```cpp
UAssetManager& AM = UAssetManager::Get();   // AssetManager.h:97

// Load one primary asset with specified bundles:
TSharedPtr<FStreamableHandle> H =
    AM.LoadPrimaryAsset(                     // AssetManager.h:315
        FPrimaryAssetId(TEXT("WeaponData"), TEXT("Rifle_01")),
        {TEXT("UI")},
        FStreamableDelegate::CreateUObject(this, &AMyHUD::OnWeaponLoaded));

// Load all of a type:
AM.LoadPrimaryAssetsWithType(TEXT("WeaponData"), {TEXT("UI")},
    FStreamableDelegate::CreateUObject(this, &AMyHUD::OnAllWeaponsLoaded));

// Unload (releases manager's reference; GC may reclaim assets):
AM.UnloadPrimaryAsset(WeaponId);            // AssetManager.h:345

// Query whether a primary asset is in memory:
if (UWeaponData* WD = AM.GetPrimaryAssetObject<UWeaponData>(WeaponId))
{
    // already resident
}
```

## Bundle-state switching

Switch which bundle of an already-registered primary is loaded without a full unload/reload:
```cpp
// Switch from "UI" to "Game" bundle (adds "Game", removes "UI"):
AM.ChangeBundleStateForPrimaryAssets(       // AssetManager.h:386
    {WeaponId},
    {TEXT("Game")},   // add
    {TEXT("UI")},     // remove
    false,            // bRemoveAllBundles
    FStreamableDelegate::CreateUObject(this, &AMyActor::OnBundleSwitched));
```

This is the preferred pattern for a lobby→in-game transition: preload UI bundles during the
lobby, switch to Game bundles when the match starts, without re-registering or full unloads.

## Dynamic primary assets (runtime-generated)

For assets that have no on-disk representation (e.g. downloaded from a server):
```cpp
FAssetBundleData BundleData;
BundleData.AddBundleAssets(TEXT("Menu"), {FSoftObjectPath(TEXT("/Game/UI/T_Dynamic.T_Dynamic"))});

AM.AddDynamicAsset(                         // AssetManager.h:180
    FPrimaryAssetId(TEXT("DynamicContent"), TEXT("Server_Zone_01")),
    FSoftObjectPath(),
    BundleData);
```

Use `RecursivelyExpandBundleData()` to follow soft references inside structs and expand nested
primary-asset dependencies.

## Enumerating registered primary assets

```cpp
TArray<FPrimaryAssetId> Ids;
AM.GetPrimaryAssetIdList(TEXT("WeaponData"), Ids);   // AssetManager.h:259

// Get FAssetData (no load):
FAssetData Data;
AM.GetPrimaryAssetData(Ids[0], Data);                // AssetManager.h:213
```

## Module dependencies

Add to `Build.cs`:
- `"Engine"` — for `UAssetManager`, `UPrimaryDataAsset`, and `FStreamableManager`.
- `"AssetRegistry"` — if you access `IAssetRegistry` directly from your manager subclass.

## Version notes

- `UAssetManager::IsValid()` was deprecated in UE 5.3; use `IsInitialized()` instead.
- `UAssetManager` is always constructed during `UEngine::InitializeObjectReferences` in UE 5.3+;
  `Get()` is safe to call any time after engine init.
- `FAssetBundleData` is stored in `UPrimaryDataAsset::AssetBundleData` (editor-only member,
  baked into the Asset Registry for cooked games at save time).
