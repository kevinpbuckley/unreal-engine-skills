---
name: physics-and-chaos
description: Use Unreal's Chaos physics and collision — collision channels/presets and responses
  (block/overlap/ignore), simulating rigid bodies (SetSimulatePhysics, forces/impulses), hit and
  overlap events, traces and sweeps (LineTrace/Sweep by channel), simple vs complex collision, and
  ragdoll via physics assets. Use when setting up collision, detecting hits/overlaps, doing line/
  shape traces, simulating physics objects, or configuring ragdoll.
metadata:
  engine-version: "5.7"
  category: systems
---

# Physics & collision (Chaos)

Chaos is Unreal's physics engine. Most gameplay needs three things from it: **collision** (what
blocks/overlaps what), **queries** (traces/sweeps to ask about the world), and occasionally
**simulation** (rigid bodies, ragdolls). Collision setup mistakes are the most common source of
"my overlap/hit never fires" bugs.

## When to use this skill

- Setting up what collides with what (channels, presets, responses).
- Detecting hits or overlaps (triggers, projectiles).
- Line/shape tracing the world (aiming, ground checks, interaction).
- Simulating physics objects or ragdolling a character.

## Collision model

Collision is governed per-component by:
- **Object type** (an `ECollisionChannel`) — what this component *is* (WorldStatic, WorldDynamic,
  Pawn, PhysicsBody, or custom channels defined in Project Settings → Collision).
- **Responses** to each channel: **Ignore**, **Overlap**, or **Block**.
- **Collision presets** bundle object type + responses (e.g. `BlockAll`, `OverlapAllDynamic`,
  `Pawn`, `Trigger`, custom).
- **Collision enabled**: `NoCollision`, `QueryOnly` (overlaps/traces, no physics), `PhysicsOnly`,
  `QueryAndPhysics`.

For **overlap** events both sides must have overlap enabled and `bGenerateOverlapEvents = true`.
For **hit** events on simulating bodies, enable `Simulation Generates Hit Events`.

```cpp
Trigger->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
Trigger->SetCollisionObjectType(ECC_WorldDynamic);
Trigger->SetCollisionResponseToAllChannels(ECR_Ignore);
Trigger->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
Trigger->SetGenerateOverlapEvents(true);
```

## Hit & overlap events

```cpp
// In constructor / BeginPlay:
Trigger->OnComponentBeginOverlap.AddDynamic(this, &AMyActor::OnBeginOverlap);
Mesh->OnComponentHit.AddDynamic(this, &AMyActor::OnHit);

UFUNCTION() void OnBeginOverlap(UPrimitiveComponent* Comp, AActor* Other,
    UPrimitiveComponent* OtherComp, int32 BodyIndex, bool bFromSweep, const FHitResult& Sweep);
UFUNCTION() void OnHit(UPrimitiveComponent* HitComp, AActor* Other,
    UPrimitiveComponent* OtherComp, FVector NormalImpulse, const FHitResult& Hit);
```
Handlers must be `UFUNCTION()` (they bind dynamic delegates — `unreal-delegates-and-events`).

## Traces & sweeps (asking the world)

```cpp
FHitResult Hit;
FVector Start = GetActorLocation();
FVector End   = Start + GetActorForwardVector() * 1000.f;
FCollisionQueryParams Params;
Params.AddIgnoredActor(this);

if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
{
    AActor* HitActor = Hit.GetActor();   // FHitResult: location, normal, actor, component, bone
}
// Shape sweep:
GetWorld()->SweepSingleByChannel(Hit, Start, End, FQuat::Identity, ECC_Pawn,
    FCollisionShape::MakeSphere(50.f), Params);
```
Variants: `*MultiByChannel` (all hits), `*ByObjectType` (by object types), `OverlapMultiByChannel`.
Use trace **channels** (e.g. a custom `Interactable` channel) to query only relevant geometry.

## Simulating rigid bodies

```cpp
Mesh->SetSimulatePhysics(true);          // requires simple collision + PhysicsBody-like setup
Mesh->SetMassOverrideInKg(NAME_None, 50.f);
Mesh->AddImpulse(FVector(0,0,50000.f));  // instantaneous
Mesh->AddForce(FVector(0,0,100000.f));   // continuous (per substep)
```
Simulated bodies need **simple collision** (boxes/spheres/convex), not per-triangle complex
collision (`meshes-static-and-skeletal`).

## Ragdoll & physics assets

A skeletal mesh ragdolls using its **`UPhysicsAsset`** (bodies + constraints):
```cpp
GetMesh()->SetSimulatePhysics(true);                    // whole-body ragdoll
GetMesh()->SetCollisionProfileName(TEXT("Ragdoll"));
// Physical animation / partial blends are also possible via the physics asset.
```

## Collision complexity

- **Simple** (primitives/convex) — for physics and most queries; cheap.
- **Complex** (per-triangle) — accurate static queries (e.g. precise traces) but no rigid-body sim.
Set via the mesh's collision complexity and component presets.

## Gotchas

- **Overlap never fires** — both components need overlap response + `bGenerateOverlapEvents`.
- **Hit never fires** — enable `Simulation Generates Hit Events` and physics on the body.
- **Tracing the wrong channel** → misses or hits unintended geometry; use a purpose channel.
- **Simulating physics on complex-collision meshes** → fails; use simple collision.
- **Forgot to ignore self** in a trace → you hit your own actor.
- **Handlers not `UFUNCTION()`** → dynamic binding fails to compile.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Engine/EngineTypes.h` — `ECollisionChannel`, `ECollisionEnabled`, responses, `FHitResult`.
- `Runtime/Engine/Classes/Components/PrimitiveComponent.h` — collision API, overlap/hit delegates.
- `Runtime/Engine/Classes/PhysicsEngine/BodyInstance.h`, `BodySetup.h`, `PhysicsAsset.h`.
- `Runtime/PhysicsCore/Public/PhysicsCore.h` — Chaos physics core.

Official docs (UE 5.7): Designing Visuals, Rendering, and Graphics / Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>

Related: `meshes-static-and-skeletal`, `actors-and-components`.
