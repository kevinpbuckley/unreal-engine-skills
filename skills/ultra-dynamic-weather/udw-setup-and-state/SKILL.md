---
name: udw-setup-and-state
description: Set up Ultra Dynamic Weather (UDW) and control its weather state — adding UDW (requires UDS), Basic Controls (Weather preset, Wind Direction), the seven weather state values + material state, Weather Settings Presets, Change Weather, the Manual Weather State with per-value overrides, sampling weather (Get Cloud Coverage / Get Display Name for Current Weather), weather event dispatchers (Started/Finished Raining, Getting Cloudy, Weather Display Name Changed, State Change per value), and the Actor Weather Status component for per-actor exposure tracking. Use any time the user asks about adding UDW, setting up rain/snow, changing weather, presets like Blizzard or Thunderstorm, sampling weather from blueprint, weather-driven events, or per-actor exposure.
metadata:
  asset: Ultra Dynamic Weather (marketplace)
  category: setup
  source-docs: https://www.ultradynamicsky.com/Documentation/V9/9-5
---

# UDW setup and weather state

The foundation of Ultra Dynamic Weather: getting the actor in place, the weather state model, presets, runtime transitions, the manual state for sequencer/per-value control, sampling weather from gameplay code, and event dispatchers.

| Concept | Mechanism |
| --- | --- |
| Weather is a preset asset (high-level) | `Weather` variable in Basic Controls; or `Change Weather(preset, duration)` |
| Weather is a custom blend (low-level) | Manual Weather State category, with per-value override toggles |
| What weather looks like right now | Sample via `Get Cloud Coverage`, `Get Display Name for Current Weather`, etc. |
| React to weather changing | UDW event dispatchers (`Started Raining`, `State Change - <Value>`) |
| Per-actor exposure tracking | `Actor Weather Status` component |
| Multiplayer | UDW replicates state-source asset references, not raw state |

## When to use this skill

- Adding UDW to a level for the first time.
- Choosing or applying a weather preset (Rain, Blizzard, Thunderstorm, etc.).
- Triggering a weather change from gameplay code.
- Overriding individual weather values without writing a new preset.
- Reading current weather from a blueprint (state values or display name).
- Wiring game events to weather transitions (sunrise of a storm, end of snowfall).
- Tracking how exposed an individual actor (player pawn) is to weather.

## Adding UDW to a level

UDW requires UDS — make sure there's an **Ultra Dynamic Sky** actor in the level first (see `uds-setup-and-modes`).

Drag an **Ultra Dynamic Weather** actor from the Blueprints folder into the scene. It detects UDS automatically and hooks everything up.

By default, UDW starts with a manual weather state matching the Cloud Coverage and Fog already set on UDS. The **Weather** variable in Basic Controls lets you apply different weather presets immediately.

## Basic Controls

| Setting | Purpose |
| --- | --- |
| `Weather` | Select a weather preset (Rain, Partly Cloudy, Blizzard, Thunderstorm, etc.). Clearing → falls back to Manual Weather State. |
| `Wind Direction` | Degrees. Drives weather particle movement *and* cloud movement on UDS. |

Advanced dropdown holds additional knobs (Control Point Location Source — see `udw-spatial-weather`; configuration override — see `uds-modifiers-configs-state`).

## Weather state

The set of values that defines "what weather is" right now.

| State value | Type | Notes |
| --- | --- | --- |
| Cloud Coverage | float | If UDS-only project, set on UDS; if UDW present, UDW owns it |
| Fog | float | Same |
| Wind Intensity | float | Drives wind effects (gusts, particles, physics force) |
| Rain | float | Drives rain particles, drips, screen droplets |
| Snow | float | Drives snow particles, screen frost, breath |
| Dust | float | Drives dust particles, fog dust color contribution |
| Thunder/Lightning | float | Drives lightning flash interval, obscured lightning |

Plus material state — drives material effect functions:

| Material state value | Drives |
| --- | --- |
| Material Snow Coverage | Snow coverage in DLWE / Surface Weather Effects |
| Material Wetness | Wetness / puddles in DLWE / Surface Weather Effects |
| Material Dust Coverage | Dust coverage in Surface Weather Effects |

The visible material state at runtime isn't always *directly* the weather state values — see `udw-material-and-screen-effects` for the `Simulate Changing Material State Over Time` option.

### What determines weather state

The active state can come from any combination of these sources (specificity layers from global → local):

| Source | Scope |
| --- | --- |
| `Weather` preset in Basic Controls | Global default |
| `Change Weather(preset, duration)` function | Global, transitions |
| Random Weather Variation | Global, periodic (see `udw-random-seasons-temperature`) |
| Manual Weather State | Global, used when no preset selected. Per-value override toggles. |
| Weather Override Volumes | Local to a spline region (see `udw-spatial-weather`) |
| Radial Storms | Local circular region with visible distant storm effects (see `udw-spatial-weather`) |

## Weather Settings Presets

Preconfigured weather states as data assets. Used by `Weather`, `Change Weather`, Random Weather Variation, Weather Override Volumes, and Radial Storms.

```
Blueprints/Weather_Effects/Weather_Presets/
   ├── Rain
   ├── Partly_Cloudy
   ├── Blizzard
   ├── Thunderstorm
   └── ...
```

### Creating custom presets

Easiest: duplicate one of the included assets in `Blueprints/Weather_Effects/Weather_Presets/` and edit its settings. Your new asset works everywhere the included ones do.

### Custom Weather Behavior (per-preset Blueprint logic)

The `UDS_Weather_Settings` data asset class has a `Custom Weather Behavior` function meant for override. To add custom logic to a preset:

```
1. Create a child of UDS_Weather_Settings
2. Override Custom Weather Behavior
   (parent applies the Sky Modifier on the preset — call Super if using one)
3. Make data assets using the child class
```

The function has an **Alpha** input (0–1): how much this preset is currently affecting local weather state. Called at runtime as weather state changes in any way involving this preset.

## Change Weather

To trigger a weather change at runtime (instantly or over a duration):

```
UDW.ChangeWeather(targetPreset, transitionLengthSeconds)
```

The new global state stays applied indefinitely, until another change is called for.

| Call | Effect |
| --- | --- |
| `ChangeWeather(Blizzard, 10)` | Transitions to Blizzard over 10 seconds |
| `ChangeWeather(null, 5)` | Transitions to Manual Weather State over 5 seconds |
| `ChangeToRandomWeatherVariation()` | Returns to random variation after a manual override |

## Manual Weather State

For individual weather values without a preset. Category: **Manual Weather State**.

```
1. Clear the Weather setting in Basic Controls (no preset selected)
2. Edit values in the Manual Weather State category — they become active
```

### Per-value overrides

Override one value while keeping the rest from a preset. Example: Thunderstorm preset is active, but set `Manual Rain Override = true` and pick a custom `Manual Rain` value — rain comes from your manual value, everything else from Thunderstorm.

Each weather state value has an override toggle and a manual value pair in this category.

## Sampling weather state (runtime)

| Function | Output |
| --- | --- |
| `Get Cloud Coverage` | float (blueprint function library) |
| `Get Wind Intensity` | float |
| *(and one Get function per state value)* | Each weather state value |
| `Get Local Weather State` *(off a UDW reference, or via the library)* | The current `Weather Settings` object used by effects/sky |
| `Get Display Name for Current Weather` | Text label like "Light Rain", "Blizzard" |

`Get Display Name for Current Weather` is what to call when you want to surface a weather label in UI without parsing individual values. For temperature, see `udw-random-seasons-temperature`.

## Weather event dispatchers

Bind events from your blueprints. Pattern:

```
UDW = GetUltraDynamicWeather()
UDW.OnStartedRaining.AddDynamic(this, &MyActor::OnRainStart)
// Or in Blueprint: Bind to Started Raining → Custom Event
```

| Dispatcher | Fires when |
| --- | --- |
| `Started Raining` / `Finished Raining` | Rain crosses a threshold |
| `Started Snowing` / `Finished Snowing` | Snow crosses a threshold |
| `Dust/Sand Forming` / `Dust/Sand Clearing` | Dust crosses a threshold |
| `Getting Cloudy` / `Clouds Clearing` | Cloud coverage crosses a threshold |
| `Getting Foggy` / `Fog Clearing` | Fog crosses a threshold |
| `Weather Display Name Changed` | Output of `Get Display Name for Current Weather` changes — best generic "weather changed" hook |
| `State Change - <Value>` | A specific weather state value changes. Bind to `State Change - Rain` for any rain change. |

The threshold for the started/finished dispatchers is in the **Event Dispatchers** category on UDW.

## Actor Weather Status component

Per-actor weather tracking. Intended for important actors (e.g. the player pawn) that need to constantly monitor their own status.

At runtime, the component periodically traces to test exposure and tracks how the actor's temperature is affected. All values are in the component's **Status** category.

Features:

| Feature | Detail |
| --- | --- |
| Per-component event dispatchers | Fires when *this actor* gets exposed to rain or snow, or temperature passes thresholds for hot/cold. Different from UDW's global dispatchers. |
| Material Effects array | Add dynamic material instances to have UDW-style parameters set using *the actor's* local status: `Wet`, `Raining`, `Snowy`, `Dusty`, `Wind Intensity` (all 0–1). UDW material functions have a `Use Local Parameters` input that pairs with this. |

### One-off exposure query without a component

```
UDW.TestActorForWeatherExposure(actor) → rain, wind, snow, dust (each 0-1)
// Floats combine weather intensity with actor exposure.
// 1.0 = fully exposed to that effect at max intensity.
```

## Sequencer

To animate the weather state in Sequencer, use **Manual Weather State** and keyframe its variables.

For material effects (Material Wetness/Snow Coverage/Dust Coverage), to make keyframes look identical at runtime to in-sequence: in the **Material Effects** category, **disable** `Simulate Changing Material State Over Time`. Otherwise runtime gradually transitions between values instead of matching keyframes precisely.

## Multiplayer replication

UDW replicates weather state for multiplayer:

| What replicates | How |
| --- | --- |
| Global Weather State source assets | Preset assets used by the transition system, random variation, Weather Override Volumes, Radial Storms. Not raw state values. |
| Clients construct Local Weather State themselves | Each player can experience their own local weather (e.g. different WOVs they're inside); the underlying state of the volumes/storms is shared. |

Result: updates only need to go over the wire when a state-source change starts. Between updates, clients track state the same way the server does.

## Gotchas

- **`Cloud Coverage` / `Fog` on UDS ignored** — UDW is in the scene; it owns those values. Set on UDW's weather state instead.
- **`Change Weather` doesn't appear to transition** — `transitionLengthSeconds` was 0 (instant change). Pass a duration for a smooth transition.
- **Setting `Weather` to a preset has no effect at runtime** — preset assignment is editor-time. Use `ChangeWeather(preset, duration)` from blueprint to switch at runtime.
- **Material wetness/snow doesn't match keyframes in Sequencer** — `Simulate Changing Material State Over Time` is on. Disable it for direct keyframe playback.
- **Manual Rain value ignored** — `Manual Rain Override` is off. Override toggles must be enabled for per-value manual values to apply.
- **Weather display name shows "Manual Weather"** — no preset is selected; UDW falls back to Manual Weather State. Set the `Weather` variable or call `ChangeWeather(preset, ...)`.
- **Per-actor wetness in materials not working** — the material's `Use Local Parameters` pin isn't set, or the dynamic material instance wasn't added to the Actor Weather Status component's Material Effects array.
- **Started Raining / Started Snowing fires at the wrong threshold** — adjust thresholds in the **Event Dispatchers** category on UDW.
- **Random Weather Variation overriding `ChangeWeather`** — call `ChangeToRandomWeatherVariation()` to return control, or disable Random Weather Variation in its category.

## References & source material

Docs (Ultra Dynamic Weather 9.5):
- [Adding Ultra Dynamic Weather to Your Level](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-78)
- [Basic Controls](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-79)
- [What is Weather State?](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-81)
- [What Determines the Weather State?](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-82)
- [Weather Settings Presets](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-83)
- [Change Weather](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-84)
- [Manual Weather State](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-87)
- [Sampling the Weather State from UDW](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-112)
- [Weather Event Dispatchers](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-115)
- [Actor Weather Status](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-116)
- [Custom Weather Behavior](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-135)
- [Technical Notes — Replication (UDW)](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-183)

Plugin asset paths:
- `Blueprints/` — Ultra Dynamic Weather actor (drag from here)
- `Blueprints/Weather_Effects/Weather_Presets/` — included preset data assets (`UDS_Weather_Settings`)
- `Blueprints/Weather_Effects/` — Actor Weather Status component

Related skills: `uds-setup-and-modes` (UDS must exist first), `udw-random-seasons-temperature`, `udw-spatial-weather`, `udw-particles-lightning-wind-sounds`, `udw-material-and-screen-effects`, `uds-modifiers-configs-state` (Apply Weather Configuration, save/load state).
