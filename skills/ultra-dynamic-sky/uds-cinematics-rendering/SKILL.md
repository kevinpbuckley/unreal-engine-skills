---
name: uds-cinematics-rendering
description: Use Ultra Dynamic Sky for cinematic work — animating UDS with Sequencer (keyframing Time of Day, Cloud Coverage/Fog, Cloud Movement, exposing extra variables to cinematics), rendering movies with Movie Render Queue (Project Mode Cinematic/Offline), supporting the Path Tracer (`Adjust for Path Tracer`, post-process height fog approximation), and configuring volumetric clouds to seamlessly loop. Use any time the user mentions Sequencer with UDS, cinematic rendering, MRQ, path-traced renders with UDS, looping clouds for a film, or keyframing the sky/weather over time.
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: cinematics
  source-docs: https://www.ultradynamicsky.com/Documentation/V9/9-5
---

# UDS cinematics and rendering

This skill covers everything UDS-side for cinematic work: Sequencer animation, Movie Render Queue, Path Tracer support, and seamlessly looping volumetric clouds. For weather animation/keyframing, see `udw-setup-and-state` and `udw-material-and-screen-effects`.

| Task | Where to start |
| --- | --- |
| Animate time of day in Sequencer | Disable `Animate Time of Day`, keyframe `Time of Day` |
| Animate weather state | UDW Manual Weather State (not UDS Cloud Coverage / Fog if UDW present) |
| Animate cloud movement deterministically | Cloud Speed = 0, keyframe `Cloud Phase` |
| Render a movie | Project Mode = Cinematic / Offline (switch back after) |
| Render with the Path Tracer | Enable `Adjust for Path Tracer` + keep height fog post-process approximation |
| Make volumetric clouds loop seamlessly | Multi-step recipe in **Cloud Movement** + **Volumetric Clouds** |
| Trigger a lightning flash from Sequencer | UDW `Flash Lightning` via Event → Trigger track |

## When to use this skill

- Animating time of day or weather in Sequencer.
- Rendering a film/cinematic with UDS (MRQ).
- Rendering with the Path Tracer.
- Making clouds loop seamlessly for a recorded movie.
- Spawning lightning flashes from a sequence.
- Diagnosing keyframed UDS variables that don't update at runtime.

## Project Mode for renders

Before rendering, switch **Project Mode** on UDS to **Cinematic / Offline**:

| Effect | Detail |
| --- | --- |
| Forces full updates every frame | UDS (and UDW) update completely per frame instead of cache-spread |
| Bumps quality settings at runtime | Many sky/cloud quality knobs auto-increase |
| Disables real-time optimizations | The cache system pauses |

**Switch back to Game / Real-time after rendering** — Cinematic's quality bumps tank live game perf.

The **Cinematic / Offline Mode** category has additional knobs for offline-only quality tuning.

## Animating with Sequencer

### Keyframing Time of Day

```
1. Disable Animate Time of Day on UDS  ← otherwise it overrides your keys
2. Add UDS to the sequence
3. Keyframe Time of Day directly
```

Going past 2400 is fine — UDS understands it and rolls into the next day.

### Keyframing Cloud Coverage or Fog

Keyframe `Cloud Coverage` / `Fog` on UDS — **but only if UDW is not in the scene**. If UDW is present, those values are controlled by weather state and keyframing them on UDS won't stick. Instead keyframe `Cloud Coverage` and `Fog` on UDW via its manual weather state (see `udw-setup-and-state`).

### Keyframing Cloud Movement (deterministic playback)

For playback identical every time:

```
1. CloudSpeed = 0
2. Randomize Cloud Formation on Run = false
3. Clouds Move with Time of Day = false
4. Keyframe Cloud Phase in Sequencer
```

This gives direct deterministic control.

### Exposing additional variables for keyframing

Not every UDS variable is dynamically re-applied at runtime; many *can be keyframed* and will just update. All variables exposed by default already work — they're already marked `Expose to Cinematics`.

For variables not exposed by default:

```
1. Open UDS in the blueprint editor
2. Find the variable in My Blueprint panel
3. Check Expose to Cinematics in its variable details
```

The variable then becomes keyframable. But for variables that aren't dynamically re-applied at runtime, the keyframe value won't propagate. Workaround: **call the matching `Static Properties - <Category>` function every frame of the animation** — that forces the value to update each frame.

## Rendering movies (MRQ)

Movie Render Queue workflow with UDS:

```
1. Project Mode → Cinematic / Offline
2. Render via MRQ as normal
3. Switch Project Mode back to Game / Real-time when finished
```

If using the Path Tracer, see the next section.

## Path Tracer

The Path Tracer uses the **sky light cubemap** as a replacement for native sky rendering. This brings limitations UDS compensates for.

```
1. In UDS → Cinematics / Offline Rendering category:
   Enable "Adjust for Path Tracer"

2. In UDS → Fog Color category:
   Leave "Render Height Fog In Path Tracer Using Post Process" enabled (default)
   ← approximates distant height fog via post process
   ← the path tracer otherwise has no native height fog support
```

With those on, UDS works acceptably as a background for path-traced renders.

## Looping volumetric cloud movement

For seamlessly looping cloud animation in a film render. The loop requires the cloud formation texture to complete one full 0–1 UV cycle, which constrains the minimum loop length.

### In Cloud Movement

| Setting | Value |
| --- | --- |
| `Cloud Speed` | 0 (drive time via `Cloud Phase`) |
| `Cloud Direction` | A single axis: 0, 90, 180, or 270 |
| `Formation Change Speed` | 1 (or 0.5 for a loop twice as long) |

### In Volumetric Clouds

| Setting | Value |
| --- | --- |
| `3D Noise Scale` | 1 |
| `Cloud Formation Texture Scale` | 1 |
| `Macro Variation` | 0 |
| `3D Noise Vertical Movement` | 0 |

### Keyframe

```
Cloud Phase: 0 → 100   (seamless loop)
// With Formation Change Speed = 0.5:
Cloud Phase: 0 → 200
```

## Keyframing a lightning flash

(For stormy weather cinematics.) Add UDW to the sequence:

```
1. Create an Event → Trigger track on UDW
2. Add a keyframe; right-click for properties
3. Endpoint → Quick Bind → Flash Lightning
4. Configure inputs (Custom Lightning Location, seed) in keyframe properties
5. Check Call in Editor to preview the flash in the sequence editor
```

Full lightning details in `udw-particles-lightning-wind-sounds`.

## Gotchas

- **Keyframed Time of Day has no effect** — `Animate Time of Day` is still on and overriding. Disable it.
- **Keyframed Cloud Coverage / Fog on UDS has no effect** — UDW is in the scene. Keyframe on UDW's manual weather state instead.
- **Cloud movement looks different each playback** — `Randomize Cloud Formation On Run` is on, or `Clouds Move With Time of Day` is on. Disable both for deterministic playback.
- **Cloud movement loops with a visible seam** — one of the looping recipe steps is missing (often Formation Change Speed ≠ 1, or 3D Noise Vertical Movement ≠ 0).
- **Exposed-to-cinematics variable doesn't actually update at runtime** — not dynamically re-applied. Call `Static Properties - <Category>` every frame.
- **Game perf is terrible after rendering** — Project Mode is still on **Cinematic / Offline**. Switch back to Game / Real-time.
- **Path-traced render shows no height fog in the distance** — `Render Height Fog In Path Tracer Using Post Process` is off. The path tracer lacks native height fog; UDS approximates via post process when enabled.

## References & source material

Docs (Ultra Dynamic Sky 9.5):
- [Animating UDS with Sequencer](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-43)
- [Rendering Movies](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-44)
- [Rendering with the Path Tracer](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-45)
- [Looping the Volumetric Cloud Movement](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-46)
- [Using Weather with Sequencer](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-125) (UDW, incl. keyframing a lightning flash)

Related skills: `uds-setup-and-modes`, `uds-clouds`, `uds-time`, `uds-fog-and-atmosphere`, `udw-setup-and-state`, `udw-particles-lightning-wind-sounds`.
