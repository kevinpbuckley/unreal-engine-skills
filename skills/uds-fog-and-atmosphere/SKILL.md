---
name: uds-fog-and-atmosphere
description: Configure fog, volumetric fog, dust, and atmospheric coloring in Ultra Dynamic Sky. Covers Fog Density (base + cloud/fog/dust contributions, height falloff, start distance), Fog Color (and the `Support Sky Atmosphere Affecting Height Fog` project setting), Volumetric Fog with light scattering, the Global Volumetric Material (3D noise, ground fog, water-level fog), Dust, the Sky Atmosphere settings (Rayleigh scattering, absorption, overcast luminance), and Simplified Color mode for cheaper sky shading. Use whenever the user mentions UDS fog, height fog, volumetric fog, atmospheric scattering, sky color tinting, dust/sand haze, ground fog, fog below water, or sees a "hard line where fog suddenly starts" issue.
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: atmosphere
  source-docs: D:\UDSdocs.txt (lines 320-393, 1943-1961)
---

# UDS fog and atmosphere

UDS owns three air-shading systems — height fog, volumetric fog, and the global volumetric material — plus a sky-coloring layer with two backends. This skill covers each and the interactions between them.

| System | Category | What it does | Cost |
| --- | --- | --- | --- |
| Height fog (density) | **Fog Density** | Distance-based opacity, height falloff, start distance | Cheap |
| Height fog (color) | **Fog Color** | Tint of the height fog (overridden by Sky Atmosphere by default) | Cheap |
| Volumetric Fog | **Volumetric Fog** | 3D fog receiving local light, scatters | **Expensive** |
| Global Volumetric Material | **Volumetric Fog** | 3D noise extinction, ground fog, underwater extinction | Adds cost on top of Volumetric Fog |
| Dust | **Dust** | Imitates dust/smoke/particulates in the air (affects fog density + color) | Cheap |
| Sky Atmosphere | **Sky Atmosphere** | Realistic atmospheric scattering (default Color Mode) | Costlier than Simplified |
| Simplified Color | **Simplified Color** | LUT-based sky coloring with adjustable color values | Cheap |

## When to use this skill

- Tuning how thick fog gets with cloud coverage / weather / dust.
- Making fog look different per weather (cloudy, foggy, dusty).
- Enabling volumetric fog and dealing with its cost.
- Adding ground fog or 3D noise variation to the fog.
- Setting up underwater fog tinting/extinction.
- Picking between Sky Atmosphere and Simplified Color for sky shading.
- Tuning sunset/twilight color, Rayleigh scattering, or overcast luminance.
- Diagnosing a hard fog line, sky flickering black, or pixelated volumetric fog.

## Fog Density

Category: **Fog Density**. Derives the height fog component's density, falloff, and start distance from inputs like Cloud Coverage, Fog, and Dust Amount.

| Output | How it's derived |
| --- | --- |
| `Density` | Base value + contributions added for Cloud Coverage, Fog, Dust Amount |
| `Height Falloff` | Base value + separate falloffs for cloudy / foggy / dusty (used directly, not summed) |
| `Start Distance` | Derived from current density. A start distance at low density + a density value at which start distance reduces to 0 (fog right up to the camera) |

Increasing Cloud Coverage / Fog / Dust automatically thickens distance fog. For different moods per weather, tune the per-state contributions in this category.

## Fog Color

Category: **Fog Color**. The project setting **Support Sky Atmosphere Affecting Height Fog** is what determines whether these settings are actually used.

| Project setting state | Result |
| --- | --- |
| Enabled *(typical default, recommended)* | Height fog colors come **directly from the sky atmosphere**. Most Fog Color settings on UDS are ignored. |
| Disabled | Fog uses Fog Color settings only. Use for full direct control. |

This dependency disappears entirely if `Color Mode = Simplified Color` — Simplified Color doesn't enable the sky atmosphere, so all Fog Color settings are live.

### Path Tracer distance fog

`Render Height Fog In Path Tracer Using Post Process` (in Fog Color category, on by default). Lets the path tracer approximate distant height fog via post process — the path tracer otherwise lacks native height fog support. See `uds-cinematics-rendering`.

## Volumetric Fog

Unreal's volumetric fog renders advanced fog nearby the camera that receives/scatters light from local sources and supports variable color/extinction via volumetric materials. Enable from the **Volumetric Fog** category.

| Setting | Effect |
| --- | --- |
| Enable | Master toggle |
| Overall extinction | How dense the volumetric fog is |
| Distance from camera | How far volumetric fog renders |
| `Volumetric Scattering Intensity` (sun + moon) | How brightly each light source lights the volumetric fog |

### Performance and scalability

Volumetric Fog is expensive. Notes:

| Fact | Consequence |
| --- | --- |
| Volumetric Fog is a renderer feature | Scalability comes from the **Shadow Quality** group |
| Default scalability for Low and Medium disables volumetric fog | Many users won't see it on their hardware unless quality is High+ |
| UDS's Global Volumetric Material adds cost on top | Cost increases noticeably with global material on |

## Global Volumetric Material

Also in **Volumetric Fog** category. Adds global controls of extinction and color.

| Feature | What it adds |
| --- | --- |
| Texture-based 3D noise | Variation to the fog extinction |
| Weather Mask brush masking | Mask volumetric fog where Weather Mask Brush / Projection Box actors are placed. See `udw-material-and-screen-effects`. |
| Ground fog | Additional extinction directly above distance fields. Requires project setting that generates mesh distance fields. |
| Underwater extinction + albedo | Applied below the water level set in **Water Level** category. See `uds-modifiers-configs-state`. |

## Dust

Category: **Dust**. Imitates dust/smoke/particulates in the air.

| Variable | Effect |
| --- | --- |
| `Dust Amount` | Affects fog density, height falloff, fog color |
| `Dust Color` | Color used for fog when Dust Amount = 1 |
| Density-specific settings | In the **Fog Density** category |

If UDW is in the scene, **UDW takes control of `Dust Amount`** as part of weather state.

## Sky Atmosphere

When `Color Mode = Sky Atmosphere` (default), main sky color comes from the **Sky Atmosphere** category.

| Setting | Drives |
| --- | --- |
| `Rayleigh Scattering` (day / night / dawn-dusk) | Main sky color. Adjustable per time band. |
| `Sunset/Sunrise`, `Twilight` | The sky atmosphere component's `Absorption` setting. Use for stronger colored sunsets, altered twilight tone. |
| `Sky Atmosphere Overcast Luminance` | Scales intensity of all sky colors when Cloud Coverage is high |

## Simplified Color

When `Color Mode = Simplified Color`, main sky color comes from the **Simplified Color** category. Cheaper at the material level than Sky Atmosphere, more directly tweakable.

| Setting | Drives |
| --- | --- |
| Color variables (base sky, light/dark cloud) | 2D Dynamic Clouds and Static Clouds cloud colors. (Volumetric cloud color is in the Volumetric Clouds category.) |
| `Directional Intensity` (float curve) | How directional light intensity dims as it nears the horizon |
| `Directional Light Scattering` (color curve) | How directional light color is filtered as it nears the horizon |
| Sun / Moon atmosphere LUT textures | Volume textures sampled by the sky material to derive atmospheric colors from camera vector and sun/moon orientation |

The LUT textures are involved to author from scratch. For tweaks, prefer doing color transforms on the included textures.

## Runtime / Blueprint control

```
// Active properties — set directly, cache picks up:
UDS.Fog          = 0.4    // (use UDW instead if present)
UDS.CloudCoverage = 0.7
UDS.DustAmount   = 0.2

// Volumetric fog enable / extinction / distance — many are static:
UDS.bEnableVolumetricFog = true
UDS.CallStaticPropertiesVolumetricFog()   // apply
```

If a runtime change has no effect, look for the matching `Static Properties - <Category>` function and call it. Last-resort full refresh: `Hard Reset Cache`. See `uds-performance-mobile-troubleshooting`.

## Performance

| Lever | Effect |
| --- | --- |
| Use `Color Mode = Simplified Color` | Skips Sky Atmosphere; cheaper sky material |
| Disable Volumetric Fog | Big win — Volumetric Fog is expensive |
| Disable Global Volumetric Material | Saves the cost added on top of Volumetric Fog |
| Disable Ground Fog feature | Avoid the distance-field tracing cost |

## Gotchas

- **Hard line where fog/atmosphere suddenly starts** — sky atmosphere position is wrong relative to the scene. Place UDS at ground level so the camera is never significantly *below* the UDS actor.
- **Sky color flickers black when moving the camera** — engine bug; camera dipped below the sky atmosphere "ground". Select the **Sky Atmosphere** component on UDS (in the top components list) and move it down below the lowest point the camera can reach.
- **Volumetric fog pixelated / low quality** — that's project scalability. Volumetric fog's scalability cvars are in the **Shadow Quality** group. UDS doesn't override them.
- **Volumetric fog completely invisible** — default Low/Medium engine scalability **disables** volumetric fog entirely. Check scalability settings.
- **Fog Color changes have no effect** — `Support Sky Atmosphere Affecting Height Fog` project setting is on, so fog colors come from the sky atmosphere. Either disable the project setting or switch `Color Mode` to Simplified Color.
- **`Dust Amount` ignored on UDS** — UDW is in the scene; UDW's weather state owns it.
- **Ground Fog feature has no effect** — project setting to generate mesh distance fields is off. Enable it.

## References & source material

Docs: `D:\UDSdocs.txt`
- Fog Density — lines 320-331
- Fog Color — lines 333-341
- Volumetric Fog — lines 343-349
- Global Volumetric Material — lines 351-361
- Dust — lines 363-369
- Sky Atmosphere — lines 371-380
- Simplified Color — lines 382-393
- General rendering issues — lines 1943-1961

Related skills: `uds-setup-and-modes`, `uds-clouds`, `uds-modifiers-configs-state` (water level), `uds-cinematics-rendering`, `udw-particles-lightning-wind-sounds` (UDW Dust flows into UDS Dust Amount), `udw-material-and-screen-effects` (Weather Mask masking applies to Global Volumetric Material).
