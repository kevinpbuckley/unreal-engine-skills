# Modifiers and Triggers — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers all built-in `UInputModifier` and
`UInputTrigger` subclasses, their configuration, and how to author custom ones.
Grounded in UE 5.7 (`Engine/Plugins/EnhancedInput/Source/EnhancedInput/Public/`).

## Input Modifiers (`UInputModifier`)

Modifiers transform the raw `FInputActionValue` before it reaches triggers. They are applied
**in array order** — mapping-level modifiers run first, then action-level modifiers.

Base class: `UInputModifier` (`InputModifiers.h`:15). Override `ModifyRaw_Implementation` to
author a custom modifier (Blueprintable or C++):

```cpp
UCLASS(BlueprintType, EditInlineNew)
class UMyInputModifier : public UInputModifier
{
    GENERATED_BODY()
protected:
    virtual FInputActionValue ModifyRaw_Implementation(
        const UEnhancedPlayerInput* PlayerInput,
        FInputActionValue CurrentValue,
        float DeltaTime) override
    {
        // Halve the input
        return CurrentValue * 0.5f;
    }
};
```

### Built-in modifiers

| Class | DisplayName | Effect |
|---|---|---|
| `UInputModifierNegate` | Negate | Inverts selected axes (bX, bY, bZ all default true) |
| `UInputModifierSwizzleAxis` | Swizzle Input Axis Values | Reorders axes; `YXZ` swaps X↔Y (used to map W/S to the Y axis of an Axis2D) |
| `UInputModifierDeadZone` | Dead Zone | Remaps `[LowerThreshold, UpperThreshold]` → `[0, 1]`; `Radial` type gives smooth circular coverage |
| `UInputModifierScalar` | Scalar | Multiplies value by per-axis `FVector Scalar` |
| `UInputModifierSmooth` | Smooth | Rolling-average smoothing across multiple frames |
| `UInputModifierSmoothDelta` | Smooth Delta | Smoothed normalized delta between current and previous value; configurable curve |
| `UInputModifierScaleByDeltaTime` | Scale By Delta Time | Multiplies value by `DeltaTime` (useful for camera look without frame-rate dependency) |
| `UInputModifierResponseCurveExponential` | Response Curve - Exponential | Per-axis exponential curve (`CurveExponent`) |
| `UInputModifierResponseCurveUser` | Response Curve - User Defined | Per-axis `UCurveFloat` assets |
| `UInputModifierFOVScaling` | FOV Scaling | Scales look input by the player's FOV |
| `UInputModifierToWorldSpace` | To World Space | Converts input axes to world space (up/down→forward, left/right→right) |

Sources: `InputModifiers.h`:85–395.

### WASD modifier pattern (Axis2D from keyboard)

A single `IA_Move` (`Axis2D`) uses four modifier chains in the IMC:

| Key | Modifiers (applied in order) | Result in Axis2D |
|---|---|---|
| D | (none) | +X |
| A | Negate (X) | −X |
| W | Swizzle YXZ | +Y (X value moved to Y slot) |
| S | Swizzle YXZ, Negate (Y) | −Y |

`EInputAxisSwizzle::YXZ` swaps X and Y: a 1D key press (which reports on X) becomes a Y
contribution. Source: `InputModifiers.h`:358–393.

---

## Input Triggers (`UInputTrigger`)

Triggers decide **when** an action fires. They return `ETriggerState::{None, Ongoing,
Triggered}` each tick. The conversion to `ETriggerEvent` (the enum your handler receives)
reflects the transition between states frame-to-frame.

Base class: `UInputTrigger` (`InputTriggers.h`:112). Key base properties:

- `ActuationThreshold` (float, default 0.5): minimum magnitude for the input to be considered
  active. `IsActuated(Value)` returns `true` when `|Value| >= threshold`.
- `bShouldAlwaysTick` (bool, default false): tick this trigger every frame regardless of
  input; has a performance cost.

### Trigger types: Explicit, Implicit, Blocker

| Type | Effect on action |
|---|---|
| `Explicit` (default) | At least one explicit trigger must succeed for the action to fire |
| `Implicit` | All implicit triggers must succeed |
| `Blocker` | If this trigger succeeds, the action is blocked (overrides all others) |

Rules: if no triggers → fires whenever value is non-zero. If only implicits → all must fire.
If only explicits → any one must fire. Mixed → all implicits AND at least one explicit.

Source: `InputTriggers.h`:68–79 (`ETriggerType`); `InputAction.h`:156–163 (rule summary).

### ETriggerEvent transitions

| Event | State transition |
|---|---|
| `Started` | `None → Ongoing` or `None → Triggered` (first frame of activity) |
| `Ongoing` | `Ongoing → Ongoing` (in progress, conditions not yet fully met) |
| `Triggered` | Any → `Triggered` (conditions met this frame) |
| `Completed` | `Triggered → None` (was triggered, now released) |
| `Canceled` | `Ongoing → None` (was in progress, aborted before triggering) |

Source: `InputTriggers.h`:34–56 (`ETriggerEvent`).

### Built-in trigger classes

**Down** (`UInputTriggerDown`) — default behavior when no trigger is specified. Fires
`Triggered` every tick the input exceeds the actuation threshold.

**Pressed** (`UInputTriggerPressed`) — fires `Triggered` once on the first frame the threshold
is exceeded. Holding does not re-fire. Source: `InputTriggers.h`:249–264.

**Released** (`UInputTriggerReleased`) — fires `Triggered` once when input drops back below
the threshold (i.e. the key is released). Source: `InputTriggers.h`:268–283.

**Hold** (`UInputTriggerHold`) — fires `Triggered` after `HoldTimeThreshold` seconds of
continuous actuation. Set `bIsOneShot = false` to re-fire every frame once the threshold is
met. Source: `InputTriggers.h`:292–313.

**Hold And Release** (`UInputTriggerHoldAndRelease`) — fires `Triggered` when the key is
released after being held for at least `HoldTimeThreshold` seconds. Source: `InputTriggers.h`:320–332.

**Tap** (`UInputTriggerTap`) — fires `Triggered` if the key is pressed and released within
`TapReleaseTimeThreshold` seconds (default 0.2s). Source: `InputTriggers.h`:337–351.

**Repeated Tap** (`UInputTriggerRepeatedTap`) — fires `Triggered` after N taps within
`RepeatDelay` seconds (default `NumberOfTapsWhichTriggerRepeat = 2` → double-tap).
Source: `InputTriggers.h`:359–408.

**Pulse** (`UInputTriggerPulse`) — fires `Triggered` repeatedly at an `Interval` (seconds)
while the key is held. Optional `TriggerLimit` caps the number of fires (0 = unlimited).
Source: `InputTriggers.h`:416–443.

**Chorded Action** (`UInputTriggerChordAction`) — fires `Triggered` only when another action
(`ChordAction`) is also currently triggering. This is an `Implicit` trigger, so the chorded
action blocks the parent action when the chord is not met. Source: `InputTriggers.h`:452–473.

**Combo** (`UInputTriggerCombo`, Beta) — fires after a sequence of actions is completed in
order within per-step time windows. Source: `InputTriggers.h`:525–568.

### Authoring a custom trigger

```cpp
UCLASS(BlueprintType, EditInlineNew)
class UMyDoublePressFilter : public UInputTrigger
{
    GENERATED_BODY()
protected:
    virtual ETriggerState UpdateState_Implementation(
        const UEnhancedPlayerInput* PlayerInput,
        FInputActionValue ModifiedValue,
        float DeltaTime) override
    {
        // Return None, Ongoing, or Triggered based on your logic
        return IsActuated(ModifiedValue) ? ETriggerState::Triggered : ETriggerState::None;
    }
};
```

Add to a mapping's `Triggers[]` array in the IMC asset or construct one in C++ and push it to
the mapping via `UInputMappingContext::MapKey` before adding the context.

### Timed trigger base class

`UInputTriggerTimedBase` (`InputTriggers.h`:187) tracks `HeldDuration` automatically and
transitions to `Ongoing` on actuation. Subclass it for any hold-duration-based custom trigger;
override `UpdateState_Implementation` to determine when to return `Triggered`.

Property `bAffectedByTimeDilation` (default `false`): if `true`, the held duration uses the
owning PlayerController's actor time dilation.
