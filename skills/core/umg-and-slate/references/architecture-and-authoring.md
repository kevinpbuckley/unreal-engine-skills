# UI architecture & authoring — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers screen architecture with CommonUI
activatable layer stacks (the Lyra pattern), decoupling widgets from gameplay code, the
MVVM Viewmodel plugin, DPI scaling and resolution independence, safe zones, and
texture/authoring rules. Grounded in UE 5.7 engine and plugin source plus Epic's UMG
best-practices docs (links at the end).

## Screen architecture: layer stacks (the Lyra pattern)

Production UE games don't `AddToViewport` each screen ad hoc — they register a single
root layout containing **named layers**, each a stack of activatable widgets. CommonUI
ships the building blocks:

- `UCommonActivatableWidgetContainerBase`
  (`Engine/Plugins/Runtime/CommonUI/Source/CommonUI/Public/Widgets/CommonActivatableWidgetContainer.h`:24)
  — base container; `AddWidget<T>(Class)`:33 generates/pushes an activatable widget,
  `RemoveWidget`:70 pops it.
- `UCommonActivatableWidgetStack` (same header, :202) — LIFO stack; the top widget is
  active, widgets below stay in the hierarchy but deactivate. Back/escape pops.
- `UCommonActivatableWidgetQueue` (same header, :235) — FIFO queue; ideal for modal
  dialogs and toasts shown one at a time.

The **Lyra** sample (the canonical reference, not engine code) builds on this with a
`PrimaryGameLayout` root widget holding one stack per layer, registered under gameplay
tags:

| Layer tag | Contents |
|---|---|
| `UI.Layer.Game` | The HUD (pushed by the active Experience) |
| `UI.Layer.GameMenu` | In-game screens — inventory, map |
| `UI.Layer.Menu` | Settings / pause / front-end menus |
| `UI.Layer.Modal` | Confirmation dialogs, error popups (a queue, via its messaging subsystem) |

Code pushes screens by tag (`PushWidgetToLayerStack(Tag, WidgetClass)` in Lyra's
`UPrimaryGameLayout`) instead of touching the viewport. What the pattern buys you:

- **Input routing for free** — CommonUI directs input to the topmost active widget of the
  highest-priority visible layer; no manual focus juggling when menus stack.
- **Back handling for free** — `UCommonActivatableWidget::BP_OnHandleBackAction` pops the
  stack; escape/B works consistently everywhere.
- **Z-order by construction** — modals always above menus, menus above HUD.
- **Decoupled flows** — a screen never needs to know what opened it or what's underneath.

Practical rules:
- Base every full screen on `UCommonActivatableWidget`; activate/deactivate instead of
  add/remove so state survives while a screen is buried in the stack.
- Keep one widget per layer responsibility — don't push HUD elements onto menu layers.
- Async-load screen classes before pushing (`TSoftClassPtr` + streamable;
  `asset-management`) — Lyra's push helpers do exactly this.
- Debug stacks with `CommonUI.DumpActivatableTree`.

## Decoupling widgets from gameplay

Widgets are views. Best-practice boundaries that keep them testable and reusable:

- **Gameplay never knows widget types.** Pawns/components expose state + change
  delegates (`OnHealthChanged`); UI subscribes. The dependency arrow points UI → gameplay
  only.
- **Widgets never cast to concrete pawn classes.** Bind through an interface, a
  component looked up by class, or a viewmodel. A health bar that casts to
  `ABP_MyHero_v2_Final` dies with that class.
- **UI state lives outside widgets.** Which screen is open, selected loadout, unread
  notifications — keep in a `ULocalPlayerSubsystem` or `UGameInstanceSubsystem`; widgets
  read/observe it. Widgets are recreated on level travel; subsystems are not.
- **Initial state + change events.** Every "bind to delegate" must also pull current
  state once on construct, or the widget shows stale defaults until the first change.

## MVVM Viewmodel plugin

The `ModelViewViewModel` plugin formalizes the event-driven rule with designer-friendly
bindings that fire **only when a field changes** (no per-frame polling).

```cpp
// HealthViewModel.h — a viewmodel models a domain entity, not a widget.
#include "MVVMViewModelBase.h"
#include "HealthViewModel.generated.h"

UCLASS(BlueprintType)
class UHealthViewModel : public UMVVMViewModelBase
{
    GENERATED_BODY()

protected:
    UPROPERTY(BlueprintReadWrite, FieldNotify, Setter, Getter)
    float Health = 100.f;

    UPROPERTY(BlueprintReadWrite, FieldNotify, Setter, Getter)
    float MaxHealth = 100.f;

public:
    void SetHealth(float Value)
    {
        // Broadcasts only if the value actually changed:
        if (UE_MVVM_SET_PROPERTY_VALUE(Health, Value))
        {
            UE_MVVM_BROADCAST_FIELD_VALUE_CHANGED(GetHealthPercent); // dependent field
        }
    }
    float GetHealth() const { return Health; }

    void SetMaxHealth(float Value) { UE_MVVM_SET_PROPERTY_VALUE(MaxHealth, Value); }
    float GetMaxHealth() const { return MaxHealth; }

    // Derived FieldNotify function — bindable like a property:
    UFUNCTION(BlueprintPure, FieldNotify)
    float GetHealthPercent() const { return MaxHealth > 0.f ? Health / MaxHealth : 0.f; }
};
```

Key pieces (`Engine/Plugins/Runtime/ModelViewViewModel/Source/ModelViewViewModel/Public/MVVMViewModelBase.h`):
`UMVVMViewModelBase`:42, `UE_MVVM_BROADCAST_FIELD_VALUE_CHANGED`:16,
`UE_MVVM_SET_PROPERTY_VALUE`:20. In the widget, add a Viewmodel in the **Viewmods**
panel and create View Bindings (widget property ← viewmodel field) in the designer;
choose a creation mode (Create Instance / Global collection / Resolver / Manual).

Best practices:
- **Viewmodels model domain entities** (player vitals, a shop item), not widgets — one
  viewmodel can feed many widgets.
- Gameplay writes to the viewmodel (via its setters) — it never touches widgets;
  widgets bind — they never poll.
- Derived values are `UFUNCTION(BlueprintPure, FieldNotify)` functions; broadcast them
  from the setters of fields they depend on.
- Plain `TArray` fields don't notify on element changes — wrap mutations in viewmodel
  functions that broadcast, or model list entries as child viewmodels.
- When to use: data-rich screens (inventory, settings, stats). For a two-field HUD,
  plain push setters are less machinery. The plugin is Beta in 5.7 — solid, but expect
  editor-UX rough edges.

## DPI scaling & resolution independence

UMG renders in **Slate units**, then applies one global DPI scale from project settings
(`Engine/Source/Runtime/Engine/Classes/Engine/UserInterfaceSettings.h` —
`UUserInterfaceSettings`:117, `UIScaleRule`:174, `UIScaleCurve`:189,
`GetDPIScaleBasedOnSize`:224; config: Project Settings → Engine → User Interface).

Rules that make UI survive every resolution:
- **Pick one target resolution** (e.g. 1920×1080) and author *every* Widget Blueprint at
  it (Designer → Screen Size dropdown), at **DPI scale 1.0**. Mixed authoring resolutions
  scale inconsistently forever after.
- **Shortest Side** is the standard `UIScaleRule` — UI scales with vertical resolution on
  widescreen, so ultrawide gains horizontal space instead of giant UI. The `UIScaleCurve`
  maps that side length → scale (1080 → 1.0, 2160 → 2.0, etc.).
- **Anchors handle aspect ratio; DPI handles resolution.** Anchor HUD corners/edges to
  their screen corners/edges with offsets, never absolute positions from (0,0).
- **Preview other sizes, author at one.** The designer's screen-size dropdown is for
  checking, not building.
- Design at your **lowest** supported resolution and let DPI scale up — up-scaling stays
  sharp with properly sized art; down-scaling crowds layouts.
- Query scale at runtime via `GetDPIScaleBasedOnSize` if you must convert between pixels
  and Slate units (e.g. custom hit-testing).

## Safe zones

TVs overscan; phones have notches and home bars. Wrap edge-anchored chrome in a
`USafeZone` (`Engine/Source/Runtime/UMG/Public/Components/SafeZone.h`:28) — it pads its
child to the platform-reported safe area automatically. Pattern: root Canvas/Overlay →
SafeZone → the HUD frame; full-bleed art (backgrounds, vignettes) stays *outside* the
SafeZone. Test with the designer's device previews or `r.DebugSafeZone.TitleRatio` to
simulate shrunken safe areas.

CommonUI alternative: its `UCommonHardwareVisibilityBorder` & platform traits handle
per-platform layout variants when a simple inset isn't enough.

## Texture & art authoring rules

- **No padding baked into textures.** Transparent borders in the PNG break 9-slicing and
  waste texture memory; add space with UMG padding instead.
- **Split composite art** (panel corners/edges/fill as separate pieces, or one texture
  with **Draw As: Border** and margins — 9-slice) so panels stretch without distortion.
- **Author art at target resolution × max DPI scale** — a 64px icon shown at 128px on 4K
  needs 128px source art; conversely don't ship 1024px textures for 64px slots.
- **Prefer textures over UI materials** for static elements — materials break batching
  and add shader cost; reserve them for animated/procedural elements (tier-1 animations,
  progress rings).
- Match Texture Group `UI` so mip/compression settings fit 2D rendering.

## Slot sizing & transforms

- **Auto vs Fill:** `Auto` sizes a box slot to its child's desired size; `Fill` divides
  remaining space by fill weights. Typical screen: header/footer rows Auto, content row
  Fill. Don't put Fill content inside an Auto parent and expect it to grow.
- **Permanent scaling belongs to layout** — use a `UScaleBox` (layout scale, affects
  desired size) to fit content, not a render transform. **Render transforms are for
  transient animation only** — they don't affect layout, so a "scaled-down" widget still
  occupies its full slot and misaligns siblings.
- Leave text room for localization — German/Russian strings run ~30% longer than
  English; prefer Auto-sized slots + wrapping over fixed-width text boxes, and never bake
  text into textures (`core-types-and-containers` for `FText`).

## Version notes

- MVVM (`ModelViewViewModel` plugin) introduced 5.1, Beta through 5.7; binding panel UX
  improved substantially in 5.3+.
- `FieldNotify` specifier on `UPROPERTY`/`UFUNCTION` requires 5.1+.
- CommonUI activatable containers stable since 5.0; Lyra (5.0+) is the canonical
  layer-stack reference implementation (`PrimaryGameLayout`, `UI.Layer.*` tags live in
  Lyra's CommonGame/CommonUser plugins, not the engine).
- `USafeZone` honors mobile notches since 4.25; device-specific insets come from device
  profiles.

## Sources

Engine source (UE 5.7, under `Engine/Source/` and `Engine/Plugins/`):
- `Engine/Plugins/Runtime/CommonUI/Source/CommonUI/Public/Widgets/CommonActivatableWidgetContainer.h`
  — `UCommonActivatableWidgetContainerBase`:24, `AddWidget`:33, `RemoveWidget`:70,
  `UCommonActivatableWidgetStack`:202, `UCommonActivatableWidgetQueue`:235.
- `Engine/Plugins/Runtime/ModelViewViewModel/Source/ModelViewViewModel/Public/MVVMViewModelBase.h`
  — `UE_MVVM_BROADCAST_FIELD_VALUE_CHANGED`:16, `UE_MVVM_SET_PROPERTY_VALUE`:20,
  `UMVVMViewModelBase`:42.
- `Engine/Source/Runtime/Engine/Classes/Engine/UserInterfaceSettings.h` —
  `UUserInterfaceSettings`:117, `UIScaleRule`:174, `UIScaleCurve`:189,
  `GetDPIScaleBasedOnSize`:224.
- `Engine/Source/Runtime/UMG/Public/Components/SafeZone.h` — `USafeZone`:28.

Official docs (verified):
- UMG Best Practices —
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/umg-best-practices-in-unreal-engine>
- Common UI overview —
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-advanced-multiplatform-user-interfaces-with-common-ui-for-unreal-engine>
- UMG Viewmodel —
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/umg-viewmodel-for-unreal-engine>
- UMG Safe Zones —
  <https://dev.epicgames.com/documentation/unreal-engine/umg-safe-zones-in-unreal-engine>

Community (cross-checked):
- Lyra CommonUI setup notes — <https://x157.github.io/UE5/LyraStarterGame/CommonUI/>
- MVVM for game devs — <https://miltoncandelero.github.io/unreal-viewmodel>
