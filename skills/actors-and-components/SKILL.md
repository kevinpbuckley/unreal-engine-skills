---
name: actors-and-components
description: Build and compose gameplay objects from Actors and Components in Unreal C++ — the
  AActor lifecycle (constructor, PostInitializeComponents, BeginPlay, Tick, EndPlay, Destroyed),
  the component types (UActorComponent, USceneComponent, UPrimitiveComponent), the root component
  and attachment, spawning actors and creating/registering components at construction or runtime,
  and ticking. Use when creating an actor or component, setting up a component hierarchy, attaching
  components, spawning actors, registering runtime components, or debugging lifecycle/ticking/
  attachment/overlap issues.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Actors & components

An **Actor** (`AActor`) is anything you can place or spawn in a level. **Components** are the
reusable pieces of behavior/representation you compose onto actors. "Composition over
inheritance" is the intended design: prefer adding components over deep actor class hierarchies.

## When to use this skill

- Creating a new `AActor` or `UActorComponent` subclass.
- Setting up a component hierarchy (root + attached scene components) and choosing the root.
- Spawning actors (immediate or deferred) or adding/registering components at runtime.
- Wiring overlap/hit events, or deciding what runs in the constructor vs `BeginPlay`.
- Debugging "BeginPlay didn't run", "component has no transform / doesn't render", attachment
  problems, or "my runtime component does nothing".

## Component types

`UActorComponent` is the base for all components. The three tiers, in increasing capability:

| Type | Has transform? | Renders/collides? | Use for |
|---|---|---|---|
| `UActorComponent` | no | no | pure behavior/data (health, inventory, AI logic, abilities) |
| `USceneComponent` | **yes** (location/rotation/scale) | no | transform nodes, attach points, spring arms, cameras |
| `UPrimitiveComponent` | yes | **yes** | meshes, collision, anything drawn or physical |

Concrete primitives you will use most: `UStaticMeshComponent`, `USkeletalMeshComponent`,
`UCapsuleComponent`, `UBoxComponent`, `USphereComponent`, `UCameraComponent`,
`USpringArmComponent`.

Key consequences of the hierarchy:
- Only `USceneComponent`-derived components have a transform, can be **attached** into a hierarchy,
  or be the **root component**.
- Only `USceneComponent`/`UPrimitiveComponent` create a **render state** by default; plain
  `UActorComponent`s don't (nothing to draw).
- Only `UPrimitiveComponent` creates a **physics state** by default (collision/simulation).

See [references/components-and-registration.md](references/components-and-registration.md) for the
full type breakdown, render/physics state, and registration internals.

## AActor lifecycle (order matters)

The canonical order for a typical gameplay actor:

1. **Constructor** — set defaults, `CreateDefaultSubobject` for owned components. No world,
   no gameplay; also runs on the Class Default Object (CDO) and in the editor.
2. `OnConstruction(Transform)` — re-runs whenever a placed actor's properties change (construction
   script). Runs in editor and on spawn; keep it idempotent.
3. `PreInitializeComponents` → per-component `InitializeComponent` → `PostInitializeComponents` —
   components exist & are registered; safe to wire them together.
4. **`BeginPlay`** — gameplay starts. Do gameplay init here (spawning, timers, delegate bindings),
   **not** in the constructor.
5. `Tick(DeltaSeconds)` — per-frame, only if ticking is enabled (see [Ticking](#ticking)).
6. **`EndPlay(Reason)`** — leaving play (destroyed, level change, PIE end, app shutdown);
   clean up timers/delegates here.
7. `Destroyed` (legacy) then `BeginDestroy` / `FinishDestroy` during garbage collection.

There are three distinct **creation paths** that converge before `BeginPlay`: load-from-disk
(`PostLoad`), Play-in-Editor duplication (`PostDuplicate`), and spawning (`PostActorCreated` →
`OnConstruction`). `PostLoad` and `PostActorCreated` are mutually exclusive. The full flow,
including deferred spawn and the GC sequence, is in
[references/actor-lifecycle.md](references/actor-lifecycle.md).

Verified in 5.7 (`GameFramework/Actor.h`): `BeginPlay()`:2128, `EndPlay()`:2135,
`PostInitProperties()`:2346, `Tick(float)`:3059, `PreInitializeComponents()`:3123,
`PostInitializeComponents()`:3126, `OnConstruction()`:3448, `Destroyed()`:3568.

**Constructor vs BeginPlay:** the constructor runs on the CDO and in the editor, with no world.
Never do gameplay logic (spawning, world queries, timers, delegate binding) there — use `BeginPlay`.

## Authoring an actor with components

```cpp
// Pickup.h
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Pickup.generated.h"

class USphereComponent;
class UStaticMeshComponent;

UCLASS()
class MYGAME_API APickup : public AActor
{
    GENERATED_BODY()
public:
    APickup();

protected:
    virtual void BeginPlay() override;

    // Overlap handlers must be UFUNCTION() with the exact delegate signature, or AddDynamic fails.
    UFUNCTION()
    void OnOverlap(UPrimitiveComponent* OverlappedComp, AActor* OtherActor,
                   UPrimitiveComponent* OtherComp, int32 OtherBodyIndex,
                   bool bFromSweep, const FHitResult& Sweep);

    UPROPERTY(VisibleAnywhere) TObjectPtr<USphereComponent> Trigger;   // root, collision
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Mesh;  // visual
};
```

```cpp
// Pickup.cpp
#include "Pickup.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"

APickup::APickup()
{
    PrimaryActorTick.bCanEverTick = false;   // default OFF; opt in only if you override Tick

    Trigger = CreateDefaultSubobject<USphereComponent>(TEXT("Trigger"));
    SetRootComponent(Trigger);

    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    Mesh->SetupAttachment(Trigger);          // attach in the constructor with SetupAttachment
}

void APickup::BeginPlay()
{
    Super::BeginPlay();
    Trigger->OnComponentBeginOverlap.AddDynamic(this, &APickup::OnOverlap);
}
```

Key rules:
- `CreateDefaultSubobject<T>(TEXT("UniqueName"))` is **constructor-only**; the names must be unique
  within the actor. It is declared on `UObject` (`CoreUObject/Public/UObject/Object.h`).
- Hold component pointers in `UPROPERTY() TObjectPtr<T>` members so the GC keeps them alive and
  they show in the editor. A raw `T*` UPROPERTY also works but `TObjectPtr` is the modern form.
- Set the root with `SetRootComponent` (or assign `RootComponent`). The actor's world transform
  comes from its root.
- In the constructor, attach with `SetupAttachment(Parent)`. At runtime, use `AttachToComponent`.
- Forward-declare component classes in the header and `#include` the concrete component headers in
  the `.cpp` to keep header dependencies light.

## Spawning actors at runtime

```cpp
FActorSpawnParameters Params;
Params.Owner = this;
Params.SpawnCollisionHandlingOverride =
    ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

APickup* P = GetWorld()->SpawnActor<APickup>(PickupClass, Location, Rotation, Params);

// Deferred spawn: set properties/expose-on-spawn values before BeginPlay runs
AThing* T = GetWorld()->SpawnActorDeferred<AThing>(ThingClass, Transform);
T->Damage = 50.f;
T->FinishSpawning(Transform);   // runs construction → PostInitializeComponents → BeginPlay
```

- `PickupClass` is typically a `UPROPERTY(EditAnywhere) TSubclassOf<APickup>` so designers pick the
  Blueprint subclass. Spawning the C++ class directly skips Blueprint-authored defaults/components.
- Use **deferred spawn** when the actor needs values set *before* `BeginPlay` (e.g. a projectile's
  damage/owner). Plain `SpawnActor` runs the constructor and `BeginPlay` immediately.
- `GetWorld()` can be null on the CDO/in the constructor — only spawn from gameplay code.

Full spawn-parameter fields, collision-handling values, and destroy/pooling guidance:
[references/spawning-and-destroying.md](references/spawning-and-destroying.md).

## Adding components at runtime

```cpp
UStaticMeshComponent* Extra = NewObject<UStaticMeshComponent>(this);
Extra->SetupAttachment(GetRootComponent());  // or AttachToComponent if already registered
Extra->RegisterComponent();                  // REQUIRED so it ticks/renders/collides
```

Runtime components **must** be `RegisterComponent()`-ed — registration is what associates a
component with the world/scene so it can update, render, and collide. Default subobjects created in
the constructor are registered for you during the actor's spawn. Registering many components during
play has a cost; prefer creating them as default subobjects when you can.

## Attachment

```cpp
// Runtime attach/detach (scene components only):
Mesh->AttachToComponent(Target, FAttachmentTransformRules::SnapToTargetIncludingScale, SocketName);
Mesh->DetachFromComponent(FDetachmentTransformRules::KeepWorldTransform);

// Whole-actor attach (attaches this actor's root to another actor/component):
AttachToActor(OtherActor, FAttachmentTransformRules::KeepRelativeTransform);
```

- `SetupAttachment` is for the constructor / not-yet-registered components; `AttachToComponent`
  attaches immediately and is for play. Using `SetupAttachment` at runtime does nothing without
  registration.
- Attachment rules choose, per channel, whether to keep the world transform or snap to the
  parent/socket. A component can have many children but only one parent; cycles are not allowed.

Attachment rules, sockets, mobility, and relative-vs-world transforms:
[references/attachment-and-transforms.md](references/attachment-and-transforms.md).

## Ticking

- Actors: set `PrimaryActorTick.bCanEverTick = true;` in the constructor, then override `Tick`.
- Components: set `PrimaryComponentTick.bCanEverTick = true;` then override `TickComponent`.
- Both default to **off**. `bCanEverTick` only makes ticking *possible*; you can toggle it at
  runtime with `PrimaryActorTick.SetTickFunctionEnable(true/false)`.
- Prefer events/timers (`timers-and-async`) over ticking when you can — ticking everything is a
  common performance sink. Leave `bCanEverTick = false` for actors that don't need per-frame work.

## Finding components

```cpp
UStaticMeshComponent* M = GetComponentByClass<UStaticMeshComponent>();   // first of class
TArray<USceneComponent*> All;
GetComponents<USceneComponent>(All);                                     // all of class
```

## Gotchas

- **Gameplay logic in the constructor** — runs on the CDO/editor with no world; use `BeginPlay`.
- **Overlap/hit handler not a `UFUNCTION()`** — `AddDynamic` silently fails to fire; the bound
  function must be a `UFUNCTION()` with the *exact* delegate signature.
- **Forgot `RegisterComponent()`** on a runtime component → it won't render/collide/tick.
- **Attaching a non-scene component** — only `USceneComponent`+ can attach or have a transform.
- **`SetupAttachment` at runtime** does nothing without registration; use `AttachToComponent`.
- **No overlaps firing** — the primitive needs collision enabled and `SetGenerateOverlapEvents(true)`
  on both components, with overlapping collision responses.
- **No cleanup in `EndPlay`** — timers/delegates referencing this actor can dangle; clear them.
  `EndPlay` runs for *all* exit reasons, so it's the right place (not `Destroyed`).
- **Static mobility moved at runtime** — only `Movable` components can be transformed during play;
  setting transform on a `Static` component is ignored/asserts.
- **Spawning into a blocked location** can fail and return null; set a collision-handling override.

## Version notes

- `TObjectPtr<T>` is the current idiom for object UPROPERTYs (UE5+); older code uses raw `T*`,
  which still works. See `memory-and-gc`.
- The lifecycle callbacks and component model here are stable across UE5; line numbers in citations
  drift between patch releases, but the header paths and class/function names are stable.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/`):
- `Engine/Classes/GameFramework/Actor.h` — `AActor` lifecycle, `RootComponent`:995,
  `PrimaryActorTick`:285, `SetRootComponent`:2486, `AttachToActor`:2032, `FinishSpawning`:3116,
  `GetComponentByClass`:3791.
- `Engine/Classes/Components/ActorComponent.h` — `UActorComponent`, `RegisterComponent`:1305,
  `OnRegister`:816, `InitializeComponent`:905, `BeginPlay`:922, `TickComponent`:962,
  `PrimaryComponentTick`:168, `bWantsInitializeComponent`:331.
- `Engine/Classes/Components/SceneComponent.h` — transforms, `SetupAttachment`:729,
  `AttachToComponent`:747, `DetachFromComponent`:781, `Mobility`:298.
- `Engine/Classes/Components/PrimitiveComponent.h` — rendering/collision, `OnComponentBeginOverlap`:1409,
  `SetGenerateOverlapEvents`:373, `SetCollisionEnabled`:1943.
- `Engine/Classes/Engine/World.h` — `SpawnActor`/`SpawnActorDeferred`:3735, `FActorSpawnParameters`:418.
- `Engine/Classes/Engine/EngineTypes.h` — `FAttachmentTransformRules`:74, `EEndPlayReason`:3428,
  `ESpawnActorCollisionHandlingMethod`:4169.
- `CoreUObject/Public/UObject/Object.h` — `CreateDefaultSubobject`:147.

Official docs (UE 5.7):
- Actor Lifecycle — <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-actor-lifecycle>
- Components — <https://dev.epicgames.com/documentation/unreal-engine/components-in-unreal-engine>
- Actors — <https://dev.epicgames.com/documentation/unreal-engine/actors-in-unreal-engine>
- Spawning and Destroying an Actor —
  <https://dev.epicgames.com/documentation/unreal-engine/spawning-and-destroying-unreal-engine-actors>
- Actor Ticking — <https://dev.epicgames.com/documentation/unreal-engine/actor-ticking-in-unreal-engine>

Deep-dive references in this skill:
- [references/actor-lifecycle.md](references/actor-lifecycle.md) — full creation paths, component
  init sub-sequence, end-of-life and garbage collection.
- [references/components-and-registration.md](references/components-and-registration.md) — type
  hierarchy, registration/render/physics state, `InitializeComponent` vs `BeginPlay`, ticking.
- [references/attachment-and-transforms.md](references/attachment-and-transforms.md) — attachment
  APIs, transform rules, sockets, mobility.
- [references/spawning-and-destroying.md](references/spawning-and-destroying.md) — spawn variants,
  spawn parameters, deferred spawn, destruction, pooling.
