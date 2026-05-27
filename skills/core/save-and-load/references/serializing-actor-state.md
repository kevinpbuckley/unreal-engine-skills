# Serializing actor state — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `UPROPERTY(SaveGame)` + `ArIsSaveGame`
mechanism, `FObjectAndNameAsStringProxyArchive`, the full multi-actor capture/restore loop, and
common pitfalls. Grounded in UE 5.7
(`Engine/Source/Runtime/CoreUObject/Public/Serialization/ObjectAndNameAsStringProxyArchive.h`,
`Engine/Source/Runtime/Core/Public/Serialization/Archive.h`,
`Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h`).

## Why a separate actor-serialization path?

`SaveGameToSlot` only serializes the `USaveGame` object itself. Dynamic world objects — chests
opened, destructibles broken, NPCs with modified inventories — must be captured separately and
stored inside the `USaveGame` as opaque byte arrays. On load, you re-spawn or find the actors and
push the bytes back into them.

## UPROPERTY(SaveGame) and CPF_SaveGame

The `SaveGame` UPROPERTY specifier sets flag `CPF_SaveGame = 0x0000000001000000` on the property
metadata (`ObjectMacros.h`:443). This flag has **no effect** during normal `UObject` serialization
(including `SaveGameToSlot`). It only gates serialization when the archive's `ArIsSaveGame` bit
is true (`Archive.h`:933).

```cpp
// On the actor you want to snapshot:
UPROPERTY(SaveGame)  int32 HitPoints = 100;    // included when ArIsSaveGame = true
UPROPERTY(SaveGame)  bool  bDoorOpen  = false;  // included
UPROPERTY()          float SpeedCache = 0.f;    // excluded — no SaveGame specifier
UPROPERTY(Transient) float AIAlertLevel = 0.f;  // always excluded (Transient beats SaveGame)
```

`Transient` always prevents serialization regardless of `SaveGame` or `ArIsSaveGame`. If a field
is `Transient`, marking it `SaveGame` has no effect.

## FObjectAndNameAsStringProxyArchive

`FObjectAndNameAsStringProxyArchive` (ObjectAndNameAsStringProxyArchive.h) is an `FArchive` proxy
that overrides `operator<<` for `UObject*`, `FWeakObjectPtr`, `FSoftObjectPtr`,
`FSoftObjectPath`, and `FObjectPtr` to serialize them as human-readable strings rather than raw
object pointers. This makes the byte stream safe across sessions (object pointers are process-
local and meaningless after a reload).

Constructor:

```cpp
FObjectAndNameAsStringProxyArchive(FArchive& InInnerArchive, bool bInLoadIfFindFails);
```

- `InInnerArchive` — the actual byte-storage archive (`FMemoryWriter` or `FMemoryReader`).
- `bInLoadIfFindFails` — when deserializing, try to load the referenced object if it isn't in
  memory. Pass `true` on load, `false` on save.

After construction, set `Ar.ArIsSaveGame = true` to enable the `CPF_SaveGame` filter.

## Single-actor capture and restore

```cpp
// Actor header — properties to persist:
UPROPERTY(SaveGame) bool bActivated = false;
UPROPERTY(SaveGame) int32 AmmoCount = 30;

// ---- Capture ----
void CaptureActor(AActor* Actor, TArray<uint8>& OutBytes)
{
    OutBytes.Reset();
    FMemoryWriter Writer(OutBytes, /*bIsPersistent*/ true);
    FObjectAndNameAsStringProxyArchive Ar(Writer, /*bInLoadIfFindFails*/ false);
    Ar.ArIsSaveGame = true;
    Actor->Serialize(Ar);
}

// ---- Restore ----
void RestoreActor(AActor* Actor, const TArray<uint8>& Bytes)
{
    FMemoryReader Reader(Bytes, /*bIsPersistent*/ true);
    FObjectAndNameAsStringProxyArchive Ar(Reader, /*bInLoadIfFindFails*/ true);
    Ar.ArIsSaveGame = true;
    Actor->Serialize(Ar);
}
```

`bIsPersistent = true` on `FMemoryWriter`/`FMemoryReader` marks the archive as a "persistent"
save stream, which enables the full tagged-property serialization path rather than a transient
in-memory shortcut.

## Full multi-actor save loop

A typical "save all saveable actors in the level" pattern using a record struct stored in the
`USaveGame`:

```cpp
// In MySaveGame.h:
USTRUCT()
struct FActorSaveRecord
{
    GENERATED_BODY()
    UPROPERTY() FName    ActorName;        // unique, stable name set at edit time
    UPROPERTY() FTransform Transform;      // position/rotation/scale
    UPROPERTY() TArray<uint8> PropertyData; // UPROPERTY(SaveGame) fields
};

UCLASS()
class MYGAME_API UMySaveGame : public USaveGame
{
    GENERATED_BODY()
public:
    UPROPERTY() TArray<FActorSaveRecord> SavedActors;
};
```

```cpp
// ---- Save all actors ----
UMySaveGame* Save = Cast<UMySaveGame>(
    UGameplayStatics::CreateSaveGameObject(UMySaveGame::StaticClass()));

for (TActorIterator<ASaveableBase> It(GetWorld()); It; ++It)
{
    FActorSaveRecord Record;
    Record.ActorName  = It->GetFName();
    Record.Transform  = It->GetTransform();

    FMemoryWriter Writer(Record.PropertyData, true);
    FObjectAndNameAsStringProxyArchive Ar(Writer, false);
    Ar.ArIsSaveGame = true;
    It->Serialize(Ar);

    Save->SavedActors.Add(Record);
}
UGameplayStatics::SaveGameToSlot(Save, TEXT("World"), 0);
```

```cpp
// ---- Load and restore ----
UMySaveGame* Save = Cast<UMySaveGame>(
    UGameplayStatics::LoadGameFromSlot(TEXT("World"), 0));
if (!Save) { return; }

// Index live actors by name for fast lookup
TMap<FName, ASaveableBase*> ActorMap;
for (TActorIterator<ASaveableBase> It(GetWorld()); It; ++It)
    ActorMap.Add(It->GetFName(), *It);

for (const FActorSaveRecord& Record : Save->SavedActors)
{
    if (ASaveableBase** Found = ActorMap.Find(Record.ActorName))
    {
        (*Found)->SetActorTransform(Record.Transform);

        FMemoryReader Reader(Record.PropertyData, true);
        FObjectAndNameAsStringProxyArchive Ar(Reader, true);
        Ar.ArIsSaveGame = true;
        (*Found)->Serialize(Ar);
    }
    // If not found, the actor may have been added or removed between saves — handle gracefully.
}
```

## Spawning vs. finding actors on load

Two strategies for dynamic actors:

**Find existing** — actor is always present in the level (placed, never destroyed). Use the
actor's stable `FName` (or a `UPROPERTY(SaveGame) FName UniqueID` you assign) to look it up and
restore state. Works for persistent world actors.

**Spawn on load** — actor was spawned at runtime and must be recreated. Store the actor's
`TSubclassOf` (as a `FSoftClassPath`/`FName`) plus its transform in the record, then spawn it at
load time and immediately deserialize into it. Use deferred spawn so the restored properties are
set before `BeginPlay`:

```cpp
AThing* T = GetWorld()->SpawnActorDeferred<AThing>(LoadedClass, Record.Transform);
// Restore UPROPERTY(SaveGame) state before BeginPlay:
FMemoryReader Reader(Record.PropertyData, true);
FObjectAndNameAsStringProxyArchive Ar(Reader, true);
Ar.ArIsSaveGame = true;
T->Serialize(Ar);
T->FinishSpawning(Record.Transform);
```

## Pitfalls

- **`FObjectAndNameAsStringProxyArchive` serializes object refs as paths** — if the referenced
  object no longer exists at the same path on load, the pointer lands as `nullptr`. Pass
  `bInLoadIfFindFails = true` to attempt loading from disk.
- **Transforming byte arrays between sessions** — if class layout changes (new SaveGame field
  added), the tagged serialization format handles it gracefully. Renamed or removed fields are
  silently dropped on load; add a version guard if you need explicit migration.
- **Not resetting state before restore** — call `ResetToDefaults` or re-initialize actor state
  before deserializing if you want a clean slate (avoid stale values from the level default).
- **Nested UObjects in SaveGame properties** — if a `UPROPERTY(SaveGame)` field is a `UObject*`,
  the proxy archive serializes it as a path string. The object must be loadable by path on
  restore. Prefer plain structs or primitive types for save data.
- **Actors with no stable name** — runtime-spawned actors get a generated `FName` that changes
  per-session. Assign a stable ID at spawn time (e.g., a `UPROPERTY(SaveGame) FGuid UniqueID`)
  and use that as your map key instead of `GetFName()`.
