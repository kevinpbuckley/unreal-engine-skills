---
name: udw-random-seasons-temperature
description: Configure dynamic weather variation, seasons, climate, and temperature on Ultra Dynamic Weather. Covers Random Weather Variation (Random Interval / Daily / Hourly timing, Weather Type Probabilities, Transition Length, Begin Play Weather is Random, Change to Random Weather Variation), Seasons (0-4 float, Set Season, Season Mode driven by date, Meteorological vs Astronomical, Sample UDW Season + Season Color Blend material nodes), Climate Presets (real-world data setting probability + temperature ranges), Temperature (Get Current Temperature with F/C, Temperature Bias, Min/Max per season, Sample Location Global vs local, Interior Temperature), Temperature Volumes, and the UDW Thermometer widget. Use whenever the user asks about random weather, season cycling, climate presets, temperature reading, hot/cold zones, or what season it is.
metadata:
  asset: Ultra Dynamic Weather (marketplace)
  category: weather-variation
  source-docs: https://www.ultradynamicsky.com/Documentation/V9/9-5
---

# UDW random weather, seasons, climate, temperature

The systems that make weather feel naturally varied over time: random variation, seasonal cycles, climate-aware probability, and the temperature system that derives values from all of it.

| System | Where | Purpose |
| --- | --- | --- |
| Random Weather Variation | **Random Weather Variation** category | Periodic random weather changes per season-weighted probability |
| Seasons | **Season** category | 0–4 float (Spring → Winter) driving probability maps + temperature ranges |
| Climate Presets | **Random Weather Variation** category | One-shot real-world climate data → probabilities + temperature |
| Temperature | **Temperature** category | Calculated from weather state + season + biases + interior |
| Temperature Volumes | `Blueprints/Weather_Effects/` actor | Per-region temperature offsets |

## When to use this skill

- Setting up weather that changes by itself periodically.
- Making weather change with seasons.
- Picking a real-world climate (tropical, alpine, desert) for a region.
- Reading temperature in F or C from gameplay code.
- Adding local hot zones (near fire) or cold zones.
- Displaying current temperature on screen.
- Driving materials based on the season.

## Random Weather Variation

Periodically picks a new weather preset based on season and probability maps. Category: **Random Weather Variation**.

### Timing modes

| `Random Weather Variation` mode | Trigger |
| --- | --- |
| **Random Interval** | `Random Weather Change Interval` (min/max seconds) — system holds a preset for a random time then picks a new one |
| **Daily** | Once per in-game day at the time set by `Random Weather Change Hour` |
| **Hourly** | Each in-game hour |

`Transition Length` — fraction of the interval between changes devoted to transitioning old → new.

### Probability maps

The **Weather Type Probabilities** maps hold weather presets and their relative probabilities. Values are *relative*:

```
{ Rain: 5, Partly Cloudy: 1, Clear: 1 }
   → Rain is 5x as likely as either of the others
```

Which map is *used* depends on the current season (see below). Different probability maps per season is how spring rains differ from summer heat.

### Begin Play behavior

| `Begin Play Weather is Random` | Behavior at play start |
| --- | --- |
| True | A random weather is selected on play start |
| False | Starts with whatever weather the level editor was displaying; changes after the first interval |

### Climate Presets

Same category — apply a **climate preset** to populate the probability maps with real-world climate data, and set temperature ranges in the **Temperature** category accordingly. Fastest way to get believable weather for "tropical jungle", "alpine", "desert", etc.

### Returning to random after a manual change

`Change Weather` (see `udw-setup-and-state`) switches to a static preset. To go back:

```
UDW.ChangeToRandomWeatherVariation()
```

## Seasons

Category: **Season**. The `Season` variable is a float 0–4:

| Value | Meaning |
| --- | --- |
| 0 | Mid Spring |
| 1 | Mid Summer |
| 2 | Mid Fall |
| 3 | Mid Winter |
| 4 | Wraps back to Spring |

Whole values = middle of a season (where its data is applied purely). In-between values = transition. `0.5` = half Spring + half Summer.

### Where Season comes from

| `Season Mode` setting | Behavior |
| --- | --- |
| Derived from date | Uses UDS's date (Simulation category, increments per day). See `uds-simulation`. |
| Uncontrolled | `Season` variable is uncontrolled — set yourself via `SetSeason(value)` |

When deriving from date:

| Setting | Effect |
| --- | --- |
| `Season Day Offset` | Shifts what date corresponds to what season value |
| `Meteorological Seasons` | Whether the seasons (at offset 0) represent meteorological or astronomical |

### Sampling season in materials

| Material node | Output |
| --- | --- |
| `Sample UDW Season` | 0–1 per season (four values, total = 1) |
| `Season Color Blend` | Blends 4 color inputs based on current season |

Use for season-driven material effects (autumn foliage colors, winter rock tinting).

## Temperature

Category: **Temperature**. Sample via:

```
UDW.GetCurrentTemperature(unit, sampleLocation)
// unit: Fahrenheit or Celsius
// sampleLocation: Global, or per-location (volumes + interior)
```

### How temperature is calculated

Treated as a **product** of weather, not a driver of it:

```
1. Start at 0
2. Add every Temperature Bias value in the Temperature category
   (biases reflect factors like Time of Day and weather state)
3. Map the resulting -1..1 value into the Min/Max range for current season
4. Add a slowly-changing random value, scaled by Randomize Temperature
5. If sampleLocation != Global:
   - Sample Temperature Volumes in the level
   - Apply Interior Temperature based on Player Occlusion of the sample point
     (Player Occlusion is on UDS — see uds-modifiers-configs-state)
```

### Temperature and Weather Override Volumes

Weather Override Volumes apply their own temperature ranges while the player is inside. Configurable per-WOV or disablable. See `udw-spatial-weather`.

### Temperature Volumes

Actor class **Temperature Volume** at `Blueprints/Weather_Effects/`. Place to create local temperature effects.

Example: place around a fire with a positive `Temperature Offset` — temperature sampled inside the volume reads higher.

### Show temperature on-screen

**UDW Thermometer** widget in the widget designer palette under **Ultra Dynamic Sky Widgets**. Samples and displays current temperature. Drop into a UMG widget.

## Runtime / Blueprint scripting summary

| Action | API |
| --- | --- |
| Change weather to a preset | `ChangeWeather(preset, transitionLength)` |
| Change to manual state | `ChangeWeather(null, transitionLength)` |
| Switch from manual back to random | `ChangeToRandomWeatherVariation()` |
| Set season manually | `SetSeason(value)` (when Season Mode isn't deriving from date) |
| Sample temperature | `GetCurrentTemperature(unit, sampleLocation)` |
| Sample season in materials | `Sample UDW Season` MF, `Season Color Blend` MF |

## Gotchas

- **Random Weather Variation doesn't fire** — mode is set to something other than Random Interval / Daily / Hourly. Pick a timing mode.
- **Begin Play weather isn't random** — `Begin Play Weather is Random` is false. Set it true.
- **Random weather always picks the same preset** — probability map has a strong bias toward one entry; or there's only one entry in the map. Verify the map for the current season.
- **`SetSeason` has no effect** — `Season Mode` is set to derive from date, which overrides manual season. Switch Season Mode to "Uncontrolled" first.
- **Temperature reads always the same despite weather changing** — `Temperature Bias` values aren't configured for the weather you care about. Add bias entries for that weather/time-of-day.
- **`GetCurrentTemperature(local)` reads same as Global** — sample location is set to Global, or there are no Temperature Volumes / Player Occlusion isn't computing occlusion at that location. See `uds-modifiers-configs-state`.
- **Climate preset overwrote a custom probability map** — applying a climate preset is destructive to the maps. Save a config asset first (see `uds-modifiers-configs-state`) before experimenting.

## References & source material

Docs (Ultra Dynamic Weather 9.5):
- [Random Weather Variation](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-85)
- [Seasons](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-86)
- [Sampling Temperature](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-113) (incl. how temperature is calculated, Temperature Volumes, on-screen display)

Plugin asset paths:
- `Blueprints/Weather_Effects/Weather_Presets/` — preset assets weighted by the probability maps
- `Blueprints/Weather_Effects/` — Temperature Volume actor class
- Widget designer palette → **Ultra Dynamic Sky Widgets** → UDW Thermometer

Related skills: `udw-setup-and-state`, `uds-simulation` (date drives season when Season Mode set to derive), `udw-spatial-weather` (WOVs override temperature ranges locally), `uds-modifiers-configs-state` (Player Occlusion drives Interior Temperature), `udw-material-and-screen-effects` (Freezing Breath uses calculated temperature).
