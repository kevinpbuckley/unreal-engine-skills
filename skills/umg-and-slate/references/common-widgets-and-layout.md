# Common widgets and layout — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the leaf widget types, panel widgets and
their slot system, dynamic widget construction from C++, the `UWidgetTree` API, and
`UPanelWidget` child management. Grounded in UE 5.7
(`Engine/Source/Runtime/UMG/Public/Components/`).

## Widget type hierarchy

```
UVisual
  UWidget (Widget.h:215)            — base; wraps an SWidget
    UPanelWidget (PanelWidget.h:14) — has child Slots; layout containers
    UContentWidget                  — single-child panels (Border, Button, ScaleBox...)
    UTextLayoutWidget               — UTextBlock, UMultiLineEditableText...
    ULeafWidget                     — no children (Image, Slider, ProgressBar...)
```

Each `UWidget` lazily builds an `SWidget` (Slate) on demand via `RebuildWidget()` and keeps
the Slate widget synced through `SynchronizeProperties()`.

## Leaf widgets

| C++ class | Header | Use for |
|---|---|---|
| `UTextBlock` | `TextBlock.h` | Static display text; `SetText(FText)`, `SetFont`, `SetColorAndOpacity` |
| `UImage` | `Image.h` | Textures, brushes, materials; `SetBrushFromTexture`, `SetBrushFromMaterial` |
| `UButton` | `Button.h` | Clickable container; `OnClicked`, `OnPressed`, `OnReleased` delegates; any widget as child |
| `UProgressBar` | `ProgressBar.h` | 0..1 fill bar; `SetPercent(float)` |
| `USlider` | `Slider.h` | User-draggable value; `OnValueChanged` delegate |
| `UCheckBox` | `CheckBox.h` | Toggle; `OnCheckStateChanged` |
| `UEditableTextBox` | `EditableTextBox.h` | Single-line text input; `OnTextCommitted` |
| `URichTextBlock` | `RichTextBlock.h` | Inline styled/decorated text |
| `UBorder` | `Border.h` | Single-child with background brush |
| `USpacer` | `Spacer.h` | Empty space placeholder |

### UTextBlock

`SetText` / `GetText` use `FText` (for localization). Direct access to the `Text` UPROPERTY
is deprecated since 5.1 (`TextBlock.h`:28-30):

```cpp
if (ScoreText)
{
    ScoreText->SetText(FText::AsNumber(Score));
}
```

### UButton

`OnClicked` (`Button.h`:76) is a `FOnButtonClickedEvent` (`DECLARE_DYNAMIC_MULTICAST_DELEGATE`
at `Button.h`:18). Any `UFUNCTION()` method with no parameters can be bound:

```cpp
StartButton->OnClicked.AddDynamic(this, &UMyHUDWidget::OnStartClicked);
```

`UButton` is a `UContentWidget` — it can hold exactly one child widget, enabling rich
click-able elements (e.g. an `HorizontalBox` with icon + text).

## Panel widgets (layout containers)

Panels inherit from `UPanelWidget` (`PanelWidget.h`:14) and hold a typed `Slots` array:

| Class | Layout behavior | Slot type |
|---|---|---|
| `UCanvasPanel` | Absolute positioning with anchors; the default root panel in most UMG layouts | `UCanvasPanelSlot` |
| `UHorizontalBox` | Children laid out left-to-right | `UHorizontalBoxSlot` |
| `UVerticalBox` | Children laid out top-to-bottom | `UVerticalBoxSlot` |
| `UGridPanel` | Row/column grid; children specify row/col/span | `UGridSlot` |
| `UOverlay` | Stacks children on top of one another | `UOverlaySlot` |
| `UUniformGridPanel` | Equal-sized cells | `UUniformGridSlot` |
| `UWrapBox` | Wraps children at a given width | `UWrapBoxSlot` |
| `USizeBox` | Constrains or overrides a child's desired size | `USizeBoxSlot` |
| `UScrollBox` | Vertical or horizontal scrollable container | `UScrollBoxSlot` |
| `UWidgetSwitcher` | Shows one child at a time by index | (none) |

### Adding children at runtime

`UPanelWidget::AddChild` (`PanelWidget.h`:59) returns a `UPanelSlot*` that must be cast to
the concrete slot type to set layout properties:

```cpp
UHorizontalBox* HBox = WidgetTree->ConstructWidget<UHorizontalBox>();
UTextBlock* Label   = WidgetTree->ConstructWidget<UTextBlock>();
Label->SetText(FText::FromString(TEXT("Health")));

UHorizontalBoxSlot* Slot = Cast<UHorizontalBoxSlot>(HBox->AddChild(Label));
if (Slot)
{
    Slot->SetSize(FSlateChildSize(ESlateSizeRule::Fill, 1.f));
    Slot->SetPadding(FMargin(4.f));
}
```

## UWidgetTree

`UWidgetTree` (`WidgetTree.h`:19) owns the widget instances for a `UUserWidget`. Its primary
APIs:

- `ConstructWidget<T>(Class, Name)` (:102) — create a widget owned by this tree. Use for
  dynamically built sub-trees. For `UUserWidget` subclasses, redirects to `CreateWidget`.
- `FindWidget(FName)` (:30) — find by name.
- `ForEachWidget(Predicate)` (:74) — iterate all widgets in the tree.
- `GetAllWidgets(Array)` (:61) — collect all widgets recursively.
- `RootWidget` (:142) — the top-level widget of the tree.

Direct use of `UWidgetTree` is only needed when building a widget hierarchy entirely from C++
without a Widget Blueprint. The usual pattern is to author layout in the Widget Blueprint and
let `BindWidget` give C++ typed access to pre-built widgets.

## UPanelWidget child management

```cpp
// Read children:
int32 Count = Panel->GetChildrenCount();       // PanelWidget.h:28
UWidget* Child = Panel->GetChildAt(0);         // PanelWidget.h:36
TArray<UWidget*> All = Panel->GetAllChildren();// PanelWidget.h:40

// Modify:
Panel->RemoveChildAt(0);                       // PanelWidget.h:52
Panel->RemoveChild(MyWidget);
```

## Dynamic entry widgets (lists)

For large or data-driven lists, prefer:
- `UListView` / `UTileView` / `UTreeView` — virtualized, efficient; implement
  `IUserObjectListEntry` on item widgets.
- `UDynamicEntryBox` — a non-virtualized panel that auto-creates entry widgets from a class.

These avoid manually creating/destroying individual child widgets and are significantly more
performant for lists of 20+ items.

## NamedSlot — template composition

`UNamedSlot` (`NamedSlot.h`) allows a parent `UUserWidget` to expose named insertion points
that child Widget Blueprints can fill — essentially slots in a template widget. Implement
`INamedSlotInterface` in C++ to expose named slots programmatically.

## Performance tips

- **Invalidation boxes** (`UInvalidationBox`, `InvalidationBox.h`) cache rendered output;
  use around complex static sub-trees that update rarely.
- **Retainer boxes** (`URetainerBox`) render children to a render target at a reduced
  rate — useful for expensive but slowly-changing sub-trees.
- Avoid deeply nested `UCanvasPanel` hierarchies; prefer `UHorizontalBox`/`UVerticalBox` for
  flow layouts (they compute layout more cheaply).
- Keep widget count per `UUserWidget` manageable; hundreds of live leaf widgets have measurable
  tick/layout cost.
