# Slate layer — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `SWidget` class hierarchy, declarative
syntax (`SLATE_BEGIN_ARGS`/`SNew`), authoring `SCompoundWidget` subclasses, the layout and
paint model, invalidation, and guidance on when to use Slate vs UMG. Grounded in UE 5.7
(`Engine/Source/Runtime/SlateCore/Public/Widgets/`).

## The Slate widget hierarchy

```
SWidget (SWidget.h)               — abstract base; every Slate widget
  SCompoundWidget (SCompoundWidget.h) — one ChildSlot; most non-leaf widgets
    SButton, SBorder, SScrollBox, ... — engine-provided compound widgets
  SPanel                          — multiple FSlotBase children (SBoxPanel, SGridPanel...)
    SHorizontalBox, SVerticalBox, SOverlay, SCanvas, ...
  SLeafWidget                     — no children; draws itself (SImage, STextBlock...)
```

`SWidget` is a **reference-counted** object (`TSharedRef<SWidget>`); it is **not** a
`UObject`. Slate widgets are not GC-tracked — keep them alive with `TSharedPtr`/`TSharedRef`.

## Key SWidget virtuals

Declared in `SWidget.h` (verified 5.7):

| Virtual | Line | Purpose |
|---|---|---|
| `ComputeDesiredSize(float Scale)` | :731 | Return the widget's preferred size. Called during the layout prepass. |
| `GetChildren()` | :856 | Return `FChildren*` — all direct child slots. Slate iterates this for layout and hit-testing. |
| `OnPaint(...)` | :1650 | Emit draw elements into `FSlateWindowElementList`. Pure virtual on `SWidget`. |
| `OnArrangeChildren(...)` | (SPanel) | Compute child positions given the allotted geometry. |

`OnPaint` in `SWidget.h` is the *pure virtual*; the non-virtual public `SWidget::Paint()`
enforces pre/post conditions and calls the virtual.

## Declarative syntax

Slate uses C++ macros to define a widget's "args" struct, enabling a fluent-builder pattern:

```cpp
// Declare args inside a widget class:
class SMyWidget : public SCompoundWidget
{
public:
    SLATE_BEGIN_ARGS(SMyWidget)
        : _Title(FText::GetEmpty())
        , _ButtonColor(FLinearColor::White)
    {}
        SLATE_ARGUMENT(FText,        Title)
        SLATE_ARGUMENT(FLinearColor, ButtonColor)
        SLATE_EVENT  (FSimpleDelegate, OnConfirm)
    SLATE_END_ARGS()

    void Construct(const FArguments& InArgs);
};

// Construction:
TSharedRef<SMyWidget> W = SNew(SMyWidget)
    .Title(FText::FromString(TEXT("Settings")))
    .ButtonColor(FLinearColor::Green)
    .OnConfirm(FSimpleDelegate::CreateUObject(this, &UMyClass::HandleConfirm));
```

`SLATE_BEGIN_ARGS` / `SLATE_END_ARGS` declare `FArguments` with a `<<= operator` that
`SNew` / `SAssignNew` use (`DeclarativeSyntaxSupport.h`:37,41). `SLATE_ARGUMENT` declares a
value-type parameter; `SLATE_ATTRIBUTE` declares a bindable `TAttribute<T>`; `SLATE_EVENT`
declares a delegate slot.

## SCompoundWidget authoring

`SCompoundWidget` (`SCompoundWidget.h`:21) provides a single `ChildSlot` that accepts one
child widget. Override `Construct(FArguments)` to populate it.

```cpp
void SMyWidget::Construct(const FArguments& InArgs)
{
    ChildSlot
    [
        SNew(SVerticalBox)
        + SVerticalBox::Slot().AutoHeight()
        [
            SNew(STextBlock).Text(InArgs._Title)
        ]
        + SVerticalBox::Slot().FillHeight(1.f)
        [
            SNew(SButton)
            .ButtonColorAndOpacity(InArgs._ButtonColor)
            .OnClicked_Lambda([InArgs]() -> FReply
            {
                InArgs._OnConfirm.ExecuteIfBound();
                return FReply::Handled();
            })
        ]
    ];
}
```

The `[ ]` operator on a slot takes a `TSharedRef<SWidget>` or an `SNullWidget` (for "no
child"). Chain `+` to add more slots on panels like `SVerticalBox`.

## Layout model

Slate performs a two-pass layout each frame (only on dirty widgets with invalidation):
1. **Prepass (desire pass)** — `ComputeDesiredSize` is called bottom-up; children report
   their preferred size before parents compute theirs.
2. **Arrange pass** — `OnArrangeChildren` distributes actual geometry top-down; every widget
   gets an `FGeometry` (position + size in local/absolute space).

`FGeometry` carries the widget's local size, absolute position, and the accumulated
`FSlateLayoutTransform` for render transforms.

## Invalidation and caching

Slate uses an invalidation/caching model to avoid recomputing layout every frame:
- **`SInvalidationPanel`** (UMG: `UInvalidationBox`) caches rendered output; only repaints
  when a child explicitly invalidates.
- Call `Invalidate(EInvalidateWidgetReason::...)` on an `SWidget` or its UMG wrapper
  `UWidget` to mark it dirty. Common reasons:
  - `Layout` — size or position may change.
  - `Paint` — visual appearance changed, size/position unchanged.
  - `ChildOrder` — number/order of children changed.
  - `Prepass` — desired size may change without full layout invalidation.

UMG calls `UWidget::Invalidate(...)` when `SynchronizeProperties` detects a change.

## Slate vs UMG decision guide

| Situation | Choose |
|---|---|
| Game HUD, menus, inventory | UMG (or CommonUI for menus) |
| Editor panel, custom editor tool | Slate directly |
| Widget needed inside an Unreal Module with no `UObject` dependency | Slate directly |
| Bespoke custom-drawn widget not expressible in UMG | Slate `SLeafWidget` subclass, wrapped by a `UNativeWidgetHost` or custom `UWidget` |
| Cross-platform game menu with gamepad input | CommonUI (`UCommonActivatableWidget`) |

## Wrapping Slate in UMG

To expose a custom `SWidget` to UMG:
1. Subclass `UWidget`.
2. Override `RebuildWidget()` → construct and return your `TSharedRef<SWidget>`.
3. Override `SynchronizeProperties()` → push UPROPERTY values into the Slate widget.
4. The engine calls `RebuildWidget()` when the Slate widget is needed and
   `SynchronizeProperties()` when UMG properties change.

```cpp
class UMyCustomWidget : public UWidget
{
    GENERATED_BODY()
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override
    {
        MySWidget = SNew(SMySlateWidget);
        return MySWidget.ToSharedRef();
    }
    virtual void SynchronizeProperties() override
    {
        Super::SynchronizeProperties();
        if (MySWidget.IsValid()) { MySWidget->SetSomeValue(SomeValue); }
    }
private:
    TSharedPtr<SMySlateWidget> MySWidget;
    UPROPERTY(EditAnywhere) float SomeValue = 1.f;
};
```

## Thread safety

Slate runs on the **game thread**. Widget construction, destruction, and property updates must
all happen on the game thread. Slate rendering is driven from the game thread and submitted to
the render thread via `FSlateWindowElementList`.

## Version notes

- The invalidation model (caching/fast path) was significantly improved in UE 4.21 and has
  been stable throughout UE5.
- `TSharedRef<SWidget>` / `TSharedPtr<SWidget>` semantics are unchanged across 5.x.
- Slate's declarative macros (`SLATE_BEGIN_ARGS`) are stable and generated code unchanged
  in 5.7.
