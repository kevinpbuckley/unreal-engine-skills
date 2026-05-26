# DataTables and CompositeDataTable — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers DataTable internals, CSV/JSON import,
row-change callbacks, and CompositeDataTable layering. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/DataTable.h`,
`Engine/Source/Runtime/Engine/Classes/Engine/CompositeDataTable.h`).

## DataTable internals

`UDataTable` (`DataTable.h`:79) stores rows as a `TMap<FName, uint8*>` (`RowMap`:98). Each
value is a heap-allocated block sized to the row struct. The row struct pointer is held in
`RowStruct` (`DataTable.h`:94), a `TObjectPtr<UScriptStruct>`.

Access is type-safe through templated helpers that validate the runtime struct type against the
requested `T::StaticStruct()` before the `reinterpret_cast`:

- `FindRow<T>(RowName, Context)`:224 — returns `T*` or null; logs a warning if missing.
- `GetAllRows<T>(Context, OutArray)`:204 — fills a `TArray<T*>`; does not clear it first.
- `ForeachRow<T>(Context, Lambda)`:237 — iterates every row with a key+value callback.
- `FindRowUnchecked(RowName)`:259 — raw `uint8*`, no type check; use only when you already
  know the struct matches.

The table implements `UObject::Serialize` to persist the row map through the package system.
In cooked builds the `RowMap` is fixed at cook time; `AddRow`/`RemoveRow` at runtime are
supported but not cook-safe (avoid them in shipping gameplay code; they exist for tooling).

### `bStripFromClientBuilds`

`UDataTable::bStripFromClientBuilds`:120 excludes a table from client packages at cook time.
Use for server-authoritative tables (loot drop weights, AI decision tables) that should not be
readable from a shipped client binary.

## CSV and JSON import

The editor imports via `FDataTableImporterCSV` and `FDataTableImporterJSON`. Both are also
exposed at runtime through `UDataTable::CreateTableFromCSVString`:322 and
`CreateTableFromJSONString`:329, useful for downloading live-updated config from a backend.

CSV format rules:
- First row is the header; column names must match `UPROPERTY` names exactly (case-sensitive).
- The first column is the row name (`FName`); it does not need a header in the struct.
- Missing columns produce a warning (controllable via `bIgnoreMissingFields`:127 and
  `bPreserveExistingValues`:131 on the asset).
- An explicit key column can be set via `ImportKeyField`:135 for JSON tables where the first
  field is not the row name.

JSON format: an array of objects, each with a `"Name"` field (the row key), or the key column
set by `ImportKeyField`.

After import, `FTableRowBase::OnPostDataImport` (`DataTable.h`:51) is called on every row so
the struct can fix up data (e.g., resolve soft refs, validate cross-row constraints).
`OnDataTableChanged` (`DataTable.h`:61) is called whenever a row is edited in the editor.

## Row-change notifications

`UDataTable::OnDataTableChanged()`:194 returns a multicast delegate that fires whenever any
row changes. Subscribe in editor tooling or live-reload systems:

```cpp
// Editor utility — react to table edits
ItemTable->OnDataTableChanged().AddLambda([]() { RebuildCache(); });
```

`HandleDataTableChanged(ChangedRowName)`:200 triggers the delegate. If `ChangedRowName` is
`NAME_None`, all rows should be treated as changed.

## FDataTableRowHandle and FDataTableCategoryHandle

`FDataTableRowHandle` (`DataTable.h`:395) is the standard picker type for exposing a table
row reference to designers. It holds a `TObjectPtr<const UDataTable>` and an `FName`:

```cpp
UPROPERTY(EditAnywhere, BlueprintReadWrite)
FDataTableRowHandle LootRowHandle;

// Usage
if (const FLootRow* Row = LootRowHandle.GetRow<FLootRow>(TEXT("Loot"))) { ... }
```

`FDataTableCategoryHandle` (`DataTable.h`:468) finds all rows where a named column equals a
given value — useful for filtering rows by category tag without building a secondary index.

## CompositeDataTable — layering rows

`UCompositeDataTable` (`CompositeDataTable.h`:13) extends `UDataTable` by merging rows from a
stack of parent `UDataTable` assets. Later entries in `ParentTables`:81 override earlier ones
on duplicate row names.

Typical use:
- A base table defines every row for the vanilla game.
- A DLC or platform override table adds new rows and overrides specific base rows.
- The `UCompositeDataTable` asset lists both; code reads only the composite.

```cpp
// The composite asset is just a UDataTable at runtime — same API
if (const FItemRow* R = CompositeTable->FindRow<FItemRow>(TEXT("Sword_Iron"), TEXT("")))
    ...
```

Composite tables are **read-only** in the editor (you cannot add rows directly to a composite;
edit the underlying parent tables). The engine rejects circular parent chains at load time via
`FindLoops`:68.

Runtime parent modification is possible via `AppendParentTables`:59 and
`RemoveParentTables`:60, but the header warns this is slow and can cause hitches; avoid it
during gameplay.

### Row state

In `WITH_EDITORONLY_DATA` builds, `GetRowState(RowName)` returns `ERowState` (Inherited,
Overridden, New, Invalid), useful for editor tooling that color-codes override rows.

## Validation in DataTables

`UDataTable::IsDataValid` (`DataTable.h`:140) calls `FTableRowBase::IsDataValid` on each row,
collecting errors per-row. Override `FTableRowBase::IsDataValid` in your row struct for
per-row validation:

```cpp
#if WITH_EDITOR
virtual EDataValidationResult IsDataValid(FDataValidationContext& Context) const override
{
    if (Price < 0)
        Context.AddError(FText::FromString(TEXT("Price cannot be negative")));
    return Context.GetNumErrors() > 0
        ? EDataValidationResult::Invalid : EDataValidationResult::Valid;
}
#endif
```

## Module dependency

`UDataTable` and `UCompositeDataTable` live in the `Engine` module. Add `"Engine"` to
`PublicDependencyModuleNames` in your `Build.cs` (usually already present).

## Version notes

- The typed template API (`FindRow<T>`, `GetAllRows<T>`, `ForeachRow<T>`) is stable across
  UE5. In UE4 you had to use the untyped `FindRow` and cast manually.
- `bStripFromClientBuilds` was available since UE4.25.
- `FDataTableRowHandle::GetRow<T>` (rather than going through the table directly) is the
  preferred pattern from UE5.1 onward.
