# Spawning and destroying actors — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `SpawnActor` variants, `FActorSpawnParameters`,
collision handling, deferred spawn, destruction, and pooling. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/World.h`,
`GameFramework/Actor.h`, `Engine/Classes/Engine/EngineTypes.h`) and the official
[Spawning and Destroying an Actor](https://dev.epicgames.com/documentation/unreal-engine/spawning-and-destroying-unreal-engine-actors)
doc.

## Spawning is world-scoped

Actors live in a `UWorld`, so spawning goes through `GetWorld()->SpawnActor(...)`. `GetWorld()` is
null on the CDO and unreliable in constructors — only spawn from gameplay code (`BeginPlay` onward).
Spawning can **fail and return null** (e.g. blocked location), so null-check the result.

## `SpawnActor` variants

Templated overloads return the typed pointer (`World.h`:~3674+):

```cpp
// Class supplied as a UClass / TSubclassOf, with transform + params:
AThing* T = GetWorld()->SpawnActor<AThing>(ThingClass, Location, Rotation, Params);
AThing* U = GetWorld()->SpawnActor<AThing>(ThingClass, SpawnTransform, Params);

// Spawn the native class directly (skips Blueprint-authored defaults/components):
AThing* N = GetWorld()->SpawnActor<AThing>();
```

Prefer a `UPROPERTY(EditAnywhere) TSubclassOf<AThing> ThingClass;` so designers assign the Blueprint
subclass. Spawning the C++ class directly bypasses any components/defaults added in Blueprint.

## `FActorSpawnParameters`

`World.h`:418 — the optional knobs. Common fields:

| Field | Purpose |
|---|---|
| `Owner` | the actor that owns the spawned one (e.g. projectile's shooter); affects net relevancy |
| `Instigator` | the `APawn` responsible (damage attribution) |
| `Name` | explicit object name (must be unique) |
| `Template` | an actor to copy property values from |
| `SpawnCollisionHandlingOverride` | how to resolve spawning into a blocked spot (below) |
| `bNoFail` | force the spawn even if it would normally fail |
| `bDeferConstruction` | spawn deferred (the API behind `SpawnActorDeferred`) |
| `OverrideLevel` | which level the actor is added to |

```cpp
FActorSpawnParameters Params;
Params.Owner = this;
Params.Instigator = GetInstigator();
Params.SpawnCollisionHandlingOverride =
    ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
```

## Collision handling on spawn

`ESpawnActorCollisionHandlingMethod` (`EngineTypes.h`:4169) decides what happens when the spawn
transform overlaps existing geometry:

| Value | Behavior |
|---|---|
| `Undefined` | use the actor/default behavior |
| `AlwaysSpawn` | spawn regardless of collisions |
| `AdjustIfPossible` | try to nudge to a non-colliding spot; fail if none found |
| `AdjustIfPossibleButAlwaysSpawn` | nudge if possible, otherwise spawn anyway |
| `AdjustIfPossibleButDontSpawnIfColliding` | nudge if possible, otherwise don't spawn |
| `DontSpawnIfColliding` | fail the spawn if the location is blocked |

If you spawn at a spot that may be occupied and *must* get an actor, use
`AdjustIfPossibleButAlwaysSpawn`.

## Deferred spawn — set state before `BeginPlay`

When the actor needs values configured **before** its construction script and `BeginPlay` run
(projectile damage, a pickup's item id, anything "expose on spawn"):

```cpp
AProjectile* P = GetWorld()->SpawnActorDeferred<AProjectile>(ProjectileClass, SpawnTransform,
                                                             /*Owner=*/this, /*Instigator=*/GetInstigator());
P->Damage = 50.f;            // configure the valid-but-incomplete instance
P->SetReplicates(true);
P->FinishSpawning(SpawnTransform);   // Actor.h:3116 — runs construction → PostInitializeComponents → BeginPlay
```

`SpawnActorDeferred` runs everything up to `PostActorCreated`, then pauses; `FinishSpawning`
resumes at `ExecuteConstruction` and completes the lifecycle. (See
[actor-lifecycle.md](actor-lifecycle.md) for the exact sequence.) Plain `SpawnActor` runs the
constructor and `BeginPlay` immediately, with no window to inject state.

## Destroying actors

```cpp
Actor->Destroy();                 // Actor.h — mark pending-kill, remove from level; fires EndPlay
Actor->SetLifeSpan(5.f);          // auto-Destroy after N seconds
```

`Destroy()` marks the actor `RF_PendingKill` and removes it from the level's actor array;
garbage collection frees it later. `EndPlay(EEndPlayReason::Destroyed)` runs as part of this —
put cleanup there, since `EndPlay` also covers level transitions, PIE end, and streaming unload.
Don't keep raw pointers to actors that may be destroyed; use `TWeakObjectPtr<AActor>` and check
`IsValid()`. `EEndPlayReason` is defined at `EngineTypes.h`:3428.

## Object pooling (when spawn/destroy churn matters)

`SpawnActor`/`Destroy` allocate and GC; for high-frequency actors (bullets, impact FX) that churn
can hurt. The common pattern is a **pool**: pre-spawn N actors, then on "spawn" reactivate one
(`SetActorHiddenInGame(false)`, enable collision/tick, reposition) and on "destroy" deactivate and
return it to the pool instead of calling `Destroy()`. Reset per-use state yourself, since the
instance is reused (it never goes through a fresh constructor). This trades memory for fewer
allocations and GC passes — measure before adopting it.

## Gotchas

- **`GetWorld()` null in constructor/CDO** — spawn only from gameplay code.
- **Ignoring the null return** — a blocked spawn returns null; check it or set a collision override.
- **Setting state after plain `SpawnActor`** — too late if `BeginPlay` already used it; use deferred
  spawn.
- **Forgetting `FinishSpawning`** after `SpawnActorDeferred` — the actor never finishes construction
  or runs `BeginPlay`.
- **Spawning the C++ class instead of the `TSubclassOf` Blueprint** — loses Blueprint components and
  defaults.

## Version notes

- Spawn APIs, parameters, and the collision-handling enum are stable across UE5. Line numbers drift
  between patches; re-grep `World.h` / `EngineTypes.h` if a cite looks off.
