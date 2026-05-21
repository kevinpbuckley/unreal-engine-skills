---
name: data-driven-design
description: Drive Unreal gameplay from data instead of hardcoded values — DataTables (USTRUCT rows
  from CSV/JSON), DataAssets and PrimaryDataAssets for structured config objects, curves
  (UCurveFloat/CurveTable) for value-over-input, and config (.ini) driven properties. Use when
  defining items/enemies/levels/balance data, choosing DataTable vs DataAsset vs curve, exposing
  designer-tunable data, or replacing magic numbers with editable assets.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Data-driven design

Hardcoding gameplay values (item stats, enemy configs, balance numbers, progression curves) makes
iteration slow and risky. Move them into data assets designers can edit without recompiling. The
trick is choosing the right container: DataTable, DataAsset, or curve.

## When to use this skill

- Defining sets of similar records (items, enemies, weapons, levels, loot).
- One-off structured configuration objects (a game's tuning, a boss's setup).
- Values that vary over an input (damage falloff vs distance, XP curve).
- Replacing magic numbers / `Config` settings with editable assets.

## Pick the right container

| Need | Use |
|---|---|
| Many rows of the same schema, often from a spreadsheet | **`UDataTable`** (rows = a `FTableRowBase` struct) |
| A single structured config object (possibly subclassed) | **`UDataAsset`** / **`UPrimaryDataAsset`** |
| A value that depends on another value | **`UCurveFloat`** / **`UCurveTable`** |
| A handful of global, code-near settings | **`Config` UPROPERTY** in `.ini` |

## DataTables (tabular records)

Define a row struct, then author rows in a DataTable asset (or import CSV/JSON):

```cpp
USTRUCT(BlueprintType)
struct FItemRow : public FTableRowBase
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FText DisplayName;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Price = 0;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) TSoftObjectPtr<UTexture2D> Icon;
};

// Lookup at runtime:
if (const FItemRow* Row = ItemTable->FindRow<FItemRow>(TEXT("Potion"), TEXT("ItemLookup")))
    Use(*Row);
```
Reference rows safely with `FDataTableRowHandle` (a table + row name) exposed as a `UPROPERTY` so
designers pick the row in the editor. Good when data is row-shaped and edited in bulk/spreadsheets.

## DataAssets (structured config objects)

```cpp
UCLASS(BlueprintType)
class MYGAME_API UEnemyConfig : public UPrimaryDataAsset
{
    GENERATED_BODY()
public:
    UPROPERTY(EditAnywhere, BlueprintReadOnly) float MaxHealth = 100.f;
    UPROPERTY(EditAnywhere, BlueprintReadOnly) TSoftClassPtr<AActor> Pawn;
    UPROPERTY(EditAnywhere, BlueprintReadOnly) FGameplayTagContainer Traits;
};
```
- `UDataAsset` — simple data object; create instances as assets in the Content Browser.
- `UPrimaryDataAsset` — discoverable/loadable by `UAssetManager` (good for large managed sets,
  async loading, DLC). See `asset-management`.
- Subclass `UDataAsset` to add behavior/validation; reference instances via `UPROPERTY`
  (hard) or `TSoftObjectPtr` (lazy).

DataAssets shine when each record is rich/nested or benefits from inheritance; DataTables shine
for flat, many-row, spreadsheet-style data.

## Curves

- `UCurveFloat` (asset) — a curve evaluated with `Curve->GetFloatValue(Time)`; ideal for falloff,
  ease, progression, spawn-rate-over-time.
- `UCurveTable` — many named curves in one asset.
- Embed an editable curve directly in a struct with `FRuntimeFloatCurve`.

```cpp
UPROPERTY(EditAnywhere) TObjectPtr<UCurveFloat> DamageFalloff;
float Mult = DamageFalloff ? DamageFalloff->GetFloatValue(Distance) : 1.f;
```

## Config-driven (.ini) properties

For global, programmer-near tuning, mark a `UCLASS(Config=Game)` and `UPROPERTY(Config)`; values
read/write from `Config/DefaultGame.ini` (see `unreal-project-structure`). Use for settings, not
for content-scale data.

## Validation

Override `IsDataValid` (with `WITH_EDITOR`) on DataAssets / row structs to flag bad data in the
editor (Data Validation), catching balance/content errors before runtime.

## Gotchas

- **Wrong container**: rich/nested config forced into a DataTable, or thousands of records as
  individual DataAssets — match the shape to the tool.
- **Hard refs to heavy assets** inside rows/configs load everything at once; use `TSoftObjectPtr`.
- **Row name typos** in `FindRow` return null — prefer `FDataTableRowHandle` pickers.
- **Editing CSV out of sync** with the row struct → import errors; keep the struct authoritative.
- **Config UPROPERTY for content data** doesn't scale or give designers a good editor; use assets.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Engine/DataTable.h` — `UDataTable`, `FTableRowBase`, `FDataTableRowHandle`.
- `Runtime/Engine/Classes/Engine/DataAsset.h` — `UDataAsset`, `UPrimaryDataAsset`.
- `Runtime/Engine/Classes/Engine/CurveTable.h`, `Runtime/Engine/Classes/Curves/CurveFloat.h`.

Official docs (UE 5.7): Working with Content —
<https://dev.epicgames.com/documentation/unreal-engine/working-with-content-in-unreal-engine>

Related: `asset-management`, `gameplay-tags`, `unreal-project-structure`.
