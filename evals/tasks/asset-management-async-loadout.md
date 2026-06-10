---
skill: asset-management
title: Async-load a weapon loadout from soft references
---

## Prompt

In an Unreal Engine 5.7 C++ project module named `EvalScratch`, implement a loadout
component that references a list of weapon definitions without keeping them in memory:
designers assign the list in the editor, nothing loads at construction or BeginPlay,
and `EquipWeapon(int32 Index)` asynchronously loads the entry, then spawns/attaches it
when ready. Cancel any in-flight load when another equip request arrives or the
component is destroyed.

## Acceptance criteria

- The designer-facing list uses soft references (`TSoftClassPtr<AActor>` or
  `TSoftObjectPtr<...>` / `FSoftObjectPath` in a struct), not `TSubclassOf` or raw
  object pointers (which are hard references and load with the component).
- Async load goes through `FStreamableManager::RequestAsyncLoad` (typically
  `UAssetManager::GetStreamableManager()`), not `LoadSynchronous`/`TryLoad` on the
  game thread.
- The returned `TSharedPtr<FStreamableHandle>` is stored; a new equip request or
  `EndPlay` calls `CancelHandle`/releases it.
- The completion delegate safely resolves the loaded class (`Get()` on the soft ptr)
  and handles the already-loaded fast path.
- No `ConstructorHelpers::FObjectFinder` outside a constructor, and none used for this
  runtime path at all.

## Common baseline failures

`TSubclassOf` arrays that hard-reference every weapon, `LoadSynchronous` hitching the
game thread inside `EquipWeapon`, dropping the streamable handle (load may be GC'd or
uncancellable), or `ConstructorHelpers` misused at runtime (assert/crash).
