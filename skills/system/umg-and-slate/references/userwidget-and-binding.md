# UUserWidget lifecycle and BindWidget — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the full `UUserWidget` lifecycle callback
order, the internals of `BindWidget`/`BindWidgetOptional`/`BindWidgetAnim`, the
`NativeOnInitialized` vs `NativeConstruct` distinction, widget ownership by the
`GameViewportSubsystem`, and common initialization pitfalls. Grounded in UE 5.7
(`Engine/Source/Runtime/UMG/Public/Blueprint/UserWidget.h`).

## Full lifecycle order

When a `UUserWidget` subclass is used as a Widget Blueprint, the sequence from class load
to teardown is:

1. **Class construction (CDO)** — object initialized; no world, no viewport. Avoid gameplay
   logic here.
2. **`Initialize()`** (internal, `UserWidget.h`:300) — called once per instance when
   `CreateWidget` constructs the widget. Resolves the widget tree and calls
   **`NativeOnInitialized()`**.
3. **`NativeOnInitialized()`** (`UserWidget.h`:1574) — runs after the widget tree is
   assembled and `BindWidget` pointers are populated. Safe for one-time setup that does not
   need a visible widget or world context (e.g. sub-widget ref caching, non-gameplay delegate
   registration). Runs **before** the widget is ever shown.
4. **`NativePreConstruct()`** (`UserWidget.h`:1575) — runs in the editor designer and on
   every Blueprint compile. Used for design-time preview; do not do gameplay work here.
5. **`NativeConstruct()`** (`UserWidget.h`:1576) — called when the widget is added to the
   viewport/player screen (i.e. when it becomes visible). Analogous to `BeginPlay`. Bind
   `OnClicked`, start timers, read game state.
6. **`NativeTick(Geometry, DeltaTime)`** (`UserWidget.h`:1578) — called each frame if ticking
   is enabled (see Tick section below).
7. **`NativeDestruct()`** (`UserWidget.h`:1577) — called when the widget is removed from the
   viewport. Clean up delegates, timers, and any resources created in `NativeConstruct`.

`NativeConstruct`/`NativeDestruct` can be called multiple times if the same widget instance
is added and removed from the viewport repeatedly. `NativeOnInitialized` fires only once per
instance.

## BindWidget internals

`meta=(BindWidget)` is validated by `UWidgetBlueprintGeneratedClass` at Blueprint compile and
at asset load time. The metadata keys are declared in `Widget.h` (`UMWidget` namespace):
- `BindWidget` (:69) — property is required; a missing or type-mismatched widget in the
  Blueprint is a compile error.
- `BindWidgetOptional` (:73) / `OptionalWidget=true` (:77) — property is allowed to be null;
  always null-check before use.
- `BindWidgetAnim` (:82) — binds a `UWidgetAnimation*`; requires `Transient` specifier on
  the `UPROPERTY` so it is not serialized separately.
- `BindWidgetAnimOptional` (:85) — optional animation binding.

The C++ variable name must match the Blueprint widget's **Name** field (visible in the
designer's Details panel) case-sensitively. The type must match or be a parent class.

```cpp
// Correct:
UPROPERTY(meta=(BindWidget))
TObjectPtr<UButton> StartButton;      // Blueprint widget named exactly "StartButton"

UPROPERTY(meta=(BindWidgetAnim), Transient)
TObjectPtr<UWidgetAnimation> SlideIn; // Blueprint animation named "SlideIn"

// Safely optional — null if widget not in BP:
UPROPERTY(meta=(BindWidgetOptional))
TObjectPtr<UImage> BackgroundImage;
```

## NativeOnInitialized vs NativeConstruct

A common mistake is to do all setup in `NativeConstruct` and none in `NativeOnInitialized`.
The distinction:

| | `NativeOnInitialized` | `NativeConstruct` |
|---|---|---|
| When | Once, right after `CreateWidget` | Each time added to viewport |
| World available? | Depends on owner — yes if owner is world/PC | Yes |
| Widget tree ready? | Yes — `BindWidget` pointers are valid | Yes |
| Use for | One-time caching, static delegate registration | Per-show setup, dynamic data |

Prefer `NativeOnInitialized` for any setup that only needs to happen once per widget
instance lifetime; `NativeConstruct` for anything that depends on the current game state
when the widget becomes visible.

## Ticking

`UUserWidget` carries `UCLASS(meta=(DisableNativeTick))` by default (`UserWidget.h`:282).
Tick only runs if:
- The widget has a Blueprint Tick event or latent Blueprint nodes, **or**
- You override `NativeTick` in C++ (which automatically opts in), **and**
- `TickFrequency` is `EWidgetTickFrequency::Auto` (`UserWidget.h`:119).

Tick has a measurable per-widget cost on many active widgets. Prefer timer-based or push-based
updates. If you need ticking, override `NativeTick` and call `Super::NativeTick` first.

```cpp
virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override
{
    Super::NativeTick(MyGeometry, InDeltaTime);
    // per-frame logic here
}
```

## CreateWidget and ownership

`CreateWidget<T>` (`UserWidget.h`:1811) accepts these owner types:
- `UWorld*` — widget owned by the world; any player can see it via `AddToViewport`.
- `APlayerController*` — widget owned by that player; use `AddToPlayerScreen` for split-screen.
- `UGameInstance*` — persists across level transitions.
- `UWidget*` or `UWidgetTree*` — nested widget creation within another widget.

The `FName WidgetName` parameter is optional and primarily useful for debugging (it becomes the
widget's object name).

## GameViewportSubsystem

Since UE 5.1, viewport management is delegated to `UGameViewportSubsystem`
(`Blueprint/GameViewportSubsystem.h`). `AddToViewport` and `RemoveFromParent` on
`UUserWidget` route through this subsystem. Direct use is rarely needed but is available
for advanced viewport layout (anchor presets, full-screen offsets).

## Widget animations

`UWidgetAnimation` referenced via `BindWidgetAnim` can be played from C++:

```cpp
// Declared with meta=(BindWidgetAnim), Transient
if (SlideIn)
{
    PlayAnimation(SlideIn);
    // PlayAnimation(SlideIn, 0.f, 1, EUMGSequencePlayMode::Forward, 1.f, false);
}
```

`PlayAnimation` returns a `FWidgetAnimationHandle` (UE 5.5+); the legacy
`UUMGSequencePlayer*` return is deprecated.

## Version notes

- `NativeOnInitialized` available since UE 4.17; stable in 5.x.
- `UUMGSequencePlayer` and its return from `PlayAnimation` deprecated in 5.5; replaced by
  `FWidgetAnimationHandle` / `FWidgetAnimationState`.
- Direct property access on `UTextBlock` (`Text`, `ColorAndOpacity`) deprecated in 5.1; use
  `GetText()`/`SetText()`. Same for `UButton` style/color in 5.2.
