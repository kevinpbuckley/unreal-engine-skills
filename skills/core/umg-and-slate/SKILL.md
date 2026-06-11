---
name: umg-and-slate
description: Build game UI in Unreal — UMG user widgets (UUserWidget) with the C++ lifecycle
  (NativeOnInitialized, NativeConstruct, NativeDestruct, NativeTick), the widget tree and
  common leaf/panel widgets (UButton/UTextBlock/UImage/UProgressBar/UCanvasPanel/UHorizontalBox/
  UVerticalBox/UOverlay), the meta=(BindWidget/BindWidgetOptional) pattern to wire C++ to
  Blueprint-designed widgets, CreateWidget + AddToViewport / RemoveFromParent, UWidgetComponent
  for 3D in-world UI, event binding (OnClicked AddDynamic), the Slate layer (SWidget,
  SCompoundWidget, declarative syntax), and CommonUI for input-routed multiplatform menus —
  plus UI best practices and performance optimization: invalidation boxes/retainer boxes/
  volatility, widget pooling (FUserWidgetPool, ListView), event-driven updates instead of
  property bindings or Tick, Canvas Panel nesting rules, animation cost tiers, MVVM
  viewmodels (FieldNotify), CommonUI layer stacks (the Lyra pattern), DPI scaling, and safe
  zones. Use when creating HUDs/menus/inventory/widgets, wiring UI to gameplay in C++,
  handling button/input events, choosing UMG vs Slate vs CommonUI, debugging BindWidget name
  mismatches, optimizing slow UI, or architecting screen flow for a production game.
metadata:
  engine-version: "5.7"
  category: ui
---

# UMG & Slate

**UMG** is Unreal's widget-based UI framework: a Widget Blueprint pairs with a C++
`UUserWidget` subclass that holds logic, while the Blueprint handles layout and styling.
Underneath sits **Slate**, the lower-level C++ UI framework. Prefer UMG for game UI and
**CommonUI** for anything with menus or multiplatform input routing.

## When to use this skill

- Creating a HUD, menu, inventory screen, or any on-screen UI.
- Wiring UMG widgets to gameplay data or handling button/input events in C++.
- Choosing how to create, show, and hide widgets at runtime.
- Building a 3D in-world widget on an actor (`UWidgetComponent`).
- Deciding between UMG, raw Slate, or CommonUI.
- Diagnosing or preventing UI performance problems (draw calls, per-frame cost, hitches).
- Structuring screens/menus for a real game (layer stacks, MVVM, resolution independence).

## Mental model

- **`UUserWidget`** — the C++ base for every Widget Blueprint. Holds logic, references to
  child widgets, and lifecycle callbacks.
- **Widget tree** — a `UWidgetTree` (`WidgetTree.h`) owns all `UWidget` instances that make up
  the layout of a `UUserWidget`.
- **`UWidget`** (`Widget.h`) — base of all UMG leaf and panel widgets; wraps a Slate `SWidget`.
- **Slate** — the lower platform-level framework. `SWidget` (SlateCore) → `SCompoundWidget` →
  specialized widgets. UMG wraps Slate; you only author Slate for editor tools or bespoke widgets.

## UUserWidget lifecycle

Declare in `UserWidget.h`:1574-1578.

| Callback | When | Put here |
|---|---|---|
| `NativeOnInitialized()` | Once, after the widget object is constructed and the widget tree is built — before it is ever shown. | One-time setup that does not need a world (register non-world delegates, cache sub-widget refs). |
| `NativePreConstruct()` | Every time the Widget Blueprint CDO is compiled or the designer refreshes. | Design-time preview work only. |
| `NativeConstruct()` | Widget is added to the viewport / displayed — analogous to `BeginPlay`. | Bind `OnClicked`, start timers, fetch game state. |
| `NativeDestruct()` | Widget is removed from the viewport. | Clean up delegates/timers. |
| `NativeTick(Geometry, DeltaTime)` | Per frame — only if tick is needed. | Per-frame updates (prefer push-based updates instead). |

`UUserWidget` has `meta=(DisableNativeTick)` on its `UCLASS` by default; override
`NativeTick` only when genuinely needed or enable ticking explicitly.

## The BindWidget pattern (core technique)

`meta=(BindWidget)` tells UMG that a `UPROPERTY` in C++ maps to a widget of the same name
in the Widget Blueprint. The Blueprint compiler validates the name match at load time.

```cpp
// MyHUDWidget.h
#pragma once
#include "Blueprint/UserWidget.h"
#include "MyHUDWidget.generated.h"

class UButton;
class UTextBlock;
class UProgressBar;

UCLASS()
class MYGAME_API UMyHUDWidget : public UUserWidget
{
    GENERATED_BODY()

protected:
    virtual void NativeConstruct() override;
    virtual void NativeDestruct() override;

    // Name in BP designer must match exactly:
    UPROPERTY(meta=(BindWidget))
    TObjectPtr<UButton>      StartButton;   // required — compile error if absent in BP

    UPROPERTY(meta=(BindWidget))
    TObjectPtr<UTextBlock>   ScoreText;

    UPROPERTY(meta=(BindWidgetOptional))
    TObjectPtr<UProgressBar> HealthBar;     // optional — null if not in BP, no error

    // Bound anim (Blueprint-authored UMG animation):
    UPROPERTY(meta=(BindWidgetAnim), Transient)
    TObjectPtr<UWidgetAnimation> FadeInAnim;

    UFUNCTION()
    void OnStartClicked();

public:
    void SetScore(int32 Score);
    void SetHealthPercent(float Percent);   // 0..1
};
```

```cpp
// MyHUDWidget.cpp
#include "MyHUDWidget.h"
#include "Components/Button.h"
#include "Components/TextBlock.h"
#include "Components/ProgressBar.h"

void UMyHUDWidget::NativeConstruct()
{
    Super::NativeConstruct();
    if (StartButton)
    {
        StartButton->OnClicked.AddDynamic(this, &UMyHUDWidget::OnStartClicked);
    }
}

void UMyHUDWidget::NativeDestruct()
{
    if (StartButton)
    {
        StartButton->OnClicked.RemoveDynamic(this, &UMyHUDWidget::OnStartClicked);
    }
    Super::NativeDestruct();
}

void UMyHUDWidget::OnStartClicked()
{
    // handle click
}

void UMyHUDWidget::SetScore(int32 Score)
{
    if (ScoreText)
    {
        ScoreText->SetText(FText::AsNumber(Score));  // FText for display/localization
    }
}

void UMyHUDWidget::SetHealthPercent(float Percent)
{
    if (HealthBar)
    {
        HealthBar->SetPercent(FMath::Clamp(Percent, 0.f, 1.f));
    }
}
```

Key rules:
- The C++ variable name **must** equal the widget name in the Blueprint designer; any mismatch
  is a load/compile error (use `BindWidgetOptional` if the widget may not exist).
- `OnClicked` is a `UPROPERTY(BlueprintAssignable)` dynamic multicast delegate on `UButton`
  (`Button.h`:76); the bound function must be a `UFUNCTION()`.
- Remove `AddDynamic` bindings in `NativeDestruct` to prevent stale delegates.

## Creating and showing widgets at runtime

```cpp
// In a PlayerController or HUD:
UPROPERTY(EditAnywhere, Category="UI")
TSubclassOf<UMyHUDWidget> HUDWidgetClass;   // assign the Widget BP in the editor

UPROPERTY()
TObjectPtr<UMyHUDWidget> HUDWidget;

void AMyPlayerController::BeginPlay()
{
    Super::BeginPlay();

    // CreateWidget<T>(owner, class) — owner can be World, PlayerController, or GameInstance
    HUDWidget = CreateWidget<UMyHUDWidget>(this, HUDWidgetClass);
    if (HUDWidget)
    {
        HUDWidget->AddToViewport();          // ZOrder 0 by default
        // HUDWidget->AddToPlayerScreen();   // split-screen: add to a player's viewport slice
    }
}

void AMyPlayerController::HideHUD()
{
    if (HUDWidget)
    {
        HUDWidget->RemoveFromParent();       // hides; does not destroy (still held by UPROPERTY)
    }
}
```

- `CreateWidget` is a templated free function (`UserWidget.h`:1811); it accepts a `UWorld*`,
  `APlayerController*`, `UGameInstance*`, `UWidget*`, or `UWidgetTree*` as owner.
- Hold widget pointers in a `UPROPERTY()` — without it the GC destroys the widget even if it
  is displayed (`memory-and-gc`).
- `RemoveFromViewport` is deprecated since 5.1; use `RemoveFromParent()` instead.

## Data binding & update strategy

| Approach | When |
|---|---|
| **Push setters** (recommended) | Call `SetScore()`/`SetHealthPercent()` from gameplay code when data changes — zero per-frame cost. |
| **UMG Property Binding** (legacy) | A function returning a value bound in the editor; re-evaluates every frame — avoid for many widgets. |
| **MVVM Viewmodel plugin** | Declare `UMVVMViewModelBase` with `FieldNotify` properties; view bindings update only on change. Best for larger data-driven UIs (UE 5.1+, still Beta in 5.7). |

Epic's hard rule: **never raw property bindings** — they poll every frame per widget.
Drive updates from gameplay delegates, and pull initial state once in `NativeConstruct`.
Full MVVM walkthrough (FieldNotify, `UE_MVVM_SET_PROPERTY_VALUE`, viewmodel design):
[references/architecture-and-authoring.md](references/architecture-and-authoring.md).

## Performance best practices (summary)

The rules agents most often need — deep dive with engine citations in
[references/performance-and-best-practices.md](references/performance-and-best-practices.md):

- **One Canvas Panel at the root is fine; never nest Canvas Panels** inside reusable
  widgets (each canvas child gets its own layer ID → extra draw calls, broken batching).
  Build templates from `Overlay`/`HorizontalBox`/`VerticalBox`/`GridPanel`.
- **No Tick, no OnPaint, no property bindings** — event-driven updates only.
- Wrap rarely-changing subtrees in **`UInvalidationBox`**; mark per-frame widgets
  **Volatile**; reach for **`URetainerBox`** (phased render-to-texture) only after that.
- **Pool dynamic entries**: `UListView`/`UTileView` (virtualized + pooled) for lists,
  `FUserWidgetPool` for damage numbers/markers/toasts.
- **Hidden widgets still load and construct** — every `WidgetSwitcher` page, every
  `TSubclassOf` reference. Delete unused widgets; async-load rare screens via soft refs.
- Prefer **`Collapsed`** over `Hidden` (skips layout); set decorative widgets to
  **`HitTestInvisible`**; don't call `SetVisibility`/`FText::Format` per frame.
- **`USpacer` over `USizeBox`** for spacing; **never Scale Box + Size Box together**
  (per-frame layout flip-flop); **Rich Text only when really needed**.
- Animation cost tiers: **material animation > BP tween > Sequencer anim > anything
  that changes layout**.
- Profile with `stat Slate`, Widget Reflector (Ctrl+Shift+W), `Slate.ShowBatching`,
  `stat dumpframe -ms=0.1`.

## Input, focus, and input mode

- Override `NativeOnKeyDown`, `NativeOnMouseButtonDown`, etc. for per-widget input handling.
- For menus: switch input mode on the `PlayerController` via
  `SetInputModeUIOnly`/`SetInputModeGameAndUI`/`SetInputModeGameOnly` and toggle the cursor.
- For gamepad/multiplatform menus, see CommonUI below — plain UMG focus is painful to
  manage manually across platforms.

## UWidgetComponent — 3D in-world widgets

`UWidgetComponent` (`WidgetComponent.h`:94) is a `UMeshComponent` that renders a
`UUserWidget` onto a render target, then displays it on a plane or cylinder in 3D space.

```cpp
// In an actor's .h:
UPROPERTY(VisibleAnywhere)
TObjectPtr<UWidgetComponent> InteractPrompt;

// In constructor:
InteractPrompt = CreateDefaultSubobject<UWidgetComponent>(TEXT("InteractPrompt"));
InteractPrompt->SetupAttachment(RootComponent);
InteractPrompt->SetWidgetClass(PromptWidgetClass);   // TSubclassOf<UUserWidget>
InteractPrompt->SetDrawSize(FVector2D(200.f, 80.f));
InteractPrompt->SetWidgetSpace(EWidgetSpace::World); // World or Screen
```

Access the live widget instance at runtime: `InteractPrompt->GetWidget()`.
For player interaction with 3D widgets, pair with `UWidgetInteractionComponent`.

## CommonUI (recommended for production menus)

The **CommonUI** plugin (`Engine/Plugins/Runtime/CommonUI/`) builds on UMG for structured,
multiplatform UI:
- **`UCommonUserWidget`** — `UUserWidget` + input-action binding (`CommonUserWidget.h`:21).
- **`UCommonActivatableWidget`** — adds activate/deactivate semantics and a back-navigation
  stack; the widget can turn on/off without being removed from the hierarchy
  (`CommonActivatableWidget.h`:43).
- **Input routing** — only the topmost active activatable widget in a layer receives input;
  no need to manually manage focus across multiple overlapping menus.
- **Style assets** — `UCommonButtonBase`, `UCommonTextBlock`, etc., separate style data from
  widget instances, making platform-specific theming practical.

Use CommonUI for any UI with menus, modals, or gamepad navigation. Base game-HUD widgets
on `UCommonUserWidget`; base menus on `UCommonActivatableWidget`.

**Screen architecture — layer stacks (the Lyra pattern):** production games register one
root layout with named layers, each a `UCommonActivatableWidgetStack` (or `...Queue` for
modals) — e.g. `UI.Layer.Game` / `GameMenu` / `Menu` / `Modal` in Lyra's
`PrimaryGameLayout`. Screens are pushed/popped by layer tag instead of `AddToViewport`,
which gives correct Z-order, input routing to the topmost active widget, and free
back-button handling. Details and best practices:
[references/architecture-and-authoring.md](references/architecture-and-authoring.md).

## Slate layer (when and how)

UMG wraps Slate. For **editor tools** and highly bespoke widgets not achievable in UMG,
author Slate directly.

```cpp
// Minimal SCompoundWidget subclass — editor tool or plugin UI:
class SMyPanel : public SCompoundWidget
{
public:
    SLATE_BEGIN_ARGS(SMyPanel) {}
        SLATE_ARGUMENT(FText, LabelText)
    SLATE_END_ARGS()

    void Construct(const FArguments& InArgs)
    {
        ChildSlot
        [
            SNew(STextBlock).Text(InArgs._LabelText)
        ];
    }
};
```

Core Slate types:
- `SWidget` (`SlateCore/Public/Widgets/SWidget.h`) — base; pure abstract (`OnPaint`:1650,
  `ComputeDesiredSize`:731, `GetChildren`:856).
- `SCompoundWidget` (`SCompoundWidget.h`) — single `ChildSlot`; base for most authored widgets.
- `SLeafWidget` — no children; for custom-drawn leaf elements.
- `SNew(WidgetType)` / `SAssignNew(Ptr, WidgetType)` — declarative construction macros
  (`DeclarativeSyntaxSupport.h`:37).

For game UI, stay in UMG/CommonUI — Slate skips `UPROPERTY`/GC and needs more boilerplate.

## Gotchas

- **`BindWidget` name mismatch** — the C++ variable name must match the Blueprint widget name
  exactly; a mismatch is a compiler/load error. Use `BindWidgetOptional` if the widget may be
  absent. (`Widget.h`:69-74).
- **Widget not in a `UPROPERTY`** — the GC destroys it even if still displayed; always hold
  in a `UPROPERTY()` member.
- **`RemoveFromViewport` deprecated** (5.1+) — use `RemoveFromParent()`.
- **Per-frame property bindings** across many widgets → significant CPU cost; push updates
  from gameplay instead.
- **Canvas Panels nested inside reusable widgets** — each canvas child gets its own layer
  ID → extra draw calls across the whole screen. One canvas at the root only; templates
  use Overlay/boxes.
- **Scale Box wrapping a Size Box** (or vice versa) — the two fight over desired size and
  can flip layout every frame; let content size itself or pick one.
- **Calling `SetVisibility` every frame** — it's surprisingly expensive (can invalidate
  layout); only call on actual state change. Prefer `Collapsed` over `Hidden`, and
  `HitTestInvisible` for decorations.
- **Hidden widgets still load and construct** — unused widgets in the tree and every page
  of a `WidgetSwitcher` pay full load/construct cost; delete leftovers, async-load rare
  screens.
- **Create/destroy churn for dynamic entries** — use `UListView` or `FUserWidgetPool`
  instead; with `FUserWidgetPool`, call `ReleaseAllSlateResources()` from the owner's
  `ReleaseSlateResources` or the pool leaks via circular refs.
- **`OnClicked` handler not a `UFUNCTION()`** — `AddDynamic` silently fails; the bound method
  must be marked `UFUNCTION()` with the matching signature.
- **Forgetting `SetInputMode`/cursor** — menus added to viewport that don't receive clicks
  usually have the wrong input mode on the owning `PlayerController`.
- **Gamepad/focus pain with plain UMG** — use CommonUI for structured input routing across
  menus and platforms (`enhanced-input` for input-action integration).
- **Building display text with `FString`** — use `FText::AsNumber`, `FText::Format`, etc. for
  localization (`core-types-and-containers`).
- **`WidgetComponent` not visible** — ensure `DrawSize` is non-zero and collision/visibility
  settings are correct; `EWidgetSpace::Screen` ignores world occlusion.
- **`NativeTick` never called** — `UUserWidget` has `DisableNativeTick` by default; the tick
  only runs if you override `NativeTick` and the widget has latent actions or Blueprint tick
  is set to `Auto` (`EWidgetTickFrequency`:`UserWidget.h`:120).

## Version notes

- `RemoveFromViewport` deprecated in 5.1; replaced by `RemoveFromParent` (from `UWidget`).
- `UTextBlock`/`UButton` direct property access deprecated in 5.1/5.2 respectively; use
  getter/setter methods (`GetText()`/`SetText()`, `GetStyle()`/`SetStyle()`).
- UMG Viewmodel (MVVM) plugin available since 5.1, Beta in 5.7; stable enough for production
  with care.
- CommonUI ships in engine and is stable; Lyra uses it as the canonical game UI reference.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/UMG/Public/Blueprint/UserWidget.h` — `UUserWidget` UCLASS:282,
  `AddToViewport`:345, `AddToPlayerScreen`:354, `RemoveFromViewport` (deprecated 5.1):359,
  `NativeOnInitialized`:1574, `NativePreConstruct`:1575, `NativeConstruct`:1576,
  `NativeDestruct`:1577, `NativeTick`:1578, `CreateWidgetInstance` (backing `CreateWidget`):1462-1466,
  `EWidgetTickFrequency`:120.
- `Runtime/UMG/Public/Blueprint/WidgetTree.h` — `UWidgetTree`, `RootWidget`:142,
  `ConstructWidget<T>`:102, `ForEachWidget`:74, `FindWidget`:30.
- `Runtime/UMG/Public/Components/Widget.h` — `UWidget` UCLASS:215,
  `BindWidget`/`BindWidgetOptional` metadata enum:68-74.
- `Runtime/UMG/Public/Components/Button.h` — `UButton`:32, `OnClicked` delegate:76,
  `OnPressed`:80, `OnReleased`:83, `SetStyle`:117, `GetStyle`:119.
- `Runtime/UMG/Public/Components/TextBlock.h` — `UTextBlock`:22, `SetText`/`GetText` (via
  Getter/Setter specifiers):30.
- `Runtime/UMG/Public/Components/PanelWidget.h` — `UPanelWidget`:14, `AddChild`:59,
  `GetChildAt`:36, `GetChildrenCount`:28.
- `Runtime/UMG/Public/Components/WidgetComponent.h` — `UWidgetComponent`:94,
  `EWidgetSpace`:24, `GetWidget`:206, `SetWidget`:213, `SetWidgetClass`:337.
- `Runtime/SlateCore/Public/Widgets/SWidget.h` — `SWidget`, `ComputeDesiredSize`:731,
  `GetChildren`:856, `OnPaint`:1650.
- `Runtime/SlateCore/Public/Widgets/SCompoundWidget.h` — `SCompoundWidget`:21, `ChildSlot`:113.
- `Runtime/SlateCore/Public/Widgets/DeclarativeSyntaxSupport.h` — `SNew`:37, `SAssignNew`:41.
- `Engine/Plugins/Runtime/CommonUI/Source/CommonUI/Public/CommonUserWidget.h` —
  `UCommonUserWidget`:21.
- `Engine/Plugins/Runtime/CommonUI/Source/CommonUI/Public/CommonActivatableWidget.h` —
  `UCommonActivatableWidget`:43, `ActivateWidget`:52, `DeactivateWidget`:55.

Official docs (UE 5.7, verified):
- Creating User Interfaces —
  <https://dev.epicgames.com/documentation/unreal-engine/creating-user-interfaces-with-umg-and-slate-in-unreal-engine>
- Slate UI Framework —
  <https://dev.epicgames.com/documentation/unreal-engine/slate-user-interface-programming-framework-for-unreal-engine>
- Widget Type Reference —
  <https://dev.epicgames.com/documentation/unreal-engine/widget-type-reference-for-umg-ui-designer-in-unreal-engine>
- Plugins for UI Development —
  <https://dev.epicgames.com/documentation/unreal-engine/plugins-for-ui-development-in-unreal-engine>
- UMG Viewmodel —
  <https://dev.epicgames.com/documentation/unreal-engine/umg-viewmodel-for-unreal-engine>
- Common UI Plugin —
  <https://dev.epicgames.com/documentation/unreal-engine/common-ui-plugin-for-advanced-user-interfaces-in-unreal-engine>
- UMG Best Practices —
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/umg-best-practices-in-unreal-engine>
- Optimization Guidelines for UMG —
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/optimization-guidelines-for-umg-in-unreal-engine>
- Invalidation in Slate and UMG —
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/invalidation-in-slate-and-umg-for-unreal-engine>
- UMG Safe Zones —
  <https://dev.epicgames.com/documentation/unreal-engine/umg-safe-zones-in-unreal-engine>

Deep-dive references in this skill:
- [references/userwidget-and-binding.md](references/userwidget-and-binding.md) — full
  `UUserWidget` lifecycle, BindWidget internals, NativeOnInitialized vs NativeConstruct,
  animation binding (`BindWidgetAnim`), and `GameViewportSubsystem`.
- [references/common-widgets-and-layout.md](references/common-widgets-and-layout.md) — every
  common leaf widget and panel type, slot system, dynamic widget creation from C++.
- [references/widget-component-and-input.md](references/widget-component-and-input.md) —
  `UWidgetComponent` deep dive, `UWidgetInteractionComponent`, input mode management, focus.
- [references/slate-layer.md](references/slate-layer.md) — `SWidget` hierarchy, declarative
  syntax, `SCompoundWidget` authoring, Invalidation, and when to use Slate vs UMG.
- [references/performance-and-best-practices.md](references/performance-and-best-practices.md) —
  invalidation boxes/retainer boxes/volatility, event-driven updates vs property bindings,
  widget pooling (`FUserWidgetPool`, ListView), loading/construction costs, Canvas Panel
  and layout do/don'ts, animation cost tiers, hidden costs (`SetVisibility`,
  `FText::Format`), and the profiling toolbox.
- [references/architecture-and-authoring.md](references/architecture-and-authoring.md) —
  CommonUI activatable layer stacks (the Lyra pattern), decoupling widgets from gameplay,
  MVVM viewmodels (`FieldNotify`, `UE_MVVM_SET_PROPERTY_VALUE`), DPI scaling and
  resolution independence, safe zones, and texture/slot-sizing authoring rules.
