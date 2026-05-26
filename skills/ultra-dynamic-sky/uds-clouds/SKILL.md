---
name: uds-clouds
description: Configure clouds in Ultra Dynamic Sky — Volumetric, Static, 2D Dynamic, Voxel clouds, plus Cloud Movement, Cloud Wisps, the Volumetric Cloud Painter, Volumetric Cloud Light Rays, and the Cloud Profile Authoring Tool. Use this skill any time the user mentions clouds in UDS — appearance, altitude, scale, performance, second cloud layer, painting coverage, hard mesh intersections, blurry/streaky when moving fast, looking dark, custom cloud shapes, cloud direction/speed, looping clouds, the wispy high-altitude texture, light rays through clouds, or making a custom static cloud texture. Trigger even when the user just says "the clouds" without naming the system.
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: clouds
  source-docs: D:\UDSdocs.txt (lines 94-155, 740-789, 1901-1939)
---

# UDS clouds

UDS renders clouds via one of four mutually exclusive systems plus a shared movement/wisp/light-ray layer. This skill covers each system's settings, the cloud painter, the light-ray effect, and the looping/troubleshooting recipes. For *which* cloud mode to choose, see `uds-setup-and-modes`.

| Sky Mode | What it draws | GPU cost | Notable per-mode tool |
| --- | --- | --- | --- |
| Volumetric Clouds | Full 3D clouds, real shadows | Heaviest | Volumetric Cloud Painter, Cloud Profile Authoring Tool |
| Static Clouds | Static texture with packed lighting angles | Cheap | Static Clouds Authoring Tool |
| 2D Dynamic Clouds | Panning 2D textures on the sky sphere | Cheap | — |
| Voxel Clouds | Hard cubic voxel render of Volumetric Clouds | Heavy | Same tools as Volumetric Clouds |

## When to use this skill

- Tuning the look (altitude, scale, density, color, second layer) of any cloud type.
- Cutting cloud-rendering GPU cost.
- Painting localised cloud coverage (gaps over mountains, clouds in a basin).
- Authoring a custom cloud shape profile, or generating a custom static cloud texture.
- Configuring volumetric cloud light rays (god rays through cloud gaps).
- Making the clouds loop seamlessly for a film render.
- Diagnosing dark clouds, hard mesh intersections, blurry-when-moving, or in-layer artifacts.

## Volumetric Clouds

Richest and most expensive cloud option. Category: **Volumetric Clouds**.

| Setting | What it does |
| --- | --- |
| `Volumetric Cloud Rendering Mode` | Exposes `r.volumetricrendertarget.mode`. Each mode prioritizes a tradeoff — Performance, Quality, Mesh Intersections, Long Trail, etc. |
| `Bottom Altitude` | Cloud layer height. **Use this, not actor translation** (which breaks atmosphere/fog). |
| `Volumetric Clouds Scale` | Uniform scale of the cloud field |
| `View Sample Scale` / `Shadow Sample Scale` | Sample counts. Lower = cheaper but noisier. |
| `Max High Frequency Noise Levels` | Detail when close/zoomed in. Cost scales with the High Frequency Noise Distance Scale. |
| `Second Cloud Layer → Two Layers` | Adds a second layer with offset. Requires much higher sample count; significant cost increase. |

### Authoring custom cloud shape

The **Cloud Profile Authoring Tool** generates the Cloud Profile LUT texture UDS samples for cloud shape.

- Launch: **Ultra Dynamic Sky** dropdown on the level editor toolbar, *or* run the editor utility at `Blueprints/Tools/`.

### Volumetric Cloud Painter

Paint local cloud coverage on top of the global `Cloud Coverage` value. Carve gaps over a mountain, or paint clouds into a basin.

- UDS must be in the scene with Sky Mode = Volumetric Clouds.
- Launch: **Ultra Dynamic Sky** dropdown on the toolbar, *or* the editor utility in `Blueprints/`.
- Painting data is held in **UDS Cloud Paint Container** actors. One level can hold many; the painter creates a new one or opens an existing one.

Painter UI:

| Area | Function |
| --- | --- |
| Top bar | Brush: texture, strength, falloff, spacing |
| Viewport | LMB paint, RMB pan, MMB zoom (or buttons lower-right) |
| View modes (lower-left) | Three options; lock icon ties painter view to level viewport |
| Left side | Three coverage levels (red/green/blue) and erase (black) |
| Bottom | **Save to Textures** — commits painting to texture assets in `UDS_LevelData/` next to the level |

Container resolution / mapping to the cloud coverage render target is configured on UDS in the **Volumetric Cloud Painting** category.

```
// Switching active container at runtime:
ContainerA.Deactivate()
ContainerB.Activate()
```

### Volumetric Cloud Light Rays

When the cloud layer has a gap (painted or just low coverage), UDS renders distant light rays through it. Category: **Volumetric Cloud Light Rays** (enabled by default).

Rays are giant additive cards driven by a Niagara system — **not** volumetric fog and **not** screen-space light shafts.

- Adjust color and spacing of ray cards.
- **Individual Cloud Light Rays** — also casts rays through gaps in overall high-coverage formations (not just painted gaps). Can render many more ray cards; cost rises significantly.

## 2D Dynamic Clouds

Panning 2D textures on the sky sphere. Category: **2D Dynamic Clouds**.

These are a material effect on the sky sphere — they don't exist in 3D space. `Cloud Height` is fake-perspective distortion in the sky material, not real altitude.

Advanced dropdown: distribution settings (concentrate around horizon, reduce around the moon, etc.).

Perf: enabling **One Cloud Layer** reduces sky shader cost (already on at Low material quality).

## Static Clouds

Static texture with multiple lighting angles packed in, approximating lighting changes as sun/moon move. Category: **Static Clouds** — swap texture, control rotation.

### Static Clouds Authoring Tool

Generates a new static clouds texture by rendering UDS's volumetric clouds.

- Launch: **Ultra Dynamic Sky** dropdown on the toolbar, *or* the editor utility at `Blueprints/Tools/`.

## Voxel Clouds

Hard cubic voxel rendering style; internally an alternate renderer for Volumetric Clouds. Category: **Voxel Clouds** holds voxel-specific settings, but most cloud settings come from the **Volumetric Clouds** category (textures, altitude, colors). Affected by the Volumetric Cloud Painter and Radial Storm local coverage.

## Cloud Movement

Category: **Cloud Movement** — controls movement of Volumetric Clouds *and* 2D Dynamic Clouds.

| Setting | Behavior |
| --- | --- |
| `Cloud Speed` | Overall speed |
| `Cloud Direction` | Degrees. UDW's wind direction overrides if UDW is in the scene. |
| `Cloud Phase` | Phase variable. Useful when Cloud Speed = 0; primary control for looping / keyframed movement. |
| `Randomize Cloud Formation On Run` | New random formation each play |
| `Clouds Move With Time of Day` | Keeps cloud movement synced when time speed varies (good for time-lapses) |
| `Formation Change Speed` | Used in seamless looping (see below) |

### Seamless looping (for film renders)

The loop requires the cloud formation texture to complete one full 0–1 UV cycle. Steps:

In **Cloud Movement**:
- `Cloud Speed` = 0 (drive time via `Cloud Phase`).
- `Cloud Direction` along a single axis (0, 90, 180, or 270).
- `Formation Change Speed` = 1 (or 0.5 → loop twice as long).

In **Volumetric Clouds**:
- `3D Noise Scale` = 1.
- `Cloud Formation Texture Scale` = 1.
- `Macro Variation` = 0.
- `3D Noise Vertical Movement` = 0.

```
// Keyframe in Sequencer:
CloudPhase: 0 → 100   (loops seamlessly)
// (Or with Formation Change Speed = 0.5: 0 → 200)
```

## Cloud Wisps

High-altitude wispy layer rendered as a static texture on the sky behind every Sky Mode except Space. Category: **Cloud Wisps**.

How it works: samples a grayscale texture (R channel only) and applies a wisp color that varies with time of day. Opacity is scaled by two `Cloud Wisps Opacity` settings — one for low cloud coverage, one for high.

- `Cloud Wisps Texture` — swap. Keep grayscale.
- Movement effect (default on) warps the texture over time with cloud direction, fading with an offset mapping to create a seamless loop.

## Runtime / Blueprint control

```
// Active properties — set directly, cache picks up automatically:
UDS.CloudCoverage = 0.8   // (use UDW instead if present)
UDS.CloudPhase    = 47.5
UDS.CloudSpeed    = 0.3
UDS.CloudDirection = 90

// Container actors (Cloud Painter data):
ContainerA.Activate() / ContainerA.Deactivate()
```

For **static** cloud properties (texture swaps, noise scales, etc.), call `Static Properties - Volumetric Clouds` (or the relevant category function) after changing the variable; or `Hard Reset Cache` for a complete refresh. See `uds-performance-mobile-troubleshooting`.

## Performance

| Lever | Cost impact |
| --- | --- |
| Sky Mode (Volumetric → Static → 2D → None) | Largest GPU perf lever on the system |
| `Volumetric Cloud Rendering Mode` (use Performance variants) | Significant |
| `View Sample Scale`, `Shadow Sample Scale` (reduce) | Cheaper but noisier |
| `Two Layers` (off) | Big saving |
| `Max High Frequency Noise Levels` (lower) | Cheaper close-up |
| `One Cloud Layer` (on, for 2D Dynamic) | Reduces sky shader cost |
| `Individual Cloud Light Rays` (off) | Saves many ray cards |

## Gotchas

- **Volumetric clouds look dark/gray** — usually the directional light. If using **Custom Sun/Moon Light Actor**, copy `Cloud Scattered Luminance Scale` exactly from UDS's built-in component (UDS can't set this on a custom actor). Otherwise it's a leftover directional light in the level that wasn't removed before adding UDS.
- **Hard mesh intersections** — default rendering mode prioritizes background quality. Switch `Volumetric Cloud Rendering Mode` to a mode that prioritizes Mesh Intersections.
- **Clouds blurry/streaky when moving fast** (e.g. time-lapse) — default mode resolves with a long history trail. Switch to any other `Volumetric Cloud Rendering Mode`.
- **Translucent materials render in front of clouds** — on the material → **Translucency settings** → enable `Apply Fogging` *and* `Apply Cloud Fogging`. For some meshes also enable `Compute Fog Per Pixel` (otherwise cloud fogging is per-vertex).
- **Banding/noise inside or above the layer** — defaults tuned for ground viewing. Raise `View Sample Count Scale` (costs perf), lower `Tracing Max Distance` (two settings: inside/outside layer), adjust `Close View Sample Ratio`.
- **Moving the UDS actor to change altitude** — wrong; use `Bottom Altitude`.
- **Setting Cloud Coverage on UDS has no effect** — UDW is in the scene. Set on UDW's weather state instead.
- **Voxel mode looking for unique settings** — most live in **Volumetric Clouds**, not **Voxel Clouds**.

## References & source material

Docs: `D:\UDSdocs.txt`
- Volumetric Clouds — lines 94-111
- 2D Dynamic Clouds — lines 113-119
- Static Clouds — lines 121-127
- Voxel Clouds — lines 129-135
- Cloud Movement (incl. looping) — lines 137-145, 470-496
- Cloud Wisps — lines 147-155
- Volumetric Cloud Painter — lines 740-763
- Volumetric Cloud Light Rays — lines 783-789
- Cloud rendering issues — lines 1901-1939

Plugin asset paths:
- `Blueprints/Tools/` — Cloud Profile Authoring Tool, Static Clouds Authoring Tool, Volumetric Cloud Painter editor utility
- `UDS_LevelData/` (created next to the level) — saved cloud paint cell textures
- `Materials/` — `UDS_VolumetricClouds_MPC` parameter collection (used by cloud fog / cloud shadow materials sharing properties with the visible clouds)

Related skills: `uds-setup-and-modes`, `uds-fog-and-atmosphere`, `uds-cinematics-rendering`, `uds-lighting-and-shadows`, `uds-performance-mobile-troubleshooting`.
