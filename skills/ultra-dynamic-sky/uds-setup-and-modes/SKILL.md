---
name: uds-setup-and-modes
description: How to install Ultra Dynamic Sky (UDS) in an Unreal level and pick its top-level modes — Sky Mode (Volumetric/Static/2D/Voxel/Aurora/Space), Color Mode (Sky Atmosphere vs Simplified), Project Mode (Game vs Cinematic), Feature Level (Desktop/Mobile). Use whenever the user mentions adding UDS to a scene, the UDS actor not working, choosing between cloud types, setting up the sky in a new level, mobile/console targets, or anything in the "Basic Controls" category — even when phrased generically like "why are my volumetric clouds missing on mobile", "switch to performance-friendly clouds", or "is there a space-only sky mode".
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: setup
  source-docs: https://www.ultradynamicsky.com/Documentation/V9/9-5
---

# UDS setup and top-level modes

UDS replaces Unreal's stock sky/lighting stack with one actor and four cross-cutting mode dials. This skill covers getting the actor into a level cleanly and choosing the Sky / Color / Project / Feature Level combination for the project.

| Mode | Variable | What it controls | Where the per-option config lives |
| --- | --- | --- | --- |
| Sky Mode | `Sky Mode` | Cloud rendering style (or aurora-only / space) | Volumetric Clouds / 2D Dynamic Clouds / Static Clouds / Voxel Clouds / Aurora categories |
| Color Mode | `Color Mode` | Source of sky colors | Sky Atmosphere or Simplified Color category |
| Project Mode | `Project Mode` | Runtime perf vs offline quality tradeoff | Cinematic / Offline Mode category |
| Feature Level | `Feature Level` | Renderer feature-level fallback policy | Mobile category |

## When to use this skill

- Dragging UDS into a fresh level for the first time, or getting "missing/dark scene" on a level that just got UDS.
- Choosing between Volumetric, Static, 2D Dynamic, Voxel, Aurora, or Space cloud modes.
- Targeting mobile/console — making sure incompatible features are swapped out.
- Switching to/from Cinematic Project Mode before rendering a film.
- Anything in the **Basic Controls** category of UDS.

## Adding UDS to a level

Before dragging the actor in, remove from the level:

- Directional Lights
- Sky Light
- Exponential Height Fog
- Sky Atmosphere
- Volumetric Cloud

If ambient light remains after removing those, static light is baked into the level's lightmaps — run **Build → Build Lighting** to clear it.

Drag the **Ultra Dynamic Sky** actor from the `Blueprints/` folder of the UDS plugin into the level. Daytime lighting with volumetric clouds should appear.

```
Place UDS at ground level.
Use Volumetric Clouds → Bottom Altitude to change cloud height,
NOT actor translation (which disturbs atmosphere/fog).
```

On first use the editor may need to compile shaders for UDS before features become visible. It will indicate this; it can take a while depending on hardware.

## Basic Controls category

| Setting | Purpose | Notes |
| --- | --- | --- |
| Time of Day | Primary time control; positions sun/moon by default | See `uds-time` |
| Sky Mode | Cloud / aurora / space mode | See table at top |
| Color Mode | Sky color source | Sky Atmosphere or Simplified Color |
| Project Mode | Game vs Cinematic | Toggle before/after film render |
| Feature Level | Renderer feature-level target | Desktop or Mobile |
| Cloud Coverage | How cloudy | If UDW is present, UDW owns this |
| Fog | How foggy | If UDW is present, UDW owns this |
| Saturation / Contrast / Overall Intensity / Night Brightness | Visual tweaks | Cheap art-direction knobs |
| Lighting Brightness (Day / Dawn-Dusk / Night) | Light intensity per time band | Independent from sky color brightness |
| Dusk Time / Dawn Time | Time of Day values where sun crosses horizon | Ignored when `Simulate Real Sun` is on |

The Basic Controls category also has an advanced dropdown that holds the **configuration override** option — see `uds-modifiers-configs-state`.

## Sky Mode

| Option | Mental model | Cost | Best for |
| --- | --- | --- | --- |
| Volumetric Clouds *(default)* | Full 3D clouds | Heaviest | Hero desktop / console |
| Static Clouds | Static texture with packed lighting angles | Cheap | Perf-bound projects |
| 2D Dynamic Clouds | Panning 2D textures on the sky sphere | Cheap | Stylized projects, lower hardware |
| No Clouds | No clouds at all | Minimal | Clear-sky deserts, simple shots |
| Volumetric Aurora | Full 3D aurora effects (no clouds) | Heavy | Aurora as the focal effect |
| Space | No clouds, no atmosphere, no sky color — sun/moon/stars only | Minimal | Outer-space scenes |
| Voxel Clouds | Hard cubic voxel rendering style; internally an alternate Volumetric Clouds renderer | Heavy | Stylized voxel projects |

Voxel Clouds shares most settings with Volumetric Clouds (textures, altitude, colors) and is affected by the Volumetric Cloud Painter and Radial Storm local coverage.

## Color Mode

| Option | Mental model | When to pick |
| --- | --- | --- |
| Sky Atmosphere *(default)* | Unreal's atmospheric scattering | Realistic, hero quality |
| Simplified Color | Samples a LUT volume + adjustable color values | Cheaper material, more direct tweaks, mobile-friendly |

If the project setting `Support Sky Atmosphere Affecting Height Fog` is on (default + recommended), fog colors come from the sky atmosphere and most Fog Color settings on UDS are ignored. Disable that project setting for full direct fog color control. Simplified Color disables the sky atmosphere entirely, so all Fog Color settings become live.

## Project Mode

| Option | Behavior | Use when |
| --- | --- | --- |
| Game / Real-time *(default)* | Cache-spread updates, runtime optimizations | Any project that needs real-time perf |
| Cinematic / Offline | Every dynamic property updates every frame; quality auto-bumped at runtime | Movies / stills only |

**Switch Cinematic Mode back to Game / Real-time after rendering** — Cinematic's quality bumps will tank live perf.

The **Cinematic / Offline Mode** category has additional knobs for offline-only quality.

## Feature Level

`Feature Level` should match the renderer feature level the build targets. With **Mobile** selected, incompatible Sky Modes (Volumetric Clouds, Volumetric Aurora) auto-swap at runtime for mobile-compatible replacements, configured in the **Mobile** category.

For multi-platform projects, set Feature Level from `Platform Name` at startup — the `Platform Feature Levels` map in the **Mobile** category. Without this, the blueprint may activate features the platform can't render, causing visual bugs.

## Runtime / Blueprint control

All four modes are exposed variables on the UDS actor.

```
// Get a UDS reference from any blueprint:
UDS = GetUltraDynamicSky()

// Setting modes at runtime:
UDS.SkyMode      = ESkyMode::VolumetricClouds
UDS.ColorMode    = EColorMode::Simplified
UDS.ProjectMode  = EProjectMode::Game
UDS.FeatureLevel = EFeatureLevel::Mobile
UDS.CloudCoverage = 0.6      // ignored if UDW present
UDS.Fog           = 0.2      // ignored if UDW present
```

Most "active" properties (Time of Day, Cloud Coverage, Fog, sun/moon colors) update naturally via the cache system. Some are **static properties** that apply once at startup and don't auto-refresh — if a runtime change has no effect, call the matching `Static Properties - <Category>` function (e.g. `Static Properties - Sun`). For a complete instant refresh, call `Hard Reset Cache`. See `uds-performance-mobile-troubleshooting`.

## Quick decision guide

- **Targeting consoles/PC, want it to look great** → Volumetric Clouds + Sky Atmosphere + Game / Real-time.
- **Mobile build** → Feature Level = Mobile. Mobile category picks the cloud replacement (Static or 2D Dynamic).
- **Rendering a film/cinematic** → Project Mode = Cinematic / Offline before, Game / Real-time after.
- **Stylized voxel game** → Sky Mode = Voxel Clouds.
- **Space scene** → Sky Mode = Space. See `uds-sun-moon-stars` for stars/space layer.
- **Aurora is the hero effect** → Sky Mode = Volumetric Aurora (no clouds); for 2D aurora in any mode enable `Use Auroras` in the Aurora category.
- **Cheap sky for low-end hardware** → No Clouds + Simplified Color + Game / Real-time.

## Gotchas

- **Scene renders black after adding UDS** — exposure. Disable any post process volume that overrides exposure; in the viewport's **Lit** dropdown check **Game Settings** for exposure; or on UDS disable **Apply Exposure Settings** in the Exposure category. (See `uds-lighting-and-shadows`.)
- **Moving the UDS actor to change cloud height** — wrong knob. Use `Bottom Altitude` in **Volumetric Clouds**; moving the actor breaks atmosphere/fog.
- **Mobile features missing or rendering wrong** — Feature Level is not set to Mobile. The blueprint will try to activate desktop-only features on the mobile renderer, causing visual bugs.
- **Cinematic mode left on** after a render → live FPS tanks because quality settings stay bumped at runtime. Always switch back.
- **Cloud Coverage / Fog ignored on UDS** — UDW is in the scene. Set them on UDW's weather state instead (see `udw-setup-and-state`).
- **Setting Sky Mode while a Radial Storm or Volumetric Cloud Painter is in use, on a non-Volumetric mode** — the distant-storm visuals only work with Volumetric Clouds; on other modes the storm still affects state but renders no distant visible storm.

## References & source material

Docs (Ultra Dynamic Sky 9.5):
- [Adding Ultra Dynamic Sky to Your Level](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-3)
- [Basic Controls](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-4)
- [Sky Mode](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-5)
- [Color Mode](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-6)
- [Project Mode](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-7)
- [Feature Level](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-8)
- [Considerations for Mobile](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-72)

Plugin asset paths:
- `Blueprints/` — UDS actor (drag into level from here)
- `Blueprints/Tools/` — editor utilities (Cloud Profile Authoring Tool, Static Clouds Authoring Tool, Configuration Manager, etc.)

Related skills: `uds-clouds`, `uds-fog-and-atmosphere`, `uds-time`, `uds-lighting-and-shadows`, `uds-performance-mobile-troubleshooting`, `uds-modifiers-configs-state`.
