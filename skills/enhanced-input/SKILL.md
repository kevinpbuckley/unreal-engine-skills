---
name: enhanced-input
description: Implement player input with Unreal's Enhanced Input system — Input Actions, Input
  Mapping Contexts, the Enhanced Input local player subsystem, binding actions in C++ with
  triggers and modifiers, and reading FInputActionValue. Use when setting up player controls,
  binding movement/look/jump/interact, adding or swapping mapping contexts, or migrating from the
  legacy axis/action input bindings.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Enhanced Input

Enhanced Input is the modern input system (the legacy `DefaultInput.ini` axis/action mappings are
deprecated). Input is data-driven: **Input Actions** (what can happen) are mapped to keys by
**Input Mapping Contexts** (which you push/pop at runtime), with per-mapping **modifiers** and
**triggers**.

## When to use this skill

- Setting up controls for a Pawn/Character/PlayerController.
- Binding move/look/jump/interact/etc. in C++.
- Adding, removing, or prioritizing mapping contexts (e.g. on-foot vs. in-vehicle vs. menu).
- Replacing legacy `BindAxis`/`BindAction` input.

## Setup checklist

1. Enable the **Enhanced Input** plugin (on by default in 5.x) and add `"EnhancedInput"` to your
   module's `PrivateDependencyModuleNames` (see `unreal-module-and-build-system`).
2. Set the Enhanced Input classes as defaults (Project Settings → Input):
   `Default Player Input Class = EnhancedPlayerInput`,
   `Default Input Component Class = EnhancedInputComponent`.
3. Create assets: `UInputAction` per action, and a `UInputMappingContext` mapping keys → actions.
4. Add the mapping context for the player, then bind actions in C++.

## Core types

| Type | Role |
|---|---|
| `UInputAction` | an abstract action (e.g. `IA_Move`) with a value type: bool, `Axis1D`, `Axis2D`, `Axis3D` |
| `UInputMappingContext` | maps physical keys → actions, with triggers/modifiers per mapping |
| `UEnhancedInputComponent` | binds actions to C++ handlers |
| `UEnhancedInputLocalPlayerSubsystem` | adds/removes mapping contexts for a local player |
| `FInputActionValue` | the value delivered to a handler (`Get<bool>()`, `Get<FVector2D>()`, …) |
| `ETriggerEvent` | when the handler fires: `Triggered`, `Started`, `Ongoing`, `Completed`, `Canceled` |

## Adding a mapping context

Do this where the player is ready (e.g. `APlayerController::BeginPlay` or
`APawn::PawnClientRestart`):

```cpp
#include "EnhancedInputSubsystems.h"   // UEnhancedInputLocalPlayerSubsystem

if (ULocalPlayer* LP = GetLocalPlayer())   // on a PlayerController
{
    if (auto* Subsys = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
    {
        Subsys->AddMappingContext(DefaultMappingContext, /*Priority*/ 0);
    }
}
```
Higher priority contexts win key conflicts. Remove with `RemoveMappingContext(IMC)`.

## Binding actions (C++)

Bind in `SetupPlayerInputComponent` (Pawn/Character) — the component is an
`UEnhancedInputComponent` once the default class is set:

```cpp
#include "EnhancedInputComponent.h"

void AMyCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    auto* EIC = CastChecked<UEnhancedInputComponent>(PlayerInputComponent);

    EIC->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AMyCharacter::OnMove);
    EIC->BindAction(LookAction, ETriggerEvent::Triggered, this, &AMyCharacter::OnLook);
    EIC->BindAction(JumpAction, ETriggerEvent::Started,   this, &ACharacter::Jump);
    EIC->BindAction(JumpAction, ETriggerEvent::Completed, this, &ACharacter::StopJumping);
}

void AMyCharacter::OnMove(const FInputActionValue& Value)
{
    const FVector2D Axis = Value.Get<FVector2D>();   // matches IA_Move's Axis2D type
    // forward Axis to movement (see character-and-movement)
}
```

The `UInputAction*` members (`MoveAction`, etc.) are `UPROPERTY(EditAnywhere, BlueprintReadOnly,
Category="Input")` and assigned in a Blueprint subclass or defaults.

## Triggers & modifiers (configured on the mapping)

- **Modifiers** transform the raw input: `Negate`, `Swizzle Input Axis Values` (e.g. map W/S to
  Y), `Dead Zone`, `Scalar`. Used to build a 2D move from WASD on a single `Axis2D` action.
- **Triggers** decide *when* the action fires: `Pressed`, `Released`, `Hold`, `Tap`,
  `Pulse`, `Chorded Action`. They drive which `ETriggerEvent` your handler receives.

## Choosing the trigger event

- Continuous (movement/look): `ETriggerEvent::Triggered`.
- Press/release pairs (jump, aim): `Started` + `Completed`.
- Hold-to-charge: a `Hold` trigger → `Triggered`/`Completed`.

## Gotchas

- **Forgot `"EnhancedInput"` in Build.cs** → unresolved externals for the input classes.
- **Default input classes not set** → `Cast<UEnhancedInputComponent>` fails / no input.
- **Never added the mapping context** → actions never fire; add it via the subsystem.
- **Value type mismatch** — read the type the action declares (`bool` vs `FVector2D`); reading the
  wrong type yields zero.
- **Adding context too early** (before a local player exists) → no-op; do it on possession/restart.

## References & source material

Engine source (UE 5.7, `Engine/Plugins/EnhancedInput/Source/EnhancedInput/Public/`):
- `InputAction.h` — `UInputAction`, value types, `FInputActionValue`.
- `InputMappingContext.h` — `UInputMappingContext`.
- `EnhancedInputComponent.h` — `BindAction`, `ETriggerEvent`.
- `EnhancedInputSubsystems.h` — `UEnhancedInputLocalPlayerSubsystem`.

Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>
