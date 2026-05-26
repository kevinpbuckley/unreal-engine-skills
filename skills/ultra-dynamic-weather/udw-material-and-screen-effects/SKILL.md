---
name: udw-material-and-screen-effects
description: Add weather-responsive material effects and screen-space effects with Ultra Dynamic Weather — Surface Weather Effects (wetness/snow/dust/dripping/droplets), Dynamic Landscape Weather Effects V3 (DLWE) with the DLWE Interaction component for trails/ripples, Glass Window Rain Drips, Foliage Wind Movement, Water Surface Rain Ripples, the Sample UDW Material State / Season / Wind nodes, plus screen/environmental effects — Rainbow, Screen Droplets, Screen Frost, Heat Distortion, Post Process Wind Fog, Puddle Fluid Volume (with fluid interactions), Dripping Mesh Particles, Freezing Breath, Rain Drip Spline (with icicles), and the Weather Occlusion Volume. Use any time the user asks about materials responding to weather, footprints/tracks in snow, puddles, rain on windows, foliage sway, rain ripples on water, rainbow, screen droplets/frost, heat haze, breath in cold weather, or water dripping from a roof edge.
metadata:
  asset: Ultra Dynamic Weather (marketplace)
  category: material-and-screen-effects
  source-docs: D:\UDSdocs.txt (lines 1240-1474, 1700-1839)
---

# UDW material and screen effects

Everything UDW renders into materials (per-object) and the camera (screen/post) in response to weather, plus helper actors/components for placing the effects.

| Effect | Type | Driven by |
| --- | --- | --- |
| Surface Weather Effects | Material function | Material wetness / snow / dust |
| Dynamic Landscape Weather Effects V3 (DLWE) | Material function | Material wetness / snow / dust + DLWE Interaction component |
| Glass Window Rain Drips | Material function | Rain |
| Foliage Wind Movement | Material function (WPO) | Wind |
| Water Surface Rain Ripples | Material function | Rain |
| Rainbow | Material in sky / screen | Rain + fog + sun exposure |
| Screen Droplets | Screen effect | Rain + camera facing |
| Screen Frost | Screen effect | Snow / material snow / manual |
| Heat Distortion | Post process | Temperature (or manual) |
| Post Process Wind Fog | Post process | Fog / Rain / Snow / Dust + wind |
| Puddle Fluid Volume | Actor (real water mesh) | Weather state |
| Dripping Mesh Particles | Niagara on mesh | Rain / material wetness |
| Freezing Breath | Niagara on actor | Cold temperature |
| Rain Drip Spline | Spline actor | Rain (+ optional icicles in cold) |
| Weather Occlusion Volume | Volume texture | Distance field |

## When to use this skill

- Making props or scenery materials respond to weather (wet, snowy, dusty).
- Adding footprints/tire tracks in snow or sand (landscape).
- Adding puddles to a landscape; a real water puddle in a recess.
- Rain drops dripping on glass windows.
- Foliage swaying in the wind.
- Rain ripples on water surfaces.
- Rainbow after a storm.
- Camera effects (droplets on the lens, frost, heat haze).
- Character breath visible in cold weather.
- Water dripping from a roof edge, or icicles hanging.

## Material Effects Overview

UDW exposes material functions that make your materials respond to weather's changing **material state**:

| Function | Use for |
| --- | --- |
| **Surface Weather Effects** | Solid surfaces (props, architecture) — not landscapes |
| **Dynamic Landscape Weather Effects V3** (DLWE) | Landscapes / ground meshes; supports interactive trails and ripples |
| **Glass Window Rain Drips** | Flat translucent glass |
| **Foliage Wind Movement** | Foliage models (WPO) |
| **Water Surface Rain Ripples** | Water surface normal |

### Simulate Changing Material State Over Time

In the **Material Effects** category on UDW.

| Setting | Behavior at runtime |
| --- | --- |
| Enabled *(default)* | Runtime material state changes gradually as weather changes (snow gradually accumulates while it snows) |
| Disabled | Runtime material state matches weather state directly. Changing Snow → Partly Cloudy makes Material Snow Coverage drop to 0 instantly. Required for Sequencer keyframes to play back identically. |

The time over which each transition happens (per weather type) is set in the same category.

## Surface Weather Effects

For solid scenery: props, architecture, decorations.

### Setup

```
1. Material palette → search "Weather" → Surface Weather Effects
2. Place at end of material graph, before material result
3. Uses Material Attributes pin (in + out)
   If your material doesn't use one, wrap with Make/Break Material Attributes
4. Static Bool nodes for "Apply Wetness" + "Apply Snow / Dust"
   Disabling unused effects reduces material complexity
5. Default UVs are world space (good for static scenery)
   For moving / skeletal: plug True into "Local Space" or "For Skeletal Mesh"
```

### Dripping and Droplets

Optional effects on wet surfaces, enabled via True into the `Dripping` and `Droplets` inputs.

| Effect | Look |
| --- | --- |
| Dripping | Rivulets of water moving down where wet |
| Droplets | Small water beads clinging to a smooth surface |

Both influenced by **Porosity** (0–1):

| Porosity | Surface example |
| --- | --- |
| 0 | Car paint, plastic (smooth) |
| 1 | Concrete, sand (rough) |
| (unwired) | Derived from material roughness |

### Snow/Dust direction on rotating models

With Local Space or For Skeletal Mesh on, snow/dust uses the local normal — so it rotates with the model (snow on the side of a tipped-over object).

Fix: add the **Material Snow Dust Reorient** component as a child of the mesh. On begin play, add the dynamic material instance(s) using weather effects to the component's **Dynamic Material Instances** array. The component monitors rotation and slowly reorients snow/dust to face global up.

## Dynamic Landscape Weather Effects V3 (DLWE)

For landscapes and large ground meshes. More involved than Surface Weather Effects. Example in the UDS demo map.

### Setup

```
1. Material palette → search "Weather" → Dynamic Landscape Weather Effects V3
2. End of material graph, before material result
3. Uses material attributes pin (in + out) — same wrap pattern if needed
4. Static bools for "Apply Snow/Dust" + "Apply Wetness/Puddles"
```

### Interactions (Trails and Ripples)

Moving actors can leave trails in snow/dust and ripples in puddles via the **DLWE Interaction component**.

Add as a scene component, parented to any moving component on an actor, or to a bone. e.g. character footprints in snow → one DLWE Interaction component per foot, parented to each foot socket.

| Setting | Effect |
| --- | --- |
| `Size` | How far interaction effects spread *and* how big the effects are. Match the diameter of the object it represents. |
| **DLWE Interaction Settings asset** | The full interaction configuration the component references. Use the default or create your own. |

### Render Target Area

Snow/dust trail interactions only happen within a render target area around the player. Scale: **Snow/Dust Interaction Render Target Area** on UDW.

The target dynamically recenters as the player pawn moves. To recenter from a different location, change **Control Point Location Source** in **Basic Controls** on UDW.

### Nanite Tessellation

DLWE supports nanite tessellation for snow/dust depth on nanite landscapes.

```
1. Project Settings: enable Nanite Tessellation
2. Material: check "Enable Tessellation"
3. Landscape actor: enable Nanite + build nanite mesh
4. DLWE node: plug True into "For Nanite Tessellation"
5. Set "Nanite Tessellation Magnitude" + "Nanite Tessellation Center"
   to match the material's tessellation settings.
   New landscape material with no existing displacement: Magnitude=1, Center=0
6. If you have existing displacement: plug False into
   "Displacement Input is World Scale" to keep DLWE from modifying it
```

### Blocking interaction effects with physical materials

Arrays on UDW, advanced dropdown of **DLWE** category:

| Array | Effect |
| --- | --- |
| `Physical Materials Which Disable Snow/Dust Sounds And Particles` | Phys mats in this array block snow/dust interaction effects |
| `Physical Materials Which Disable Puddle Sounds And Particles` | Same for puddles |

### Using DLWE on non-landscape meshes

To make Interaction components respond to surfaces other than landscape actors:

- Add physical materials for those surfaces to **Physical Materials which Enable DLWE Interactions on Non-Landscapes** in the DLWE Interaction Settings asset.
- Ensure static meshes use those phys mats.

### Virtual Shadow Maps

Set the landscape's **Shadow Cache Invalidation Behavior** to **Rigid** — keeps the WPO and Pixel Depth Offset used for snow depth from constantly invalidating shadows.

### Applying trail effect to underlying landscape layers

For other landscape layers (mud, sand) to also receive the snow/dust trail effect:

```
1. In material: give DLWE a "Custom Trail Surface Mask" input
   (0-1, typically from landscape layer samples)
2. In DLWE Interaction Settings asset:
   Add the relevant phys materials to
   "Custom Trail Surface Physical Materials"
   → component draws trails against those phys mats
     even with no snow/dust coverage present
```

Custom surface depth ranges from 0 to snow depth, scaled by the Custom Trail Surface Mask. Nanite tessellation gives the most convincing result.

### DLWE Interactions Not Happening

- Landscape needs World Static simple collision responding to queries and blocking Visibility. (Non-landscapes: see above.)
- DLWE Interaction component positioned and sized to trigger interactions.
- **Control Point Location Source** in advanced dropdown of Basic Controls — DLWE interactions happen around this point. Far camera = no visible effects.

## Glass Window Rain Drips

Refractive water droplets dripping down thin glass surfaces. Translucent materials only.

### Setup

```
1. Material palette → search "Weather" → Glass Window Rain Drips
2. Modifies Base Color + Opacity
   Outputs Base Color, Emissive Color, Opacity
   Use all three outputs for material result
3. UVs default to world space
   For moving surfaces, replace via the UVs input
```

## Foliage Wind Movement

Outputs world position offset for noise-based foliage movement based on UDW's wind. Foliage-focused.

If your foliage already has wind setup, it may be simpler to modify those effects to reference UDW's wind via the **Sample UDW Wind** node instead.

### Movement layers

| Layer | Frequency | Use for |
| --- | --- | --- |
| **Small Movement** | High | Leaves, grass blades, branch tips |
| **Medium Movement** | Middle | Whole branches |
| **Large Movement** | Low | Entire mesh swaying with gusts |

All three on by default. Individually disable via `Apply` inputs.

### Masking

Each layer has a 0–1 mask input multiplied over its strength. Foliage models typically have vertex color channels for masking — inspect the model's vertex colors to know which channel does what.

**Small Movement** requires a mask input. Medium and Large auto-generate a simple mask if none is supplied (using position relative to the pivot); model-aware vertex masks are always better.

For foliage master materials, expose movement inputs as parameters for per-instance tuning.

## Water Surface Rain Ripples

Adds ripples to water surface normal based on rain amount.

### Setup

```
1. Material palette → search "Weather" → Water Surface Rain Ripples
2. End of material graph, before result
3. Only modifies normal —
   plug in your material's normal, plug output's normal into result
4. Two additional inputs: scale the ripple texture, adjust intensity on normal
```

## Controlling Your Own Material Effects with UDW

For custom material logic to react to UDW:

| Material node | Output |
| --- | --- |
| **Sample UDW Material State** | Material snow coverage, material dust coverage, material wetness. Also applies WOV + Weather Mask effects (like the weather effect functions do by default). |
| **Sample UDW Season** | 0–1 per season (total = 1) |
| **Sample UDW Wind** | Direction + intensity values/vectors |

Or reference the shared MPC `Ultra Dynamic Weather Parameters` at `Materials/Weather/` directly.

## Rainbow

Enable in **Rainbow** category on UDW.

| Condition for visibility | Detail |
| --- | --- |
| Rain or fog contributing | Amount each contributes is set in Rainbow settings |
| Camera directly exposed to sunlight | Affected by cloud coverage; under overcast → no rainbow |
| Sun low enough for rainbow above horizon, OR camera high enough to see it from above | Geometric constraint |

Settings: rainbow visibility above cloud layer and below water level (if water level on).

## Screen Droplets

Water droplets on the screen when the camera is exposed to rain. Enable in **Screen Droplets** category.

| Setting | Effect |
| --- | --- |
| Droplet texture size | Visual scale |
| Effect strength | Intensity |
| Camera-facing dependency | How much the effect depends on facing the rain |
| **Underwater behavior** *(automatic with UDS Water Level)* | Turns off underwater; reapplies wet effect on resurface |

## Screen Frost

Frost/ice forming on the camera in snowy weather. Settings in **Screen Frost** category.

| Trigger | Detail |
| --- | --- |
| Snow value | Weather state |
| Material snow | Material state |
| Manual contribution | Manually drive frost independent of weather |
| Form Duration / Clear Duration | Time to form/clear |
| **Interior masking** *(default)* | No frost when player is occluded (driven by Player Occlusion on UDS) |

## Heat Distortion

Post process effect distorting distant scenery with a shimmering/convection noise — heat haze. Category: **Heat Distortion**.

| Mode | Source |
| --- | --- |
| Default | Calculated temperature value (see `udw-random-seasons-temperature`) |
| **Manual Heat Distortion** | Add distortion independent of temperature |

## Post Process Wind Fog

Extra fog noise in the local area around the camera, moving with wind and weather particles. Post process effect — much cheaper than the equivalent volumetric fog effects.

Intensity scales with fog / rain / snow / dust in current weather state.

Masking in interiors:

| Mask source | Detail |
| --- | --- |
| **Weather Occlusion Volume** *(default, best)* | Volume texture caching weather exposure around the camera via global distance field |
| Player Occlusion | Alternative |

## Puddle Fluid Volume

Renders a puddle as an actual water surface that moves up/down as the puddle fills/empties with weather. Use when there's a real geometric recess for water to fill.

In `Blueprints/Weather_Effects/`.

Optional **Puddle Fluid Interactions** renders the puddle as a dense grid mesh simulating natural ripples from DLWE Interaction components contacting the surface. Cost scales significantly with size — keep small.

Placement notes:

| Detail | Reason |
| --- | --- |
| Editor preview state comes from currently selected weather on UDW | Override via **Level Editor Preview State** |
| Place so the puddle is fully hidden under ground when dry | Mesh visible in editor when dry (helps placement); hidden at runtime when dry |
| Scale via `Puddle Area` or actor scaling; only Z-axis rotation supported | Geometry constraint |
| Translucent water surface by default | Enable **High Quality Translucency Reflections** in project settings for good Lumen reflections |

Categories: **Puddle State** (when/how filled/emptied), **Fluid Interactions** (DLWE interaction behavior toggles).

## Dripping Mesh Particles

Niagara systems that make a mesh spawn drip particles on its surface in response to rain / material wetness. In `Particles/Standalone/`.

| Mesh type | System | Setup |
| --- | --- | --- |
| Static mesh | **Dripping Static Mesh** | Add Niagara component as a child of the static mesh component |
| Skeletal mesh | **Dripping Skeletal Mesh** | Same with skeletal mesh component |

User parameters scale lifetime, max spawn rate, and the spawn rate fraction used when raining/wet/independent.

Drip appearance (sprite size, color, alpha) comes from UDW's rain particle settings.

If the actor has an **Actor Weather Status** component, the actor's local status drives the drip amount instead of global weather state. See `udw-setup-and-state`.

## Freezing Breath

Niagara system for visible character breath in cold air. Asset: **Freezing Breath** at `Particles/Standalone/`.

```
1. Add a Niagara component using Freezing Breath to your actor
2. Position + parent it in front of the mouth
3. Rotate so X axis points in direction of exhale
```

| State | Behavior |
| --- | --- |
| Default | Visible in freezing temperatures (UDW's calculated local temperature) |
| With Actor Weather Status component | Uses actor-local temperature instead |

## Rain Drip Spline

Actor in `Blueprints/Weather_Effects/` for spawning rain droplets along a line/curve — e.g. dripping from a building roof edge.

Drag in → small straight line. Edit the spline (move/rotate points; right-click to add) for length/shape.

Particle collision/appearance use UDW's rain particle settings.

**Optional icicle meshes** hanging from the spline render in cold weather — for icicles on a roof edge.

## Icicles

For icicles hanging from mesh edges, see Rain Drip Spline above — the optional icicle feature along its spline.

## Weather Occlusion Volume

Volume texture caching how occluded each point around the camera is from weather/wind. Built by sampling the global distance field — requires distance fields enabled and supported.

Used by **Post Process Wind Fog** to mask intensity in spaces blocked by scenery.

## Water Level effects (UDW side)

The **Use UDS Water Level** option in UDW's **Water Level** category enables UDS water level for several UDW features. Actual water level config is on UDS — see `uds-modifiers-configs-state`.

What UDS water level affects on UDW:

- Weather particles kept out of below-water space
- Sound Occlusion fully occludes when camera goes below water
- Screen Droplets auto-off underwater; screen wet effect on resurface
- Rainbow masked beneath water level (when its option is on)
- Surface Weather Effects + DLWE functions have inputs to mask coverage below water

## Current Weather Display widget

**UDW_Current_Weather_Display** widget (widget designer → Ultra Dynamic Sky Widgets). Represents current weather as an icon by default, sourced via `Get Display Name for Current Weather`. Exposed settings switch to text display or read the current weather preset asset.

## Gotchas

- **Material doesn't respond to weather** — function isn't placed at the end of the material graph (before material result), or wrong Material Attributes wrap pattern.
- **Snow on a moving object goes the wrong direction** — Local Space / For Skeletal Mesh is on (correctly), but the **Material Snow Dust Reorient** component isn't added. Add it as a child of the mesh and register the dynamic material instance.
- **DLWE trails don't appear** — landscape needs World Static simple collision blocking Visibility (queries enabled). Or DLWE Interaction component is too small. Or `Control Point Location Source` is far from camera.
- **DLWE on a non-landscape mesh ignored** — phys material missing from the **Physical Materials which Enable DLWE Interactions on Non-Landscapes** array.
- **Snow depth invalidates virtual shadow maps every frame** — set landscape's **Shadow Cache Invalidation Behavior** to **Rigid**.
- **Glass Window Rain Drips wrong on a moving glass surface** — UVs default to world space. Replace via the `UVs` input.
- **Foliage Wind Movement: Small Movement does nothing** — Small Movement requires a mask input. Plug one in.
- **Rainbow never appears** — cloud coverage is too high (camera not exposed to sunlight); or sun too high; or neither rain nor fog is contributing.
- **Screen Frost appearing indoors** — Player Occlusion isn't detecting the interior. See `uds-modifiers-configs-state`.
- **Heat Distortion always at max** — calculated temperature is hot, OR Manual Heat Distortion is also driving it. Disable manual contribution.
- **Puddle Fluid Volume mesh visible at runtime in dry state** — that's a bug only in the editor; at runtime the dry mesh is hidden. If it's visible at runtime, the puddle isn't fully under ground — place it lower.
- **Puddle Fluid Interactions performance terrible** — fluid interaction simulation cost scales with puddle area. Keep to small puddles.
- **Freezing Breath always visible** — Actor Weather Status component overriding to its local temperature (warmer than ambient). Tune the actor temperature inputs.
- **Dripping Mesh Particles ignoring weather** — has an Actor Weather Status component on the actor; drip uses actor-local status instead of global state. Intended behavior.
- **Custom material with Sample UDW Material State ignoring WOV / Weather Mask** — `Sample UDW Material State` already applies those by default. If you're not using it, you're not getting WOV/mask effects.

## References & source material

Docs: `D:\UDSdocs.txt`
- Material Effects Overview + Simulate Changing Material State Over Time — lines 1240-1255
- Surface Weather Effects (setup, dripping/droplets, rotating models) — lines 1258-1296
- Dynamic Landscape Weather Effects V3 (DLWE) — lines 1298-1366
- Glass Window Rain Drips — lines 1368-1378
- Foliage Wind Movement — lines 1380-1407
- Water Surface Rain Ripples — lines 1409-1419
- Sample UDW Material State / Season / Wind — lines 1421-1438
- Rainbow — lines 1740-1752
- Screen Droplets — lines 1754-1760
- Screen Frost — lines 1762-1770
- Heat Distortion — lines 1772-1778
- Post Process Wind Fog — lines 1734-1738
- Puddle Fluid Volume — lines 1699-1716
- Water Level affecting weather — lines 1718-1732
- Dripping Mesh Particles — lines 1794-1807
- Freezing Breath — lines 1809-1821
- Rain Drip Spline + Icicles — lines 1823-1833
- Weather Occlusion Volume — lines 1835-1839
- Current Weather Display widget — lines 1780-1784

Plugin asset paths:
- `Particles/Standalone/` — Freezing Breath, Dripping Static Mesh, Dripping Skeletal Mesh niagara systems
- `Blueprints/Weather_Effects/` — Puddle Fluid Volume actor, Rain Drip Spline actor
- `Blueprints/Weather_Effects/System/` — Material State Manager class
- `Materials/Weather/` — `Ultra Dynamic Weather Parameters` MPC
- Material Snow Dust Reorient component (for moving models)
- Widget designer palette → **Ultra Dynamic Sky Widgets** → UDW_Current_Weather_Display

Related skills: `udw-setup-and-state` (weather/material state drives everything; Actor Weather Status for per-actor effects), `udw-random-seasons-temperature` (temperature drives Freezing Breath, Heat Distortion, icicles), `udw-spatial-weather` (Weather Mask system masks material effects), `udw-particles-lightning-wind-sounds` (Foliage Wind references UDW wind state), `uds-modifiers-configs-state` (UDS Water Level config; Player Occlusion drives Screen Frost interior masking), `uds-fog-and-atmosphere` (Global Volumetric Material is the volumetric counterpart of Post Process Wind Fog).
