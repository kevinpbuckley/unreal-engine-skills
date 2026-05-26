# SaveGame objects and slots — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers how `UGameplayStatics` dispatches to
`ISaveGameSystem`, file locations on each tier, the binary save helpers added in UE 5.3, slot
naming conventions, and the `UAsyncActionHandleSaveGame` Blueprint async node. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Kismet/GameplayStatics.h`,
`Engine/Source/Runtime/Engine/Public/SaveGameSystem.h`).

## The slot pipeline

When you call `SaveGameToSlot`, the chain is:

1. `UGameplayStatics::SaveGameToSlot` (GameplayStatics.h:1168) serializes the `USaveGame` object
   into a `TArray<uint8>` using tagged property serialization (FObjectAndNameAsStringProxyArchive
   is **not** used here — all non-transient UPROPERTYs are written).
2. The byte array is handed to `ISaveGameSystem::SaveGame` (SaveGameSystem.h:52).
3. On PC, `FGenericSaveGameSystem` writes it to
   `<Project>/Saved/SaveGames/<SlotName>.sav` (SaveGameSystem.h:151-154).
4. On console platforms, the engine module for that platform substitutes its own
   `ISaveGameSystem` implementation transparently — your slot-name call does not change.

Loading reverses the chain: `LoadGameFromSlot` calls `ISaveGameSystem::LoadGame`, reads raw
bytes, then reconstitutes the `USaveGame` object using the engine's tagged property deserializer.

## ISaveGameSystem interface (SaveGameSystem.h)

`ISaveGameSystem` is a pure-virtual interface. Key members:

| Method | Purpose |
|---|---|
| `DoesSaveGameExist(Name, UserIndex)` | synchronous existence check |
| `DoesSaveGameExistWithResult(Name, UserIndex)` | returns `ESaveExistsResult` with Corrupt/DoesNotExist detail |
| `SaveGame(bUI, Name, UserIndex, Data)` | blocking save |
| `LoadGame(bUI, Name, UserIndex, Data)` | blocking load |
| `DeleteGame(bUI, Name, UserIndex)` | blocking delete |
| `GetSaveGameNames(FoundSaves, UserIndex)` | enumerate slot names (not all platforms) |
| `SaveGameAsync(...)` | non-blocking save, calls FSaveGameAsyncOpCompleteCallback |
| `LoadGameAsync(...)` | non-blocking load, calls FSaveGameAsyncLoadCompleteCallback |
| `LoadGameIfExistsAsync(...)` | combines existence check + load in one call |
| `DoesSaveGameExistAsync(...)` | non-blocking existence check |
| `InitAsync(bUI, PlatformUserId, Callback)` | optional user-login-time initialization |

`FBaseAsyncSaveGameSystem` (SaveGameSystem.h:178) is the preferred base for new platform
implementations: it provides the synchronous wrappers automatically from the async methods.

The async callbacks all marshal back to the game thread before firing. Do not touch gameplay
objects from inside the raw async workers.

## File locations

| Platform | Location |
|---|---|
| PC (Win/Mac/Linux) | `<Project>/Saved/SaveGames/<SlotName>.sav` |
| Console | Platform-specific save storage; slot name maps to platform file handle |
| In-memory only | `SaveGameToMemory` / `LoadGameFromMemory` — no file at all |

Slot names are arbitrary strings. Use a consistent scheme:
- `"Profile_0"`, `"Profile_1"` — per-user profiles.
- `"AutoSave"`, `"Checkpoint_Forest"` — purpose-named slots.
- Avoid platform path characters (`/`, `\`, `:`, `*`) — the slot name becomes the file name on PC.

## UGameplayStatics free functions — complete set (5.7)

All declared in `Runtime/Engine/Classes/Kismet/GameplayStatics.h`:

```
CreateSaveGameObject(Class)                              → USaveGame*      :1125
SaveGameToMemory(SaveGameObject, OutSaveData)            → bool            :1135
SaveDataToSlot(InSaveData, SlotName, UserIndex)          → bool            :1144
AsyncSaveGameToSlot(Obj, Slot, User, Delegate)           → void            :1156
SaveGameToSlot(Obj, Slot, User)                          → bool            :1168
DoesSaveGameExist(Slot, User)                            → bool            :1176
LoadGameFromMemory(InSaveData)                           → USaveGame*      :1183
LoadDataFromSlot(OutSaveData, Slot, User)                → bool            :1192
AsyncLoadGameFromSlot(Slot, User, Delegate)              → void            :1203
LoadGameFromSlot(Slot, User)                             → USaveGame*      :1212
StripSaveGameHeader(SaveData)                            → FMemoryReader   :1223
DeleteGameInSlot(Slot, User)                             → bool            :1232
```

`StripSaveGameHeader` is useful for custom serialization pipelines: it returns an `FMemoryReader`
offset past the internal save-game header so you can parse the payload yourself.

## Binary save helpers (UE 5.3+)

When you want to cache the save in memory and write it later, or want to pipeline serialization
and I/O separately:

```cpp
// Step 1: serialize to memory (game thread, synchronous)
TArray<uint8> Blob;
if (UGameplayStatics::SaveGameToMemory(MySave, Blob))
{
    // Step 2: write to slot (can be async via SaveGameAsync on ISaveGameSystem directly)
    UGameplayStatics::SaveDataToSlot(Blob, TEXT("Slot0"), 0);
}

// Reverse: load bytes then reconstruct object
TArray<uint8> Blob;
if (UGameplayStatics::LoadDataFromSlot(Blob, TEXT("Slot0"), 0))
{
    UMySaveGame* Obj = Cast<UMySaveGame>(UGameplayStatics::LoadGameFromMemory(Blob));
}
```

This two-step approach lets you, for example, compress or encrypt the blob between steps.

## UAsyncActionHandleSaveGame — Blueprint async node

`UAsyncActionHandleSaveGame` (GameFramework/AsyncActionHandleSaveGame.h) wraps async save/load
as a Blueprint latent node. Native code should use `UGameplayStatics::AsyncSaveGameToSlot` /
`AsyncLoadGameFromSlot` directly. The async action fires its `Completed` multicast delegate
(with `USaveGame*` and `bool bSuccess`) on the game thread.

## UserIndex and multi-user

`UserIndex` is an `int32` that identifies the local player account performing the save. On PC it
is typically `0`. On consoles with multiple local profiles (e.g. Xbox), pass the correct index so
the platform save system can scope the file to that user's storage space. The `ULocalPlayerSaveGame`
helpers derive `UserIndex` automatically from the `ULocalPlayer`.

Platforms that do not support multiple users (`DoesSaveSystemSupportMultipleUsers() == false`)
ignore the index; only the primary user's saves are accessible. Design your slot-name scheme to
be user-scoped even on PC if you anticipate porting to console.
