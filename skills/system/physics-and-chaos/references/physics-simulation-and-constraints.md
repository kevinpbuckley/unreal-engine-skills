# Physics simulation and constraints — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `FBodyInstance` properties, sub-stepping,
the Chaos solver, constraint drives, ragdoll setup, and physical materials. Grounded in
UE 5.7 (`Engine/Source/Runtime/Engine/Classes/PhysicsEngine/BodyInstance.h`,
`ConstraintInstance.h`, `PhysicsConstraintComponent.h`) and the official
[Physics Bodies](https://dev.epicgames.com/documentation/unreal-engine/physics-bodies-in-unreal-engine)
and [Physics Constraints](https://dev.epicgames.com/documentation/unreal-engine/physics-constraints-in-unreal-engine)
docs.

## FBodyInstance — per-shape physics properties

`UPrimitiveComponent::GetBodyInstance()` returns the `FBodyInstance*` for the component's
root body (or a named bone on a skeletal mesh). Common fields to adjust:

| Field | Default | Purpose |
|---|---|---|
| `LinearDamping` (`:599`) | 0.01 | Drag on linear velocity each step |
| `AngularDamping` (`:603`) | 0.0 | Drag on angular velocity each step |
| `bSimulatePhysics` | false | Master toggle (set via `SetSimulatePhysics`) |
| `bStartAwake` | true | Wake the body when physics starts |
| `bNotifyRigidBodyCollision` | false | Fire `OnComponentHit` on physics impact |
| `bUseCCD` | false | Continuous collision detection (fast thin objects) |
| `PhysMaterialOverride` | null | Per-body physical material override |

```cpp
FBodyInstance* BI = Mesh->GetBodyInstance();
if (BI)
{
    BI->LinearDamping  = 2.f;
    BI->AngularDamping = 5.f;
    BI->bNotifyRigidBodyCollision = true;
    // UpdatePhysicsFilterData() propagates the change to Chaos immediately:
    BI->UpdatePhysicsFilterData();
}
```

Call `UpdatePhysicsFilterData()` after mutating `FBodyInstance` fields at runtime to push
changes into the physics solver.

## Mass computation

Mass is computed from shape volume × `UPhysicalMaterial::Density` by default. Override with:

```cpp
Mesh->SetMassOverrideInKg(NAME_None, 50.f);   // NAME_None = root body
```

Set `bOverrideMass = false` in the last parameter to revert to density-based calculation.
For skeletal meshes, pass the bone name to target a specific body:

```cpp
Mesh->SetMassOverrideInKg(TEXT("spine_01"), 10.f);
```

## Forces and impulses

| Method (on `UPrimitiveComponent`) | Unit | Applied |
|---|---|---|
| `AddForce(FVector, BoneName, bAccelChange)` | N or cm/s² | Accumulated each substep |
| `AddForceAtLocation(FVector, FVector, BoneName)` | N | At world point, generates torque |
| `AddImpulse(FVector, BoneName, bVelChange)` | kg·cm/s or cm/s | Once this step |
| `AddImpulseAtLocation(FVector, FVector, BoneName)` | kg·cm/s | At world point |
| `AddTorqueInRadians(FVector, BoneName, bAccelChange)` | N·m or rad/s² | Per substep |
| `AddAngularImpulseInRadians(FVector, BoneName, bVelChange)` | kg·m²/s | Once |

Set `bAccelChange = true` / `bVelChange = true` to pass acceleration/velocity instead of
force/impulse — engine divides by mass internally, so the motion is mass-independent.

## Chaos solver and sub-stepping

Chaos runs as a discrete solver with a fixed-size substep. Configure in Project Settings →
Physics → Simulation:

- **Use Async Scene** — runs physics on a separate thread; reduces hitching but adds one
  frame of latency to physics results.
- **Max Physics Delta Time** — clamp the delta given to physics to avoid explosion during
  hitching (default 0.1 s).
- **Substepping** — subdivides large deltas into smaller steps for stability. Enable
  `bSubstepping`, set `MaxSubstepDeltaTime` and `MaxSubsteps`.

Sub-stepping is important for stiff constraints and high-speed objects. `AddForce` is applied
each substep; `AddImpulse` is applied once per game frame regardless of substep count.

For per-substep game code, override `UActorComponent::AsyncPhysicsTickComponent` (UE5+) —
it runs on the physics thread each substep and is safe to call physics APIs from.

## UPhysicsConstraintComponent

The component wrapper around `FConstraintInstance`. Place it in the scene and wire two
simulated components to join them:

```cpp
// In the constructor:
ConstraintComp = CreateDefaultSubobject<UPhysicsConstraintComponent>(TEXT("Constraint"));
ConstraintComp->SetupAttachment(RootComponent);

// In BeginPlay (after both bodies exist):
ConstraintComp->SetConstrainedComponents(CompA, NAME_None, CompB, NAME_None);
```

### Linear limits

```cpp
// Lock XY, free Z (like a pole sliding up and down):
ConstraintComp->SetLinearXLimit(LCM_Locked, 0.f);
ConstraintComp->SetLinearYLimit(LCM_Locked, 0.f);
ConstraintComp->SetLinearZLimit(LCM_Free, 0.f);
```

`ELinearConstraintMotion`: `LCM_Free`, `LCM_Limited`, `LCM_Locked`.

### Angular limits

```cpp
// Hinge: allow twist around X only, limit Y and Z swing
ConstraintComp->SetAngularTwistLimit(ACM_Free, 0.f);
ConstraintComp->SetAngularSwing1Limit(ACM_Locked, 0.f);  // Z-swing
ConstraintComp->SetAngularSwing2Limit(ACM_Locked, 0.f);  // Y-swing
```

`EAngularConstraintMotion`: `ACM_Free`, `ACM_Limited`, `ACM_Locked`.

### Constraint drives (motors)

```cpp
// Position drive: spring the body toward a target position
ConstraintComp->SetLinearPositionDrive(true, true, false);  // drive X and Y
ConstraintComp->SetLinearPositionTarget(FVector(100.f, 0.f, 0.f));
ConstraintComp->SetLinearDriveParams(/*Stiffness=*/500.f, /*Damping=*/50.f, /*MaxForce=*/0.f);

// Velocity drive: spin a joint like a motor
ConstraintComp->SetAngularDriveMode(EAngularDriveMode::TwistAndSwing);
ConstraintComp->SetAngularVelocityDriveTwistAndSwing(true, false);
ConstraintComp->SetAngularVelocityTarget(FVector(0.f, 0.f, 5.f));
ConstraintComp->SetAngularDriveParams(200.f, 20.f, 0.f);
```

### Breaking and callbacks

```cpp
ConstraintComp->ConstraintInstance.OnConstraintBroken.BindUObject(
    this, &AMyActor::HandleConstraintBroken);

// Set break thresholds (0 = unbreakable):
ConstraintComp->ConstraintInstance.ProfileInstance.bLinearBreakable = true;
ConstraintComp->ConstraintInstance.ProfileInstance.LinearBreakThreshold = 10000.f; // N

// Tear the joint programmatically:
ConstraintComp->BreakConstraint();
```

`OnConstraintBroken` is a single-cast delegate declared in `EngineTypes.h`:1136.

## Ragdoll setup

A ragdoll animates via a `UPhysicsAsset` (bodies + constraints authored in Physics Asset
Editor). Enable on a `USkeletalMeshComponent`:

```cpp
// Full ragdoll — all bones simulated:
GetMesh()->SetSimulatePhysics(true);
GetMesh()->SetCollisionProfileName(TEXT("Ragdoll"));

// Blend ragdoll with animation (partial):
// Use UPhysicalAnimationComponent — set up strength profiles per bone region.
UPhysicalAnimationComponent* PhysAnim = FindComponentByClass<UPhysicalAnimationComponent>();
PhysAnim->SetSkeletalMeshComponent(GetMesh());
PhysAnim->ApplyPhysicalAnimationProfileBelow(TEXT("pelvis"), TEXT("MyProfile"), true);
GetMesh()->SetAllBodiesBelowSimulatePhysics(TEXT("pelvis"), true);
```

For partial ragdolls, `SetAllBodiesBelowSimulatePhysics` simulates bones from the named
bone down the hierarchy while the rest blend with animation.

## Physical materials and surface types

```cpp
// Assign a physical material to a component body at runtime:
if (FBodyInstance* BI = Mesh->GetBodyInstance())
{
    BI->PhysMaterialOverride = MyPhysMat;
    BI->UpdatePhysicsFilterData();
}

// Read surface type after a trace hit:
if (Hit.PhysMaterial.IsValid())
{
    EPhysicalSurface Surface = Hit.PhysMaterial.Get()->SurfaceType;
    // Switch on Surface to play footstep SFX, spawn particles, etc.
}
```

Surface types are defined in Project Settings → Physics → Physical Surface. They are stable
integers (not names) — safe to switch-case on in performance-sensitive code.
