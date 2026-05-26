---
name: physics-and-chaos
description: Implement collision, physics simulation, and world queries using Unreal's Chaos
  physics engine in C++ — collision channels (ECollisionChannel), response types
  (ECollisionResponse / ECR_Block/Overlap/Ignore), collision presets and profiles, query vs
  physics collision (ECollisionEnabled), FBodyInstance damping/mass, SetSimulatePhysics,
  AddForce/AddImpulse, line traces and shape sweeps (LineTraceSingleByChannel,
  SweepSingleByChannel, OverlapMultiByChannel), FHitResult/FCollisionQueryParams, hit and
  overlap events (OnComponentHit, OnComponentBeginOverlap), physical materials
  (UPhysicalMaterial friction/restitution), ragdoll via UPhysicsAsset, and physics
  constraints (FConstraintInstance, UPhysicsConstraintComponent). Use when setting up
  what collides with what, creating trigger volumes, doing line/shape traces for aiming or
  interaction, simulating rigid-body objects, applying forces or impulses, building
  ragdolls, constraining bodies, or debugging missing hit/overlap events.
metadata:
  engine-version: "5.7"
  category: systems
---

# Physics & collision (Chaos)

Chaos is the physics engine in UE. Most gameplay needs three things from it: **collision**
(what blocks/overlaps what), **queries** (traces/sweeps to ask about the world), and
occasionally **simulation** (rigid bodies, ragdolls, constraints). Collision setup mistakes
are the most common source of "my overlap/hit never fires" bugs.

## When to use this skill

- Setting up what collides with what (channels, presets, per-channel responses).
- Making trigger volumes or detecting overlaps between actors.
- Line/shape tracing the world (aiming, ground checks, interaction detection).
- Simulating physics objects — enabling rigid-body physics, applying forces/impulses.
- Building ragdolls or constraining bodies with `UPhysicsConstraintComponent`.
- Debugging "overlap never fires", "trace misses", or "physics not simulating" problems.

## Collision model — three controls per component

Every `UPrimitiveComponent` has three collision controls:

1. **Object type** (`ECollisionChannel`) — what this component *is*. Built-in: `ECC_WorldStatic`,
   `ECC_WorldDynamic`, `ECC_Pawn`, `ECC_PhysicsBody`, `ECC_Visibility`, `ECC_Camera`.
   Custom channels map to `ECC_GameTraceChannel1`–`ECC_GameTraceChannel18` at runtime.

2. **Response per channel** (`ECollisionResponse`) — how it reacts to each channel:
   `ECR_Ignore`, `ECR_Overlap`, `ECR_Block`.

3. **Collision enabled** mode (`ECollisionEnabled::Type`) — what the shape participates in:
   - `NoCollision` — no physics, no queries.
   - `QueryOnly` — overlaps/traces; no rigid-body simulation. Best for trigger volumes.
   - `PhysicsOnly` — rigid-body sim only; traces don't hit it.
   - `QueryAndPhysics` — both. Default for most simulated objects.

**Block** requires *both* sides to set `ECR_Block` for the other's object type. For **overlap**
events, both sides need `ECR_Overlap` response *and* `bGenerateOverlapEvents = true`.

```cpp
// Set up a trigger sphere: query-only, ignore everything except pawns.
Trigger->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
Trigger->SetCollisionObjectType(ECC_WorldDynamic);
Trigger->SetCollisionResponseToAllChannels(ECR_Ignore);
Trigger->SetCollisionResponseToChannel(ECC_Pawn, ECR_Overlap);
Trigger->SetGenerateOverlapEvents(true);
```

**Collision presets** bundle object type + responses into a named profile. Apply with
`SetCollisionProfileName(TEXT("Trigger"))` to match a project preset or one defined in
Project Settings → Collision. Applying a preset overwrites per-channel overrides, so call
any fine-grained `SetCollisionResponseToChannel` calls *after* the preset.

See [references/collision-channels-and-profiles.md](references/collision-channels-and-profiles.md)
for the full channel list, custom-channel setup, and preset internals.

## Hit & overlap events

Bind in `BeginPlay` (not the constructor — no world available there):

```cpp
void AMyActor::BeginPlay()
{
    Super::BeginPlay();
    // Overlap: trigger volume notifying actor entry
    Trigger->OnComponentBeginOverlap.AddDynamic(this, &AMyActor::OnBeginOverlap);
    // Hit: physics body reporting impact
    Mesh->OnComponentHit.AddDynamic(this, &AMyActor::OnHit);
}

// Exact delegate signatures required — see PrimitiveComponent.h:229,231
UFUNCTION()
void AMyActor::OnBeginOverlap(UPrimitiveComponent* Comp, AActor* Other,
    UPrimitiveComponent* OtherComp, int32 OtherBodyIndex,
    bool bFromSweep, const FHitResult& Sweep) { /* ... */ }

UFUNCTION()
void AMyActor::OnHit(UPrimitiveComponent* HitComp, AActor* Other,
    UPrimitiveComponent* OtherComp, FVector NormalImpulse, const FHitResult& Hit) { /* ... */ }
```

Handlers must be `UFUNCTION()` — dynamic delegates require UObject reflection. For hit events
on simulating bodies, also enable *Simulation Generates Hit Events* on the body
(`FBodyInstance::bNotifyRigidBodyCollision`). See `actors-and-components` for delegate binding
patterns and `delegates-and-events` for the delegate system.

## Traces & sweeps

```cpp
// Line trace — first blocking hit on ECC_Visibility
FHitResult Hit;
FCollisionQueryParams Params(SCENE_QUERY_STAT(MyTrace), /*bTraceComplex=*/false);
Params.AddIgnoredActor(this);   // never hit self

if (GetWorld()->LineTraceSingleByChannel(Hit, GetActorLocation(),
        GetActorLocation() + GetActorForwardVector() * 2000.f, ECC_Visibility, Params))
{
    // Hit.GetActor(), Hit.ImpactPoint, Hit.ImpactNormal, Hit.PhysMaterial
}

// Sphere sweep — shape-based query
FHitResult SweepHit;
GetWorld()->SweepSingleByChannel(SweepHit, Start, End, FQuat::Identity,
    ECC_Pawn, FCollisionShape::MakeSphere(40.f), Params);

// Overlap query — all bodies overlapping a box at a point
TArray<FOverlapResult> Overlaps;
GetWorld()->OverlapMultiByChannel(Overlaps, Center, FQuat::Identity,
    ECC_WorldDynamic, FCollisionShape::MakeBox(FVector(50.f)), Params);
```

`FHitResult` fields to know: `Time` (0–1 along trace), `Distance`, `Location` (shape center
at contact), `ImpactPoint` (surface contact), `ImpactNormal`, `GetActor()`, `GetComponent()`,
`BoneName`, `PhysMaterial`.

Multi-variants (`LineTraceMultiByChannel`, `SweepMultiByChannel`) return all overlaps up to
and including the first block — useful for bullets through foliage.

See [references/traces-and-queries.md](references/traces-and-queries.md) for ByObjectType,
async traces, UV coordinates from hits, and debug-draw helpers.

## Simulating rigid bodies

```cpp
// Enable physics simulation — requires simple collision on the mesh asset.
Mesh->SetSimulatePhysics(true);
Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
Mesh->SetCollisionProfileName(TEXT("PhysicsActor"));

// Mass: override per component or let BodyInstance compute from density/volume.
Mesh->SetMassOverrideInKg(NAME_None, 80.f);

// Forces and impulses (world space by default):
Mesh->AddImpulse(FVector(0.f, 0.f, 600000.f));          // instantaneous kg*cm/s
Mesh->AddForce(FVector(0.f, 0.f, 98000.f));              // continuous N per physics step
Mesh->AddImpulseAtLocation(Impulse, HitPoint);           // torque from off-center
```

`AddForce` accumulates over each physics substep; `AddImpulse` applies once in the current
step. Damping is on the `FBodyInstance` (accessible via `GetBodyInstance()`):
`LinearDamping` and `AngularDamping` (both at `BodyInstance.h`).

Simulating bodies must have **simple collision** (sphere/box/capsule/convex hull). Complex
per-triangle collision cannot drive rigid-body simulation.

## Ragdolls and physics assets

A ragdoll runs through a `UPhysicsAsset` (authored in the Physics Asset Editor), which
defines per-bone bodies and constraints for a `USkeletalMeshComponent`:

```cpp
GetMesh()->SetSimulatePhysics(true);                    // whole-body ragdoll
GetMesh()->SetCollisionProfileName(TEXT("Ragdoll"));
// For blended / partial ragdoll, use UPhysicalAnimationComponent.
```

## Physics constraints

`UPhysicsConstraintComponent` wraps `FConstraintInstance` and joins two simulated bodies:

```cpp
// ConstraintComp is a UPROPERTY(VisibleAnywhere) TObjectPtr<UPhysicsConstraintComponent>
ConstraintComp->SetConstrainedComponents(CompA, NAME_None, CompB, NAME_None);
ConstraintComp->SetLinearXLimit(LCM_Free, 0.f);         // allow X-axis translation
ConstraintComp->SetAngularSwing1Limit(ACM_Limited, 45.f); // 45° swing limit
ConstraintComp->ConstraintInstance.OnConstraintBroken.BindUObject(this,
    &AMyActor::OnConstraintBroken);
```

`BreakConstraint()` on the component tears the joint at runtime. `FConstraintInstance` also
supports drives (motors): `SetLinearPositionDrive`, `SetAngularDriveMode`.

See [references/physics-simulation-and-constraints.md](references/physics-simulation-and-constraints.md)
for `FBodyInstance` details, damping, sub-stepping, and constraint drives.

## Physical materials

`UPhysicalMaterial` (under `Runtime/PhysicsCore`) stores surface properties referenced by
both `UStaticMesh` and `UPrimitiveComponent`. Key fields: `Friction`, `StaticFriction`,
`Restitution`, `Density`, `SurfaceType` (`EPhysicalSurface`). Assign via the mesh asset or
at runtime with `GetBodyInstance()->PhysMaterialOverride`.

Read `SurfaceType` from a hit to drive effects (footstep sounds, particle emitters):
`Hit.PhysMaterial.Get()->SurfaceType`.

## Collision complexity

| Mode | Uses | Sim? | Notes |
|---|---|---|---|
| Simple | primitives / convex hull | yes | Required for rigid-body sim; cheap queries |
| Complex | per-triangle | no | Precise static queries (landscape, detailed meshes) |

Set per-mesh in the Static/Skeletal Mesh asset collision settings, and optionally override
on the component. Use `FCollisionQueryParams::bTraceComplex = true` to query complex.

## Gotchas

- **Overlap never fires** — both components need `ECR_Overlap` response to each other's
  object type *and* `bGenerateOverlapEvents = true` on both. One side being `ECR_Block` still
  generates an overlap if the other is `ECR_Overlap`, but only one fires.
- **Hit event never fires** — enable `Simulation Generates Hit Events` (`bNotifyRigidBodyCollision`
  on `FBodyInstance`); physics sim must also be enabled.
- **Trace misses everything** — check `ECollisionEnabled` on targets; `NoCollision` or
  `PhysicsOnly` makes them invisible to traces.
- **Simulating on complex-collision mesh** — physics simulation requires simple collision;
  complex (per-triangle) collision cannot be simulated.
- **Forgot `AddIgnoredActor(this)`** — trace hits own actor's collision shapes.
- **Handler not `UFUNCTION()`** — `AddDynamic` silently fails; the method must be a
  `UFUNCTION()` with the exact delegate signature.
- **Applying a preset then per-channel overrides** — `SetCollisionProfileName` resets all
  responses; set per-channel responses after calling it.
- **Force vs. Impulse units** — `AddForce` is Newtons (applied each substep); `AddImpulse`
  is kg·cm/s (applied once). Scale accordingly.
- **`SetSimulatePhysics(true)` silently does nothing** — the mesh has no simple collision,
  or `SetCollisionEnabled` is `NoCollision`/`QueryOnly`.

## Version notes

Chaos replaced PhysX as the default physics engine in UE5. The Chaos solver runs
deterministic substeps controlled by `UPhysicsSettings::AsyncFixed` (Project Settings →
Physics → Simulation → Use Async Scene). `FBodyInstance` is stable across UE5; solver
internals differ from PhysX but the `UPrimitiveComponent` API is unchanged.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/Engine/Classes/Engine/EngineTypes.h` — `ECollisionChannel`:1087,
  `ECollisionResponse`:1239, `ECollisionEnabled`:1570, `FCollisionResponseContainer`:1346.
- `Runtime/Engine/Classes/Engine/HitResult.h` — `FHitResult`:20.
- `Runtime/Engine/Classes/Components/PrimitiveComponent.h` — `OnComponentHit`:229,
  `OnComponentBeginOverlap`:231, `SetGenerateOverlapEvents`:373, `SetSimulatePhysics`:1578,
  `AddImpulse`:1609, `AddForce`:1676, `SetCollisionEnabled`:1943,
  `SetCollisionProfileName`:1953, `SetCollisionObjectType`:1964,
  `SetCollisionResponseToAllChannels`:2860, `GetBodyInstance`:2248,
  `SetMassOverrideInKg`:2765.
- `Runtime/Engine/Classes/PhysicsEngine/BodyInstance.h` — `LinearDamping`:599,
  `AngularDamping`:603.
- `Runtime/Engine/Classes/PhysicsEngine/ConstraintInstance.h` — `FConstraintInstance`:254,
  `SetLinearLimits`:358, `InitConstraint`:920.
- `Runtime/Engine/Classes/PhysicsEngine/PhysicsConstraintComponent.h` —
  `UPhysicsConstraintComponent`:23, `BreakConstraint`:133, `SetLinearPositionDrive`:142,
  `SetAngularDriveMode`:204.
- `Runtime/Engine/Classes/Engine/World.h` — `LineTraceSingleByChannel`:2069,
  `LineTraceMultiByChannel`:2105, `SweepSingleByChannel`:2181, `SweepMultiByChannel`:2220,
  `OverlapMultiByChannel`:2313.
- `Runtime/Engine/Public/CollisionQueryParams.h` — `FCollisionQueryParams`:42,
  `AddIgnoredActor`:243, `bTraceComplex`:51.
- `Runtime/PhysicsCore/Public/PhysicalMaterials/PhysicalMaterial.h` —
  `UPhysicalMaterial`:103, `Friction`:115, `Restitution`:131, `Density`:147,
  `SurfaceType`:181.

Official docs (UE 5.7):
- Collision Overview —
  <https://dev.epicgames.com/documentation/unreal-engine/collision-in-unreal-engine---overview>
- Traces Overview —
  <https://dev.epicgames.com/documentation/unreal-engine/traces-in-unreal-engine---overview>
- Physics Bodies —
  <https://dev.epicgames.com/documentation/unreal-engine/physics-bodies-in-unreal-engine>
- Physics Constraints —
  <https://dev.epicgames.com/documentation/unreal-engine/physics-constraints-in-unreal-engine>
- Physical Materials —
  <https://dev.epicgames.com/documentation/unreal-engine/physical-materials-in-unreal-engine>

Deep-dive references in this skill:
- [references/collision-channels-and-profiles.md](references/collision-channels-and-profiles.md)
  — channel taxonomy, custom channels, preset internals, `FCollisionResponseContainer`.
- [references/traces-and-queries.md](references/traces-and-queries.md) — full trace/sweep/
  overlap API, ByObjectType vs ByChannel, async traces, debug helpers.
- [references/physics-simulation-and-constraints.md](references/physics-simulation-and-constraints.md)
  — `FBodyInstance` properties, sub-stepping, constraint drives, ragdoll setup.

Related skills: `actors-and-components` (component types, overlap wiring),
`meshes-static-and-skeletal` (collision geometry on assets).
