---
name: character-and-movement
description: Implement player/AI characters in Unreal C++ with ACharacter and
  UCharacterMovementComponent — the capsule/mesh/movement component setup, third-person camera
  (SpringArm + Camera), movement input (AddMovementInput), jumping/crouching, movement modes,
  rotation modes, and built-in networked movement. Use when creating a Character, setting up
  walking/running/jumping, configuring the movement component, or wiring a character camera.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Characters & movement

`ACharacter` is a `APawn` specialized for bipedal, capsule-based movement, with a built-in
`UCharacterMovementComponent` (CMC) that handles walking, falling, swimming, flying — and
**networked movement with client prediction** out of the box. Use it for humanoid players/NPCs;
use a plain `APawn` for vehicles/flying/custom motion.

## When to use this skill

- Creating a walking/running/jumping character (player or AI).
- Configuring the movement component (speeds, gravity, rotation behavior).
- Setting up a third-person camera on a character.
- Applying movement from input or AI.

## What ACharacter gives you

Built-in components (verified — `ACharacter : public APawn`, `Character.h:241`):
- **`UCapsuleComponent`** — the root collision capsule (`GetCapsuleComponent()`).
- **`USkeletalMeshComponent`** — the character mesh (`GetMesh()`), offset so feet sit at capsule bottom.
- **`UCharacterMovementComponent`** — movement logic (`GetCharacterMovement()`).

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
    SpringArm->SetupAttachment(GetRootComponent());
    SpringArm->TargetArmLength = 400.f;
    SpringArm->bUsePawnControlRotation = true;     // arm follows controller look

    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    Camera->SetupAttachment(SpringArm);            // socket = arm end

    // Move in the direction of input, independent of camera facing:
    bUseControllerRotationYaw = false;
    GetCharacterMovement()->bOrientRotationToMovement = true;
    GetCharacterMovement()->RotationRate = FRotator(0.f, 540.f, 0.f);
    GetCharacterMovement()->MaxWalkSpeed = 500.f;
    GetCharacterMovement()->JumpZVelocity = 450.f;
}
```

## Applying movement

```cpp
// From input (see enhanced-input for binding). Value is a 2D move axis.
void AMyCharacter::Move(const FVector2D& Axis)
{
    const FRotator YawRot(0.f, GetControlRotation().Yaw, 0.f);
    const FVector Forward = FRotationMatrix(YawRot).GetUnitAxis(EAxis::X);
    const FVector Right   = FRotationMatrix(YawRot).GetUnitAxis(EAxis::Y);
    AddMovementInput(Forward, Axis.Y);
    AddMovementInput(Right,   Axis.X);
}

void AMyCharacter::LookInput(const FVector2D& Axis)
{
    AddControllerYawInput(Axis.X);
    AddControllerPitchInput(Axis.Y);
}
```

- `AddMovementInput(Direction, Scale)` — the correct way to drive a Character; CMC consumes it.
- `Jump()` / `StopJumping()` — built in; respects `JumpMaxHoldTime`, `JumpZVelocity`.
- `Crouch()` / `UnCrouch()` — requires `GetCharacterMovement()->NavAgentProps.bCanCrouch = true`.
- For AI, use `AAIController` + `UCharacterMovementComponent` via the navigation system
  (see `ai-and-navigation`); don't hand-set location.

## Movement & rotation modes

- Movement modes (`EMovementMode`): `MOVE_Walking`, `MOVE_Falling`, `MOVE_Swimming`,
  `MOVE_Flying`, `MOVE_Custom`. Query `GetCharacterMovement()->MovementMode`; set via
  `SetMovementMode(MOVE_Flying)`.
- Rotation behaviors (mutually exclusive intents):
  - `bOrientRotationToMovement = true` (CMC) — face movement direction (typical third-person).
  - `bUseControllerRotationYaw = true` (Character) — face controller yaw (typical first-person/strafe).
  - `bUseControllerDesiredRotation` (CMC) — smoothly rotate toward controller rotation.

## Key CMC properties to know

`MaxWalkSpeed`, `MaxWalkSpeedCrouched`, `MaxAcceleration`, `BrakingDecelerationWalking`,
`GroundFriction`, `GravityScale`, `JumpZVelocity`, `AirControl`, `RotationRate`,
`bConstrainToPlane`/`SetPlaneConstraintEnabled` (2D-style movement).

## Networking (free, but mind authority)

CMC implements client-side prediction + server reconciliation automatically. Guidance:
- Drive movement through `AddMovementInput`/`Jump` so prediction works; don't `SetActorLocation`
  every tick on a networked character.
- Possession/authority lives on the controller/GameMode — see `gameplay-framework` and
  `networking-and-replication` for replicated state and RPCs.

## Gotchas

- **Setting location directly** instead of `AddMovementInput` breaks CMC prediction and feels wrong.
- **Conflicting rotation flags** (`bOrientRotationToMovement` + `bUseControllerRotationYaw`) fight
  each other — pick one intent.
- **Crouch with `bCanCrouch` unset** silently does nothing.
- **Camera/SpringArm parented to mesh** rotates with animation; parent the SpringArm to the
  root/capsule instead.
- **Mesh not offset** → character floats or sinks; align mesh so feet meet capsule bottom and face +X.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/GameFramework/Character.h` — `ACharacter`, `Jump`, `Crouch`, `GetMesh`.
- `Runtime/Engine/Classes/GameFramework/CharacterMovementComponent.h` — movement modes, speeds, prediction.
- `Runtime/Engine/Classes/GameFramework/Pawn.h` — `APawn`, possession, `AddMovementInput`.
- `Runtime/Engine/Classes/Components/CapsuleComponent.h`,
  `Camera/CameraComponent.h`, `GameFramework/SpringArmComponent.h`.

Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>
