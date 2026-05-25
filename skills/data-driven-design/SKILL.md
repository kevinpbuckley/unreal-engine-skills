---
name: data-driven-design
description: Drive Unreal gameplay from externally-editable data instead of hardcoded values —
  DataTables (UDataTable, FTableRowBase, CSV/JSON import, UCompositeDataTable), DataAssets
  (UDataAsset, UPrimaryDataAsset with AssetManager), Curves (UCurveFloat, UCurveTable,
  FRuntimeFloatCurve), config-driven UPROPERTY(config) in .ini files, and DeveloperSettings
  (UDeveloperSettings) for project-wide tuning. Use when defining item/enemy/level/balance
  schemas, choosing the right data container, exposing designer-tunable values, replacing
  magic numbers with editable assets, or layering data across DLC/platforms with composite
  tables.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Data-driven design

Hardcoding gameplay values (item stats, enemy configs, balance numbers, curves) makes iteration
slow and risky. Move them into assets and config objects that designers can edit without
recompiling. The choice of container drives every downstream workflow.

## When to use this skill

- Defining sets of similar records (items, enemies, weapons, abilities, loot).
- One-off structured config objects (boss setup, game-mode tuning, single-character stats).
- Values that vary over an input (damage falloff, XP per level, camera ease curves).
- Replacing magic numbers with `.ini`-backed project settings editable in Project Settings.
- Layering or overriding rows across game modes, DLC, or platforms (composite tables).

## Pick the right container

| Need | Use |
|---|---|
| Many rows of the same schema, bulk spreadsheet workflow | **`UDataTable`** |
| Layered/overriding rows across DLC or variants | **`UCompositeDataTable`** |
| A single rich config object, possibly subclassed | **`UDataAsset`** / **`UPrimaryDataAsset`** |
| A value that depends on another (falloff, curves) | **`UCurveFloat`** / **`UCurveTable`** |
| An inline editable curve inside a struct/component | **`FRuntimeFloatCurve`** |
| Global programmer-near settings in `.ini` | **`UCLASS(Config=X)` + `UPROPERTY(config)`** |
| Project Settings panel entry with change notifications | **`UDeveloperSettings`** |

## DataTables — tabular records

Define a row struct inheriting `FTableRowBase`, then create a DataTable asset in the Content
Browser (or import CSV/JSON). The table stores rows as a `TMap<FName, uint8*>` internally,
accessed through typed template helpers.

```cpp
// ItemRow.h — one USTRUCT per table schema
USTRUCT(BlueprintType)
struct FItemRow : public FTableRowBase
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FText  DisplayName;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) int32  Price    = 0;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float  Weight   = 1.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) TSoftObjectPtr<UTexture2D> Icon;
};
```

```cpp
// Runtime lookup — context string appears in log if the row is missing
if (const FItemRow* Row = ItemTable->FindRow<FItemRow>(TEXT("Sword_Iron"), TEXT("ItemQuery")))
{
    float w = Row->Weight;
}

// Iterate every row
ItemTable->ForeachRow<FItemRow>(TEXT("PopulateShop"),
    [](const FName& Key, const FItemRow& Row) { /* ... */ });

// Typed bulk access
TArray<FItemRow*> All;
ItemTable->GetAllRows<FItemRow>(TEXT("All"), All);
```

Key macro rule: the struct needs `USTRUCT(BlueprintType)` so Blueprint graphs can read rows;
`FTableRowBase` is the mandatory base (`DataTable.h`:36).

**`FDataTableRowHandle`** (`DataTable.h`:395) — a two-field struct (table + row name) you expose
as a `UPROPERTY` so designers pick the exact row in the Details panel, eliminating string typos.

```cpp
UPROPERTY(EditAnywhere, BlueprintReadWrite) FDataTableRowHandle RewardRow;
// At runtime:
if (const FItemRow* R = RewardRow.GetRow<FItemRow>(TEXT("Reward"))) { ... }
```

**`UCompositeDataTable`** (`CompositeDataTable.h`:13) — a `UDataTable` subclass that stacks
parent tables; higher-index parents win on duplicate row names. Use for DLC or per-platform row
overrides without duplicating the base table. See
[references/datatables-and-composite.md](references/datatables-and-composite.md).

## DataAssets — structured config objects

A `UDataAsset` is a `UObject` subclass you create as an asset. Inherit it for rich single-record
configs; override properties in Blueprint Data Only subclasses for per-instance variation.

```cpp
// EnemyConfig.h
UCLASS(BlueprintType)
class MYGAME_API UEnemyConfig : public UPrimaryDataAsset
{
    GENERATED_BODY()
public:
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Stats")
    float MaxHealth = 100.f;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Spawning")
    TSoftClassPtr<APawn> PawnClass;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category="Tags")
    FGameplayTagContainer Traits;
};
```

- `UDataAsset` (`DataAsset.h`:20) — base; creates assets in the Content Browser, hard-loaded
  when the outer object is loaded.
- `UPrimaryDataAsset` (`DataAsset.h`:46) — adds `GetPrimaryAssetId()` for `UAssetManager`
  discovery, async loading, and bundle-based streaming. Use when you need lifecycle control or
  have many instances (hundreds of items). See `asset-management`.

Reference instances as `TObjectPtr<UEnemyConfig>` (hard, loads immediately) or
`TSoftObjectPtr<UEnemyConfig>` (lazy, loaded on demand). DataAssets beat DataTables when each
record needs inheritance, rich nested types, or Blueprint subclassing.

See [references/data-assets-and-validation.md](references/data-assets-and-validation.md).

## Curves

Use curves when a value depends on a continuous input (time, distance, level).

| Type | Storage | Evaluation |
|---|---|---|
| `UCurveFloat` | standalone asset | `Curve->GetFloatValue(X)` |
| `UCurveTable` | many named curves in one asset | `Table->FindRichCurve(Name, Context)` |
| `FRuntimeFloatCurve` | embedded in a struct/component | `Curve.GetRichCurve()->Eval(X)` |

```cpp
// Standalone curve asset property
UPROPERTY(EditAnywhere, Category="Balance") TObjectPtr<UCurveFloat> DamageFalloff;

float GetDamage(float Distance) const
{
    return BaseDamage * (DamageFalloff ? DamageFalloff->GetFloatValue(Distance) : 1.f);
}
```

```cpp
// Inline curve — editable in the Details panel without a separate asset
UPROPERTY(EditAnywhere, Category="Motion") FRuntimeFloatCurve SpeedOverTime;

float GetSpeed(float T) const
{
    const FRichCurve* C = SpeedOverTime.GetRichCurveConst();
    return C ? C->Eval(T) : 0.f;
}
```

`UCurveFloat` (`CurveFloat.h`:30) wraps a `FRichCurve` and is the standard designer-facing
single-axis float curve. `FRuntimeFloatCurve` (`CurveFloat.h`:12) lets you bake the curve
inline or point at an external `UCurveFloat` asset.

See [references/curves-and-runtime-data.md](references/curves-and-runtime-data.md).

## Config-driven properties (`.ini` files)

For global, programmer-near defaults that ship with the project, mark the class and properties:

```cpp
// Reads/writes Config/DefaultGame.ini under [/Script/MyGame.UGameBalanceSettings]
UCLASS(Config=Game, DefaultConfig)
class MYGAME_API UGameBalanceSettings : public UObject
{
    GENERATED_BODY()
public:
    UPROPERTY(Config, EditAnywhere, Category="Balance")
    float GlobalDamageScale = 1.f;

    UPROPERTY(Config, EditAnywhere, Category="Economy")
    int32 StartingGold = 500;
};

// Read anywhere:
const UGameBalanceSettings* S = GetDefault<UGameBalanceSettings>();
float Scale = S->GlobalDamageScale;
```

The `.ini` section name is `[/Script/ModuleName.ClassName]` (without the `U` prefix).
`DefaultConfig` writes user edits back to `Default<Category>.ini` rather than a per-user file.
Do not use this pattern for content-scale data (hundreds of records); use DataTables/DataAssets.

## DeveloperSettings — Project Settings panel entries

`UDeveloperSettings` (`DeveloperSettings.h`:23, module `DeveloperSettings`) auto-discovers the
class and adds it to **Project Settings**. Ideal for cross-system tuning knobs and references to
key data assets that the rest of the codebase needs to find.

```cpp
UCLASS(Config=Game, DefaultConfig, meta=(DisplayName="My Game Settings"))
class MYGAME_API UMyGameSettings : public UDeveloperSettings
{
    GENERATED_BODY()
public:
    UMyGameSettings() { CategoryName = TEXT("Game"); SectionName = TEXT("MyGameSettings"); }

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Tables")
    TSoftObjectPtr<UDataTable> ItemTable;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Tuning")
    float DifficultyMultiplier = 1.f;

    // Convenience accessor
    static const UMyGameSettings* Get() { return GetDefault<UMyGameSettings>(); }
};
```

```cpp
// Consuming code — no FindObject, no hard path
const UDataTable* Table = UMyGameSettings::Get()->ItemTable.LoadSynchronous();
```

Add `DeveloperSettings` to your module's `PublicDependencyModuleNames` in `Build.cs`.

See [references/config-and-developer-settings.md](references/config-and-developer-settings.md).

## Validation

Override `IsDataValid` on DataAssets and in row structs to surface content errors before runtime.

```cpp
// In UEnemyConfig (editor-only)
#if WITH_EDITOR
virtual EDataValidationResult IsDataValid(FDataValidationContext& Context) const override
{
    EDataValidationResult Result = Super::IsDataValid(Context);
    if (MaxHealth <= 0.f)
        Context.AddError(FText::FromString(TEXT("MaxHealth must be > 0")));
    if (PawnClass.IsNull())
        Context.AddError(FText::FromString(TEXT("PawnClass is not set")));
    return Context.GetNumErrors() > 0 ? EDataValidationResult::Invalid : Result;
}
#endif
```

Run validation from the Content Browser (**Asset Actions → Validate Assets**) or via
`UnrealEditor-Cmd.exe MyProject.uproject -run=DataValidation` for CI. The Data Validation plugin
calls `IsDataValid` on `UDataTable` itself (engine implementation) and on `UObject`-derived
assets that override it.

## Gotchas

- **Wrong container shape** — large flat datasets in individual DataAssets, or deeply nested
  configs forced into DataTable rows — match the shape to the tool.
- **Hard refs to heavy assets in rows/assets** — every row's hard ref loads at table load time;
  use `TSoftObjectPtr` for textures, meshes, sounds, and class refs.
- **Row name typos** in `FindRow` return null silently (with a log warning); prefer
  `FDataTableRowHandle` pickers so designers pick from a validated list.
- **Forgetting `USTRUCT(BlueprintType)`** on a row struct — Blueprint nodes that read rows will
  fail to expose the type.
- **Editing CSV after adding struct fields** — the column order and header names must match the
  struct; add new fields at the end and re-import.
- **Composite table loop** — `UCompositeDataTable` detects and rejects circular parent
  references at load time, but keep the parent chain shallow.
- **`UDeveloperSettings` not showing** — the module must be listed in `PublicDependencyModuleNames`;
  also check that `CategoryName` maps to a known Project Settings category (`"Game"`, `"Engine"`,
  `"Editor"`).
- **`GetDefault<T>()` vs `GetMutableDefault<T>()`** — `GetDefault` is read-only and safe
  anywhere; `GetMutableDefault` is for editor tooling or startup init only, never gameplay.
- **Config UPROPERTY for content data** — `.ini` values are not asset-browser-visible and give
  designers a worse authoring experience; use DataTables or DataAssets for game content.

## Version notes

- `UCompositeDataTable` has been stable since UE4. The `AppendParentTables`/`RemoveParentTable`
  runtime API (CompositeDataTable.h:59–63) allows dynamic parent modification, but the comment in
  the header warns this can cause hitches during gameplay.
- `UDeveloperSettings` is in its own module (`DeveloperSettings`) since UE5; in UE4 it was part
  of `Engine`. Update `Build.cs` accordingly.
- `FRuntimeFloatCurve::GetRichCurveConst()` is the const accessor added in UE5 to avoid the
  const-correctness issues of the earlier mutable-only path.
- `FTableRowBase::IsDataValid` signature matches `UObject::IsDataValid(FDataValidationContext&)`
  introduced in UE5.1; do not use the older `TArray<FText>&` variant.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/`):
- `Engine/Classes/Engine/DataTable.h` — `FTableRowBase`:36, `UDataTable`:79,
  `FindRow<T>`:224, `GetAllRows<T>`:204, `ForeachRow<T>`:237,
  `FDataTableRowHandle`:395, `FDataTableCategoryHandle`:468.
- `Engine/Classes/Engine/CompositeDataTable.h` — `UCompositeDataTable`:13,
  `ParentTables`:81, `AppendParentTables`:59.
- `Engine/Classes/Engine/DataAsset.h` — `UDataAsset`:20, `UPrimaryDataAsset`:46,
  `GetPrimaryAssetId()`:52.
- `Engine/Classes/Engine/CurveTable.h` — `UCurveTable`:40, `FindCurve`:129,
  `FindRichCurve`:148, `FCurveTableRowHandle`:260.
- `Engine/Classes/Curves/CurveFloat.h` — `FRuntimeFloatCurve`:12,
  `UCurveFloat`:30, `GetFloatValue`:44.
- `DeveloperSettings/Public/Engine/DeveloperSettings.h` — `UDeveloperSettings`:23,
  `GetContainerName`:31, `GetCategoryName`:33, `GetSectionName`:35.

Official docs (UE 5.7):
- Data Assets — <https://dev.epicgames.com/documentation/unreal-engine/data-assets-in-unreal-engine>
- Configuration Files — <https://dev.epicgames.com/documentation/unreal-engine/configuration-files-in-unreal-engine>
- Data Validation — <https://dev.epicgames.com/documentation/unreal-engine/data-validation-in-unreal-engine>

Deep-dive references in this skill:
- [references/datatables-and-composite.md](references/datatables-and-composite.md) — DataTable
  internals, CSV/JSON import, row callbacks, CompositeDataTable layering.
- [references/data-assets-and-validation.md](references/data-assets-and-validation.md) —
  DataAsset vs PrimaryDataAsset, AssetManager integration, validation patterns.
- [references/curves-and-runtime-data.md](references/curves-and-runtime-data.md) —
  UCurveFloat, UCurveTable, FRuntimeFloatCurve, FCurveTableRowHandle.
- [references/config-and-developer-settings.md](references/config-and-developer-settings.md) —
  config UPROPERTY mechanics, DeveloperSettings setup, GetDefault, SaveConfig.

Related skills: `asset-management`, `gameplay-tags`, `project-structure`, `cpp-fundamentals`.
