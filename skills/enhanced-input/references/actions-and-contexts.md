# Actions and Contexts — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UInputAction` value types and
accumulation, `UInputMappingContext` structure, priority, and runtime add/remove/query.
Grounded in UE 5.7 (`Engine/Plugins/EnhancedInput/Source/EnhancedInput/Public/`).

## UInputAction

`UInputAction` is a `UDataAsset` subclass. Each instance represents one logical player
capability (Jump, Move, Fire, Aim). Key properties:

| Property | Type | Purpose |
|---|---|---|
| `ValueType` | `EInputActionValueType` | `Boolean`, `Axis1D` (float), `Axis2D` (FVector2D), `Axis3D` (FVector) |
| `AccumulationBehavior` | `EInputActionAccumulationBehavior` | `TakeHighestAbsoluteValue` (default) or `Cumulative` |
| `bTriggerWhenPaused` | `bool` | Fire even when game is paused |
| `bConsumeInput` | `bool` | Block lower-priority contexts from seeing the same key |
| `Triggers[]` | `TArray<UInputTrigger*>` | Action-level triggers (applied after mapping-level triggers) |
| `Modifiers[]` | `TArray<UInputModifier*>` | Action-level modifiers (applied after mapping-level modifiers) |

Source: `InputAction.h`:87–145.

### Value types

```
EInputActionValueType::Boolean  → bool  (any non-zero component = true)
EInputActionValueType::Axis1D   → float (Value.X)
EInputActionValueType::Axis2D   → FVector2D (Value.X, Value.Y)
EInputActionValueType::Axis3D   → FVector
```

Source: `InputActionValue.h`:9–19. The underlying storage in `FInputActionValue` is always
`FVector` with unused components zeroed.

### Accumulation

When multiple key mappings in the active contexts point to the same action, Enhanced Input
accumulates their values each tick:

- `TakeHighestAbsoluteValue` (default): the mapping whose value has the largest magnitude
  wins per axis. Useful for exclusive bindings (keyboard + gamepad).
- `Cumulative`: values are summed. Useful for WASD (W pushes +Y, S pushes −Y; the sum is
  the net direction). Enable on the action asset's `AccumulationBehavior` property.

Source: `InputAction.h`:119–128 (`EInputActionAccumulationBehavior`).

## UInputMappingContext

`UInputMappingContext` is a `UDataAsset` subclass holding an ordered list of
`FEnhancedActionKeyMapping` entries. Each mapping binds one `FKey` to one `UInputAction`,
with optional per-mapping `Modifiers[]` and `Triggers[]`.

Key 5.7 change: the `Mappings` property is **deprecated** (`UE_DEPRECATED(5.7)`) and replaced
by the `DefaultKeyMappings` struct (`FInputMappingContextMappingData`). Avoid writing C++ that
accesses `Mappings` directly; use the asset editor or call `GetMappings()` (which forwards to
`DefaultKeyMappings.Mappings`).

Source: `InputMappingContext.h`:87–243; `DefaultKeyMappings`:101; deprecated `Mappings`:94.

### Per-mapping modifier and trigger order

Processing pipeline for one key press:

1. Raw key value from the input device.
2. Mapping-level `Modifiers[]` applied in array order.
3. Mapping-level `Triggers[]` evaluated.
4. Action-level `Modifiers[]` applied (from the `UInputAction` asset).
5. Action-level `Triggers[]` evaluated.
6. Resulting `FInputActionValue` and `ETriggerEvent` delivered to bound handlers.

Source: `EnhancedActionKeyMapping.h`:85–91 (mapping modifiers applied before action modifiers).

## Priority and context switching

`AddMappingContext` takes an `int32 Priority`. Active contexts are processed from highest to
lowest priority. Within one priority level, the first context to map a key wins when
`bConsumeInput` is set on the action.

### Adding and removing contexts

```cpp
// Via PlayerController:
ULocalPlayer* LP = GetLocalPlayer();
auto* Subsys = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>();
Subsys->AddMappingContext(VehicleIMC, /*Priority*/ 10);

// Remove when exiting vehicle:
Subsys->RemoveMappingContext(VehicleIMC);

// Query whether a context is applied:
bool bActive = Subsys->HasMappingContext(VehicleIMC);
```

Source: `EnhancedInputSubsystemInterface.h`:258–270 (`AddMappingContext`, `RemoveMappingContext`);
`HasMappingContext`:363.

### FModifyContextOptions

The optional third parameter to `AddMappingContext` and `RemoveMappingContext`:

```cpp
FModifyContextOptions Opts;
Opts.bIgnoreAllPressedKeysUntilRelease = false;  // default: true
Opts.bForceImmediately = true;   // apply this frame, not end-of-frame
Opts.bNotifyUserSettings = true; // register with UEnhancedInputUserSettings
Subsys->AddMappingContext(IMC, Priority, Opts);
```

`bIgnoreAllPressedKeysUntilRelease` (default `true`) prevents instant-fire of already-held
keys when a new context is added — important to avoid jump firing immediately when entering a
vehicle that maps jump to the same key as a vehicle action.

Source: `EnhancedInputSubsystemInterface.h`:47–100.

### Context switching pattern (on-foot ↔ vehicle)

```cpp
// BeginPlay / possession: push default on-foot context
Subsys->AddMappingContext(FootIMC, 0);

// Entering vehicle:
Subsys->RemoveMappingContext(FootIMC);
Subsys->AddMappingContext(VehicleIMC, 0);

// Or use priority to overlay (vehicle wins, foot still partially active):
Subsys->AddMappingContext(VehicleIMC, /*Priority*/ 5);
// Remove vehicle context on exit — foot remains at priority 0
```

## Player mappable input (remapping support)

Mark a mapping as player-remappable by assigning a `UPlayerMappableKeySettings` instance on
the `FEnhancedActionKeyMapping` (set `SettingBehavior = OverrideSettings`) or on the
`UInputAction` asset. The `UEnhancedInputUserSettings` subsystem (opt-in via
`UEnhancedInputDeveloperSettings::bEnableUserSettings`) manages per-user remapping and
persistence.

Source: `EnhancedActionKeyMapping.h`:121–133; `InputAction.h`:151–153.

## FInputActionInstance

When you bind a handler with the `const FInputActionInstance&` signature, you get richer
per-frame data beyond just the value:

```cpp
EIC->BindAction(Action, ETriggerEvent::Triggered, this, &AMyClass::OnAction);

void AMyClass::OnAction(const FInputActionInstance& Instance)
{
    FInputActionValue Val    = Instance.GetValue();       // current value
    ETriggerEvent     Event  = Instance.GetTriggerEvent(); // Triggered/Started/etc.
    float             Held   = Instance.GetElapsedTime(); // seconds in Ongoing/Triggered
    float             Trig   = Instance.GetTriggeredTime(); // seconds in Triggered only
}
```

Source: `InputAction.h`:196–271 (`FInputActionInstance` member functions).
