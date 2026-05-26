# Movement modes & custom movement — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `EMovementMode` state
machine, physics sub-routines, implementing a custom mode, gravity direction,
and plane constraints. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/GameFramework/CharacterMovementComponent.h`).

## The EMovementMode state machine

`UCharacterMovementComponent` tracks current behavior in
`MovementMode` (`CMC.h:229`, `TEnumAsByte<EMovementMode>`), plus
`CustomMovementMode` (`CMC.h:237`, `uint8`) when the mode is `MOVE_Custom`.

```
MOVE_None        → used only briefly during initialization / destruction
MOVE_Walking     → grounded, floors detected by sweep
MOVE_NavWalking  → AI path-following variant; snaps to nav mesh
MOVE_Falling     → airborne; gravity applies; AirControl governs lateral input
MOVE_Swimming    → inside a water volume (UPhysicsVolume::bWaterVolume)
MOVE_Flying      → freeform 3D; no gravity unless you set GravityScale > 0
MOVE_Custom      → your sub-routines, dispatched by CustomMovementMode byte
```

Transitions happen via `SetMovementMode(NewMode, NewCustomMode)` (`CMC.h:1257`).
After the internal state changes, `UCharacterMovementComponent::OnMovementModeChanged`
(`CMC.h:1279`) fires, which calls `ACharacter::OnMovementModeChanged`
(`Character.h:924`), which broadcasts `MovementModeChangedDelegate` so Blueprints
can react.

Default starting mode is controlled by `DefaultLandMovementMode` (`CMC.h:894`)
and `DefaultWaterMovementMode` (`CMC.h:902`).

## Physics sub-routines

Each mode delegates per-tick work to a virtual function:

| Mode | Function | What it does |
|------|----------|--------------|
| `MOVE_Walking` | `PhysWalking(float, int32)` `CMC.h:1956` | Floor sweeps, step-up logic, slope walkability |
| `MOVE_Falling` | `PhysFalling(float, int32)` `CMC.h:1627` | Gravity integration, `AirControl`, landing detection |
| `MOVE_Flying` | `PhysFlying(float, int32)` `CMC.h:1962` | Friction-only velocity damping, no gravity |
| `MOVE_Swimming` | `PhysSwimming(float, int32)` `CMC.h:1965` | Buoyancy, water friction, surface detection |
| `MOVE_Custom` | `PhysCustom(float, int32)` `CMC.h:1968` | **Override this in your subclass** |

The top-level dispatcher (`MoveAlongFloor`/`PerformMovement`) calls the correct
physX function based on the current mode. Sub-iterations (`int32 Iterations`)
allow the engine to sub-step large delta times without tunneling.

## Implementing a custom movement mode

### Step 1 — Subclass CMC

```cpp
// MyMovementComponent.h
UCLASS()
class UMyMovementComponent : public UCharacterMovementComponent
{
    GENERATED_BODY()
protected:
    virtual void PhysCustom(float DeltaTime, int32 Iterations) override;
    virtual void OnMovementModeChanged(EMovementMode PreviousMode,
                                       uint8 PreviousCustomMode) override;
};
```

### Step 2 — Inject via ObjectInitializer

```cpp
// MyCharacter.cpp
AMyCharacter::AMyCharacter(const FObjectInitializer& OI)
    : Super(OI.SetDefaultSubobjectClass<UMyMovementComponent>(
          ACharacter::CharacterMovementComponentName))
{}
```

### Step 3 — Implement PhysCustom

```cpp
// MyMovementComponent.cpp
void UMyMovementComponent::PhysCustom(float DeltaTime, int32 Iterations)
{
    if (DeltaTime < MIN_TICK_TIME) return;

    switch (CustomMovementMode)
    {
    case 1:  // e.g. wall-running
        // 1. Compute desired velocity from input projected onto wall normal.
        // 2. Call MoveUpdatedComponent() to move + detect hits.
        // 3. On hit, decide to stay on wall or fall off.
        break;
    default:
        Super::PhysCustom(DeltaTime, Iterations);
        break;
    }
}
```

Key helper calls inside `PhysCustom`:
- `MoveUpdatedComponent(Delta, NewRotation, bSweep, &Hit)` — the canonical way
  to move the component and receive hit info.
- `SlideAlongSurface(...)` — decompose velocity along a blocking surface.
- `SetMovementMode(MOVE_Falling)` — exit when conditions are no longer met.

### Step 4 — Activate it

```cpp
GetCharacterMovement()->SetMovementMode(MOVE_Custom, /*CustomMode=*/1);
```

## Gravity direction (UE 5.x)

UE 5.x added configurable gravity direction, letting characters walk on walls
or ceilings. The direction is stored in `GravityDirection` (`CMC.h:199`,
`VisibleAnywhere BlueprintReadOnly`) and replicated via
`ReplicatedGravityDirection` (`Character.h:474`) for simulated proxies.

```cpp
// Set in your character or game mode — world +Y as "down":
GetCharacterMovement()->SetGravityDirection(FVector(0.f, 1.f, 0.f));
```

When `ShouldRemainVertical()` is true (the default for most modes), CMC also
aligns the capsule to the gravity direction. For walking modes, input axes are
re-mapped into the gravity-relative plane.

## Plane constraints (2D-style games)

`UMovementComponent` (the base class) provides:
- `bConstrainToPlane` (`MovementComponent.h:155`) — enable constraint.
- `SetPlaneConstraintNormal(FVector)` (`MovementComponent.h:416`) — set the
  normal of the blocking plane (e.g. `FVector::RightVector` for a side-scroller).
- `SetPlaneConstraintAxisSetting(EPlaneConstraintAxisSetting)` — helper for
  common axis alignments.
- `SetPlaneConstraintEnabled(bool)` (`MovementComponent.h:428`) — toggle at runtime.

```cpp
// Lock motion to the X-Z plane (side-scroller):
GetCharacterMovement()->bConstrainToPlane = true;
GetCharacterMovement()->SetPlaneConstraintAxisSetting(
    EPlaneConstraintAxisSetting::Y);
```

## Walking sub-details

- **Step height** — `MaxStepHeight` (`CMC.h:159`) is the maximum upward step the
  character can climb without launching. Default 45 cm.
- **Walkable floor angle** — `WalkableFloorAngle` (`CMC.h:183`, private, set via
  `SetWalkableFloorAngle`) controls the maximum slope angle.
- **Ground friction vs. braking** — when input is present, `GroundFriction`
  (`CMC.h:254`) damps lateral sliding. When no input, `BrakingDecelerationWalking`
  (and `bUseSeparateBrakingFriction`) controls stopping rate.
- **NavWalking** — `MOVE_NavWalking` projects the character down to the nav mesh
  each tick; useful for NPCs that must stay on the nav surface but can cause
  visible sliding on uneven terrain.

## Falling sub-details

- `AirControl` (`CMC.h:359`) — fraction of `MaxAcceleration` applied while
  airborne, 0 = no control, 1 = full.
- `AirControlBoostMultiplier`/`AirControlBoostVelocityThreshold` (`CMC.h:366,373`)
  — bonus air control when lateral speed is low (helps prevent sticking to walls).
- `bNotifyApex` (`CMC.h` internal flag, Character.h exposes `OnReachedJumpApex`
  delegate `Character.h:810`) — fire an event at jump apex; you must set
  `bNotifyApex = true` on the CMC when entering `MOVE_Falling`.

## Version notes

- `EMovementMode` and the five built-in physics sub-routines are stable across
  UE 5.x. `GravityDirection` was introduced mid-UE5 and may behave differently
  on UE 5.0–5.2 targets.
- `MOVE_NavWalking` was added as an AI-focused alternative to `MOVE_Walking`
  for better nav-mesh conformance; it is not exposed through Blueprint in the
  same way.
- Line numbers drift between patch releases; use the function/property names
  to locate them in the current header.
