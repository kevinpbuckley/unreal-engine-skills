---
name: uds-performance-mobile-troubleshooting
description: Tune Ultra Dynamic Sky for performance, configure for mobile/consoles, update UDS safely, modify it via child blueprints, and resolve common runtime issues. Covers Sky Mode perf impact, Volumetric Cloud Rendering Mode, sample scales, Two Layers, Sky Light Mode tradeoffs, Volumetric Fog scalability, Half Rate Tick, Use Sky Mode Scalability Map, Lights Update settings, the Mobile category + Platform Feature Levels map, updating UDS from the Fab launcher (default vs custom location), Static Properties functions, Hard Reset Cache, Max Property Cache Period, and fixes for black scene, ambient light not updating, slow Lumen GI adaptation, runtime property changes that take a second or don't apply, hard cloud/mesh intersections, blurry/streaky/dark clouds, hard fog lines, sky flickering black, low-quality volumetric fog, and missing Space Layer.
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: performance
  source-docs: https://www.ultradynamicsky.com/Documentation/V9/9-5
---

# UDS performance, mobile, updates, and troubleshooting

This skill covers GPU/CPU performance levers, mobile configuration, the update workflow, modifying UDS safely, the runtime cache system, and the bulk of common runtime issues. For SKILL.md size reasons the deepest troubleshooting tables live here (intentionally consolidated rather than scattered across the other skills).

| Concern | Where to look |
| --- | --- |
| Cut GPU cost of clouds/sky | Performance levers table below |
| Cut CPU cost of UDS tick | Half Rate Tick + Lights Update |
| Ship to mobile | Feature Level + Mobile category + Platform Feature Levels map |
| Apply a runtime variable change | Cache system section (Static Properties / Hard Reset Cache) |
| Black scene / ambient broken / weird rendering | Common Issues section |
| Update UDS | Updating UDS section |
| Modify UDS without losing on update | Child blueprints (see `uds-modifiers-configs-state`) |

## When to use this skill

- Frame rate is bad and you want to know what's costing the most.
- Building for mobile or a console with limited feature support.
- A UDS runtime variable change is delayed or has no effect.
- Updating the UDS plugin from the launcher.
- Something is rendering wrong (black, dark, hard lines, flickering, missing).
- Diagnosing single-layer water lighting wrong under clouds.

## Performance — most impactful levers

Focused on UDS-specific features. General engine perf concerns (dynamic shadows, GI, etc.) apply the same way with or without UDS.

### Sky Mode (largest GPU lever)

From most expensive to cheapest:

| Mode | Cost |
| --- | --- |
| Volumetric Clouds | Heaviest |
| 2D Dynamic Clouds | Significantly cheaper |
| Static Clouds | Cheaper still |
| No Clouds | Minimal |
| Space | Also minimal (no clouds, no atmosphere) |

### Color Mode

| Mode | Cost note |
| --- | --- |
| Sky Atmosphere | Costlier sky material |
| Simplified Color | Cheaper (skips Sky Atmosphere, simpler sky logic) |

### Project Mode

| Mode | Cost note |
| --- | --- |
| Game / Real-time | **Required** for any real-time perf project |
| Cinematic / Offline | Applies quality settings at runtime that **wreck perf** — only for offline rendering |

### Volumetric Clouds perf

| Lever | Effect |
| --- | --- |
| `Volumetric Cloud Rendering Mode` (use Performance variants) | Significant |
| `View Sample Scale` (lower) | Cheaper, noisier |
| `Shadow Sample Scale` (lower) | Cheaper, noisier shadows |
| `Max High Frequency Noise Levels` (lower) | Cheaper when close to clouds; cost scales with `High Frequency Noise Distance Scale` |
| `Two Layers` (off) | Big saving — Two Layers needs much higher sample count + more complex material |

### 2D Dynamic Clouds perf

| Lever | Effect |
| --- | --- |
| `One Cloud Layer` (on) | Reduces sky shader cost. Already on at Low material quality. |

### Sky Light perf

| Lever | Effect |
| --- | --- |
| `Sky Light Mode` = **Capture Based** | Has real-time sky light capture cost |
| `Sky Light Mode` = **Cubemap with Dynamic Color Tinting** | Eliminates capture cost while keeping ambient light dynamic; works on all platforms |

### Volumetric Fog perf

| Fact | Detail |
| --- | --- |
| Very significant rendering cost | Volumetric Fog is the heavy hitter |
| Scalability lives in **Shadow Quality** group | UDS doesn't override scalability cvars |
| Default scalability Low + Medium **disables** volumetric fog entirely | Many players won't see it on default settings |
| Global Volumetric Material adds cost on top | Enable only if needed |

### CPU / tick perf

| Setting | Effect |
| --- | --- |
| `Half Rate Tick` (in **Scalability/Performance**) — on | UDS/UDW tick every other frame above the framerate threshold (default 45 fps). Recommended on. |
| Lower framerate threshold to 30 | Tick optimization applies at 30+. Fast lighting changes then update at 15 fps and look stuttery. |
| `Use Sky Mode Scalability Map` (in **Scalability/Performance**) | Switch Sky Mode at launch based on current Effects Quality scalability. E.g. Medium+ → Volumetric, Low → Static. |
| `Lights Update` settings (in **Directional Light**) | Limit how often the lights update rotation. Reduces cached directional shadow update frequency. |

### Material quality

Almost all UDS materials respond to global material quality. At Low/Medium material quality, complexity drops automatically.

### Static / stationary lighting

Movable is the default, but **static / stationary is always cheaper** if it fits the project. See `uds-lighting-and-shadows` for setup.

## Mobile

| Step | Setting | Effect |
| --- | --- | --- |
| 1 | **Feature Level** in Basic Controls = **Mobile** | Critical. Without this, the blueprint tries to activate desktop-only features on the mobile renderer → visual bugs or wrong rendering. |
| 2 | **Mobile** category | Defines what Feature Level Mobile does (the replacement modes used for incompatible Sky Modes) |
| 3 | `Platform Feature Levels` map (in Mobile category) | Set Feature Level based on `Platform Name` at startup — useful when shipping across multiple feature levels |

### Mobile Space Layer

Project setting `Mobile DBuffer Decals` must be enabled and supported by the platform for the Space Layer to render on mobile.

## Runtime cache system (why property changes behave strangely)

UDS's runtime updates are split into three functions:

| Function | Cadence | Applies |
| --- | --- | --- |
| `Update Active Variables` | Frequent | Properties expected to change at runtime (time/weather-driven) |
| `Cache Properties` | Less often | Spreads expensive calculation across frames; values lerp between cache updates |
| `Update Static Variables` | At startup | Properties not expected to change at runtime (texture swaps, mobility, etc.) |

### "Changing a property at runtime takes a second to apply"

Active properties (e.g. Sun Light Color) typically take 1–2 seconds because the cache is updating infrequently and interpolating between values.

| Fix | Effect |
| --- | --- |
| `Hard Reset Cache()` | Instant complete refresh |
| Lower `Max Property Cache Period` in **Scalability/Performance** | Cache updates more often globally |

### "Changing a property at runtime has no effect"

These are **static properties** — applied at startup, not re-applied actively.

| Fix | Pattern |
| --- | --- |
| `Static Properties - <Category>()` | Set the variable, then call the matching function. e.g. for `Sun Softness` → `Static Properties - Sun`. |
| `Hard Reset Cache()` | As a heavy fallback that refreshes everything |

## Updating UDS

Updates can install without losing your work. **Always back up or use version control before updating** so you can roll back.

| Fact | Consequence |
| --- | --- |
| Updates overwrite assets | Direct modifications to UDS assets (e.g. editing the UDS blueprint) **will be lost** |
| Configuration assets, Sky Modifiers you created survive | They aren't overwritten by the update |
| Fab plugin **cannot** be used to update an asset pack already in your project | Use the **Epic launcher** |

### If UDS is in its default location (`Content/UltraDynamicSky/`)

```
1. Close your project
2. Launcher → Fab library → Library tab → find UDS
3. Add to Project → allow overwrite

If the launcher won't add or doesn't grab the latest version:
   Remove Local Content on UDS → try again
```

### If UDS has been moved from its default location

More involved — you'll have to do the move in another project and copy it over.

```
1. In your target project: right-click UltraDynamicSky folder
   → Update Redirector References (ensures no redirector reliance)
   Close target project.

2. From the launcher: add UDS to a blank project in the same engine version.

3. Open the blank project → open UDS demo map → let shaders compile.
   With the demo map open, move the UltraDynamicSky folder to the
   exact directory matching its location in the target project.
   Wait for the move; right-click the entire Content folder
   → Update Redirector References.

4. Close + open the UDS demo map in the blank project to verify
   nothing broke. If clouds aren't visible, run console command:
       Recompileshaders All
   (engine bug after asset moves)

5. Close both projects. From a file explorer, copy the
   UltraDynamicSky folder from the blank project over the one
   in the target project (overwriting).

6. Open the target project. Update is applied.
```

After the update, read the change log (linked from the docs home page) for any project work needed.

## Modifying UDS (survives updates)

Work in a **child class** rather than editing UDS directly. See `uds-modifiers-configs-state` for the full pattern.

## Common Issues — lighting & post processing

### Scene renders black after adding UDS

Almost certainly exposure. Try in order:

```
1. Check level for post process volumes overriding exposure
   → disable the overrides so UDS can control exposure
2. Viewport Lit dropdown → check Game Settings for exposure
3. On UDS → Exposure category → disable Apply Exposure Settings
```

### Ambient light doesn't update as time changes

Sky light isn't updating. Causes:

| Cause | Fix |
| --- | --- |
| Platform doesn't support real-time sky light capture | Switch `Sky Light Mode` to **Cubemap with Dynamic Color Tinting** (works everywhere, dynamic) |
| Static light leftover from baked solution is bright at night | Run a lighting build to clear lightmaps |

### Ambient light slow to adapt after fast sky change

That's Lumen's default GI update speed. UDS doesn't touch Lumen. Adjust **Lumen Global Illumination → Update Speed** in a post-process volume. Raises GPU cost.

### Water/ocean shader lit incorrectly in cloudy weather

Single-layer water tests directional light intensity/color without light functions.

| Fix | Where |
| --- | --- |
| Enable `Single Layer Water Uses Light Function Atlas` | Project Settings. UDS cloud shadows support the atlas. |
| Enable `Correct Specular Scale For Low Angle Cloud Shadows` | **Cloud Shadows** category on UDS — fixes sun reflection near sunset/sunrise not matching cloud coverage |

## Common Issues — volumetric clouds

| Symptom | Cause / Fix |
| --- | --- |
| **Hard mesh intersections** | Default mode is best for background clouds. Switch `Volumetric Cloud Rendering Mode` to a mode that prioritizes Mesh Intersections. |
| **Translucent materials render in front of clouds** | On the translucent material → Translucency settings → enable `Apply Fogging` and `Apply Cloud Fogging`. For some meshes also enable `Compute Fog Per Pixel`. |
| **Artifacts inside/above the layer** (banding, noise) | Raise `View Sample Count Scale` (costs perf), lower `Tracing Max Distance` (two settings inside/outside), adjust `Close View Sample Ratio` |
| **Blurry/streaky when moving fast** (e.g. time-lapse) | Default mode resolves with a long history trail. Switch to any other `Volumetric Cloud Rendering Mode`. |
| **Look dark/gray** | If using Custom Sun/Moon Light Actor: copy `Cloud Scattered Luminance Scale` from UDS's directional light component to your actor. Otherwise: leftover directional light in the level. |

## Common Issues — general rendering

| Symptom | Cause / Fix |
| --- | --- |
| **Hard line of fog/atmosphere at a specific camera distance** | Sky atmosphere positioned wrong. Place UDS at ground level; camera should never be significantly below it. |
| **Sky color flickers black when moving the camera** | Engine bug — camera dipped below sky atmosphere "ground". Select the Sky Atmosphere component on UDS (top of components list) and move it down below the lowest point the camera can reach. |
| **Volumetric fog pixelated/low quality** | Scalability — UDS doesn't override. Volumetric fog scalability cvars are in **Shadow Quality** group. |
| **Volumetric fog completely missing** | Engine default Low/Medium scalability disables it entirely. Check scalability. |
| **Space Layer not rendering** | Project setting `DBuffer Decals` (or `Mobile DBuffer Decals`) is off, or platform doesn't support DBuffer mesh decals |

## Multiplayer notes (perf-relevant)

`Time of Day` and `Date` replicate via `Replicated Time of Day` periodic syncs. Clients tick time locally between updates so the wire traffic is minimal. Weather state in UDW replicates similarly via state-source asset references rather than direct state values (see `udw-setup-and-state` replication notes).

## References & source material

Docs (Ultra Dynamic Sky 9.5):
- [Configuring For Performance](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-71)
- [Considerations for Mobile](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-72)
- [How to Update UDS](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-73)
- [Modifying UDS Blueprints](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-74)
- [Common Issues — Lighting and Post Processing](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-143)
- [Common Issues — Volumetric Clouds](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-150)
- [Common Issues — General Rendering](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-156)
- [Changing a Property at Runtime Takes a Second to Apply](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-147)
- [Changing a Property at Runtime Has No Effect](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-148)
- [Technical Notes — Cache System](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-172)
- [Technical Notes — Replication (UDS)](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-176)

Related skills: `uds-setup-and-modes` (Sky / Color / Project / Feature Mode selection — the biggest perf decisions), `uds-clouds` (full cloud settings; cloud rendering troubleshooting), `uds-lighting-and-shadows` (Sky Light Mode tradeoffs; static lighting; exposure), `uds-fog-and-atmosphere` (Volumetric Fog cost; hard fog lines; sky atmosphere position), `uds-modifiers-configs-state` (child blueprints for modifying UDS), `udw-spatial-weather` (child class pattern for Weather Override Volume).
