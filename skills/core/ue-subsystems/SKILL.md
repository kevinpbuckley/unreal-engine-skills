---
name: ue-subsystems
description: >
  Implement engine-managed singletons scoped to a defined lifetime using Unreal's Subsystem
  framework — UEngineSubsystem, UGameInstanceSubsystem, UWorldSubsystem,
  UTickableWorldSubsystem, and ULocalPlayerSubsystem. Covers Initialize/Deinitialize
  lifecycle, ShouldCreateSubsystem for conditional creation, InitializeDependency for
  ordered init, and Blueprint/Python exposure. Use when building a service or manager
  (save system, ability registry, match service, analytics) and deciding whether to scope
  it to the process, game session, world, or local player — and when choosing between a
  subsystem, a manager actor, or a GameInstance override.
metadata:
  aliases: "subsystem, subsystems, singleton, manager, service, GameInstanceSubsystem, WorldSubsystem"
  engine-version: "5.9"
  category: gameplay-framework
---

# Subsystems

A **Subsystem** is a `UObject`-derived singleton whose lifetime matches a specific engine
construct (engine process, game instance, world, or local player). The engine creates it
automatically when the owning object is created and destroys it when the owner is torn down —
no manual instancing, no GC juggling, and Blueprint/Python exposure comes for free.

Subsystems replace hand-rolled static singletons and "manager actors". They are the canonical
pattern for cross-cutting services in modern Unreal C++.

## When to use this skill

- You need a service or manager class (inventory, save system, match lifecycle, analytics,
  ability registry, audio coordinator) and want it created and cleaned up automatically.
- You need to choose between a `UGameInstanceSubsystem`, `UWorldSubsystem`, or a manager actor.
- You are building a plugin and want the plugin's systems initialized without burdening the
  game project with manual setup code.
- You want Blueprint-callable game services without casting to game-specific classes.
- You want per-local-player state that is split-screen-safe.

## The five subsystem types (choose by lifetime)

| Base class | Lifetime | Created/owned by | Access |
|---|---|---|---|
| `UEngineSubsystem` | Engine process; survives level loads and PIE sessions | `UEngine` / `GEngine` | `GEngine->GetEngineSubsystem<T>()` |
| `UGameInstanceSubsystem` | Game session; **persists across level loads** | `UGameInstance` | `GameInstance->GetSubsystem<T>()` |
| `UWorldSubsystem` | One `UWorld`; reset on every level change or seamless travel | `UWorld` | `World->GetSubsystem<T>()` |
| `UTickableWorldSubsystem` | Same as `UWorldSubsystem` plus automatic per-frame `Tick` | `UWorld` | `World->GetSubsystem<T>()` |
| `ULocalPlayerSubsystem` | One local player; one instance per split-screen slot | `ULocalPlayer` | `LocalPlayer->GetSubsystem<T>()` |

`UEditorSubsystem` (editor-only module) follows the same pattern for editor tooling; it is not
covered here. See `references/subsystem-types.md` for full per-type detail.

## Authoring a subsystem

A minimal `UGameInstanceSubsystem`:

```cpp
// MySaveSubsystem.h
#pragma once
#include "Subsystems/GameInstanceSubsystem.h"
#include "MySaveSubsystem.generated.h"

UCLASS()
class MYGAME_API UMySaveSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()
public:
    // Called after UGameInstance is initialized. Collection is used to declare dependencies.
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    // Returns false to skip creation entirely (e.g. on dedicated server).
    virtual bool ShouldCreateSubsystem(UObject* Outer) const override;

    UFUNCTION(BlueprintCallable, Category = "Save")
    void SaveProfile();

private:
    UPROPERTY()
    TObjectPtr<USaveGame> CurrentSave;
};
```

```cpp
// MySaveSubsystem.cpp
#include "MySaveSubsystem.h"
#include "AnotherSubsystem.h"   // dependency example

void UMySaveSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    // Ensure UAnotherSubsystem is initialized before this one.
    Collection.InitializeDependency<UAnotherSubsystem>();
    Super::Initialize(Collection);
    // Perform initialization — world is not guaranteed here for game-instance scope.
}

void UMySaveSubsystem::Deinitialize()
{
    // Clear timers, delegates, file handles, etc.
    Super::Deinitialize();
}

bool UMySaveSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
    // Skip on dedicated server builds:
    if (!Super::ShouldCreateSubsystem(Outer)) { return false; }
    return !IsRunningDedicatedServer();
}
```

Key rules:
- `Initialize`/`Deinitialize` are the lifecycle hooks — not `BeginPlay`/`EndPlay`.
- The subsystem is a `UObject`; use `UPROPERTY()` on all `UObject*` members.
- `ShouldCreateSubsystem` is called on the CDO before any instance is created; keep it cheap.
- Call `Super::Initialize(Collection)` first, `Super::Deinitialize()` last.

## Accessing a subsystem

```cpp
// From any actor — GameInstance subsystem:
if (UGameInstance* GI = GetGameInstance())
{
    if (UMySaveSubsystem* Save = GI->GetSubsystem<UMySaveSubsystem>())
        Save->SaveProfile();
}

// Static helper — safe even if GI is null:
UMySaveSubsystem* Save = UGameInstance::GetSubsystem<UMySaveSubsystem>(GetGameInstance());

// World subsystem (returns null if ShouldCreateSubsystem returned false):
UMyWorldSub* WS = GetWorld()->GetSubsystem<UMyWorldSub>();

// Checked accessor (asserts on null; prefer when null is a bug):
UMyWorldSub& WS = *GetWorld()->GetSubsystemChecked<UMyWorldSub>();

// Local player subsystem from a PlayerController:
UMyLPSub* S = ULocalPlayer::GetSubsystemFromController<UMyLPSub>(this);
```

In **Blueprints**, subsystems appear as typed auto-context getter nodes — no casting required.
The node is available for any subsystem that is a `UCLASS()` (even without `BlueprintType`), as
long as the function is marked `BlueprintCallable`. `USubsystemBlueprintLibrary` provides the
static getters that Blueprint graph searches surface.

In **Python** that library does not exist: every getter on it is `BlueprintInternalUseOnly`,
which the Python generator skips, so `unreal.SubsystemBlueprintLibrary` raises
`module 'unreal' has no attribute 'SubsystemBlueprintLibrary'`. Use the free functions of the
`unreal` module, one per subsystem kind; the owner argument must be the right kind of object
(a `GameInstance`, a `World`, a `LocalPlayer`), and a class of the wrong kind raises
`Cannot nativize 'X' as 'Class'`:

```python
unreal.get_engine_subsystem(unreal.MyEngineSub)
unreal.get_editor_subsystem(unreal.MyEditorSub)                    # editor only
gi = unreal.GameplayStatics.get_game_instance(world)               # world: a PIE or game world
unreal.get_game_instance_subsystem(gi, unreal.MyGameInstanceSub)   # 5.9+
unreal.get_world_subsystem(world, unreal.MyWorldSub)               # 5.9+
unreal.get_local_player_subsystem(local_player, unreal.MyLPSub)    # 5.9+
```

These also do not exist: `gi.get_subsystem(...)`, `MySub.get()`. *Version note:* the
game-instance, world and local-player getters are new in UE 5.9 (`PyEngine.cpp`); 5.8 Python has
only the engine and editor getters, so reaching a game subsystem from 5.8 Python needs your own
`BlueprintCallable` static that returns it. All return `None` when the owner does not create
that subsystem.

## Dependency ordering

```cpp
void UMySubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    // Template form — preferred, type-safe:
    Collection.InitializeDependency<UOtherSubsystem>();
    Super::Initialize(Collection);
}
```

`InitializeDependency` only works within the same collection (same owner). You cannot declare a
`UWorldSubsystem` dependency on a `UGameInstanceSubsystem` — they live in separate collections.
See `references/lifecycle-and-access.md` for the full initialization sequence.

## Ticking — UTickableWorldSubsystem

When per-frame work is needed in a world-scoped subsystem, inherit from
`UTickableWorldSubsystem` instead of `UWorldSubsystem`:

```cpp
UCLASS()
class MYGAME_API UMyTickingSystem : public UTickableWorldSubsystem
{
    GENERATED_BODY()
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    virtual void Tick(float DeltaTime) override;

    // Required pure virtual — used by the stats system:
    virtual TStatId GetStatId() const override
    {
        RETURN_QUICK_DECLARE_CYCLE_STAT(UMyTickingSystem, STATGROUP_Tickables);
    }
};
```

Rules:
- Forward `Initialize`/`Deinitialize` to `Super` to enable/disable ticking correctly.
- `GetStatId` is a pure virtual — failing to implement it prevents compilation.
- Prefer timers (`ue-timers-and-async`) over ticking when the work is infrequent.

## Choosing subsystem vs alternatives

| Need | Recommendation |
|---|---|
| Stateless utility functions | Free functions or a `BlueprintFunctionLibrary` |
| Replicated state (HP, score) | `AGameState`, `APlayerState` (subsystems do not replicate) |
| Single placed world object (obstacle spawner) | Manager actor placed in the level |
| Per-actor behavior/data | Component on the actor |
| Cross-level session state | `UGameInstanceSubsystem` |
| Per-level state, reset on travel | `UWorldSubsystem` |
| Per-player UI/input state | `ULocalPlayerSubsystem` |
| Plugin initialization | `UEngineSubsystem` or `UGameInstanceSubsystem` |

**Subsystems do not replicate.** Keep authoritative networked state on `GameState`,
`PlayerState`, or replicated actors. Use subsystems on the local side for coordination,
caching, and UI logic. See `ue-networking-and-replication` and `ue-gameplay-framework`.

## Gotchas

- **No world access in GameInstance/Engine Initialize** — `GetWorld()` on a
  `UGameInstanceSubsystem` returns null during `Initialize`; use a `UWorldSubsystem` or defer
  world-dependent work to `OnWorldBeginPlay` (world subsystems) or a timer.
- **Wrong scope** — session-persistent data in a `UWorldSubsystem` is wiped on level change;
  per-level data in a `UGameInstanceSubsystem` accumulates across travels.
- **`ShouldCreateSubsystem` returns false, but caller doesn't null-check** — `GetSubsystem<T>`
  returns `nullptr` when the subsystem was skipped; always null-check in the caller.
- **Dependency across collections** — `InitializeDependency` only works within the same
  collection; cross-scope coordination needs an accessor call in `Initialize`.
- **Forgetting `Super` in Initialize/Deinitialize** — for `UTickableWorldSubsystem`,
  `Super::Initialize` starts ticking and `Super::Deinitialize` stops it; skipping them breaks
  the tick lifecycle.
- **Heavy work in `Initialize` blocking startup** — defer expensive loading via
  `FStreamableManager` or `AsyncTask` (see `ue-timers-and-async`).
- **Circular dependencies** — `InitializeDependency` detects simple cycles at runtime and
  asserts; avoid mutual dependencies by splitting shared state into a third subsystem.

## References & source material

Engine source (UE 5.9, `Engine/Source/Runtime/Engine/Public/Subsystems/`):
- `Subsystem.h` — `USubsystem`:44 — `ShouldCreateSubsystem`:56, `Initialize`:69,
  `Deinitialize`:72. `UDynamicSubsystem`:90 (base for `UEngineSubsystem`).
- `SubsystemCollection.h` — `FSubsystemCollectionBase`:16, `InitializeDependency`:53,
  `ActivateExternalSubsystem`:68, `DeactivateExternalSubsystem`:73.
- `GameInstanceSubsystem.h` — `UGameInstanceSubsystem`:16 (`Within=GameInstance`),
  `GetGameInstance()`:25.
- `WorldSubsystem.h` — `UWorldSubsystem`:16 — `PostInitialize`:37,
  `OnWorldBeginPlay`:43, `DoesSupportWorldType`:66. `UTickableWorldSubsystem`:80 —
  `GetStatId` pure virtual:93.
- `LocalPlayerSubsystem.h` — `ULocalPlayerSubsystem`:17 (`Within=LocalPlayer`),
  `PlayerControllerChanged`:35.
- `EngineSubsystem.h` — `UEngineSubsystem`:20 (derives from `UDynamicSubsystem`).
- `SubsystemBlueprintLibrary.h` — Blueprint-internal getters for all subsystem types:15
  (each `meta = (BlueprintInternalUseOnly = "true")`, so none reach Python).

Python getters (UE 5.9): `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyEngine.cpp`
(`get_world_subsystem`, `get_game_instance_subsystem`, `get_local_player_subsystem`) and
`Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyEditor.cpp`
(`get_engine_subsystem`, `get_editor_subsystem`); the generator's skip rule is
`IsScriptExposedFunction` in `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyGenUtil.cpp`.

Engine source (UE 5.9, `Engine/Source/Runtime/Engine/Classes/Engine/`):
- `GameInstance.h` — `GetSubsystem<T>()`:440, static `GetSubsystem(GameInstance*)`:450.
- `World.h` — `GetSubsystem<T>()`:4313, `GetSubsystemChecked<T>()`:4322,
  static `GetSubsystem(World*)`:4332.
- `LocalPlayer.h` — `GetSubsystem<T>()`:365, `GetSubsystemFromController<T>()`:389.
- `Engine.h` — `GetEngineSubsystem<T>()`:3837, `EngineSubsystemCollection`:3886.

Official docs (UE 5.8):
- Programming Subsystems —
  <https://dev.epicgames.com/documentation/unreal-engine/programming-subsystems-in-unreal-engine>

Deep-dive references in this skill:
- [references/subsystem-types.md](references/subsystem-types.md) — per-type detail: creation
  timing, valid `GetWorld()` availability, `DoesSupportWorldType`, dynamic subsystems,
  `UEditorSubsystem`.
- [references/lifecycle-and-access.md](references/lifecycle-and-access.md) — full
  Initialize/Deinitialize sequence, dependency ordering, accessing subsystems from C++ and
  Blueprints, collection internals.
- [references/choosing-a-subsystem.md](references/choosing-a-subsystem.md) — decision guide:
  subsystem vs manager actor vs GameInstance override vs component; networking constraints;
  plugin patterns.
