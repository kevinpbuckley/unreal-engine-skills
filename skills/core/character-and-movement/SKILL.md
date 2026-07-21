---
name: character-and-movement
description: Implement player/AI characters in Unreal C++ with ACharacter and
  UCharacterMovementComponent — capsule/mesh setup, movement modes
  (walking/falling/flying/swimming/custom), rotation behaviors, jumping,
  crouching, root motion sources, client-predicted networked movement, and the
  experimental Mover plugin successor. Use when creating or configuring a
  Character class, setting movement speeds/gravity/air-control, overriding a
  custom movement mode (PhysCustom), adding root motion, or debugging network
  smoothing and prediction on a character.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Characters & movement

`ACharacter` is an `APawn` specialized for capsule-based, vertically-oriented
movement. It owns a `UCharacterMovementComponent` (CMC) that handles walking,
falling, swimming, flying, and custom movement modes with **client-side
prediction and server reconciliation included**. Use it for humanoid players and
NPCs; use a plain `APawn` or `UFloatingPawnMovement` for vehicles/drones.

## When to use this skill

- Creating a walking/running/jumping/swimming/flying character (player or AI).
- Configuring CMC properties: speeds, gravity, air control, friction, rotation.
- Switching or overriding movement modes (including custom modes).
- Applying root motion sources from C++ (launching, impulses, warps).
- Debugging prediction artifacts, network smoothing, or crouch silently failing.
- Choosing between CMC and the experimental Mover plugin.

## What ACharacter gives you

Built-in components declared in `Character.h:252-263` (`ACharacter : public APawn`):

- **`UCapsuleComponent`** — root collision capsule; CMC assumes vertical alignment.
  Access via `GetCapsuleComponent()`.
- **`USkeletalMeshComponent`** — animated mesh. Access via `GetMesh()`. Must be
  offset so the feet sit at the capsule bottom and the mesh faces +X by default.
- **`UCharacterMovementComponent`** — all movement logic. Access via
  `GetCharacterMovement()` (also a templated form for subclasses).

The class hierarchy for movement is:
`UMovementComponent` → `UNavMovementComponent` → `UPawnMovementComponent` →
`UCharacterMovementComponent`. `UPawnMovementComponent` owns `AddInputVector`/
`ConsumeInputVector`; `APawn::AddMovementInput` (`Pawn.h:484`) accumulates
input for CMC to consume each tick.

## Typical third-person character

```cpp
// MyCharacter.h
UCLASS()
class MYGAME_API AMyCharacter : public ACharacter
{
    GENERATED_BODY()
public:
    AMyCharacter();
protected:
    UPROPERTY(VisibleAnywhere) TObjectPtr<class USpringArmComponent> SpringArm;
    UPROPERTY(VisibleAnywhere) TObjectPtr<class UCameraComponent>   Camera;
};

// MyCharacter.cpp
#include "MyCharacter.h"
#include "GameFramework/SpringArmComponent.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/CharacterMovementComponent.h"

AMyCharacter::AMyCharacter()
{
    SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
    SpringArm->SetupAttachment(GetRootComponent());    // capsule, not mesh
    SpringArm->TargetArmLength = 400.f;
    SpringArm->bUsePawnControlRotation = true;

    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    Camera->SetupAttachment(SpringArm);

    // Third-person: face movement direction, ignore controller yaw on actor
    bUseControllerRotationYaw   = false;
    GetCharacterMovement()->bOrientRotationToMovement = true;   // CMC.h:445
    GetCharacterMovement()->RotationRate = FRotator(0.f, 540.f, 0.f); // CMC.h:409
    GetCharacterMovement()->MaxWalkSpeed = 500.f;               // CMC.h:274
    GetCharacterMovement()->JumpZVelocity = 450.f;              // CMC.h:163
    GetCharacterMovement()->GravityScale  = 1.0f;               // CMC.h:155
}
```

The SpringArm **must** attach to the capsule/root, not the mesh — otherwise it
rotates with the animation skeleton.

## Applying movement input

```cpp
// Bind this to an Enhanced Input IA_Move action (2D axis)
void AMyCharacter::Move(const FInputActionValue& Value)
{
    const FVector2D Axis = Value.Get<FVector2D>();
    const FRotator YawRot(0.f, GetControlRotation().Yaw, 0.f);
    AddMovementInput(FRotationMatrix(YawRot).GetUnitAxis(EAxis::X), Axis.Y);
    AddMovementInput(FRotationMatrix(YawRot).GetUnitAxis(EAxis::Y), Axis.X);
}

void AMyCharacter::Look(const FInputActionValue& Value)
{
    const FVector2D Delta = Value.Get<FVector2D>();
    AddControllerYawInput(Delta.X);
    AddControllerPitchInput(Delta.Y);
}
```

`AddMovementInput` (`Pawn.h:484`) accumulates a pending vector that CMC
reads and clears each tick via `ConsumeInputVector` (`PawnMovementComponent.h:86`).
Never bypass this with `SetActorLocation` on a networked character — it breaks
prediction.

For AI, call path-following through `UAIController`; the navigation system
drives movement via `AddMovementInput` internally.

## Jumping and crouching

```cpp
// In SetupPlayerInputComponent or IA_ binding:
Jump();       // ACharacter::Jump() — Character.h:711; sets bPressedJump
StopJumping(); // Character.h:720; clears hold force

// Multi-jump: set on the character
JumpMaxCount = 2;        // Character.h:630 — double-jump
JumpMaxHoldTime = 0.3f;  // Character.h:621 — hold for extra height
```

Crouch requires one flag before calling `Crouch()`:
```cpp
// In constructor or BeginPlay:
GetCharacterMovement()->GetNavAgentPropertiesRef().bCanCrouch = true;
// NavigationTypes.h:393 (FNavAgentProperties::bCanCrouch)

// Then in input binding:
Crouch();    // Character.h:871
UnCrouch();  // Character.h:880
```

Without `bCanCrouch = true`, `Crouch()` does nothing silently.

## Movement modes

CMC tracks state in `MovementMode` (`CMC.h:229`, `TEnumAsByte<EMovementMode>`):

| Mode | Enum | Physics function |
|------|------|-----------------|
| Walking | `MOVE_Walking` | `PhysWalking` (`CMC.h:1956`) |
| Falling | `MOVE_Falling` | `PhysFalling` (`CMC.h:1627`) |
| Swimming | `MOVE_Swimming` | `PhysSwimming` (`CMC.h:1965`) |
| Flying | `MOVE_Flying` | `PhysFlying` (`CMC.h:1962`) |
| Custom | `MOVE_Custom` | `PhysCustom` (`CMC.h:1968`) — override this |

Switch modes at runtime:
```cpp
GetCharacterMovement()->SetMovementMode(MOVE_Flying);  // CMC.h:1257
// Revert to default land/water mode:
GetCharacterMovement()->SetDefaultMovementMode();      // CMC.h:1834
```

`OnMovementModeChanged` fires on both the CMC (`CMC.h:1279`) and the Character
(`Character.h:924`) — override either to react (e.g. turn on `bNotifyApex` when
entering `MOVE_Falling`).

### Custom movement mode

Override `PhysCustom` in a CMC subclass:
```cpp
// MyMovementComponent.h
UCLASS()
class UMyMovementComponent : public UCharacterMovementComponent
{
    GENERATED_BODY()
protected:
    virtual void PhysCustom(float DeltaTime, int32 Iterations) override;
};

// MyMovementComponent.cpp
void UMyMovementComponent::PhysCustom(float DeltaTime, int32 Iterations)
{
    if (CustomMovementMode == 1)   // your sub-mode index (0-255)
    {
        // Compute velocity, call MoveUpdatedComponent, handle hits...
        Super::PhysCustom(DeltaTime, Iterations);
    }
}
```

Use `ObjectInitializer.SetDefaultSubobjectClass<UMyMovementComponent>(...)` in
the Character constructor to substitute the CMC subclass.

## Rotation modes

Three mutually exclusive intents — pick exactly one:

| Property | Owner | Behavior |
|----------|-------|----------|
| `bOrientRotationToMovement` (`CMC.h:445`) | CMC | Rotate actor toward velocity direction. Typical third-person. |
| `bUseControllerRotationYaw` (APawn) | Character | Actor yaw tracks controller yaw. Typical first-person/strafe. |
| `bUseControllerDesiredRotation` (`CMC.h:438`) | CMC | Smooth-rotate toward controller rotation; overridden by Orient. |

Setting both `bOrientRotationToMovement` and `bUseControllerRotationYaw` causes
the actor to fight itself every frame — a common bug.

## Root motion sources (programmatic)

Root motion sources let C++ inject procedural movement that participates in
CMC's prediction loop — unlike raw `SetActorLocation`. Montage-driven root
motion (animation clip data) flows automatically through CMC when the montage
has `RootMotionMode != NoRootMotionExtraction`.

```cpp
// Launch the character along an arc using a root motion source:
TSharedPtr<FRootMotionSource_JumpForce> JumpSource =
    MakeShared<FRootMotionSource_JumpForce>();
JumpSource->InstanceName    = FName("MyArcJump");
JumpSource->Duration        = 0.6f;
JumpSource->Height          = 200.f;
JumpSource->bDisableTimeout = false;
GetCharacterMovement()->ApplyRootMotionSource(JumpSource); // CMC.h:2739
```

Remove by name when done:
```cpp
GetCharacterMovement()->RemoveRootMotionSource(FName("MyArcJump")); // CMC.h:2751
```

See [references/root-motion-and-launch.md](references/root-motion-and-launch.md)
for the full `FRootMotionSource` type catalogue and network considerations.

## Networking (free, but mind authority)

CMC implements the full client-prediction + server-reconciliation loop via
`PerformMovement` (`CMC.h:2252`) and `FSavedMove_Character` (`CMC.h:2912`).
Key rules:

- Drive all movement through `AddMovementInput`/`Jump`/`LaunchCharacter` so
  moves are saved and replayed correctly.
- Adding custom state to prediction requires subclassing `FSavedMove_Character`
  and overriding `GetCompressedFlags`/`SetMoveFor`/`PrepMoveFor`.
- `NetworkMaxSmoothUpdateDistance` (`CMC.h:838`) controls when CMC teleports vs.
  interpolates to a correction; increase it if you see snap-corrections on
  simulated proxies.
- `ReplicatedMovementMode` (`Character.h:593`) replicates the enum to simulated
  proxies so they can transition physics locally.

See [references/networked-movement.md](references/networked-movement.md) for the
full prediction loop, custom move flags, and RPC flow.

## Key CMC properties

| Property | Line | Purpose |
|----------|------|---------|
| `MaxWalkSpeed` | 274 | Top speed on ground |
| `MaxWalkSpeedCrouched` | 278 | Top speed while crouched |
| `MaxAcceleration` | 294 | Rate of velocity build-up |
| `GroundFriction` | 254 | Deceleration friction while grounded |
| `BrakingDecelerationWalking` | (see `BrakingDeceleration*`) | Deceleration when no input |
| `GravityScale` | 155 | Multiplies world gravity |
| `JumpZVelocity` | 163 | Initial vertical impulse |
| `AirControl` | 359 | Lateral control while airborne (0–1) |
| `RotationRate` | 409 | Degrees/sec for orientation modes |
| `bConstrainToPlane` | (MovementComponent.h:155) | Lock motion to a plane (2-D games) |

All lines above refer to `CharacterMovementComponent.h` unless noted.

## Mover plugin (experimental successor)

`Engine/Plugins/Experimental/Mover/` contains the **Mover** plugin, intended as
the long-term replacement for CMC. Key differences versus CMC:

- Actor-type agnostic (`UMoverComponent` does not require `ACharacter`).
- Movement modes are modular objects, not an enum + `switch`.
- Uses rollback networking (Network Prediction Plugin or Chaos Networked Physics)
  instead of CMC's client-RPC model.
- State is guarded — no direct velocity manipulation; use modes, layered moves,
  and instant effects.
- APIs, data formats, and properties are still subject to breaking changes.

Epic states CMC will remain supported "for the foreseeable future" after Mover
reaches production status. For new projects targeting UE 5.7+, evaluate Mover
only if you need its modular architecture or non-capsule shapes and can accept
experimental status. See `references/networked-movement.md` for the CMC vs.
Mover replication model comparison, and the dedicated `mover-movement-system`
skill for full Mover setup, modes, layered moves, and backends.

## Gotchas

- **`SetActorLocation` on a networked character** bypasses prediction; use
  `AddMovementInput`, `Jump`, or `LaunchCharacter` instead.
- **`bOrientRotationToMovement` + `bUseControllerRotationYaw` both true** — they
  fight each other every frame; pick one.
- **Crouch with `bCanCrouch` unset** silently does nothing. Set it on
  `NavAgentProps` before calling `Crouch()`.
- **SpringArm parented to mesh** — rotates with the skeleton; parent to the
  root capsule.
- **Mesh not offset** — align so feet meet capsule bottom and mesh forward faces
  +X, or movement/animation will be misaligned.
- **`PhysCustom` not overriding** — you must subclass CMC and inject via
  `ObjectInitializer.SetDefaultSubobjectClass`, not just override in the Character.
- **`JumpMaxHoldTime` non-zero without `StopJumping()`** — the character
  accumulates vertical velocity indefinitely until hold time expires.
- **Moving a `Static` mobility component at runtime** — mobility must be
  `Movable`; static components ignore transforms at play.
- **Overlapping `PhysicsVolume`** changes CMC's water mode automatically if the
  volume is a water volume; be aware when swimming detection differs from your
  game's logic.

## Version notes

- `TObjectPtr<T>` for `UPROPERTY` members is the UE5+ idiom; legacy code uses
  raw `T*`, which still compiles.
- Custom gravity direction (`GravityDirection`, added in UE 5.x) is a
  `VisibleAnywhere BlueprintReadOnly` property (`CMC.h:199`) — useful for
  wall-walking. Replicated via `Character.h:474` (`ReplicatedGravityDirection`).
- `CharacterMovementConstants::AsyncCharacterMovement` CVar enables async CMC
  updates (`CMC.h:44`); experimental in 5.7 — test with it off first.
- Line numbers in engine headers drift across patch releases; header paths and
  class/function names are stable.

## References & source material

Engine source (UE 5.7, `Engine/Source/Runtime/Engine/Classes/`):
- `GameFramework/Character.h` — `ACharacter:241`, `Jump:711`, `StopJumping:720`,
  `Crouch:871`, `UnCrouch:880`, `JumpMaxCount:630`, `JumpMaxHoldTime:621`,
  `OnMovementModeChanged:924`, `ReplicatedMovementMode:593`,
  `ReplicatedGravityDirection:474`.
- `GameFramework/CharacterMovementComponent.h` — `MovementMode:229`,
  `CustomMovementMode:237`, `GravityScale:155`, `JumpZVelocity:163`,
  `GroundFriction:254`, `MaxWalkSpeed:274`, `MaxWalkSpeedCrouched:278`,
  `MaxAcceleration:294`, `AirControl:359`, `RotationRate:409`,
  `bUseControllerDesiredRotation:438`, `bOrientRotationToMovement:445`,
  `NetworkMaxSmoothUpdateDistance:838`, `SetMovementMode:1257`,
  `OnMovementModeChanged:1279`, `PhysFalling:1627`, `PhysWalking:1956`,
  `PhysFlying:1962`, `PhysSwimming:1965`, `PhysCustom:1968`,
  `PerformMovement:2252`, `FSavedMove_Character:2912`,
  `ApplyRootMotionSource:2739`, `RemoveRootMotionSource:2751`.
- `GameFramework/Pawn.h` — `AddMovementInput:484`.
- `GameFramework/PawnMovementComponent.h` — `GetPendingInputVector:69`,
  `ConsumeInputVector:86`.
- `GameFramework/NavMovementComponent.h` — `NavAgentProps:61`.
- `AI/Navigation/NavigationTypes.h` — `FNavAgentProperties::bCanCrouch:393`.
- `GameFramework/MovementComponent.h` — `bConstrainToPlane:155`.
- `GameFramework/RootMotionSource.h` — `FRootMotionSource`, `FRootMotionSource_JumpForce`.

Plugin source (UE 5.7):
- `Engine/Plugins/Experimental/Mover/Source/Mover/Public/MoverComponent.h`
- `Engine/Plugins/Experimental/Mover/Source/Mover/Public/DefaultMovementSet/CharacterMoverComponent.h`

Official docs (UE 5.7):
- Characters — <https://dev.epicgames.com/documentation/unreal-engine/characters-in-unreal-engine>
- Gameplay Framework — <https://dev.epicgames.com/documentation/unreal-engine/gameplay-framework-in-unreal-engine>
- Mover — <https://dev.epicgames.com/documentation/unreal-engine/mover-in-unreal-engine>
- Mover vs CMC — <https://dev.epicgames.com/documentation/unreal-engine/comparing-mover-and-character-movement-component-in-unreal-engine>
- Networking & Multiplayer — <https://dev.epicgames.com/documentation/unreal-engine/networking-and-multiplayer-in-unreal-engine>

Deep-dive references in this skill:
- [references/movement-modes-and-custom.md](references/movement-modes-and-custom.md) — full
  mode state machine, `PhysCustom` walkthrough, gravity direction, plane constraints.
- [references/networked-movement.md](references/networked-movement.md) — prediction
  loop, `FSavedMove_Character`, custom move flags, network smoothing, Mover comparison.
- [references/root-motion-and-launch.md](references/root-motion-and-launch.md) — root
  motion source types, `LaunchCharacter`, animation root motion and networking.
