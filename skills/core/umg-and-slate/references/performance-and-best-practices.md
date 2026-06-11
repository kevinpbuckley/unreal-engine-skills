# UMG performance & best practices — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the invalidation system (invalidation
boxes, retainer boxes, volatility), event-driven updates vs property bindings, widget
pooling, loading/construction costs, layout do/don'ts (Canvas Panel nesting, Spacer vs
Size Box), animation cost tiers, and the profiling toolbox. Grounded in UE 5.7
(`Engine/Source/Runtime/UMG/Public/`) and Epic's official UMG best-practices and
optimization guidelines (links at the end).

## The golden rules

1. **Never use UMG property bindings** — they poll every frame. Push updates from events.
2. **Avoid Tick/OnPaint logic** — respond to delegates and event dispatchers instead.
3. **One Canvas Panel at the root is fine; nested Canvas Panels are not.**
4. **Hidden widgets still construct and load** — everything in the tree pays startup cost.
5. **Wrap static subtrees in Invalidation Boxes; mark per-frame widgets Volatile.**
6. **Pool dynamic entries** (`UListView` or `FUserWidgetPool`) instead of
   Create/RemoveFromParent churn.
7. **Prefer material animation > Blueprint tween > Sequencer animation > anything that
   changes layout.**

## Invalidation: the cost hierarchy

Slate caches widget paint/layout data and only recomputes what is invalidated. Each kind
of change has a different downstream cost — knowing the tiers tells you what to avoid:

| Invalidation type | Triggered by | Relative cost |
|---|---|---|
| Volatility / Visibility | Flag flips only | Very low |
| Paint | Color, brush, material — no size change | Low |
| Layout | Desired size or position changes | Moderate (re-layout subtree) |
| Child order / hierarchy | Add/remove/reorder widgets | High (full recalculation) |

Practical consequences:
- Changing a `UImage` tint is cheap; changing its desired size mid-game is not.
- Adding/removing children at runtime is the most expensive thing UI can do per frame —
  toggle visibility (`Collapsed`) or pool widgets instead.
- UMG animations that move/resize widgets cause Layout invalidation every frame they play
  (see Animation cost tiers below).

### Invalidation Box

`UInvalidationBox` (`Components/InvalidationBox.h`:19, `SetCanCache`:44) caches the
rendered output of its child subtree; nothing under it is repainted until a child
invalidates. Use around complex subtrees that change rarely (a stats panel, a settings
page, a minimap frame). First tool to reach for — cheap, low memory, no visual change.

### Volatility

A widget that changes every frame (an ammo counter, a timer) defeats caching — it would
invalidate its Invalidation Box constantly and pay caching overhead for nothing. Mark it
**Is Volatile** (Details → Performance) or call `ForceVolatile(true)` in C++
(`Components/Widget.h`:620, `bIsVolatile`:388). Volatile widgets skip paint caching but
keep cached layout — geometry is recomputed each frame, layout is not.

### Global invalidation

`Slate.EnableGlobalInvalidation 1` treats the whole window as one invalidation root
(individual Invalidation Boxes inside it are then ignored). Worth testing on UI-heavy
games; verify with profiling, since badly-behaved widgets that constantly invalidate can
negate it.

### Retainer Box

`URetainerBox` (`Components/RetainerBox.h`:26) renders its children into a render target,
then draws that texture. Two modes (constructor-time, not runtime-switchable):
- **RenderOnInvalidation** (`RetainerBox.h`:42) — re-render only when a child invalidates.
- **RenderOnPhase** (`RetainerBox.h`:49, `Phase`:60, `PhaseCount`:72) — re-render every
  Nth frame; `PhaseCount=2, Phase=0` renders on even frames. Spread several retainers
  across phases to stagger their cost.

Costs more memory than an Invalidation Box (a render target per retainer) — use it only
after invalidation boxes aren't enough. Bonus: `GetEffectMaterial()` (`RetainerBox.h`:92)
lets you apply a material to the whole flattened subtree (desaturate a paused HUD, etc.).

## Event-driven updates — never property bindings

UMG **property bindings** (the `Bind` dropdown next to Text/Percent/Visibility in the
designer) re-evaluate the bound function **every frame, per widget**. A HUD with 30 bound
fields runs 30 Blueprint calls per frame doing mostly nothing.

```cpp
// DON'T: designer-bound GetHealthText() polled every frame.

// DO: gameplay broadcasts; widget reacts once per actual change.
void UHealthWidget::NativeConstruct()
{
    Super::NativeConstruct();
    if (UHealthComponent* Health = GetOwningPlayerPawn()->FindComponentByClass<UHealthComponent>())
    {
        Health->OnHealthChanged.AddDynamic(this, &UHealthWidget::HandleHealthChanged);
        HandleHealthChanged(Health->GetHealth(), Health->GetMaxHealth()); // initial state
    }
}

void UHealthWidget::HandleHealthChanged(float Health, float MaxHealth)
{
    HealthBar->SetPercent(Health / MaxHealth);
    HealthText->SetText(FText::AsNumber(FMath::CeilToInt(Health)));
}
```

For larger data-driven UIs, the MVVM Viewmodel plugin gives you change-driven bindings
with designer ergonomics — see
[architecture-and-authoring.md](architecture-and-authoring.md).

Same rule for Tick: `UUserWidget` disables native tick by default; keep it that way.
Timers, delegates, and animations cover almost every "per-frame" need.

## Widget pooling

Creating and destroying `UUserWidget`s churns UObjects *and* their Slate trees. For
dynamic lists/entries:

- **`UListView` / `UTileView` / `UTreeView`** (`Components/ListView.h`:38,
  `Components/ListViewBase.h`:545) — virtualized *and* pooled: only visible rows have
  live widgets, and rows are recycled as you scroll. Always the first choice for 20+
  items. Entry widgets implement `IUserObjectListEntry`; treat entries as views over
  their item object — reset all state in `OnListItemObjectSet`, because the widget you
  receive is recycled, not fresh.
- **`FUserWidgetPool`** (`Blueprint/UserWidgetPool.h`:26) — the engine's pooling helper
  for everything else (damage numbers, markers, notifications):

```cpp
// In the owning widget:
FUserWidgetPool MarkerPool;   // constructed with *this as owner

UDamageNumberWidget* Marker = MarkerPool.GetOrCreateInstance<UDamageNumberWidget>(MarkerClass);
// ... add to a panel, play its anim ...
MarkerPool.Release(Marker);   // back to the pool, Slate widget kept for reuse
```

Key API: `GetOrCreateInstance` (`UserWidgetPool.h`:59), `Release`:79, `ReleaseAll`:85,
`ResetPool`:88. **Gotcha:** call `ReleaseAllSlateResources()` (`UserWidgetPool.h`:97)
from the owning widget's `ReleaseSlateResources` override, or the pool's cached
`SObjectWidget`s keep the UUserWidgets alive in a circular reference (leak).
`NativeConstruct`/`NativeDestruct` fire as pooled instances are activated/released.

## Loading & construction costs

Every widget in a `UUserWidget`'s tree is **loaded and constructed regardless of
visibility**:

- A `UWidgetSwitcher` constructs *all* pages up front, not just the active one.
- Every `TSubclassOf<UUserWidget>` property loads that class (and its whole asset
  dependency chain) when the owner loads. Use `TSoftClassPtr<UUserWidget>` +
  `UAssetManager`/streamable async load for screens that may never open
  (`asset-management`).
- Event Construct / `NativeConstruct` runs for every widget touched.

Therefore:
- **Delete unused widgets** from Widget Blueprints — invisible leftovers still cost
  load, memory, and construct time.
- **Split big screens** into pieces by usage: always-visible (load with the HUD),
  opened-often (preload in background, keep instance), opened-rarely (async load on
  demand, destroy on close).
- Create each persistent widget **once and toggle visibility**, rather than
  CreateWidget/RemoveFromParent per open. `RemoveFromParent` does not destroy the
  instance if a `UPROPERTY` holds it — re-`AddToViewport` is cheap.

## Hidden costs of common calls

- **`SetVisibility` is surprisingly expensive** — it can invalidate layout and walks the
  hierarchy. Only call it when the state actually changes; guard with
  `if (GetVisibility() != NewVis)` in hot paths, never call it per frame.
- **`Collapsed` vs `Hidden`**: `Collapsed` takes no layout space and **skips layout
  entirely** — prefer it for hidden UI. `Hidden` still occupies space and pays prepass.
- **Non-interactive widgets should not be `Visible`** — `Visible` widgets take part in
  hit-testing. Set decorative images/text to `HitTestInvisible` (subtree) or
  `SelfHitTestInvisible` (just this widget). A HUD full of `Visible` decorations slows
  every cursor/touch hit-test.
- **`FText::Format` / `AsNumber` are not free** (~0.04 ms per call measured on console
  hardware) — format when the value changes, never per frame.
- **Clipping** (`Clip to Bounds`) adds per-widget cost when many clipped widgets overlap;
  enable it deliberately, not by default.

## Layout: widget choice do/don'ts

### Canvas Panels — one at the root, never nested

`UCanvasPanel` children each get their own layer ID so they can overlap arbitrarily —
which means **each child can become its own draw-call batch**. One Canvas as the root of
a HUD or full screen is the intended use. The anti-pattern is a Canvas inside every
reusable widget (button, list row, tooltip): nested canvases multiply layers and break
batching across the whole screen.

- DO: root HUD/menu = Canvas (or Overlay); reusable widgets = `Overlay`, `Horizontal/
  VerticalBox`, `GridPanel`, `SizeBox` + padding.
- DON'T: a Canvas Panel inside a ListView entry, button, or any widget instantiated many
  times. If a template widget needs free positioning, it usually actually needs an
  `Overlay` with alignment.
- In a fixed-layout HUD, also consider replacing the root Canvas with Overlays + boxes —
  Epic's guidance is that most screens don't need absolute positioning at all.

### Other layout rules

- **`USpacer` (`Components/Spacer.h`:19) over `USizeBox` for raw spacing** — a Spacer is
  just desired-size; a Size Box (`Components/SizeBox.h`:21) adds override/clamp logic and
  is significantly more expensive.
- **Never combine a Scale Box with a Size Box** (`Components/ScaleBox.h`:21) — the two
  fight over desired size and can flip-flop layout every frame (a permanent Layout
  invalidation). Let content size itself, or pick one.
- **Rich Text sparingly** — `URichTextBlock` (`Components/RichTextBlock.h`:39) runs a
  parser + decorator framework and is far more expensive than `UTextBlock`. If you only
  need a second color/size, use a separate styled TextBlock.

## Animation cost tiers

Cheapest to most expensive — always pick the highest tier that can express the effect:

| Tier | Technique | Cost |
|---|---|---|
| 1 | **Material animation** (panner, sine, params driven rarely from code) | GPU only — effectively free on the game thread; best for loops |
| 2 | **Blueprint/C++ tween** (lerp on timer/delegate, `SetRenderOpacity`, render transforms) | Low — no Sequencer player init |
| 3 | **UMG animation (Sequencer)** on paint-only attributes (color/opacity) | High — sequence evaluation on the game thread |
| 4 | **Any animation that changes layout** (size, slot padding, adding widgets) | Worst — Layout invalidation every frame it plays |

- Render-transform animation (translate/scale/rotate) is paint-level, not layout-level —
  animate transforms, not slot properties.
- Widgets animated every frame should be **Volatile** so they don't thrash caches.
- For short one-shots (button pulse, fade) prefer a tween over a Sequencer animation; the
  player has measurable setup cost.

## In-world UI at scale

`UWidgetComponent` renders a full widget tree to its own render target per component —
fine for a handful of interaction prompts, wrong for hundreds of nameplates/health bars
(memory + per-target rendering). For mass in-world indicators use **`SMeshWidget`**
(`Slate/SMeshWidget.h`:23) — instanced mesh rendering of UI elements in a single draw
call — or project world positions and draw pooled widgets in the HUD layer.

## Profiling toolbox

| Tool | Use |
|---|---|
| `stat Slate` | Slate tick/paint timings and draw-call counts on screen |
| `stat dumpframe -ms=0.1` | One-frame hierarchical breakdown to the log — find which widget is slow |
| **Widget Reflector** (Ctrl+Shift+W or `WidgetReflector`) | Live widget tree: pick any on-screen widget, see hierarchy, invalidation roots, paint counts |
| `Slate.EnableGlobalInvalidation` | Toggle global invalidation for A/B testing |
| `Slate.ShowBatching` / `Slate.ShowOverdraw` | Visualize draw-call batches (spot Canvas-induced batch breaks) and overdraw — editor/dev builds |
| `CommonUI.DumpActivatableTree` | Dump CommonUI activatable widget/layer state |
| Unreal Insights | `Slate` channel for off-line analysis of UI frames |

Workflow: `stat Slate` to confirm UI is the problem → Widget Reflector to find the hot
widget/subtree → fix with the rules above → re-measure.

## Version notes

- Global invalidation and the fast-path invalidation model date from UE 4.21+ and are
  mature in 5.x.
- `RetainerBox` mode/phase properties are constructor-set; direct access deprecated in
  5.2 (use `IsRenderOnPhase`/`GetPhase` getters).
- `FUserWidgetPool::ReleaseSlateResources` renamed `ReleaseAllSlateResources` in 4.24.
- `UListView` family and `IUserObjectListEntry` stable since 4.23.

## Sources

Engine source (UE 5.7, under `Engine/Source/Runtime/UMG/Public/`):
- `Components/InvalidationBox.h` — `UInvalidationBox`:19,
  `GetCanCache`:37, `SetCanCache`:44.
- `Components/RetainerBox.h` — `URetainerBox`:26,
  `RenderOnInvalidation`:42, `RenderOnPhase`:49, `Phase`:60, `PhaseCount`:72,
  `GetEffectMaterial`:92.
- `Components/Widget.h` — `bIsVolatile`:388, `ForceVolatile`:620.
- `Blueprint/UserWidgetPool.h` — `FUserWidgetPool`:26,
  `GetOrCreateInstance`:59, `Release`:79, `ReleaseAll`:85, `ResetPool`:88,
  `ReleaseInactiveSlateResources`:91, `ReleaseAllSlateResources`:97.
- `Components/ListView.h` — `UListView`:38.
- `Components/ListViewBase.h` — `UListViewBase`:545.
- `Components/Spacer.h` — `USpacer`:19.
- `Components/SizeBox.h` — `USizeBox`:21.
- `Components/ScaleBox.h` — `UScaleBox`:21.
- `Components/RichTextBlock.h` — `URichTextBlock`:39.
- `Slate/SMeshWidget.h` — `SMeshWidget`:23.

Official docs (verified):
- UMG Best Practices —
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/umg-best-practices-in-unreal-engine>
- Optimization Guidelines for UMG —
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/optimization-guidelines-for-umg-in-unreal-engine>
- Invalidation in Slate and UMG —
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/invalidation-in-slate-and-umg-for-unreal-engine>
- Using the Invalidation Box —
  <https://dev.epicgames.com/documentation/unreal-engine/using-the-invalidation-box-for-umg-in-unreal-engine>

Community (cross-checked against source):
- Unreal UIs and Performance (unreal-garden) — <https://unreal-garden.com/tutorials/ui-performance/>
- UMG/Slate Compendium — <https://github.com/YawLighthouse/UMG-Slate-Compendium>
