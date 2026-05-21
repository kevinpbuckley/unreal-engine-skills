---
name: actors-and-components
description: Build and compose gameplay objects from Actors and Components in Unreal C++ — the
  AActor lifecycle (constructor, PostInitializeComponents, BeginPlay, Tick, EndPlay, Destroyed),
  the component types (UActorComponent, USceneComponent, UPrimitiveComponent), the root component
  and attachment, and spawning actors/creating components at construction or runtime. Use when
  creating an actor or component, setting up a component hierarchy, attaching components, spawning
  actors, or debugging lifecycle/ticking/attachment issues.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Actors & components

An **Actor** is anything you can place or spawn in a level. **Components** are the reusable
pieces of behavior/representation you compose onto actors. "Composition over inheritance" is the
intended design: prefer adding components over deep actor class hierarchies.

## When to use this skill

- Creating a new `AActor` or `UActorComponent` subclass.
- Setting up a component hierarchy (root + attached scene components).
- Spawning actors or adding components at runtime.
- Debugging "BeginPlay didn't run", "component has no transform", or attachment problems.

## Component types

| Type | Has transform? | Renders/collides? | Use for |
|---|---|---|---|
| `UActorComponent` | no | no | pure behavior/data (health, inventory, AI logic) |
| `USceneComponent` | **yes** (location/rotation/scale) | no | transform nodes, attach points, springs |
| `UPrimitiveComponent` | yes | **yes** | meshes, collision, anything drawn/physical |

Concrete primitives: `UStaticMeshComponent`, `USkeletalMeshComponent`, `UCapsuleComponent`,
`UBoxComponent`, `USphereComponent`, `UCameraComponent`, `USpringArmComponent`.

Only `USceneComponent`-derived components can be attached into a transform hierarchy or be the
**root component**.

## AActor lifecycle (order matters)

1. **Constructor** — set defaults, `CreateDefaultSubobject` for owned components. No world/gameplay yet.
2. `OnConstruction` (placed/CDS) — construction script logic.
3. `PostInitializeComponents` — components exist & registered; safe to wire them together.
4. **`BeginPlay`** — gameplay starts; do gameplay init here, not in the constructor.
5. `Tick(DeltaSeconds)` — per-frame (only if enabled; see below).
6. **`EndPlay(Reason)`** — leaving play (destroyed, level change, PIE end); clean up here.
7. `Destroyed` / `BeginDestroy` — destruction/GC.

Verified in 5.7 (`GameFramework/Actor.h`): `BeginPlay()`:2128, `EndPlay()`:2135,
`Tick(float)`:3059, `PostInitializeComponents()`:3126.

**Constructor vs BeginPlay:** the constructor also runs on the Class Default Object and in the
editor. Never do gameplay logic (spawning, world queries, timers) there — use `BeginPlay`.

## Authoring an actor with components

```cpp
// Pickup.h
UCLASS()
class MYGAME_API APickup : public AActor
{
    GENERATED_BODY()
public:
    APickup();
protected:
    virtual void BeginPlay() override;

    UPROPERTY(VisibleAnywhere) TObjectPtr<USphereComponent> Trigger;       // root, collision
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Mesh;      // visual
};

// Pickup.cpp
#include "Pickup.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"

APickup::APickup()
{
    PrimaryActorTick.bCanEverTick = false;

    Trigger = CreateDefaultSubobject<USphereComponent>(TEXT("Trigger"));
    SetRootComponent(Trigger);

    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    Mesh->SetupAttachment(Trigger);    // attach in constructor with SetupAttachment
}

void APickup::BeginPlay()
{
    Super::BeginPlay();
    Trigger->OnComponentBeginOverlap.AddDynamic(this, &APickup::OnOverlap);
}
```

Key rules:
- `CreateDefaultSubobject<T>(TEXT("UniqueName"))` is **constructor-only**; names must be unique.
- Set the root with `SetRootComponent` (or assign `RootComponent`).
- In the constructor, attach with `SetupAttachment(Parent)`. At runtime, use `AttachToComponent`.

## Spawning actors at runtime

```cpp
FActorSpawnParameters Params;
Params.Owner = this;
Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
APickup* P = GetWorld()->SpawnActor<APickup>(PickupClass, Location, Rotation, Params);

// Deferred spawn: set properties before BeginPlay runs
AThing* T = GetWorld()->SpawnActorDeferred<AThing>(ThingClass, Transform);
T->Damage = 50.f;
T->FinishSpawning(Transform);
```

`PickupClass` is typically a `UPROPERTY(EditAnywhere) TSubclassOf<APickup>` so designers pick the
Blueprint subclass.

## Adding components at runtime

```cpp
UStaticMeshComponent* Extra = NewObject<UStaticMeshComponent>(this);
Extra->SetupAttachment(GetRootComponent());   // or AttachToComponent for already-registered
Extra->RegisterComponent();                    // REQUIRED so it ticks/renders
```
Runtime components must be `RegisterComponent()`-ed; default subobjects are registered for you.

## Attachment at runtime

```cpp
Mesh->AttachToComponent(Target, FAttachmentTransformRules::SnapToTargetIncludingScale, SocketName);
Mesh->DetachFromComponent(FDetachmentTransformRules::KeepWorldTransform);
```
Attachment rules choose whether to keep world transform or snap to the parent/socket.

## Ticking

- Actors: `PrimaryActorTick.bCanEverTick = true;` in the constructor, then override `Tick`.
- Components: `PrimaryComponentTick.bCanEverTick = true;` then override `TickComponent`.
- Default to **off**. Prefer events/timers (`timers-and-async`) over ticking when you can —
  ticking everything is a common performance sink.

## Gotchas

- **Gameplay logic in the constructor** — runs on the CDO/editor, no world; use `BeginPlay`.
- **Forgot `RegisterComponent()`** on a runtime component → it won't render/collide/tick.
- **Attaching a non-scene component** — only `USceneComponent`+ can attach/have a transform.
- **`SetupAttachment` at runtime** does nothing without registration; use `AttachToComponent`.
- **No cleanup in `EndPlay`** — timers/delegates referencing this actor can dangle; clear them.
- **Spawning with collision** at an occupied spot can fail; set a collision-handling override.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/GameFramework/Actor.h` — `AActor` lifecycle, spawning, `RootComponent`.
- `Runtime/Engine/Classes/Components/ActorComponent.h` — `UActorComponent`, registration, ticking.
- `Runtime/Engine/Classes/Components/SceneComponent.h` — transforms, `SetupAttachment`/`AttachToComponent`.
- `Runtime/Engine/Classes/Components/PrimitiveComponent.h` — rendering/collision/overlaps.

Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>
