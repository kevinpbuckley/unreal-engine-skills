---
name: uds-modifiers-configs-state
description: Use UDS's higher-level state features — Sky Modifiers (data assets that override sky/post-process properties, time-of-day-triggered modifiers), the Configuration Manager (save/apply complete UDS configs, runtime Apply Sky Configuration, configuration override), Save UDS+UDW state for save games, Sun Lens Flare, Post Process Components driven by time/weather/interior, Interior Adjustments + Player Occlusion (with UDS Occlusion Volume and Portal), Water Level (caustics, underwater fog, Water Body Classes), Ambient Sound — Time and Weather Controlled, and the UDS Onscreen Controls widget (with multiplayer client controller). Use any time the user asks about saving/loading sky presets, applying a different sky config, save-game serialization for time/weather, sun lens flare, post-processing tied to time of day, indoor vs outdoor differences, water/underwater effects, ambient sounds that change with time, or an on-screen UI to control the sky.
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: state-management
  source-docs: https://www.ultradynamicsky.com/Documentation/V9/9-5
---

# UDS modifiers, configurations, state, and misc features

The "extras" layer of UDS: packaging, saving, and applying state; per-context post-processing; interior detection; water; sounds; on-screen UI; and the sun lens flare. Each system is independent — pick the section that applies.

| System | Category on UDS | Mental model |
| --- | --- | --- |
| Sky Modifiers | **Modifiers** | Data-asset property overrides that fade in/out and layer |
| Configuration Manager | (editor utility) | Snapshot/restore the *entire* UDS settings state as an asset |
| Save UDS+UDW State | (function pair) | Pack/unpack state into a struct for save data |
| Sun Lens Flare | **Lens Flare** | UDS's own filmic flare on the sun |
| Post Process Components | **Post Processing** | Time/weather/interior-driven post components |
| Interior Adjustments | **Interior Adjustments** | Sky/fog/light changes when camera is occluded |
| Player Occlusion | **Player Occlusion** | The trace/volume system that drives interior detection |
| Water Level | **Water Level** | Caustics, underwater fog, sound, weather particle masking |
| AmbientSound — Time and Weather | (actor class in Blueprints/Sound) | Drop-in ambient sound that auto-volumes with day/night and weather |
| Onscreen Controls | (widget in palette) | Drop-in UI for player time/weather control |

## When to use this skill

- Saving the current UDS look as an asset; applying a different one at runtime.
- Persisting sky/weather state across save/load.
- Layering temporary visual treatments (combat tint, slow-motion vignette) onto UDS.
- Post processing that changes with time of day, weather, or being indoors.
- A scene that needs different fog/light when the player enters a building.
- A water level affecting fog/caustics/sound/weather underwater.
- Letting players control the sky from in-game UI.
- Modifying UDS logic without losing changes on updates (child blueprints).

## Sky Modifiers

Data assets that override a selection of float/color properties on UDS, plus post-process settings. Can be added/removed at runtime, faded in/out, and layered.

### Authoring modifier assets

Launch the **Sky Modifier Editor**:

- **Ultra Dynamic Sky** dropdown on the level editor toolbar, *or*
- Run the editor utility at `Blueprints/Tools/`

In the editor:

| Action | What happens |
| --- | --- |
| **Open** | Open an existing modifier asset |
| **New** | Blank modifier placed in `Blueprints/Sky_Modifiers/` (movable afterward) |
| Edit a Modifiable Sky Property value | Modifier takes control of that property |
| Click checkbox next to a property | Remove the property override from this modifier |
| Modifier Settings → easing, max alpha, post-process toggles | Per-modifier behavior |

The current modifier previews live on UDS while you work.

### Applying modifiers

| Where | How |
| --- | --- |
| **Modifiers** category on UDS | Add a modifier to be used from level start |
| Runtime functions on UDS | See table below |

| Function | Behavior |
| --- | --- |
| `Add Modifier(modifier, fadeIn)` | Add and fade in over `fadeIn` seconds |
| `Remove Modifier(modifier, fadeOut)` | Fade out an applied modifier and remove |
| `Set Modifier State(modifier, alpha)` | Set alpha directly and freeze it. Doesn't change on its own. Adds if not already applied. |
| `Clear Modifiers()` | Instantly clear all applied modifiers |
| `Set Unmodified Property Values()` | Resave current applied properties as the new unmodified baseline (used as the from/to for future modifier interpolations) |

### Time-of-Day-specific modifiers

In **Sky Modifiers** category, the **Time of Day Specific Modifiers** map auto-applies modifiers within Time of Day ranges:

- Add a modifier to the map; expand the dropdown for its fade range.
- Configure fade in across one TOD range and fade out across another.
- Fade-in can occur *before or after* fade-out — useful for overnight modifiers. Just ensure end > start for each fade.

**Don't drive a time-controlled modifier with `Add/Remove/Set Modifier State`** — they'll conflict.

## Configuration Manager

Save the *complete* configuration of every UDS (and UDW) setting as a config asset, for reuse across levels/projects or runtime application.

Launch the **Configuration Manager**:

- **Ultra Dynamic Sky** dropdown on the toolbar, *or*
- Run the editor utility in the Blueprints folder

| Action | What happens |
| --- | --- |
| Select existing config | Apply it to your UDS actor |
| Save (bottom-right, when nothing selected) | Create new config; prompts for name + location |
| Save to project files | Placed in `Ultra Dynamic Sky/` folder in your project (per-project) |
| Save to engine content folder | Placed in `Ultra Dynamic Sky/` folder there (per-engine-version, shared across projects) |

The version number in each config's thumbnail corner is the UDS version it was saved with. Older configs still load but won't contain data for new variables. Re-save them with current UDS for complete data.

### Applying configs at runtime

| Function | Where |
| --- | --- |
| `Apply Sky Configuration(config)` | On UDS |
| `Apply Weather Configuration(config)` | On UDW |

**When applying both, apply the weather config first.**

### Configuration override (bind UDS to a config asset)

Point UDS or UDW at a config asset for settings to be entirely driven by that reference. Useful for shared configs across multiple levels.

| Where | Setting |
| --- | --- |
| Advanced dropdown of **Basic Controls** on UDS / UDW | `Configuration Override` |

With an override set, UDS/UDW settings can't be changed directly — the override owns them. Override applies on startup; at runtime you can still modify UDS/UDW variables as normal.

### Configuration Buttons editor panel

For levels where you swap configs while working, pin **Configuration Buttons** — find in the **Ultra Dynamic Sky** dropdown on the toolbar. Add configs as buttons in a compact panel for quick swap.

## Save / load state for save games

For save-game systems that persist sky/weather state across loads or sessions:

| Function | What it does |
| --- | --- |
| `Create UDS and UDW State for Saving()` | Returns a struct with all time + current weather state — pack into save data |
| `Apply Saved UDS and UDW State(struct)` | Apply on save load or level entry |

## Sun Lens Flare

UDS's own filmic lens flare for the sun. **Completely separate** from Unreal's image-based lens flare post effect.

In the **Lens Flare** category:

- Enable `Enable Sun Lens Flare`
- Select a `Lens Flare Type`

### Custom lens flares

In the advanced dropdown of **Lens Flare**, set `Custom Lens Flare Parent Instance` to an instance you created from one of the existing material instances at:

```
Materials/Material_Instances/Lens_Flares/
```

Adjust textures, colors, and mapping parameters in your custom instance.

## Post Process Components (time/weather-driven)

In the **Post Processing** category, the **Post Process Components** array — each entry becomes a post process component the system creates at startup.

| Per-entry control | Effect |
| --- | --- |
| Post process settings | Override any setting (bloom, color grading, vignette) |
| Time-of-day Enable/Disable checkboxes | Fade blend weight in/out as time changes |
| Mask Blend Weight options | Mask the component based on cloud coverage, fog, dust, interior occlusion |
| Raining / Snowing masks | Dependent on UDW (no effect without it) |

Use cases:

- Desaturated grade only at night.
- Harsher contrast only when overcast.
- Warm cozy color grade only inside.

## Interior Adjustments

Adjusts fog and light based on how occluded the camera is by surrounding scene collision. Category: **Interior Adjustments**.

| Step | Detail |
| --- | --- |
| Enable | `Apply Interior Adjustments` |
| Configure | Tune the settings below it for interior look |
| Source of occlusion | The **Player Occlusion** system (below) |
| Force a region to be occluded | Place a **UDS Occlusion Volume** actor (`Blueprints/Occlusion/`) |

`Occlusion Mode` in the **Player Occlusion** category — whether occlusion comes from traces, volumes, or both.

## Player Occlusion

The system on UDS that monitors how occluded the player camera/pawn is from the sky/weather. Drives:

- **Interior Adjustments** on UDS (above)
- **Sound Occlusion** on UDW — quiets/muffles weather sounds in interiors
- Optional **Interior Temperature** on UDW's temperature calculation

The **Player Occlusion** category sets how occlusion is computed: per-update time budget, trace count, collision channel, etc.

| Actor / component | Purpose |
| --- | --- |
| `UDS Occlusion Volume` (`Blueprints/Occlusion/`) | Force a region to be fully occluded; also can block weather particles (Simple Collision mode only) |
| `UDS Occlusion Portal` (component) | Around the sampling location, traced against; can negate occlusion when the trace is unobstructed. Use case: an open door/window letting outside weather sound in. |

## Water Level

Sets the height of water surfaces in the level. Category: **Water Level**.

Used by:

| Feature | Toggle / setting |
| --- | --- |
| Water caustics on sun/moon | `Render Water Caustics` on UDS |
| Volumetric fog below water (extinction + albedo) | Part of Global Volumetric Material (see `uds-fog-and-atmosphere`) |
| UDW applying water level to weather particles, sound occlusion | `Use UDS Water Level` in UDW's Water Level category |

| Variable | Meaning |
| --- | --- |
| `Global Water Level` | Universal minimum water Z (e.g. an ocean) |
| `Water Body Classes` | Actor classes whose meshes locally affect water level by rendering to a render target. Pre-configured for the Water plugin's Lake/Ocean/River. |

If water bodies stream in/out, call `Update Water Level Target` on UDS to force a refresh.

## AmbientSound — Time and Weather Controlled

Actor class at `Blueprints/Sound/AmbientSound - Time and Weather Controlled`. Child of standard Ambient Sound — auto-adjusts volume by day/night and weather.

| Setting (top of **Sound** category on the actor) | Effect |
| --- | --- |
| Day / night volume multipliers | Per-time-band volume |
| Snowy / Rainy / No-weather multipliers | Per-weather volume |
| `Volume Multiplier Transition Time` | How long the volume change takes when conditions change |

For a fuller soundscape with sound occlusion, prefer UDW's Environment Sound system — see `udw-particles-lightning-wind-sounds`.

## On-screen sky controls widget

`UDS Onscreen Controls` widget in the widget designer palette under **Ultra Dynamic Sky Widgets**. Drop-in player UI for time/weather.

| Exposed setting | Effect |
| --- | --- |
| `Show Time Control`, `Show Weather Control`, etc. | Toggle off individual controls (e.g. for a compact time-only widget) |
| Time / date format | Display format |
| Weather presets available | What appears in the weather control |

### Multiplayer use

For client-side Onscreen Controls driving server-side UDS/UDW state: add the **UDS Client Controller** component to your player controller class. Onscreen Controls automatically uses it from clients to replicate function calls up to the server.

## Modifying UDS blueprints (survives updates)

For changing UDS logic itself: work in a **child class** rather than editing UDS directly — modifications survive updates.

```
1. Right-click UDS class in content browser
2. Create Child Blueprint Class
3. Override individual functions (e.g. Current Sun Light Color)
```

Some classes have empty functions specifically meant for override in children — e.g. `Custom Volume Behavior` on Weather Override Volume (see `udw-spatial-weather`).

## Gotchas

- **Modifier and time-of-day specific modifier both applied to the same modifier** — they conflict. Pick one mechanism.
- **`Set Modifier State` doesn't appear to work** — the modifier wasn't applied first. `Set Modifier State` adds it automatically; if alpha looks wrong, you may be racing another modifier control call.
- **Config asset loads with missing values** — saved with an older UDS version. Re-save with current UDS to fill in new fields.
- **Can't change a UDS variable** — configuration override is bound to a config asset. Either remove the override or edit the underlying config.
- **`Apply Sky Configuration` and `Apply Weather Configuration` in the wrong order** — apply *weather* first when applying both.
- **Sun Lens Flare confused with engine post-process lens flare** — different system. UDS's Lens Flare is filmic and configured per Lens Flare Type in the **Lens Flare** category. Engine post lens flare is configured per post-process volume.
- **Interior Adjustments fade in/out flickering** — occlusion traces are unstable; tune Player Occlusion settings (trace count, update period) or place UDS Occlusion Volumes for stable interiors.
- **Weather sounds quiet at wrong times** — sound occlusion using Player Occlusion. Adjust trace behavior in **Player Occlusion** on UDS. (See `udw-particles-lightning-wind-sounds`.)
- **Underwater fog or sound not applying** — `Use UDS Water Level` on UDW is off, or `Global Water Level` is wrong, or per-body Water Body Classes aren't configured.
- **Onscreen Controls don't work for clients in multiplayer** — `UDS Client Controller` component not added to the player controller.
- **Changes to UDS blueprint lost after a plugin update** — modifications were made directly to UDS classes. Use child blueprints (see above).

## References & source material

Docs (Ultra Dynamic Sky 9.5):
- [Saving and Applying Configurations](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-57)
- [Sky Modifiers](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-58)
- [Saving the Sky and Weather State for Save Data](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-59)
- [Sun Lens Flare](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-60)
- [Interior Adjustments](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-61)
- [Player Occlusion](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-62)
- [Water Level](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-65) (incl. Water Body Classes)
- [Post Processing](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-67) (Post Process Components)
- [Ambient Sounds Controlled by Time and Weather](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-68)
- [On Screen Sky Controls](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-69)
- [Modifying UDS Blueprints](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-74)

Plugin asset paths:
- `Blueprints/Tools/` — Sky Modifier Editor, Configuration Manager, Configuration Buttons utilities
- `Blueprints/Sky_Modifiers/` — default home for new modifier assets
- `Blueprints/Sound/` — `AmbientSound - Time and Weather Controlled` actor class
- `Blueprints/Occlusion/` — `UDS Occlusion Volume` actor; `UDS Occlusion Portal` component
- `Materials/Material_Instances/Lens_Flares/` — material instances for Custom Lens Flare Parent Instance
- `Ultra Dynamic Sky/` (project or engine content) — default location for Configuration assets
- Widget designer palette → **Ultra Dynamic Sky Widgets** — `UDS Onscreen Controls`

Related skills: `uds-setup-and-modes` (config override option lives in Basic Controls advanced dropdown), `uds-fog-and-atmosphere` (Water Level drives Global Volumetric Material underwater extinction), `uds-performance-mobile-troubleshooting` (`Hard Reset Cache`, `Static Properties` functions), `udw-setup-and-state` (`Apply Weather Configuration`), `udw-particles-lightning-wind-sounds` (Sound Occlusion uses Player Occlusion; Environment Sound system).
