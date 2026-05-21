---
name: subsystems
description: Use Unreal's Subsystems for clean, automatically-managed singletons scoped to a
  lifetime — UGameInstanceSubsystem, UWorldSubsystem, ULocalPlayerSubsystem, UEngineSubsystem
  (and UEditorSubsystem) — with Initialize/Deinitialize and ShouldCreateSubsystem. Use when you
  need a manager/service without a hand-rolled singleton or a "god" actor, want per-world or
  per-player services, or are deciding where cross-cutting gameplay logic should live.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Subsystems

Subsystems are engine-managed singletons with a defined lifetime and automatic creation/teardown.
They replace hand-written singletons and "manager actors": no manual instancing, no GC worries,
and they're directly accessible from C++ and Blueprints.

## When to use this skill

- You need a service/manager (save system, audio manager, match service, ability registry).
- You want something scoped to the game session, a world/level, or a local player.
- You're tempted to write a `static` singleton or a placed "manager actor" — use a subsystem instead.

## The five types (pick by lifetime/scope)

| Subsystem base | Lifetime / scope | Get it from |
|---|---|---|
| `UEngineSubsystem` | whole engine process | `GEngine->GetEngineSubsystem<T>()` |
| `UGameInstanceSubsystem` | the running game, **across level loads** | `UGameInstance::GetSubsystem<T>()` |
| `UWorldSubsystem` | one `UWorld`/level (recreated on level change) | `UWorld::GetSubsystem<T>()` |
| `ULocalPlayerSubsystem` | one local player | `ULocalPlayer::GetSubsystem<T>()` |
| `UEditorSubsystem` | the editor (editor-only) | `GEditor->GetEditorSubsystem<T>()` |

Each is **auto-created** once for its owner and destroyed with it. Most gameplay services want
`UGameInstanceSubsystem` (persists across levels) or `UWorldSubsystem` (per-level state).

## Authoring a subsystem

```cpp
// MySaveSubsystem.h
#include "Subsystems/GameInstanceSubsystem.h"
#include "MySaveSubsystem.generated.h"

UCLASS()
class MYGAME_API UMySaveSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    UFUNCTION(BlueprintCallable, Category="Save")
    void SaveProfile();
};

// MySaveSubsystem.cpp
void UMySaveSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    // Depend on another subsystem (ensures it's initialized first):
    // Collection.InitializeDependency(UOtherSubsystem::StaticClass());
}

void UMySaveSubsystem::Deinitialize()
{
    // tear down timers/handles created here
    Super::Deinitialize();
}
```

- `Initialize`/`Deinitialize` are the lifecycle hooks (not `BeginPlay`).
- Override `ShouldCreateSubsystem(UObject* Outer)` to conditionally create it (e.g. only on the
  server, or only when a feature is enabled).
- It's a `UObject`: use `UPROPERTY` members; it's GC-managed by its owner.

## Accessing a subsystem

```cpp
// GameInstance subsystem from any actor:
if (UGameInstance* GI = GetGameInstance())
    if (UMySaveSubsystem* Save = GI->GetSubsystem<UMySaveSubsystem>())
        Save->SaveProfile();

// World subsystem:
UMyWorldSub* WS = GetWorld()->GetSubsystem<UMyWorldSub>();

// Local player subsystem (e.g. from a PlayerController):
if (ULocalPlayer* LP = GetLocalPlayer())
    UMyLPSub* S = LP->GetSubsystem<UMyLPSub>();
```

In Blueprints, subsystems appear as auto-context targets (no spawning) — good for designer access.

## Choosing the right scope

- **Persists across levels, one per game** → `UGameInstanceSubsystem`.
- **Per-level state, reset on travel** → `UWorldSubsystem`.
- **Per local player (split-screen aware)** → `ULocalPlayerSubsystem`.
- **No world needed, process-wide** → `UEngineSubsystem`.
- **Editor tooling** → `UEditorSubsystem` (in an editor module).

If state must be replicated across the network, a subsystem isn't replicated — keep authoritative
replicated state on GameState/PlayerState/actors (see `gameplay-framework`,
`networking-and-replication`) and use the subsystem for local coordination.

## Gotchas

- **Expecting replication** — subsystems are local; they don't replicate.
- **Using `Initialize` like `BeginPlay`** — there's no world guarantee for engine/game-instance
  subsystems at init; defer world-dependent work or use a `UWorldSubsystem`.
- **Wrong scope** — putting per-level state in a GameInstance subsystem leaks it across levels;
  putting persistent state in a WorldSubsystem loses it on travel.
- **Heavy work in `Initialize`** blocks startup; defer or async it (`timers-and-async`).

## References & source material

Engine source (UE 5.7, `Runtime/Engine/Public/Subsystems/`):
- `Subsystem.h` — `USubsystem`, `FSubsystemCollectionBase`.
- `GameInstanceSubsystem.h`, `WorldSubsystem.h`, `LocalPlayerSubsystem.h`, `EngineSubsystem.h`.
- Editor: `Editor/EditorSubsystem/Public/EditorSubsystem.h`.

Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>
