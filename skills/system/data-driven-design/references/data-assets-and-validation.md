# DataAssets and Validation — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UDataAsset` vs `UPrimaryDataAsset`, the
AssetManager relationship, Blueprint subclassing patterns, and the Data Validation system.
Grounded in UE 5.7 (`Engine/Source/Runtime/Engine/Classes/Engine/DataAsset.h`) and the official
[Data Assets](https://dev.epicgames.com/documentation/unreal-engine/data-assets-in-unreal-engine)
and [Data Validation](https://dev.epicgames.com/documentation/unreal-engine/data-validation-in-unreal-engine)
docs.

## UDataAsset vs UPrimaryDataAsset

Both live in `Engine/Source/Runtime/Engine/Classes/Engine/DataAsset.h`.

### UDataAsset (line 20)

`UDataAsset` is declared `UCLASS(abstract, MinimalAPI, Meta = (LoadBehavior = "LazyOnDemand"))`.
It inherits from `UObject`. Key properties:

- **Hard-loading**: a hard `TObjectPtr<UMyDataAsset>` reference loads the asset when its outer
  package loads. This is fine for small assets but expensive for large libraries.
- **No Asset Manager awareness**: `UDataAsset` does not implement `GetPrimaryAssetId`, so
  `UAssetManager` cannot discover, track, or async-load it by type.
- **Inheritance via Blueprints**: the Data Only Blueprint pattern lets designers subclass a
  native `UDataAsset` to add variables and override defaults, without writing C++.

Use `UDataAsset` for single-instance or small-count configs that are always loaded with the
level (e.g., a weapon's constant parameters, a character's ability loadout).

### UPrimaryDataAsset (line 46)

`UPrimaryDataAsset` adds `GetPrimaryAssetId() const override`:52, which returns an
`FPrimaryAssetId(PrimaryAssetType, AssetName)`. This lets `UAssetManager`:

- Scan and register all instances at startup via the Asset Registry.
- Async-load by type (`LoadPrimaryAssets`, `LoadPrimaryAsset`).
- Manage lifecycle (bundle loading, unloading for streaming/DLC).
- Expose the full inventory of an asset type without loading it.

The `PrimaryAssetType` is the name of the first native class up the hierarchy
(`GetPrimaryAssetId` implementation). If you need a custom type name, override
`GetPrimaryAssetId` in your native class.

Use `UPrimaryDataAsset` when you have many instances (items, enemies, abilities, skins) that
should be asynchronously loaded and managed. Always configure the type in **Project Settings →
Asset Manager** so the scanner finds your assets.

## Authoring pattern: C++ base + Blueprint children

```
UPrimaryDataAsset
  └─ UWeaponData  (C++ — defines schema: damage, range, icon, sound soft refs)
       └─ BP_WeaponData_Rifle  (Blueprint Data Only — fills in values)
       └─ BP_WeaponData_Shotgun
```

The C++ class defines the `UPROPERTY` schema with meaningful defaults. Designers create Data
Only Blueprints (not Data Asset instances) to fill in per-weapon data. Blueprint subclasses
support inheritance — `BP_WeaponData_AutoRifle` can inherit from `BP_WeaponData_Rifle` and
override only the fire rate.

**Do not** create Data Asset instances of a Blueprint class; create Data Only Blueprint classes
instead. The `UDataAsset::NativeClass` property (marked `AssetRegistrySearchable`) enables
filtering the Content Browser and Asset Manager by native base class.

## Soft references and lazy loading

Hard references (`TObjectPtr<UWeaponData>`) load the asset when the outer object loads. Prefer
`TSoftObjectPtr<UWeaponData>` for assets that are not always needed:

```cpp
UPROPERTY(EditAnywhere, BlueprintReadOnly)
TSoftObjectPtr<UWeaponData> EquippedWeapon;

// Async load when the player equips:
TAsyncLoadOptions<UWeaponData> Opts;
StreamableManager.RequestAsyncLoad(EquippedWeapon.ToSoftObjectPath(),
    [this]() { OnWeaponLoaded(); });
```

For `UPrimaryDataAsset`, use the `UAssetManager` bundle system for larger-scale lifecycle
management rather than manually calling `StreamableManager`. See `asset-management`.

## Asset bundles

`UPrimaryDataAsset::UpdateAssetBundleData`:57 (editor-only) scans the class for `AssetBundles`
metadata on `TSoftObjectPtr`/`TSoftClassPtr` properties. A bundle groups a set of soft refs
under a named tag; the AssetManager loads the entire bundle in one call.

```cpp
UPROPERTY(EditAnywhere, meta=(AssetBundles="UI"))
TSoftObjectPtr<UTexture2D> Icon;

UPROPERTY(EditAnywhere, meta=(AssetBundles="Game"))
TSoftClassPtr<AActor> Pawn;
```

Calling `UAssetManager::LoadPrimaryAsset(Id, {"UI"})` loads only the `Icon` group, not the
heavier `Pawn` class.

## Validation

### Via UObject::IsDataValid

Override `IsDataValid(FDataValidationContext&)` in your native `UDataAsset`/`UPrimaryDataAsset`
subclass. The Data Validation plugin calls this on save and via the Validate Assets menu.

```cpp
#if WITH_EDITOR
virtual EDataValidationResult IsDataValid(FDataValidationContext& Context) const override
{
    EDataValidationResult Result = Super::IsDataValid(Context);
    if (MaxHealth <= 0.f)
        Context.AddError(NSLOCTEXT("Validate","BadHP","MaxHealth must be positive"));
    if (Icon.IsNull())
        Context.AddWarning(NSLOCTEXT("Validate","NoIcon","Icon is not set"));
    return Context.GetNumErrors() > 0 ? EDataValidationResult::Invalid : Result;
}
#endif
```

`EDataValidationResult` has three values: `Valid`, `Invalid`, and `NotValidated` (default when
the object has no rules). Always call `Super::IsDataValid(Context)` and merge the result.

### Via UEditorValidatorBase

For cross-asset rules (e.g., every ability must reference a sound that exists),
`UEditorValidatorBase`-derived validators receive a `UObject*` and can validate any asset class.
C++ and Blueprint validators auto-register on editor startup; Python validators must register
with `UEditorValidatorSubsystem::AddValidator`.

### CI integration

```
UnrealEditor-Cmd.exe MyProject.uproject -run=DataValidation
```

Outputs validation results to the log; non-zero exit code on failures. Wire this into your build
pipeline to catch content errors before they reach the game.

## Module dependency

`UDataAsset` and `UPrimaryDataAsset` are in the `Engine` module (usually already a dependency).
Data Validation APIs (`UEditorValidatorBase`) require the `DataValidation` plugin module, which
is Editor-only — guard with `#if WITH_EDITOR` or put validator classes in an Editor module.

## Version notes

- `FDataValidationContext` replaced the older `TArray<FText>& ValidationErrors` signature in
  UE5.1. Do not use the deprecated array form.
- `AssetBundleData` and `UpdateAssetBundleData` are editor-only (`WITH_EDITORONLY_DATA`).
- Data Only Blueprint instances of `UDataAsset` subclasses work in both UE4 and UE5; the
  recommended pattern (Data Only BPs over asset instances) is the same across versions.
