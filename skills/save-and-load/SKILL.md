---
name: save-and-load
description: Persist game data in Unreal with the SaveGame system — defining a USaveGame subclass,
  saving/loading to named slots (UGameplayStatics SaveGameToSlot/LoadGameFromSlot and async
  variants), choosing what to serialize, UPROPERTY(SaveGame) actor serialization, and versioning.
  Use when implementing save/load, persisting progress/settings/inventory, checking for existing
  saves, or migrating save data across versions.
metadata:
  engine-version: "5.7"
  category: systems
---

# Save & load

Persistence uses a **`USaveGame`** object: you put the data to persist in `UPROPERTY`s, then save
the object to a named slot and load it back. Keep the SaveGame as a clean data container and decide
deliberately what belongs in it.

## When to use this skill

- Saving/loading player progress, settings, inventory, world state.
- Checking whether a save exists; deleting saves; multiple slots/profiles.
- Serializing actor state into a save.
- Versioning saves so old saves still load after updates.

## Define a SaveGame

```cpp
// MySaveGame.h
#include "GameFramework/SaveGame.h"
#include "MySaveGame.generated.h"

UCLASS()
class MYGAME_API UMySaveGame : public USaveGame
{
    GENERATED_BODY()
public:
    UPROPERTY() int32 SaveVersion = 1;          // for migration
    UPROPERTY() FString PlayerName;
    UPROPERTY() int32 Level = 1;
    UPROPERTY() TArray<FName> UnlockedItems;
    UPROPERTY() FTransform PlayerTransform;
};
```
Members must be `UPROPERTY` to serialize. Use plain data (ints, strings, names, structs, arrays);
avoid storing live `UObject*`/actor pointers — store identifiers (names/IDs/soft paths) instead.

## Save & load (synchronous)

```cpp
#include "Kismet/GameplayStatics.h"

// Save
UMySaveGame* Save = Cast<UMySaveGame>(UGameplayStatics::CreateSaveGameObject(UMySaveGame::StaticClass()));
Save->Level = CurrentLevel;
Save->PlayerName = Name;
UGameplayStatics::SaveGameToSlot(Save, TEXT("Slot0"), /*UserIndex*/ 0);

// Load
if (UGameplayStatics::DoesSaveGameExist(TEXT("Slot0"), 0))
{
    UMySaveGame* Loaded = Cast<UMySaveGame>(UGameplayStatics::LoadGameFromSlot(TEXT("Slot0"), 0));
    if (Loaded) Apply(Loaded);
}

// Delete
UGameplayStatics::DeleteGameInSlot(TEXT("Slot0"), 0);
```
Slots are named; `UserIndex` supports per-user/profile saves (mainly for platforms with user
accounts).

## Async save & load (avoid hitches)

Synchronous save/load blocks the game thread; for larger saves use the async variants with a
delegate:
```cpp
FAsyncSaveGameToSlotDelegate Done;
Done.BindUObject(this, &AMyGameMode::OnSaved);     // (FString Slot, int32 User, bool bSuccess)
UGameplayStatics::AsyncSaveGameToSlot(Save, TEXT("Slot0"), 0, Done);

FAsyncLoadGameFromSlotDelegate Loaded;
Loaded.BindUObject(this, &AMyGameMode::OnLoaded);  // (FString, int32, USaveGame*)
UGameplayStatics::AsyncLoadGameFromSlot(TEXT("Slot0"), 0, Loaded);
```

## What to save (design)

- Persist **authoritative state**: progress, stats, inventory, settings, key world flags.
- Don't try to serialize the entire live world; capture the minimal data to **reconstruct** it on
  load (positions/ids/states), then rebuild actors.
- Coordinate with where state lives: GameInstance/subsystems for cross-level data
  (`unreal-subsystems`, `gameplay-framework`).

## Serializing actor state (UPROPERTY(SaveGame))

For capturing a chunk of an actor's properties, mark them `UPROPERTY(SaveGame)` and use an
`FObjectAndNameAsStringProxyArchive` (with `ArIsSaveGame=true`) to serialize only those into a byte
array stored in your SaveGame. Use this for "save the world's dynamic objects" systems; for simple
games, explicit fields are clearer.

## Versioning & migration

- Store a `SaveVersion` and, on load, migrate older versions (fill defaults for new fields, convert
  changed ones). Adding a `UPROPERTY` is generally backward-compatible (old saves load it as
  default); removing/renaming needs handling.
- Never assume a loaded save matches the current schema — validate.

## Settings vs save games

Game/graphics **settings** often belong in config (`UGameUserSettings`, `.ini` —
`unreal-project-structure`) rather than a SaveGame. Use SaveGame for *gameplay* persistence.

## Gotchas

- **Non-`UPROPERTY` fields aren't saved.**
- **Storing live object/actor pointers** → invalid on load; store ids/soft refs and re-resolve.
- **Synchronous save of large data** mid-gameplay → hitch; use async.
- **No version field** → painful migrations; add one from day one.
- **Forgetting `DoesSaveGameExist`** before load → null result handling.
- **Cast without null-check** on `LoadGameFromSlot` → crash if the slot is missing/corrupt.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/GameFramework/SaveGame.h` — `USaveGame`.
- `Runtime/Engine/Classes/Kismet/GameplayStatics.h` — `CreateSaveGameObject`, `SaveGameToSlot`,
  `LoadGameFromSlot`, `DoesSaveGameExist`, `DeleteGameInSlot`, and `Async*` variants + delegates.

Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>

Related: `unreal-subsystems`, `gameplay-framework`, `data-driven-design`.
