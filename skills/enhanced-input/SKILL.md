---
name: enhanced-input
description: Implement player input with Unreal's Enhanced Input system — UInputAction (data
  asset, value types Boolean/Axis1D/Axis2D/Axis3D), UInputMappingContext (key-to-action
  mappings with per-key modifiers and triggers), UEnhancedInputComponent (BindAction with
  ETriggerEvent), UEnhancedInputLocalPlayerSubsystem (AddMappingContext/RemoveMappingContext),
  UInputModifier (Negate, SwizzleAxis, DeadZone, Scalar, Smooth), UInputTrigger (Pressed,
  Released, Hold, Tap, Pulse, ChordedAction), FInputActionValue (Get<bool>(), Get<float>(),
  Get<FVector2D>(), Get<FVector>()), and PlayerController/Pawn setup. Use when setting up
  player controls, binding movement/look/jump/interact actions in C++, adding or swapping
  mapping contexts at runtime (on-foot vs. in-vehicle vs. menu), reading analog values, or
  migrating from legacy BindAxis/BindAction input.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Enhanced Input

Enhanced Input is the modern UE input system. It is data-driven: **Input Actions** define what
a player can do, **Input Mapping Contexts** map physical keys to actions (with optional
modifiers and triggers on each mapping), and the **Enhanced Input Local Player Subsystem**
pushes and pops contexts at runtime. Legacy `DefaultInput.ini` axis/action mappings still
compile but are deprecated and should be avoided in new code.

## When to use this skill

- Setting up player controls on a Pawn, Character, or PlayerController.
- Binding movement, look, jump, interact, or any other player action in C++.
- Adding, removing, or reprioritizing mapping contexts at runtime (context switching:
  on-foot, in-vehicle, UI, etc.).
- Reading analog values from `FInputActionValue` in an action handler.
- Replacing legacy `BindAxis`/`BindAction` input bindings.

## Mental model

```
Physical key press
   → IMC mapping (modifiers applied first, triggers evaluated)
   → FInputActionValue delivered to handler on matching ETriggerEvent
```

The system is entirely **data-asset-driven**. `UInputAction` and `UInputMappingContext` are
`UDataAsset` subclasses created in the Content Browser. C++ code holds `UPROPERTY` pointers
to them and uses the subsystem and component to wire them up.

## Setup checklist

1. Verify the **Enhanced Input** plugin is enabled (on by default in 5.x new projects).
2. Add `"EnhancedInput"` to `PrivateDependencyModuleNames` in your `Build.cs`.
3. Set defaults in Project Settings → Engine → Input:
   - `Default Player Input Class` → `EnhancedPlayerInput`
   - `Default Input Component Class` → `EnhancedInputComponent`
4. Create a `UInputAction` asset per action; set the value type (`Boolean`, `Axis1D`,
   `Axis2D`, `Axis3D`).
5. Create a `UInputMappingContext` asset; add key→action mappings, plus any per-mapping
   modifiers/triggers.
6. On possession/spawn: push the context via the subsystem.
7. In `SetupPlayerInputComponent`: cast to `UEnhancedInputComponent`, call `BindAction`.

## Core types

| Type | Role |
|---|---|
| `UInputAction` | Abstract action data asset; carries a `ValueType` (`EInputActionValueType`) |
| `UInputMappingContext` | Data asset mapping `FKey` → `UInputAction`, with per-mapping `UInputModifier[]` and `UInputTrigger[]` |
| `UEnhancedInputComponent` | Input component subclass; `BindAction` registers C++ delegates |
| `UEnhancedInputLocalPlayerSubsystem` | Per-local-player subsystem; `AddMappingContext` / `RemoveMappingContext` |
| `FInputActionValue` | Value delivered to handlers; `Get<T>()` extracts `bool`, `float`, `FVector2D`, or `FVector` |
| `ETriggerEvent` | When the handler fires: `Started`, `Triggered`, `Ongoing`, `Completed`, `Canceled` |

## Adding a mapping context

Push contexts from a point where the local player exists — typically
`APlayerController::BeginPlay` or `APawn::PawnClientRestart`:

```cpp
// In AMyPlayerController::BeginPlay or APawn::PawnClientRestart
#include "EnhancedInputSubsystems.h"

if (ULocalPlayer* LP = GetLocalPlayer())  // APlayerController has GetLocalPlayer()
{
    auto* Subsys = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>();
    if (Subsys && DefaultMappingContext)
    {
        Subsys->AddMappingContext(DefaultMappingContext, /*Priority*/ 0);
    }
}
```

Higher-priority values take precedence when two active contexts map the same key to different
actions. Remove with `Subsys->RemoveMappingContext(IMC)`. A context can be added/removed any
number of times (e.g. entering/leaving a vehicle).

## Binding actions in C++

`SetupPlayerInputComponent` runs on the Pawn after the input component is created. Cast it to
`UEnhancedInputComponent` (safe once the default class is set in Project Settings):

```cpp
// AMyCharacter.h
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "AMyCharacter.generated.h"

class UInputAction;
class UInputMappingContext;
struct FInputActionValue;

UCLASS()
class MYGAME_API AMyCharacter : public ACharacter
{
    GENERATED_BODY()
public:
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

protected:
    void OnMove(const FInputActionValue& Value);
    void OnLook(const FInputActionValue& Value);

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputMappingContext> DefaultMappingContext;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> MoveAction;   // Axis2D

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> LookAction;   // Axis2D

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    TObjectPtr<UInputAction> JumpAction;   // Boolean
};
```

```cpp
// AMyCharacter.cpp
#include "AMyCharacter.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputActionValue.h"

void AMyCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);

    // Push mapping context (Pawn path: via controller's local player)
    if (APlayerController* PC = Cast<APlayerController>(GetController()))
    {
        if (ULocalPlayer* LP = PC->GetLocalPlayer())
        {
            auto* Subsys = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>();
            if (Subsys && DefaultMappingContext)
                Subsys->AddMappingContext(DefaultMappingContext, 0);
        }
    }

    auto* EIC = CastChecked<UEnhancedInputComponent>(PlayerInputComponent);

    // Continuous actions use ETriggerEvent::Triggered (fires every tick while held)
    EIC->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AMyCharacter::OnMove);
    EIC->BindAction(LookAction, ETriggerEvent::Triggered, this, &AMyCharacter::OnLook);

    // Jump: Started fires on first press, Completed fires on release
    EIC->BindAction(JumpAction, ETriggerEvent::Started,   this, &ACharacter::Jump);
    EIC->BindAction(JumpAction, ETriggerEvent::Completed, this, &ACharacter::StopJumping);
}

void AMyCharacter::OnMove(const FInputActionValue& Value)
{
    const FVector2D Axis = Value.Get<FVector2D>();  // matches IA_Move's Axis2D type
    AddMovementInput(GetActorForwardVector(), Axis.Y);
    AddMovementInput(GetActorRightVector(),   Axis.X);
}

void AMyCharacter::OnLook(const FInputActionValue& Value)
{
    const FVector2D Delta = Value.Get<FVector2D>();
    AddControllerYawInput(Delta.X);
    AddControllerPitchInput(Delta.Y);
}
```

Key rules:
- Action `UPROPERTY` members are assigned in a Blueprint subclass (or in asset defaults).
  Assign `DefaultMappingContext`, `MoveAction`, etc. via `EditAnywhere`.
- `CastChecked` asserts in Debug builds if the cast fails — a fast failure on misconfiguration.
- The handler signature must exactly match one of the four overloads: no args, `const
  FInputActionValue&`, `const FInputActionInstance&`, or the dynamic four-param form.
- `BindAction` returns a `FEnhancedInputActionEventBinding&` if you need to remove the
  binding later; store the handle or use `RemoveBindingByHandle`.

## Reading FInputActionValue

```cpp
// Match the value type declared on the UInputAction asset:
bool     bPressed = Value.Get<bool>();
float    Analog   = Value.Get<float>();       // Axis1D
FVector2D Axis2D  = Value.Get<FVector2D>();   // Axis2D
FVector   Axis3D  = Value.Get<FVector>();     // Axis3D
```

Reading the wrong type silently returns zero (e.g. `Get<bool>()` on an Axis2D action returns
`false`). The correct type is whatever `EInputActionValueType` the action asset declares.

## Trigger events — choosing the right one

| Use case | ETriggerEvent |
|---|---|
| Continuous hold (movement, look, accelerate) | `Triggered` |
| One-shot on press (jump start, fire, interact) | `Started` |
| One-shot on release (jump release, confirm UI) | `Completed` |
| Cancel feedback (abort a hold) | `Canceled` |
| Every frame while held, before threshold met | `Ongoing` |

Note: `Started` fires once on the frame the key passes the actuation threshold. `Triggered`
fires every tick while held. `Completed` fires the frame the key is released (or the trigger
condition is fully met and then ends).

## WASD as an Axis2D — modifier pattern

A single `IA_Move` (`Axis2D`) action can be driven by four keyboard keys using per-mapping
modifiers in the IMC:

| Key | Modifiers on the mapping |
|---|---|
| W | Swizzle Input Axis Values (YXZ) — moves X→Y so W contributes +Y |
| S | Swizzle (YXZ) + Negate — contributes −Y |
| A | Negate — contributes −X |
| D | (none) — contributes +X (default) |

At runtime, Enhanced Input accumulates all active mappings for an action per frame (default
`TakeHighestAbsoluteValue`; `Cumulative` is the alternative, set on the `UInputAction` asset).

## Gotchas

- **Missing `"EnhancedInput"` in Build.cs** → unresolved symbols for all Enhanced Input classes.
- **Default input classes not set** → `CastChecked<UEnhancedInputComponent>` crashes on
  start; `Cast` returns null and nothing fires.
- **Mapping context not added** → actions never fire; the subsystem must have the IMC before
  any key can reach an action.
- **Adding context before local player exists** → `GetLocalPlayer()` returns null; always add
  from `PawnClientRestart`/`BeginPlay` (after possession), not the constructor.
- **Value type mismatch** → `Get<FVector2D>()` on a Boolean action yields `(0, 0)`; align the
  handler type with the action asset's `ValueType`.
- **Legacy bind calls on UEnhancedInputComponent** → `BindAxis`/`BindAction(FName, ...)` are
  deleted (compile error) unless `ENHANCED_INPUT_ALLOW_LEGACY_BINDING=1` in Build.cs.
- **Action fires on context add when key is held** → default `FModifyContextOptions`
  sets `bIgnoreAllPressedKeysUntilRelease = true`; the key must be released and re-pressed.
  Set `bIgnoreAllPressedKeysUntilRelease = false` to override.
- **Priority conflicts** — add `0` for most contexts; reserve higher values for overlay
  contexts (e.g. UI) that must win over gameplay.

## Legacy input (you will still encounter it)

Older projects use `DefaultInput.ini` axis/action mappings and `BindAxis`/`BindAction(FName, ...)` on `UInputComponent`. These still compile in 5.7 but cannot coexist cleanly with
`UEnhancedInputComponent` (legacy binds are explicitly deleted on the enhanced component by
default). Migrate by replacing axis/action map entries with `UInputAction` + `UInputMappingContext` assets, and replacing `BindAxis`/`BindAction(FName, ...)` calls with
`UEnhancedInputComponent::BindAction`.

## Version notes

- Enhanced Input shipped in UE 4.27 as a plugin and became the default system in UE 5.1.
  In UE 5.7 the `Mappings` property on `UInputMappingContext` is deprecated (marked
  `UE_DEPRECATED(5.7)`) in favour of the new `DefaultKeyMappings` struct; use the editor
  asset instead of editing the `Mappings` array in C++.
- `FModifyContextOptions` (the options struct for `AddMappingContext`) and input mode
  filtering via `FGameplayTagContainer` are 5.3+ additions.

## References & source material

Engine source (UE 5.7, plugin path prefix:
`Engine/Plugins/EnhancedInput/Source/EnhancedInput/Public/`):
- `InputAction.h` — `UInputAction`:54 (`UDataAsset` subclass), `EInputActionValueType`:9
  (`Boolean`/`Axis1D`/`Axis2D`/`Axis3D`), `EInputActionAccumulationBehavior`:24,
  `FInputActionInstance`:196 (`GetValue()`:249, `GetTriggerEvent()`:246).
- `InputActionValue.h` — `FInputActionValue`:23; `Get<bool>()`:205, `Get<float>()`:212,
  `Get<FVector2D>()`:218, `Get<FVector>()`:224; `EInputActionValueType` reused here.
- `InputMappingContext.h` — `UInputMappingContext`:87 (`UDataAsset` subclass);
  `DefaultKeyMappings`:101 (5.7 replacement for deprecated `Mappings`).
- `EnhancedInputComponent.h` — `UEnhancedInputComponent`:373; `BindAction` template
  macro `DEFINE_BIND_ACTION`:465 (four signature overloads); `BindActionValue`:538;
  `RemoveBinding`:460; `BindActionInstanceLambda`:524.
- `EnhancedInputSubsystems.h` — `UEnhancedInputLocalPlayerSubsystem`:21
  (`ULocalPlayerSubsystem` + `IEnhancedInputSubsystemInterface`);
  `AddMappingContext`:37; `RemoveMappingContext`:38.
- `EnhancedInputSubsystemInterface.h` — `IEnhancedInputSubsystemInterface`:103;
  `FModifyContextOptions`:47 (`bIgnoreAllPressedKeysUntilRelease`, `bForceImmediately`,
  `bNotifyUserSettings`); `HasMappingContext`:363; `ClearAllMappings`:251.
- `InputTriggers.h` — `ETriggerEvent`:34 (`None`/`Triggered`/`Started`/`Ongoing`/
  `Canceled`/`Completed`); `UInputTrigger`:112 (`ActuationThreshold`:129);
  concrete triggers: `UInputTriggerPressed`:253, `UInputTriggerReleased`:268,
  `UInputTriggerHold`:292 (`HoldTimeThreshold`:307), `UInputTriggerTap`:337,
  `UInputTriggerPulse`:416, `UInputTriggerChordAction`:452.
- `InputModifiers.h` — `UInputModifier`:15 (`ModifyRaw_Implementation`); concrete
  modifiers: `UInputModifierDeadZone`:146, `UInputModifierNegate`:222,
  `UInputModifierSwizzleAxis`:381 (`EInputAxisSwizzle::YXZ`), `UInputModifierScalar`:182,
  `UInputModifierSmooth`:244, `UInputModifierResponseCurveExponential`:274.
- `EnhancedActionKeyMapping.h` — `FEnhancedActionKeyMapping`:37 (`Action`, `Key`,
  `Modifiers[]`, `Triggers[]`).
- `EnhancedInputDeveloperSettings.h` — `UEnhancedInputDeveloperSettings`:43
  (`DefaultMappingContexts`, `bEnableInputModeFiltering`, `DefaultInputMode`).

Official docs (UE 5.7):
- Enhanced Input — <https://dev.epicgames.com/documentation/unreal-engine/enhanced-input-in-unreal-engine>
- Input overview — <https://dev.epicgames.com/documentation/unreal-engine/input-in-unreal-engine>

Deep-dive references in this skill:
- [references/actions-and-contexts.md](references/actions-and-contexts.md) — `UInputAction`
  value types, accumulation, `UInputMappingContext` structure, priority, runtime add/remove.
- [references/modifiers-and-triggers.md](references/modifiers-and-triggers.md) — all
  built-in modifiers and triggers, authoring custom ones, trigger type semantics.
- [references/binding-and-setup.md](references/binding-and-setup.md) — full `BindAction`
  overload set, lambda bindings, removing bindings, the `FInputActionInstance` handler,
  per-project class defaults, world-subsystem input for non-player actors.
