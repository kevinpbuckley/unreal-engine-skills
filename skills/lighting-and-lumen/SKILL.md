---
name: lighting-and-lumen
description: Light Unreal scenes — light types and mobility (Static/Stationary/Movable), Lumen
  dynamic global illumination and reflections, sky/atmosphere/fog, post process volumes for
  exposure and color grading, and baked vs dynamic lighting trade-offs. Use when setting up scene
  lighting, enabling/troubleshooting Lumen, configuring sky and fog, tuning exposure/bloom/color,
  or deciding between baked and real-time lighting.
metadata:
  engine-version: "5.7"
  category: world-building
---

# Lighting & Lumen

UE5's default lighting is **fully dynamic**: Lumen provides global illumination and reflections
with no bake. Get the light types, mobility, and the sky/fog/post-process stack right and most
scenes look good without lightmaps.

## When to use this skill

- Setting up scene lighting (sun, sky, local lights).
- Enabling or debugging Lumen GI/reflections.
- Configuring sky atmosphere, sky light, clouds, and fog.
- Tuning exposure, bloom, and color grading; or choosing baked vs dynamic.

## Light types & mobility

Lights: **Directional** (sun/moon), **Point**, **Spot**, **Rect**, and **Sky Light** (ambient/IBL).

Mobility decides cost and capability:
| Mobility | Lighting | Shadows | Notes |
|---|---|---|---|
| **Static** | baked into lightmaps | baked | cheapest at runtime; needs lightmap UVs + a bake; no runtime change |
| **Stationary** | direct dynamic, indirect baked | mixed | limited count per area; legacy hybrid |
| **Movable** | fully dynamic | dynamic | required for Lumen GI to react; most flexible |

For a Lumen workflow, use **Movable** lights so GI and shadows update in real time.

## Lumen (dynamic GI + reflections)

- On by default in UE5; provides indirect lighting and reflections that react to movable lights and
  changing geometry — no lightmap bake.
- Requirements/notes: enable **Generate Mesh Distance Fields** (project setting) for software ray
  tracing; Lumen can use **Hardware Ray Tracing** for higher-quality reflections where supported.
- Quality vs cost is controlled via project/scalability settings and Post Process Volume Lumen
  settings (final gather quality, reflection quality).
- Pairs with **Virtual Shadow Maps** for high-quality dynamic shadows (`nanite-and-rendering`).

## Sky, atmosphere, fog

A typical real-time sky:
- **Directional Light** (the sun) + **Sky Atmosphere** (physically-based sky) — orient the sun to
  recolor the sky.
- **Sky Light** set to real-time capture for ambient/IBL from the sky.
- **Volumetric Clouds** for 3D clouds; **Exponential Height Fog** (with volumetric fog) for depth
  and god rays.

## Post Process Volume (look control)

`APostProcessVolume` (unbound or bounded) applies `FPostProcessSettings`: **exposure** (eye
adaptation), **bloom**, **color grading** (white balance, saturation, tone curve), depth of field,
motion blur, and Lumen/AO/reflection overrides. Use a global volume for the base look and bounded
volumes to vary it by area.
```cpp
// Lights/post are usually placed & tuned in-editor, but settings are FPostProcessSettings (Scene.h)
// e.g. exposure: set Min/Max EV100 or switch to manual exposure in the volume.
```

## Baked lighting (still available)

- **Lightmass / GPU Lightmass** bake static lighting into lightmaps for static scenes or mobile/
  perf-constrained targets. Requires lightmap UVs (`importing-content`) and Static/Stationary lights.
- Use baking when you need the cheapest runtime cost and the scene doesn't change; otherwise prefer
  Lumen.

## Choosing

- **Default / dynamic / changing scenes** → Movable lights + Lumen.
- **Mobile / low-end / fully static scene** → baked lightmaps.
- **Stylized exposure/color** → drive it in a Post Process Volume; prefer manual exposure for
  consistent looks (auto-exposure can "breathe").

## Gotchas

- **Lumen with Static/Stationary lights** won't get dynamic GI — use Movable.
- **Distance fields disabled** → software-Lumen artifacts/missing GI; enable mesh distance fields.
- **Auto-exposure surprises** — scenes look too bright/dark as the camera moves; set manual exposure.
- **Baked lighting without lightmap UVs** → blotchy/black; generate UVs on import.
- **Too many overlapping dynamic lights** with shadows → perf cost; budget local lights.
- **Sky Light not recapturing** after sky changes → stale ambient; use real-time capture.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Components/LightComponent.h`, `DirectionalLightComponent.h`, `SkyLightComponent.h`.
- `Runtime/Engine/Classes/Engine/PostProcessVolume.h` — `APostProcessVolume`.
- `Runtime/Engine/Classes/Engine/Scene.h` — `FPostProcessSettings` (exposure, bloom, color grading, Lumen overrides).

Official docs (UE 5.7): Designing Visuals, Rendering, and Graphics —
<https://dev.epicgames.com/documentation/unreal-engine/designing-visuals-rendering-and-graphics-with-unreal-engine>

Related: `nanite-and-rendering`, `materials-and-shaders`.
