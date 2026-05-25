# UWidgetComponent and input management — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UWidgetComponent` configuration for
world-space and screen-space UI, `UWidgetInteractionComponent` for player interaction with
3D widgets, input mode management on `APlayerController`, and focus/navigation for menus.
Grounded in UE 5.7 (`Engine/Source/Runtime/UMG/Public/Components/WidgetComponent.h`).

## UWidgetComponent overview

`UWidgetComponent` (`WidgetComponent.h`:94) is a `UMeshComponent` that renders a
`UUserWidget` to a `UTextureRenderTarget2D`, then projects the result onto a quad or cylinder
in the 3D world. It handles its own tick to keep the render target synchronized with widget
state.

### Space modes

Controlled by `EWidgetSpace` (`WidgetComponent.h`:24):

| `EWidgetSpace` | Behavior |
|---|---|
| `World` | Rendered as a mesh in the 3D world; occluded by geometry; affected by lighting (with correct material). |
| `Screen` | Rendered directly to screen space after projection; never occluded; ignores 3D position (uses screen-space anchor). |

```cpp
InteractPrompt->SetWidgetSpace(EWidgetSpace::World);
InteractPrompt->SetDrawSize(FVector2D(300.f, 100.f)); // render target resolution
```

### Tick modes

`ETickMode` (`WidgetComponent.h`:70):
- `Disabled` — component never ticks (use for truly static widgets).
- `Enabled` — always ticks.
- `Automatic` — ticks only when the widget is visible (default; usually correct).

### Blend modes

`EWidgetBlendMode` (`WidgetComponent.h`:41):
- `Opaque` — no transparency.
- `Masked` — clip by alpha.
- `Transparent` — alpha blending (most common for UI quads).

### Full setup in C++

```cpp
// Actor .h:
UPROPERTY(EditAnywhere, Category="UI")
TSubclassOf<UUserWidget> PromptWidgetClass;

UPROPERTY(VisibleAnywhere, Category="UI")
TObjectPtr<UWidgetComponent> PromptComponent;

// Actor constructor:
PromptComponent = CreateDefaultSubobject<UWidgetComponent>(TEXT("PromptWidget"));
PromptComponent->SetupAttachment(RootComponent);
PromptComponent->SetWidgetSpace(EWidgetSpace::World);
PromptComponent->SetDrawSize(FVector2D(400.f, 150.f));
PromptComponent->SetBlendMode(EWidgetBlendMode::Transparent);
PromptComponent->SetWidgetClass(PromptWidgetClass);

// Actor BeginPlay — access the live instance:
void AMyActor::BeginPlay()
{
    Super::BeginPlay();
    if (UUserWidget* W = PromptComponent->GetWidget())  // WidgetComponent.h:206
    {
        // Cast and call typed methods:
        if (UMyPromptWidget* Prompt = Cast<UMyPromptWidget>(W))
        {
            Prompt->SetPromptText(FText::FromString(TEXT("Press [E] to interact")));
        }
    }
}
```

`InitWidget()` (`WidgetComponent.h`:134) is called automatically on `BeginPlay`; it
`CreateWidget`s the instance if not already done. Call `SetWidgetClass` before `BeginPlay`
or before `InitWidget` if setting it at runtime.

## UWidgetInteractionComponent

For player interaction with world-space widgets (clicks, hover, scroll):
- Add a `UWidgetInteractionComponent` to the player pawn or camera.
- Set `InteractionSource` to `EWidgetInteractionSource::World` (line trace) or `Custom`
  (supply your own hit result).
- Call `PressPointerKey(EKeys::LeftMouseButton)` / `ReleasePointerKey(...)` in response to
  player input (e.g. from `enhanced-input` actions) to forward clicks to the hovered widget.

```cpp
// Pawn constructor:
WidgetInteraction = CreateDefaultSubobject<UWidgetInteractionComponent>(TEXT("WidgetInteraction"));
WidgetInteraction->SetupAttachment(CameraComponent);
WidgetInteraction->InteractionDistance = 500.f;

// On player "use" input press/release:
WidgetInteraction->PressPointerKey(EKeys::LeftMouseButton);
WidgetInteraction->ReleasePointerKey(EKeys::LeftMouseButton);
```

## Input mode on APlayerController

Plain UMG widgets do not receive keyboard/gamepad input unless the `PlayerController` is in
a UI-aware input mode and the widget has focus. Three mutually exclusive input mode structs:

| Function | Mouse cursor | Game input | UI input |
|---|---|---|---|
| `SetInputModeUIOnly(FInputModeUIOnly)` | Locked to widget | None | Full |
| `SetInputModeGameAndUI(FInputModeGameAndUI)` | Optional lock | Yes | Yes |
| `SetInputModeGameOnly(FInputModeGameOnly)` | Hidden | Full | None |

```cpp
// Show a pause menu:
FInputModeUIOnly Mode;
Mode.SetWidgetToFocus(PauseMenu->TakeWidget());  // TakeWidget() gets the SWidget
Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
PlayerController->SetInputModeUIOnly(Mode);
PlayerController->SetShowMouseCursor(true);

// Close the menu:
PlayerController->SetInputModeGameOnly();
PlayerController->SetShowMouseCursor(false);
```

`TakeWidget()` on a `UUserWidget` returns the underlying `TSharedRef<SWidget>` and is safe
to pass to `SetWidgetToFocus`.

## Focus and navigation

- `UWidget::SetUserFocus(PlayerController)` — programmatically focus a specific widget.
- Override `NativeSupportsKeyboardFocus()` → `return true;` on a `UUserWidget` to allow it to
  receive keyboard focus (`UserWidget.h`:1590).
- Override `NativeOnFocusReceived` / `NativeOnFocusLost` (`UserWidget.h`:1593-1594) for
  per-widget focus response.
- `UWidgetNavigation` on each widget controls which neighbor receives focus when the
  player presses directional input — configurable in the Blueprint designer or via
  `UWidget::SetNavigation`.

For production menus and gamepad navigation, use CommonUI instead (see
[../SKILL.md](../SKILL.md)). CommonUI's `UCommonActivatableWidget` handles focus routing
automatically through the active-widget stack.

## Cursor visibility helpers

```cpp
// Show/hide cursor without changing full input mode:
PlayerController->bShowMouseCursor = true;
PlayerController->bEnableClickEvents = true;
PlayerController->bEnableMouseOverEvents = true;
```

Avoid directly setting these booleans in production — prefer the `SetInputMode*` structs
which manage them atomically.

## Gotchas

- **`GetWidget()` returns null** until `InitWidget()` has run (after `BeginPlay` or explicit
  call). Do not access the widget instance in the constructor.
- **DrawSize zero** — the render target is not created if `DrawSize` is `(0, 0)`; always set
  a non-zero draw size before the component registers.
- **World-space widget invisible** — check that the actor's collision channel does not block
  the trace from `UWidgetInteractionComponent`, and that the widget component's material
  supports the intended blend mode.
- **`SetInputModeUIOnly` without `SetWidgetToFocus`** — the widget receives input but may not
  visually highlight the initially focused element; always set `WidgetToFocus`.
- **Forgetting `RemoveFromParent` on level transition** — widgets added to the viewport
  persist unless explicitly removed; tie their lifetime to the owning object's `EndPlay`.
