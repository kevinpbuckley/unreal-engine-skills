---
skill: enhanced-input
title: Enhanced Input move/look/jump bindings in C++
---

## Prompt

In an Unreal Engine 5.7 C++ project module named `EvalScratch`, wire third-person
character controls with Enhanced Input entirely from C++: WASD movement, mouse look,
and jump. Input assets (actions and the mapping context) are assigned by a designer in
the Blueprint subclass; the C++ adds the mapping context at the right moment and binds
the handlers.

## Acceptance criteria

- Build.cs adds `EnhancedInput`.
- `UPROPERTY(EditAnywhere, ...)` members of type `UInputMappingContext*` /
  `UInputAction*` (or `TObjectPtr<>`), so designers can assign assets.
- Mapping context added via `UEnhancedInputLocalPlayerSubsystem::AddMappingContext`
  retrieved from the local player (e.g. in `SetupPlayerInputComponent` or
  `NotifyControllerChanged`/`PawnClientRestart`), guarded against a null local player.
- Bindings use `UEnhancedInputComponent::BindAction` with `ETriggerEvent::Triggered`
  (move/look) and `ETriggerEvent::Started`/`Completed` (jump) — after
  `CastChecked<UEnhancedInputComponent>`.
- Handlers take `const FInputActionValue&` and extract `Get<FVector2D>()` for
  move/look; movement uses controller yaw-based direction
  (`FRotationMatrix(YawRotation).GetUnitAxis`), not raw actor forward.
- No legacy `BindAxis`/`BindAction(FName...)` calls and no Project Settings axis
  mappings.

## Common baseline failures

Legacy input API usage, binding on the base `UInputComponent` type, never adding the
mapping context (silent no-input), reading `Get<float>()` from an Axis2D action, or
adding the context in the constructor where the local player doesn't exist yet.
