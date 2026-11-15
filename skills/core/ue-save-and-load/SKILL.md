---
name: ue-save-and-load
description: Persist and restore game data in Unreal C++ using the SaveGame system — define a
  USaveGame subclass with UPROPERTY members, create/save/load/delete named slots via
  UGameplayStatics (SaveGameToSlot, LoadGameFromSlot, AsyncSaveGameToSlot,
  AsyncLoadGameFromSlot, DoesSaveGameExist, DeleteGameInSlot), and serialize actor state into
  a byte buffer with FMemoryWriter/FMemoryReader and FObjectAndNameAsStringProxyArchive. Covers
  the SaveGame UPROPERTY specifier and ArIsSaveGame archive flag for selective actor
  serialization, the ULocalPlayerSaveGame subclass for per-user saves, save versioning and
  migration, ISaveGameSystem platform abstraction, and design rules for what belongs in a save.
  Use when implementing save/load, persisting progress, inventory, or settings, handling
  multiple save slots or user profiles, serializing dynamic actor state, migrating old saves, or
  troubleshooting missing fields and null returns on load.
metadata:
  aliases: "save game, savegame, USaveGame, save system, persistence, load game, serialization"
  engine-version: "5.9"
  category: systems
---

# Save & load

Persistence uses a **`USaveGame`** object: put the data to persist in `UPROPERTY` members, then
write the object to a named slot and read it back. The slot API lives in `UGameplayStatics`; the
actual file I/O is delegated to `ISaveGameSystem`, which is swapped per platform.

## When to use this skill

- Saving and restoring player progress, inventory, world flags, or per-player settings.
- Checking whether a save slot exists; deleting or enumerating slots; multiple slot/profile flows.
- Serializing runtime actor state (dynamic objects) into a byte array inside a SaveGame object.
- Migrating save data after adding or removing fields.
- Understanding what goes in a `USaveGame` vs. config (`UGameUserSettings`/`.ini`).

## Mental model

```
USaveGame subclass        — the data bag; UPROPERTY members are what gets serialized
UGameplayStatics          — the entry point: create / save / load / delete / check slots
ISaveGameSystem           — the platform adapter; FGenericSaveGameSystem writes .sav files
FArchive (ArIsSaveGame)   — serialization flag; UPROPERTY(SaveGame) fields filtered by this
FObjectAndNameAsStringProxyArchive — proxy wrapping FMemoryWriter/Reader for actor state
```

`SaveGameToSlot` writes **all non-transient `UPROPERTY`s** on the `USaveGame` object — the
`SaveGame` specifier on the `USaveGame` itself does nothing; it matters when you use the archive
pattern to selectively serialize *actor* properties (see
[references/serializing-actor-state.md](references/serializing-actor-state.md)).

## Define a SaveGame

```cpp
// MySaveGame.h
#pragma once
#include "GameFramework/SaveGame.h"
#include "MySaveGame.generated.h"

UCLASS()
class MYGAME_API UMySaveGame : public USaveGame
{
    GENERATED_BODY()
public:
    UPROPERTY() int32 SaveVersion = 1;      // increment when schema changes
    UPROPERTY() FString PlayerName;
    UPROPERTY() int32 PlayerLevel = 1;
    UPROPERTY() FTransform LastCheckpoint;
    UPROPERTY() TArray<FName> UnlockedAbilities;

    // Serialized actor-state blobs (see actor serialization pattern below)
    UPROPERTY() TArray<uint8> DynamicActorData;
};
```

Rules for members:
- Must be `UPROPERTY` — bare fields are invisible to the serializer.
- Prefer plain data: ints, floats, strings, names, enums, structs, arrays of the above.
- Never store live `UObject*` or actor pointers — they are meaningless on reload. Store stable
  identifiers (slot index, `FName`, `FSoftObjectPath`), resolve back to live objects on load.
- `FTransform`, `FVector`, `FRotator`, and custom `USTRUCT`s are fine as long as all their
  members are `UPROPERTY`.

## Save & load — synchronous

```cpp
#include "Kismet/GameplayStatics.h"

// ---- Save ----
UMySaveGame* Save = Cast<UMySaveGame>(
    UGameplayStatics::CreateSaveGameObject(UMySaveGame::StaticClass()));
if (Save)
{
    Save->PlayerLevel = CurrentLevel;
    Save->PlayerName  = PlayerName;
    UGameplayStatics::SaveGameToSlot(Save, TEXT("Slot0"), /*UserIndex*/ 0);
}

// ---- Load ----
if (UGameplayStatics::DoesSaveGameExist(TEXT("Slot0"), 0))
{
    UMySaveGame* Loaded = Cast<UMySaveGame>(
        UGameplayStatics::LoadGameFromSlot(TEXT("Slot0"), 0));
    if (Loaded) { ApplySaveData(Loaded); }
}

// ---- Delete ----
UGameplayStatics::DeleteGameInSlot(TEXT("Slot0"), 0);
```

`UserIndex` differentiates per-user/profile saves; on PC it is typically `0`. Slots are arbitrary
strings — use a consistent naming convention (`"Profile_0"`, `"AutoSave"`, etc.).

## Save & load — async (prefer for gameplay saves)

Synchronous save/load blocks the game thread. For any save triggered during active gameplay use
the async variants, which serialize on the game thread but offload the file write/read to a
worker:

```cpp
// ---- Async save ----
FAsyncSaveGameToSlotDelegate OnSaved;
// Callback signature: void (const FString& Slot, int32 User, bool bSuccess)
OnSaved.BindUObject(this, &AMyGameMode::HandleSaveComplete);
UGameplayStatics::AsyncSaveGameToSlot(Save, TEXT("Slot0"), 0, OnSaved);

// ---- Async load ----
FAsyncLoadGameFromSlotDelegate OnLoaded;
// Callback signature: void (const FString& Slot, int32 User, USaveGame* Loaded)
OnLoaded.BindUObject(this, &AMyGameMode::HandleLoadComplete);
UGameplayStatics::AsyncLoadGameFromSlot(TEXT("Slot0"), 0, OnLoaded);
```

Both delegates are declared in `Kismet/GameplayStatics.h`:43-47.

## Serializing actor state (UPROPERTY(SaveGame) + FMemoryWriter)

For dynamic world objects (destructibles, chests, NPCs), capture actor state into a byte array
stored inside your `USaveGame`. Mark the actor properties to persist with `UPROPERTY(SaveGame)`,
then use `FObjectAndNameAsStringProxyArchive` (with `ArIsSaveGame = true`) to filter them. Only
properties marked `UPROPERTY(SaveGame)` are written when `ArIsSaveGame` is set.

```cpp
// On an actor class:
UPROPERTY(SaveGame) bool bOpened = false;
UPROPERTY(SaveGame) int32 RemainingUses = 3;
UPROPERTY()         float SomeTransientValue; // NOT saved (no SaveGame specifier)

// ---- Serialize actor → byte array ----
TArray<uint8> ActorBytes;
{
    FMemoryWriter MemWriter(ActorBytes, /*bIsPersistent*/ true);
    FObjectAndNameAsStringProxyArchive Ar(MemWriter, /*bInLoadIfFindFails*/ false);
    Ar.ArIsSaveGame = true;          // restricts serialization to UPROPERTY(SaveGame) fields
    SomeActor->Serialize(Ar);
}
MySaveGame->DynamicActorData = ActorBytes; // store in the USaveGame

// ---- Restore actor ← byte array ----
{
    FMemoryReader MemReader(MySaveGame->DynamicActorData, /*bIsPersistent*/ true);
    FObjectAndNameAsStringProxyArchive Ar(MemReader, /*bInLoadIfFindFails*/ true);
    Ar.ArIsSaveGame = true;
    SomeActor->Serialize(Ar);
}
```

See [references/serializing-actor-state.md](references/serializing-actor-state.md) for the
full multi-actor pattern, spawn/restore loop, and gotchas.

## Per-player saves — ULocalPlayerSaveGame (UE 5.3+)

`ULocalPlayerSaveGame` (also in `SaveGame.h`) extends `USaveGame` with built-in versioning,
`HandlePostLoad`/`HandlePreSave`/`HandlePostSave` hooks, and synchronous/async helpers tied to a
specific `ULocalPlayer`. It is the recommended base for per-user saves when your game supports
multiple local players or needs structured versioning:

```cpp
// Sync load-or-create for a specific player controller
UMyPlayerSave* PS = Cast<UMyPlayerSave>(
    ULocalPlayerSaveGame::LoadOrCreateSaveGameForLocalPlayer(
        UMyPlayerSave::StaticClass(), PlayerController, TEXT("PlayerSlot")));

// Async variant
ULocalPlayerSaveGame::AsyncLoadOrCreateSaveGameForLocalPlayer(
    UMyPlayerSave::StaticClass(), PlayerController, TEXT("PlayerSlot"),
    FOnLocalPlayerSaveGameLoaded::CreateUObject(this, &AMyHUD::OnPlayerSaveLoaded));
```

Declared in `Runtime/Engine/Classes/GameFramework/SaveGame.h`:47-226.

## Versioning & migration

- Add `UPROPERTY() int32 SaveVersion = 1;` from day one. Increment when the schema changes.
- Adding a `UPROPERTY` is backward-compatible (missing fields load as their C++ default).
- Renaming or removing a field is a **breaking change** — handle it in load logic:

```cpp
void UMySaveGame::PostLoad()
{
    Super::PostLoad();
    if (SaveVersion < 2)
    {
        // e.g. migrate OldField → NewField
        NewField = OldField_Deprecated;
        SaveVersion = 2;
    }
}
```

- For `ULocalPlayerSaveGame`, override `GetLatestDataVersion()` and do fixup in `HandlePostLoad`.
- Always null-check the loaded object — a corrupt or mismatched save returns `nullptr`.

## What to save (design)

- Persist **authoritative game state**: progress, stats, unlocks, world-object states, settings.
- Do not serialize the entire live level — capture the minimum data to **reconstruct** the world
  on load (spawn actors from a list of records, restore their state from byte blobs).
- Cross-level/session data (e.g. unlocked chapters) belongs in `GameInstance` or a subsystem
  during a session; persist it to a `USaveGame` slot at save points.
- Game and graphics **settings** often fit better in `UGameUserSettings` / config `.ini` files
  (`ue-project-structure`) — reserve `USaveGame` for gameplay state.

## Gotchas

- **Non-`UPROPERTY` fields are invisible** — the serializer cannot see bare C++ fields.
- **`UPROPERTY(SaveGame)` does nothing on the SaveGame object itself** — it gates selective
  actor serialization via `ArIsSaveGame`. On the `USaveGame` subclass every non-transient
  `UPROPERTY` is written regardless of specifier.
- **Storing live pointers** — actor/object pointers are meaningless after a reload; store IDs or
  soft paths and re-resolve them in `BeginPlay`.
- **Sync save on large data during active gameplay** — causes a visible hitch; use async.
- **No version field** — painful migrations; add one at project start.
- **Cast without null-check after `LoadGameFromSlot`** — crashes on missing or corrupt saves.
- **`DoesSaveGameExist` not checked** before load — not strictly required (load returns null on
  missing), but checking first lets you distinguish "no save" from "corrupt save".
- **Mismatched slot name / UserIndex** — save and load must use the exact same pair.
- **`UPROPERTY(Transient)` fields** — explicitly excluded from all serialization; use this for
  cache/derived data you recompute on load.

## Version notes

- `ULocalPlayerSaveGame` arrived in UE 5.3 (it lives in `SaveGame.h`, not its own header);
  `UAsyncActionHandleSaveGame` is much older (UE 4.x). Earlier code uses only `USaveGame` +
  the `UGameplayStatics` free functions.
- `SaveGameToMemory` / `LoadGameFromMemory` / `SaveDataToSlot` / `LoadDataFromSlot` are
  available as of UE 5.3 for in-memory and two-phase save flows.
- The `ISaveGameSystem` platform layer is stable across UE5; on PC it writes `.sav` files to
  `<Project>/Saved/SaveGames/`. Console platforms swap in platform-specific implementations.

## References & source material

Engine source (UE 5.9, under `Engine/Source/`):
- `Runtime/Engine/Classes/GameFramework/SaveGame.h` — `USaveGame` (abstract, `Blueprintable`);
  `ULocalPlayerSaveGame` with versioning hooks:47-226.
- `Runtime/Engine/Classes/Kismet/GameplayStatics.h` — `CreateSaveGameObject`:1073,
  `SaveGameToMemory`:1083, `SaveDataToSlot`:1092, `AsyncSaveGameToSlot`:1104,
  `SaveGameToSlot`:1116, `DoesSaveGameExist`:1124, `LoadGameFromMemory`:1131,
  `LoadDataFromSlot`:1140, `AsyncLoadGameFromSlot`:1151, `LoadGameFromSlot`:1160,
  `DeleteGameInSlot`:1180. Delegates `FAsyncSaveGameToSlotDelegate` /
  `FAsyncLoadGameFromSlotDelegate`:43-47.
- `Runtime/Engine/Public/SaveGameSystem.h` — `ISaveGameSystem` interface: `SaveGame`,
  `LoadGame`, `DeleteGame`, `DoesSaveGameExist`, async variants; `FGenericSaveGameSystem`
  (writes `Saved/SaveGames/<Name>.sav`).
- `Runtime/CoreUObject/Public/UObject/ObjectMacros.h` — `CPF_SaveGame` flag:458;
  `SaveGame` specifier keyword:1194 — gates serialization when `ArIsSaveGame` is set.
- `Runtime/Core/Public/Serialization/Archive.h` — `ArIsSaveGame` bitfield:938;
  `IsSaveGame()` accessor:655-658.
- `Runtime/CoreUObject/Public/Serialization/ObjectAndNameAsStringProxyArchive.h` —
  `FObjectAndNameAsStringProxyArchive`: serializes `UObject*` and `FName` as strings; wrap
  around `FMemoryWriter`/`FMemoryReader` for actor state capture.
- `Runtime/Core/Public/Serialization/MemoryWriter.h` — `FMemoryWriter` (32-bit index):100-106.
- `Runtime/Core/Public/Serialization/MemoryReader.h` — `FMemoryReader`:16-69.

Official docs (UE 5.8, verified live):
- Saving and Loading Your Game —
  <https://dev.epicgames.com/documentation/unreal-engine/saving-and-loading-your-game-in-unreal-engine>

Deep-dive references in this skill:
- [references/savegame-objects-and-slots.md](references/savegame-objects-and-slots.md) — slot
  API internals, ISaveGameSystem platform layer, file locations, binary save/load helpers.
- [references/serializing-actor-state.md](references/serializing-actor-state.md) — full
  multi-actor capture/restore pattern, UPROPERTY(SaveGame) mechanics, FArchive internals.
- [references/versioning-and-migration.md](references/versioning-and-migration.md) — version
  strategy, migration patterns, ULocalPlayerSaveGame versioning, platform considerations.

Related skills: `ue-subsystems`, `ue-gameplay-framework`, `ue-data-driven-design`, `ue-core-types-and-containers`.
