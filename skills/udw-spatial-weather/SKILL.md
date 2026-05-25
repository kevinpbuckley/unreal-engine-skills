---
name: udw-spatial-weather
description: Apply weather to specific regions of a level with Ultra Dynamic Weather — Weather Override Volumes (spline-defined arbitrary shape, Transition Width, Priority, Apply Wind Direction, climate preset, runtime ChangeWeather/ChangeToRandomWeatherVariation, Custom Volume Behavior), Radial Storms (circular weather actor visible from outside as a distant storm with clouds/fog/obscured lightning, spawning system, Fade In/Out, Move Over Time), Weather Above Volumetric Clouds adjustments, the Weather Mask system (Brush, Projection Box, Brush Painter editor utility) for masking material effects in interiors, and Control Point Location Source. Use any time the user asks about per-region weather, a localized storm, weather differing by area, a moving storm, a storm visible from a distance, the player driving into bad weather, weather changing above the cloud layer, or keeping snow/wetness out of an interior.
metadata:
  asset: Ultra Dynamic Weather (marketplace)
  category: spatial-weather
  source-docs: D:\UDSdocs.txt (lines 1084-1144, 1440-1474)
---

# UDW spatial weather

The systems that make weather happen *somewhere specific* rather than globally. WOVs and Radial Storms drive state per location; the Weather Mask system excludes material effects from interiors and under-roof areas.

| System | Shape | Visible from outside? | Use for |
| --- | --- | --- | --- |
| **Weather Override Volume** | Arbitrary spline | No | Region-specific weather state, with arbitrary shape |
| **Radial Storm** | Circle | **Yes** (clouds, fog, obscured lightning) — requires Volumetric Clouds Sky Mode | A storm seen approaching from a distance; moving storms |
| **Weather Above Volumetric Clouds** | Above cloud layer | Implicit | Auto-adjusting weather state when the player flies above the cloud layer |
| **Weather Mask Brush** | Simple shape or painted texture, projected straight down | No | Mask material effects (snow/wetness) in interiors |
| **Weather Mask Projection Box** | Box-bounded capture of meshes inside, projected down | No | Mask material effects under structures (roofs) |

## When to use this skill

- Different weather in different parts of one level.
- A storm the player can see coming in from across the map.
- A storm that moves linearly across the level over time.
- Adjusting weather behavior when the camera goes above the cloud layer.
- Keeping snow accumulating inside a building, or wetness off the floor under a roof.

## Weather Override Volumes (WOV)

Actor for region-specific weather. Found at `Blueprints/Weather_Effects/`.

The region shape is defined by the actor's **spline component** — edit spline points for any shape. Right-click on the spline to add new points. You can scale the actor; avoid non-uniform scaling.

WOV weather configuration mirrors UDW's global controls:

- Select a preset for the WOV in its **Basic Controls** category.
- Enable Random Weather Variation on the WOV with its own probability maps. Timing/logic specifics come from UDW's Random Weather Variation category.

### Key WOV settings

| Setting | Effect |
| --- | --- |
| `Transition Width` | How much space the volume devotes to blending outside → inside weather. The blend is purely spatial. **Default is small to keep the actor compact; a real-use WOV should be much larger with a wider transition width**, so players cross a smooth gradient. |
| `Priority` | How overlapping WOVs resolve |
| **Temperature** category | Local temperature range while the player is inside |
| Climate preset | Same effect as on UDS: sets probability maps + temperature ranges |
| `Apply Wind Direction` | If true, the volume's wind direction overrides as the player enters |

### Where the player is queried from

The location used to test against WOVs is set by **Control Point Location Source** in **Basic Controls** on UDW. Defaults to player pawn location.

| Control Point Location Source | Where weather/DLWE interactions sample from |
| --- | --- |
| Player Pawn *(default)* | Pawn location |
| Player Camera | Camera location |
| Manual | Vector variable you control |

### Material state across the WOV boundary

By default, WOVs draw their material state into a render target sampled by the weather material functions, so:

- A snowy region appears snowy from outside.
- From inside, you see the lack of snow coverage outside.

Disable or adjust on UDW from the **Weather Override Volumes** category.

### Runtime WOV functions

| Function | Effect |
| --- | --- |
| `ChangeWeather(preset, duration)` (on WOV) | Transitions the WOV to a specific static preset |
| `ChangeToRandomWeatherVariation()` (on WOV) | Transitions the WOV to its random variation |

### Custom Volume Behavior

To use a WOV for something other than weather (e.g. fire custom events when the player crosses into the region):

```
1. Create a child of the Weather Override Volume class
2. Override Custom Volume Behavior on the child

The function runs from UDW when the WOV affects local weather.
Input: Alpha (0-1) — how much the player is inside the volume.
```

## Radial Storms

Circular weather region actor. **Unique vs WOVs**: can render its own *local effects* and *local cloud coverage* — players see the storm in the distance as a cloud formation with fog and obscured lightning beneath. Built to be dynamic — spawn at runtime, fade in/out, move linearly.

### Constraints

| Constraint | Detail |
| --- | --- |
| Distant-storm visuals only work with Sky Mode = Volumetric Clouds | With other Sky Modes, a Radial Storm still works to affect weather state by player position (like a WOV), just without visible distant storm |
| Despite the name, can apply *any* weather inside (incl. calm/clear) | Named for the typical use case |

### Periodic spawning

UDW's **Radial Storm Spawning** category enables periodic randomized spawning during play. UDW spawns radial storms one at a time, placing/moving them so they pass over the player. The weather preset can be season-determined (similar to Random Weather Variation in `udw-random-seasons-temperature`).

### Manual spawning and control

You can spawn at runtime or place one in the editor — UDW's spawning system isn't required.

| Function on the Radial Storm actor | Effect |
| --- | --- |
| `Fade In Storm(duration)` | Start storm fading from 0 → 1 alpha. Use after spawning. |
| `Fade Out Storm(duration)` | Fade out over time, then destroy the actor |
| `Move Storm Over Time(targetPosition, duration, fadeOutAtEnd)` | Move linearly to target over duration. Optional final-fade-and-destroy. |

Example flow:

```
storm = SpawnActor(RadialStorm_BP, location)
storm.FadeInStorm(30)                              // 30s fade in
storm.MoveStormOverTime(targetPos, 200, true)      // 200s movement
// fade-out auto starts in last 30s of the movement
```

## Weather Above Volumetric Clouds

When UDS's Sky Mode is **Volumetric Clouds**, UDW by default adjusts weather state when the player goes above the cloud layer.

Configurable in the **Weather Above Volumetric Clouds** category on UDW. Enable/disable the adjustments entirely, or change the multipliers per weather value used when above clouds.

## Weather Mask System

Masks the material weather effects (snow, dust, wetness) in specific spaces — by default they affect everywhere globally.

Two component classes at `Blueprints/Weather_Effects/Components/` draw into a weather mask render target sampled by the weather material functions. Use the components directly in your actors, or use wrapper actor classes in `Blueprints/Weather_Effects/`.

### Weather Mask Brush

Draws a simple shape or a painted texture. The actor's `Brush` variable selects between them. Can be scaled non-uniformly and rotated on Z axis.

Because the system works by drawing into a render target, shapes are **always projected straight down on Z axis**.

| Per-brush setting | Effect |
| --- | --- |
| `Mask Wetness` | How much this brush masks wetness |
| `Mask Snow/Dust` | How much this brush masks snow/dust |
| `Cancel Masks Above` | Disables any brush masking above the actor's height within the brush's rectangle |

#### Painted brush textures

For more control than simple shapes, paint a texture using the **Weather Mask Brush Painter**:

- **Ultra Dynamic Sky** dropdown on the level editor toolbar, *or*
- `Blueprints/Tools/`

With the painter open, select a weather mask brush actor and click the button to start painting. Controls:

| Input | Action |
| --- | --- |
| Right-click | Pan |
| Drag middle mouse | Zoom |
| Left mouse | Paint |
| Top bar | Adjust brush and value being painted |

When finished, click **Save** — painted mask saves to a texture in `UDS_LevelData/` next to the level.

### Weather Mask Projection Box

Captures meshes within the box and uses their shapes to mask weather effects straight down. Place around a complex structure (e.g. a building) and the mesh shapes occlude directly beneath them.

Placement tips:

- Place the box so it encompasses **only** the relevant mesh geometry. e.g. enclose just the roof of a house.
- Width/length as small as possible to fit the occluding geometry — eliminates wasted render-target resolution.

| Per-box exposed setting | Effect |
| --- | --- |
| Amount snow/dust and wetness masked | Per-component mask strength |
| Blur of the mask beneath the box when drawn into the target | Softness |

### Material-level opt-out

Static switch parameters on individual materials/instances:

| Parameter | Effect |
| --- | --- |
| `Apply Weather Mask Brushes to Wetness` | Disable mask effects on wetness in this material |
| `Apply Weather Mask Brushes to Snow` | Same for snow |

### Mask distance and update

Mask effects stop at a certain distance from the camera, set by the render target width. Adjust in **Weather Mask Target** category on UDW.

### Fading a mask component

```
WeatherMaskBrush.FadeMaskOverTime(duration)
// or
WeatherMaskProjectionBox.FadeMaskOverTime(duration)
// Default fade rate: 20 updates/sec.
// Adjust via Weather Mask Update Period on UDW.
```

## Gotchas

- **WOV transition looks abrupt** — `Transition Width` is too small (default is). Make it much larger so the player crosses a smooth gradient.
- **Radial Storm not visible from outside** — Sky Mode isn't Volumetric Clouds. Distant-storm visuals require Volumetric Clouds; with other modes the storm still affects state but renders no visible distant storm.
- **WOV not affecting weather** — `Control Point Location Source` is set to a custom vector that isn't where the player is. Default to Player Pawn.
- **Weather Mask not stopping snow inside a building** — Weather Mask Brush or Projection Box not placed; or `Mask Snow/Dust` value too low; or render target distance exceeded.
- **Mask Projection Box has artifacts** — box is too large, wasting render-target resolution. Shrink to just enclose the occluding geometry.
- **Material ignoring Weather Mask** — `Apply Weather Mask Brushes to Wetness/Snow` static switches on the material are off.
- **Snow visible outside the WOV from inside** — `Weather Override Volumes` category on UDW has the material-state-rendering option turned off. Enable it for "snowy outside / not snowy inside" reads.
- **Per-storm logic from a child class not running** — for a WOV, override `Custom Volume Behavior` (not the parent's behavior). For a Radial Storm, similar pattern via child class.
- **Wind direction not changing inside a WOV** — `Apply Wind Direction` on the WOV is off. Enable for region-specific wind.

## References & source material

Docs: `D:\UDSdocs.txt`
- Weather Override Volumes — lines 1084-1108
- Radial Storms — lines 1111-1138
- Weather Above Volumetric Clouds — lines 1140-1144
- Weather Mask Brush — lines 1446-1456
- Weather Mask Projection Box — lines 1458-1473

Plugin asset paths:
- `Blueprints/Weather_Effects/` — Weather Override Volume, Radial Storm, Weather Mask Brush, Weather Mask Projection Box actor classes
- `Blueprints/Weather_Effects/Components/` — Weather Mask Brush and Projection Box component classes (for embedding in your own actors)
- `Blueprints/Tools/` — Weather Mask Brush Painter editor utility
- `UDS_LevelData/` (created next to the level) — painted weather mask textures

Related skills: `udw-setup-and-state`, `udw-random-seasons-temperature`, `udw-material-and-screen-effects`, `uds-setup-and-modes` (Volumetric Clouds required for Radial Storm distant visibility), `uds-modifiers-configs-state` (UDS Occlusion Volume for forced player occlusion).
