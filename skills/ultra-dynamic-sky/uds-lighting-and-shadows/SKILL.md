---
name: uds-lighting-and-shadows
description: Configure lighting in Ultra Dynamic Sky — Sun and Moon directional light components, Cloud Shadows (volumetric and 2D), Sky Light modes (Capture Based / Custom Cubemap / Cubemap with Dynamic Color Tinting), Exposure (auto exposure / manual), static/stationary lighting setup, Screen Space Light Shafts, the Light Day/Night Toggle component for lights that come on at night, and the day-to-night material utility functions. Use any time the user mentions UDS lighting, shadows, sky light, ambient light, sun shadow softness, light angle, exposure problems, scene rendering black or wrong at night, baked lighting with UDS, god rays/light shafts, lights that come on at sunset, cubemap recapture cost, or making a child of UDS to override sun color.
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: lighting
  source-docs: D:\UDSdocs.txt (lines 157-224, 499-516, 547-556, 734-738, 1846-1898)
---

# UDS lighting and shadows

UDS owns three lights (sun, moon, sky light) as components on the actor, and a cloud-shadow system that works for every Sky Mode. This skill covers those components, sky light modes, exposure, light shafts, static/stationary setup, and the runtime utilities for time-of-day-responsive lights.

| Light | Type | Settings category | Cost lever |
| --- | --- | --- | --- |
| Sun | Directional light component on UDS | **Sun** | Affects shadow cost, cloud shadows |
| Moon | Directional light component on UDS | **Moon** | Affects shadow cost, cloud shadows |
| Sky Light | Sky light component on UDS | **Sky Light** | Mode chooses cost vs flexibility |
| Cloud Shadows | Effect on the directional lights | **Cloud Shadows** | Works with every Sky Mode |
| Screen Space Light Shafts | Engine `Light Shaft Bloom` toggle | **Screen Space Light Shafts** | Cheap; only when facing the light |
| Exposure | Auto / Manual auto-exposure control | **Exposure** | Drives the whole image brightness |

## When to use this skill

- Configuring or limiting the sun/moon directional lights.
- Choosing or tuning the sky light mode (capture / cubemap / tinted).
- Diagnosing black, too-dark, or unresponsive ambient light.
- Setting up baked / static / stationary lighting with UDS.
- Enabling Light Shaft Bloom god rays for the sun/moon.
- Making placed lights in the level (lamps, neon) turn on at sunset.
- Making emissive materials switch on at night without writing blueprint.
- Working with a Custom Sun/Moon Light Actor (and the Cloud Scattered Luminance Scale gotcha that comes with it).

## Light components on UDS

UDS owns **Sun** and **Moon** directional light components, plus a Sky Light component. Select UDS and find them in the component list at the top of the details panel.

Settings UDS controls per light: color, intensity, cast shadows, light source angle. Everything else is editable directly on the component.

For sun/moon **positioning and appearance**, see `uds-sun-moon-stars`.

### Custom light actors (avoid unless required)

Pointing UDS at an external light actor (instead of the built-in components) is supported but **not recommended** unless a specific need forces it (e.g. a third-party plugin that requires a light actor reference).

If you do, two extra steps are needed:

| Light type | Manual fix-up |
| --- | --- |
| Directional (sun/moon) | Manually set `Cloud Scattered Luminance Scale` on the actor to match UDS's Sun/Moon component value. UDS can't set this from blueprint. **Copy the value/color exactly.** |
| Sky light | Set `Source Type` to match UDS's `Sky Light Mode`: <br>• `Cubemap with Dynamic Color Tinting` or `Custom Cubemap` → `Specified Cubemap`<br>• `Capture Based` → `Captured Scene` |

If volumetric clouds look strangely dark/gray when using a custom sun/moon actor, **missing Cloud Scattered Luminance Scale** is almost always the cause.

### Lights update throttling

`Lights Update` settings in the **Directional Light** category — throttle how often the lights' rotation actually updates. Cached sun/moon rotations are applied to visuals every frame, but the lights' real rotation can update less frequently. Useful for reducing cached directional shadow invalidation cost.

## Cloud Shadows

Category: **Cloud Shadows**. Enabled by default and compatible with **every** Sky Mode, even cloudless modes.

| Setting | What it does |
| --- | --- |
| Intensity / softness with cloud coverage | Full overcast fully occludes by default; low coverage only partial |
| Shadow contribution when Fog / Dust high | Adjustable directional light occlusion in those states |
| `2D Cloud Shadows Speed`, `2D Cloud Shadows Scale` | Texture-based shadow for non-Volumetric Sky Modes |

For Volumetric Clouds, shadows are accurate to the 3D layer — every cloud casts its own correct shadow. Other Sky Modes use the 2D texture-based shadow.

### Cloud Shadows + single-layer water

| Symptom | Fix |
| --- | --- |
| Single-layer water lit by sun in cloudy weather when it shouldn't be | Project Settings → enable `Single Layer Water Uses Light Function Atlas`. UDS cloud shadows support the light function atlas, so water reads them correctly. |
| Sun reflection near sunset/sunrise doesn't match cloud coverage that should block it | In Cloud Shadows category: enable `Correct Specular Scale For Low Angle Cloud Shadows` |

## Sky Light

`Sky Light Mode` in the **Sky Light** category.

| Mode | How it works | When to pick |
| --- | --- | --- |
| **Capture Based** | Generates a cubemap by capturing the sky. Real-time capture exposed as an option. | Hero quality, supports full dynamic sky |
| **Custom Cubemap** | Static cubemap set via `Sky Light Cubemap` | Locked-in scene with a single look |
| **Cubemap with Dynamic Color Tinting** | Flat gray cubemap dynamically tinted with fog color to align with time of day | Best for dynamic time of day at low cost; works on every platform (incl. mobile without real-time capture) |

`Sky Light Color Multiplier` settings tint differently per Time of Day. Values >1 scale intensity proportionally.

## Exposure

UDS controls exposure by default. Auto exposure (Unreal's "eye adaptation") is what lets brightness adapt to scene light. Category: **Exposure**.

| Setting | Controls |
| --- | --- |
| `Apply Exposure Settings` | Master toggle for UDS taking exposure ownership |
| Exposure Compensation Curve | Pushes brightness higher/lower based on overall scene light level |
| `Exposure Bias` (per scenario) | Per-time-of-day, per-weather exposure compensation. e.g. "make night exposure brighter, cloudy darker." |
| `Exposure Metering Mode` | Whether auto exposure is on, and which type. Set to **Manual** to disable auto exposure but keep using bias settings. |
| `Exposure Brightness Range` (MinEV100 / MaxEV100) | The range auto exposure adapts within |

For debugging auto exposure: viewport view mode **Show → Visualize → HDR(Eye Adaptation)** shows what auto exposure is doing.

## Static / stationary lighting

UDS defaults to movable lights, but supports static / stationary too.

To switch a UDS light to static or stationary, find its mobility setting in the corresponding UDS category (**Sun**, **Moon**, **Sky Light**). **Set the mobility from the exposed UDS setting, not on the component itself.**

After the level's lighting is built:

| Constraint | Why |
| --- | --- |
| Can still tweak some sky settings | Material params, etc. |
| Settings that move/alter lights break the build | Any directional light change invalidates lightmaps |
| Static/stationary **sun** → `Time of Day` cannot change at runtime | Light mobility prevents rotation at runtime |

## Screen Space Light Shafts

`Light Shaft Bloom` — engine-level directional light feature: cheap screen-space god rays. Only renders when facing the light. **Not** related to volumetric fog (which can achieve similar visuals via a different method).

Category: **Screen Space Light Shafts** — toggles per sun / moon.

## Light Day/Night Toggle component

For a light component placed in the level (lamp, neon sign) that should turn on at sunset and off at sunrise.

| Setup step | Detail |
| --- | --- |
| Add the component | `Blueprints/Utilities/Light Day/Night Toggle` as a child of the light component on an actor |
| Default behavior | On at night; flip via setting on the component |
| Power-on animation | Component animates intensity as the light powers on (imitating warm-up lamps). Toggle/adjust on the component. |
| Drive material parameters | The component can drive a `Light Toggle` scalar parameter (0–1) on an array of dynamic material instances |

Hierarchy: the toggle component **must be a child of the light component** to control it.

## Material functions for lighting

Search the material palette:

| Function | What it does |
| --- | --- |
| `Day to Night Float` / `Day to Night Color` | Interpolate between two inputs based on whether sun is up. Inputs offset threshold and widen/sharpen the transition. Good for emissive-on-at-night without blueprint. |
| `Active Sun or Moon Vector` | Unit vector toward whichever body is up (sun by day, moon by night). Also outputs a 0–1 mask that drops to 0 at the swap moment — multiply effects by it to hide pop artifacts. |

## Runtime / Blueprint control

Most lighting variables that change with time/weather (color, intensity, scattered luminance) update via the cache automatically.

For *static* lighting properties (mobility, source type, certain advanced light setup), set the variable then call `Static Properties - Sun`, `Static Properties - Moon`, or `Static Properties - Sky Light` to apply. For a complete instant refresh, `Hard Reset Cache`.

## Gotchas

- **Scene renders black after adding UDS** — exposure. In order: (1) disable any post-process volume overriding exposure; (2) viewport **Lit** dropdown → check **Game Settings** for exposure; (3) on UDS disable **Apply Exposure Settings** in the Exposure category.
- **Ambient light starts correct then stops updating as time changes** — sky light isn't updating. Platform may not support real-time sky light capture; switch `Sky Light Mode` to **Cubemap with Dynamic Color Tinting** (works everywhere, dynamic). Or it's leftover static light from a baked solution — run a lighting build.
- **Ambient light slow to adapt after a fast sky change** — that's Lumen's default GI update speed. UDS doesn't touch Lumen. Adjust **Lumen Global Illumination → Update Speed** in a post-process volume (raises GPU cost).
- **Volumetric clouds look dark/gray** with a Custom Sun/Moon Light Actor — `Cloud Scattered Luminance Scale` isn't set on the actor. Copy the value from UDS's directional light component. Without a custom actor, it's a leftover directional light in the level that wasn't removed before adding UDS.
- **Single-layer water lit incorrectly under cloudy sky** — Project Settings → enable `Single Layer Water Uses Light Function Atlas`. UDS cloud shadows support the atlas.
- **`Time of Day` won't change at runtime** — sun mobility is static or stationary. Movable required for runtime time changes.
- **Set Sun Light Color at runtime, no effect for 1–2 seconds** — cache system interpolates. Call `Hard Reset Cache` for an instant change, or lower `Max Property Cache Period` in **Scalability / Performance**.
- **Set Sun Softness at runtime, no effect at all** — static property. Set the variable, then call `Static Properties - Sun`.

## References & source material

Docs: `D:\UDSdocs.txt`
- Light Components / custom actors — lines 157-169
- Sun and Moon Directional Lights — lines 170-176
- Cloud Shadows — lines 178-184, 1893-1898
- Sky Light — lines 186-198
- Exposure — lines 200-216
- Static / Stationary Lighting — lines 218-224
- Light Day/Night Toggle — lines 499-516
- Day to Night material functions — lines 547-556
- Screen Space Light Shafts — lines 734-738
- Lighting and post processing issues — lines 1846-1898

Plugin asset paths:
- Component list on UDS actor → **Sun**, **Moon**, **Sky Light**
- `Blueprints/Utilities/` — Light Day/Night Toggle component

Related skills: `uds-sun-moon-stars`, `uds-clouds`, `uds-fog-and-atmosphere`, `uds-time`, `uds-performance-mobile-troubleshooting`.
