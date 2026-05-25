# Binding and Setup — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the full `BindAction` overload set, lambda
bindings, removing bindings, the `FInputActionInstance` handler signature, per-project class
defaults, and the world-subsystem for non-player actors. Grounded in UE 5.7
(`Engine/Plugins/EnhancedInput/Source/EnhancedInput/Public/`).

## Project Settings: default class configuration

Before Enhanced Input C++ code will work, the engine must use the enhanced component and
player input classes. Set in Project Settings → Engine → Input:

| Setting | Value |
|---|---|
| Default Player Input Class | `EnhancedPlayerInput` |
| Default Input Component Class | `EnhancedInputComponent` |

In C++ (for automated tests or plugin setup), set via `UInputSettings`:

```cpp
// Only needed if you cannot use Project Settings UI
UInputSettings* IS = GetMutableDefault<UInputSettings>();
IS->DefaultPlayerInputClass = UEnhancedPlayerInput::StaticClass();
IS->DefaultInputComponentClass = UEnhancedInputComponent::StaticClass();
IS->SaveConfig();
```

Without these settings, `Cast<UEnhancedInputComponent>(PlayerInputComponent)` returns null and
no Enhanced Input actions will fire.

## Build.cs dependency

```csharp
PrivateDependencyModuleNames.AddRange(new string[] { "EnhancedInput" });
```

Required headers pull from `Engine/Plugins/EnhancedInput/Source/EnhancedInput/Public/`.
Source: plugin Build.cs at
`Engine/Plugins/EnhancedInput/Source/EnhancedInput/EnhancedInput.Build.cs`.

## BindAction overloads

`UEnhancedInputComponent::BindAction` has four native overloads (plus a UFunction/dynamic form):

### 1. No-args handler

```cpp
// Handler takes no parameters — useful for simple one-shot actions
void AMyActor::OnJump() { /* ... */ }

EIC->BindAction(JumpAction, ETriggerEvent::Started, this, &AMyActor::OnJump);
```

Delegate signature: `FEnhancedInputActionHandlerSignature` (no parameters).
Source: `EnhancedInputComponent.h`:475.

### 2. Value handler (most common)

```cpp
void AMyActor::OnMove(const FInputActionValue& Value)
{
    FVector2D Dir = Value.Get<FVector2D>();
}
EIC->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AMyActor::OnMove);
```

Delegate signature: `FEnhancedInputActionHandlerValueSignature(const FInputActionValue&)`.
Source: `EnhancedInputComponent.h`:476.

### 3. Instance handler (richest — includes timing)

```cpp
void AMyActor::OnHold(const FInputActionInstance& Instance)
{
    float HeldFor = Instance.GetElapsedTime();   // seconds in Ongoing/Triggered
    FVector2D Val = Instance.GetValue().Get<FVector2D>();
}
EIC->BindAction(HoldAction, ETriggerEvent::Ongoing, this, &AMyActor::OnHold);
```

Delegate signature: `FEnhancedInputActionHandlerInstanceSignature(const FInputActionInstance&)`.
Source: `EnhancedInputComponent.h`:477.

### 4. UFUNCTION / dynamic form (for Blueprint-callable handlers)

```cpp
EIC->BindAction(Action, ETriggerEvent::Triggered, this, TEXT("MyBlueprintCallable"));
```

Signature: `DECLARE_DYNAMIC_DELEGATE_FourParams(FEnhancedInputActionHandlerDynamicSignature,
FInputActionValue, ActionValue, float, ElapsedTime, float, TriggeredTime, const UInputAction*,
SourceAction)` — the bound UFUNCTION must match this signature.
Source: `EnhancedInputComponent.h`:33, 482–488.

### Lambda binding

```cpp
EIC->BindActionValueLambda(MoveAction, ETriggerEvent::Triggered,
    [this](const FInputActionValue& Value)
    {
        AddMovementInput(GetActorForwardVector(), Value.Get<FVector2D>().Y);
    });

// Instance lambda (with timing data):
EIC->BindActionInstanceLambda(HoldAction, ETriggerEvent::Ongoing,
    [](const FInputActionInstance& Inst) { /* use Inst.GetElapsedTime() */ });
```

Source: `EnhancedInputComponent.h`:502–531.

## Removing a binding

`BindAction` returns a `FEnhancedInputActionEventBinding&`. Store the handle integer to remove
it later:

```cpp
FEnhancedInputActionEventBinding& Binding = EIC->BindAction(Action, ETriggerEvent::Triggered,
    this, &AMyActor::OnFire);
uint32 Handle = Binding.GetHandle();

// Later:
EIC->RemoveBindingByHandle(Handle);
// Or remove by reference:
EIC->RemoveBinding(Binding);
```

Source: `EnhancedInputComponent.h`:450–460.

## BindActionValue (polling)

When you want to poll the current value of an action each tick without a callback:

```cpp
FEnhancedInputActionValueBinding& ValueBinding = EIC->BindActionValue(MoveAction);

// In Tick or elsewhere:
FVector2D Dir = ValueBinding.GetValue().Get<FVector2D>();
```

This does not fire a delegate; it just keeps `CurrentValue` updated.
Source: `EnhancedInputComponent.h`:538–547.

## Possession / input setup sequence

The order of events for a Pawn possessed by a PlayerController:

1. `APlayerController::Possess(Pawn)` → calls `APawn::SetupPlayerInputComponent`.
2. `APawn::PawnClientRestart` → good place to push the mapping context (local player exists).
3. On unpossession: `APlayerController::UnPossess` → input component bindings cleared.

Use `PawnClientRestart` (not `BeginPlay`) if the pawn can be re-possessed:

```cpp
void AMyCharacter::PawnClientRestart()
{
    Super::PawnClientRestart();
    if (APlayerController* PC = Cast<APlayerController>(GetController()))
    {
        if (ULocalPlayer* LP = PC->GetLocalPlayer())
        {
            auto* Sub = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>();
            if (Sub) Sub->AddMappingContext(DefaultMappingContext, 0);
        }
    }
}
```

`BeginPlay` is safe for single-possession games. `PawnClientRestart` fires correctly both on
first possession and on respawn.

## World subsystem (non-player actors receiving input)

For actors without a PlayerController owner (e.g. an interactive prop or a door):

```cpp
// Requires bEnableWorldSubsystem = true in UEnhancedInputDeveloperSettings

// Enable input on the actor:
EnableInput(/* any valid PlayerController */);

// Get the world subsystem and register the actor's input component:
UEnhancedInputWorldSubsystem* WorldSub =
    GetWorld()->GetSubsystem<UEnhancedInputWorldSubsystem>();
WorldSub->AddActorInputComponent(this);  // this actor must have an active UInputComponent
```

The world subsystem has its own `UEnhancedPlayerInput` (configured via
`UEnhancedInputDeveloperSettings::DefaultWorldInputClass`) and processes key events from a
global `FEnhancedInputWorldProcessor` input preprocessor.

Source: `EnhancedInputSubsystems.h`:107–186 (`UEnhancedInputWorldSubsystem`).

## Input injection (testing / debug)

Inject input programmatically without physical device events:

```cpp
UEnhancedInputLocalPlayerSubsystem* Sub =
    LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>();

// Inject once this frame:
FInputActionValue Val(FVector2D(0.5f, 1.0f));
Sub->InjectInputForAction(MoveAction, Val, {}, {});

// Inject every tick until stopped:
Sub->StartContinuousInputInjectionForAction(MoveAction, Val, {}, {});
// ...
Sub->StopContinuousInputInjectionForAction(MoveAction);
```

Console equivalent: `Input.+key Gamepad_Left2D X=0.5 Y=1.0` / `Input.-key Gamepad_Left2D`.
Source: `EnhancedInputSubsystemInterface.h`:147–240.

## Debug commands

| Command | Effect |
|---|---|
| `showdebug enhancedinput` | Overlay showing active contexts, actions, and current values |
| `showdebug devices` | Overlay showing raw device state |
| `Input.+key <Key> [X=n Y=n Z=n]` | Inject a key press |
| `Input.-key <Key>` | Release an injected key |

These work in any non-shipping build.
