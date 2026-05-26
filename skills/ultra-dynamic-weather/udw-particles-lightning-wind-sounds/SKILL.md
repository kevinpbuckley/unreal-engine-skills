---
name: udw-particles-lightning-wind-sounds
description: Configure Ultra Dynamic Weather's rendered effects — Rain / Snow / Dust Particles (including Splash Particles), Particle Collision modes (Simple, Distance Field, None, Kill Sphere), Shared Particle Settings, Lightning (Flashes + Obscured, Flash Lightning function, Strikable Actor Interface), Wind (Direction + variation, Debris, Gusts, Directional Source for chaos cloth/SpeedTree, Physics Force, Camera Shake), Weather Sound Effects (wind/rain/thunder + Close Thunder Delay Per KM), Sound Occlusion with UDS Occlusion Portal, and Environment Sounds (UDS_Environment_Sound data assets, 5.1 metasound format, ChangeEnvironmentSound, UDS_TimeWeather_VolumeManager). Use any time the user asks about rain/snow not visible or blocked wrong, particle collision modes, lightning striking specific actors, wind on physics/cloth, weather sounds in interiors, ambient outdoor audio, or VR splash issues.
metadata:
  asset: Ultra Dynamic Weather (marketplace)
  category: weather-rendering
  source-docs: D:\UDSdocs.txt (lines 1146-1237, 1476-1547, 1624-1671, 1972-2030)
---

# UDW particles, lightning, wind, sounds

All the rendered/heard weather effects: particles, lightning, wind systems, and sounds. For per-material weather (wetness/snow coverage on surfaces), see `udw-material-and-screen-effects`.

| System | Driven by | Category on UDW |
| --- | --- | --- |
| Rain Particles | Rain value | **Rain Particles** |
| Snow Particles | Snow value | **Snow Particles** |
| Dust Particles | Dust value | **Dust Particles** |
| Shared particle settings | All particle systems | **Shared Particle Settings** |
| Lightning Flashes | Thunder/Lightning value | **Lightning** |
| Obscured Lightning | Thunder/Lightning value | **Lightning** |
| Wind Direction | `Wind Direction` Basic Control | **Wind Direction** |
| Wind Gusts | Wind Intensity value + perlin noise | **Wind Gusts** |
| Wind Debris | Wind Intensity value | **Wind Debris** |
| Wind Directional Source | Wind Intensity + Direction | **Wind Directional Source** |
| Wind Physics Force | Wind state per actor | (component class) |
| Wind Camera Shake | Wind Intensity | **Wind Camera Shake** |
| Weather Sound Effects | Wind / Rain / Thunder values | **Sound Effects** |
| Sound Occlusion | Player Occlusion (on UDS) | **Sound Occlusion** |
| Environment Sounds | Time / Weather / Wind (via metasound) | **Sound Effects** |

## When to use this skill

- Rain or snow not visible, or visible where it shouldn't be.
- Choosing between particle collision modes for perf vs flexibility.
- Lightning bolts striking specific actors as game logic.
- Adding wind force to physics objects or making chaos cloth react.
- Weather sounds going quiet at wrong times.
- Adding ambient outdoor audio (birds, insects, city) that changes with time/weather.
- Diagnosing VR splash particles only rendering in one eye.

## Rain / Snow / Dust Particles

Three per-particle categories on UDW: **Rain Particles**, **Snow Particles**, **Dust Particles**. Each is controlled by the corresponding weather state value.

| Category | Specific extras |
| --- | --- |
| Rain Particles | Splash particles (raindrop impacts on collision surfaces); color + lighting + max count |
| Snow Particles | Particle scale + max count + ambient light intensities |
| Dust Particles | Particle scale + color + alpha + max count |

For shared behaviors (collision and spawning), see **Shared Particle Settings** below.

### Splash Particles in VR

| Symptom | Cause | Workaround |
| --- | --- | --- |
| Splashes render only in one eye | Instanced Stereo doesn't support GPU sprites with deferred decal materials (the default splash setup) | Set **Splash Particles Rendering Mode** to **Translucent**. Renders in both eyes; subject to translucent lighting limitations. |

## Weather Particle Collision

Set with **Particle Collision Mode**.

| Mode | Cost | Flexibility | Best for |
| --- | --- | --- | --- |
| Simple Collision | CPU cost (significant) | High — uses level simple collision | Default; need precise blocking |
| Distance Field Collision | Cheap on CPU (pure GPU) | Limited — can't separate from distance-field lighting | Open worlds with distance fields |
| No Collision | Cheapest | None | Diagnosing "particles aren't visible" |

### Simple Collision details

Line traces against simple collision geometry of the level. The particles trace on one channel — `Weather Particle Collision Channel` (default: Visibility).

Niagara particle traces are **queries** — meshes need queries enabled on their collision response.

GPU particles take a small number of valid particle paths and reuse them — still can be a significant CPU cost.

**Particles not blocked when they should be (Simple Collision):**

- Object lacks simple collision geometry. Traces only check simple collision.
- Collision profile isn't set to *block* the channel selected on UDW (default Visibility), with collision response **Collision Enabled** or **Query Only** (Niagara uses queries).
- Particles coming through a high ceiling: raise **Ceiling Check Height** on UDW.

### Distance Field Collision details

Pure GPU emitters querying the global distance field.

| Constraint | Detail |
| --- | --- |
| Requires project to generate mesh distance fields | Project Settings |
| Distance field collision and lighting can't be separated | Surface that blocks particles also affects distance-field lighting; vice versa |
| Only works while global distance field exists | Engine scalability can disable it |

**Particles not colliding (Distance Field):**

- Project not generating mesh distance fields.
- View **Show → Visualize → Global Distance Field** to see what particles actually see.
- For meshes that should block, enable **Affect Distance Field Lighting**.

### Blocking particles without a mesh

`UDS Occlusion Volume` actor at `Blueprints/Occlusion/` — enable its setting to block weather particles. **Only available with Simple Collision mode.**

### Latency-free per-sphere blocking

For a moving space where particle collision latency is a problem (e.g. a player vehicle interior):

| Component | Effect |
| --- | --- |
| `Weather Particles Kill Sphere` | Kill any weather particles inside the sphere with zero latency |

**Only one Kill Sphere can be active at a time globally.** Manage activation/deactivation manually for multiple.

## Shared Particle Settings (Spawning)

In **Shared Particle Settings**. Particles spawn only in a volume around the camera; the illusion is they spawn everywhere.

| Setting | Effect |
| --- | --- |
| `Max Spawn Distance` | How far from camera particles spawn (X/Y) |
| `Spawn Distance Distribution` | How particles distribute within that range |
| `Spawn Box Height` | How far above camera particles can spawn |
| `World Spawn Offset`, `Camera Forward Spawn Offset` | Relocate the center of the spawn area |
| `Custom Weather Particle Camera Transform` *(advanced dropdown)* | Spawn around a manual location instead of the camera |

## Particles Not Visible

| Cause | Fix |
| --- | --- |
| Particles blocked by an invisible collision source | Switch **Particle Collision Mode** → **No Collision** to test |
| Editor viewport Show flags hiding sprites | Show dropdown → **Use Defaults** |
| Rare engine bug: Niagara compilation failed on first load | Open system asset in `Particles/` (Rain/Snow/Dust) → **Compile** dropdown → **Full Rebuild** |
| Running in Simulate play mode | Limitation: it renders through editor camera and neither the blueprint or Niagara can sample the editor camera for the particle spawn area. Use a different play mode. |

## Lightning

Two types:

| Type | What | Setting |
| --- | --- | --- |
| **Lightning Flashes** | Big bolts that cast light + crash of thunder | Interval + light source enable/disable + colors |
| **Obscured Lightning** | Idle flashes hidden in cloud layer | Frequency |

Both scale with the **Thunder/Lightning** value of current weather state.

Thunder sound settings live in the **Sound Effects** category — see below.

### Manual lightning flash

```
UDW.FlashLightning(customLocation, customTargetLocation)
// customLocation: optional; should be at cloud level (root of bolt)
// customTargetLocation: if nonzero, the bolt ends there
```

### Lightning striking specific actors

```
1. Add the UDW_Lightning Strikable Actor Interface to your actors
2. Implement "Test for Potential Lightning Strike":
   outputs: can-be-struck-now (bool) + world location where strike hits
3. On UDW → Lightning category:
   Enable "Enable Lightning Flashes Striking Actors"
4. Set "Fraction Of Lightning Flashes Which Can Strike Actors"
   (how many potential flashes go to actors when any are in range)
5. Implement the interface's "Struck by Lightning" event
   to spawn extra effects or run game logic
```

### Lightning in Sequencer

```
1. Add UDW to the sequence
2. Create Event → Trigger track on UDW
3. Add a keyframe; right-click for properties
4. Endpoint → Quick Bind → Flash Lightning
5. Configure custom location/seed in keyframe properties
6. Check Call in Editor to preview in the sequence editor
```

## Wind

### Wind Direction

Controlled separately from weather state via **Wind Direction** in Basic Controls + the **Wind Direction** category. Direction drives weather particles **and** cloud movement on UDS.

| Setting | Effect |
| --- | --- |
| **Wind Direction Variation** | Random noise variation at runtime, centered on Basic Controls Wind Direction |

WOVs can override wind direction. If `Apply Wind Direction` is true on a WOV, the volume's wind direction wins as the player enters.

### Wind Gusts

Wind intensity has a perlin-noise variation applied to simulate gusts. Settings in **Wind Gusts**: scale of variation, speed of the perlin noise.

### Wind Debris

Small debris particles flying through the air when Wind Intensity is high. Category: **Wind Debris**.

| Setting | Effect |
| --- | --- |
| Amount, scale, texture sheet | Debris appearance (texture must be 4×4 with alpha) |
| `Wind Debris Particle Spawn Count` | Live-updates at runtime |
| Spawning/collision | Uses Shared Particle Settings |

### Wind Directional Source

A **Wind Directional Source** is an engine component used by chaos cloth and SpeedTree assets. UDW makes and controls one with current wind by default.

| Category | Setting | Effect |
| --- | --- | --- |
| **Wind Directional Source** | Scale Wind Speed | How high Wind Speed is set on the source |
| **Wind Directional Source** | Disable when in interior | No wind speed when inside an interior |

### Wind Physics Force

Apply wind force to physics-simulating objects. Add the **Wind Physics Force** component as a child of any primitive component simulating physics. At runtime, the component queries UDW wind state and line-traces to test exposure.

### Wind Camera Shake

Enable in **Wind Camera Shake** to shake the player camera at max wind speeds.

| Setting | Effect |
| --- | --- |
| Scale of shake | Magnitude |
| Range of Wind Intensity that triggers shake | Threshold band |
| **Player Occlusion masking** *(automatic)* | No shake when player is in an interior. Controlled by Player Occlusion on UDS — see `uds-modifiers-configs-state`. |

## Weather Sound Effects

Enabled by default for wind, rain, thunder. Category: **Sound Effects**.

| Setting | Effect |
| --- | --- |
| Enable/disable globally | Master toggle |
| Per-effect Volume | Scales with weather state and these settings |
| `Close Thunder Delay Per KM` | How much thunder is delayed from the visual flash. Raise for realistic speed-of-sound delay. |

### Runtime control

```
UDW.SetEnableWeatherSoundEffects(bool)   // toggle all
// Or set the per-sound Volume variables directly
```

All UDW sounds use the **UDS_Weather** sound class. Add it as a child of your project's Sound Effects class so weather sounds inherit your sound mix.

## Sound Occlusion

Default: a simple system periodically traces from the camera and adjusts sound volume + low-pass filter (muffling) if the player is in an enclosed space. Toggle/adjust in **Sound Occlusion** category.

The actual occlusion calculation lives in **Player Occlusion** on UDS — see `uds-modifiers-configs-state`.

### Forced-occluded zones

Place a **UDS Occlusion Volume** actor (`Blueprints/Occlusion/`) to always-occlude a space. The **Occlusion Sampling Mode** in **Player Occlusion** decides if volumes are sampled.

### Sound portals

**UDS Occlusion Portal** component. If instances exist around the occlusion sampling location, they're traced against and can negate occlusion when the trace is unobstructed. Use case: an open door/window letting outside weather sound naturally into the space.

### Your own outdoor sounds following weather occlusion

Set your own sound sources to use the sound class **UDS Outdoor Sound** — they get occluded by the same volume attenuation as weather sounds.

## Environment Sounds

System for general ambient outdoor audio (birds, insects, city ambience) that responds to time/weather and the sound occlusion. **Sound Effects** category on UDW selects the environment sound asset; a Forest ambience example ships.

### Authoring an Environment Sound asset

```
1. Make a new data asset of type UDS_Environment_Sound
2. Point at a metasound source asset (the actual sound played)
3. Tune volume + parameter overrides
```

### Metasound source format

For sound occlusion and four-direction stereo panning, output format must be **5.1**:

| Channel | Use |
| --- | --- |
| Front Left (0) | Directional audio from -X |
| Front Right (1) | Directional audio from +X |
| Front Center (2) | Directional audio from -Y |
| Low Frequency (3) | Directional audio from +Y |
| Side Left (4) | Global audio left channel |
| Side Right (5) | Global audio right channel |

Directional audio is spatialized based on listener orientation and occluded directionally. Global audio is stereo, occluded by global occlusion.

### Audio bus setup

```
Source Settings:
   Enable Bus Sends: true
   Enable Base Submix: false
   + Post-Effect Bus Send → audio bus "UDS_Weather_AudioBus"
```

### Reacting to Time/Weather/Wind

Five input parameters UDW sets on your metasound:

| Param | Type |
| --- | --- |
| `Time`, `Weather`, `Wind` | Integers |
| `Weather Interp`, `Time Interp` | Time parameters |

Included metasound nodes use these:

| Node | What it does |
| --- | --- |
| `UDS_TimeWeather_VolumeManager` | Outputs a changing volume using array inputs for what the volume should be in different times / weathers / wind levels |
| `UDS_DayNight_VolumeManager` | Simpler day/night version |

Reference: included **Forest Example** metasound source at `Sound/MetaSounds/`.

### Runtime control

```
UDW.ChangeEnvironmentSound(asset)  // change at runtime
UDW.ChangeEnvironmentSound(null)   // stop environment sounds
```

## Gotchas

- **Splash particles only in one eye in VR** — Splash Particles Rendering Mode = **Translucent**.
- **Particles not visible at all** — invisible collision source blocking; or Show flags hiding sprites (Use Defaults); or Niagara compile fail (Full Rebuild on the asset).
- **Particles ignore an interior space (Simple Collision)** — ceiling too tall; raise `Ceiling Check Height`. Or use `Weather Particles Kill Sphere` for a moving interior.
- **UDS Occlusion Volume doesn't block particles** — `Particle Collision Mode` is Distance Field. Switch to Simple Collision (volume blocking is Simple-only).
- **Lightning never strikes the player despite the interface** — `Enable Lightning Flashes Striking Actors` is off, or `Fraction Of Lightning Flashes Which Can Strike Actors` is 0.
- **Sounds go quiet at incorrect times** — Sound Occlusion traces hitting surfaces they shouldn't. Adjust **Player Occlusion** on UDS (trace count, channel, update period).
- **No sound from open door/window** — add a `UDS Occlusion Portal` component to the door/window. Make sure traces can reach it.
- **Wind doesn't affect chaos cloth / SpeedTree** — `Wind Directional Source` category on UDW isn't enabled, or `Disable when in interior` is on and the actor is occluded.
- **Wind Camera Shake doesn't trigger** — Wind Intensity below the threshold band, or player is occluded.
- **Environment Sound metasound playing but no panning/occlusion** — output format isn't 5.1, or `Post-Effect Bus Send` to `UDS_Weather_AudioBus` is missing.
- **Custom outdoor sound not occluded with weather** — assign it the **UDS Outdoor Sound** class.

## References & source material

Docs: `D:\UDSdocs.txt`
- Rain / Snow / Dust Particles — lines 1146-1168
- Weather Particle Collision (Simple / Distance Field / Kill Sphere / Occlusion Volume) — lines 1171-1197
- Shared Particle Settings (Spawning) — lines 1200-1209
- Lightning (Flashes + Obscured + Flash Lightning + Strikable Interface) — lines 1212-1237
- Sound Effects — lines 1476-1484
- Sound Occlusion (Portal, UDS Outdoor Sound) — lines 1487-1496
- Environment Sounds (metasound format) — lines 1499-1547
- Wind Direction + Gusts + Debris + Source + Physics Force + Camera Shake — lines 1624-1670
- Particle troubleshooting (incl. VR splash, Simulate mode) — lines 1972-2030

Plugin asset paths:
- `Particles/` — Rain, Snow, Dust, Wind Debris niagara systems
- `Particles/` — Lightning Strike + Obscured Lightning systems
- `Sound/MetaSounds/` — included Forest Example environment sound metasound source
- `Blueprints/Occlusion/` — UDS Occlusion Volume actor; UDS Occlusion Portal component
- Materials → `UDS_Weather` sound class; **UDS_Weather_AudioBus** audio bus
- Component classes: Weather Particles Kill Sphere; Wind Physics Force

Related skills: `udw-setup-and-state`, `udw-spatial-weather` (WOV wind override; UDS Occlusion Volume), `uds-modifiers-configs-state` (Player Occlusion calculates occlusion; AmbientSound — Time and Weather Controlled is the simpler sound option), `udw-material-and-screen-effects` (material wetness/snow accumulates from particle landing context).
