---
name: nanite-and-rendering
description: Understand and configure Unreal's UE5 rendering features — Nanite virtualized geometry,
  Virtual Shadow Maps, Temporal Super Resolution (TSR) and anti-aliasing, post-process settings
  (FPostProcessSettings), scene capture to render targets, and scalability/cvars. Use when enabling
  Nanite, choosing AA/upscaling, configuring DOF/motion blur/bloom, rendering to a texture
  (minimaps/mirrors/portals), or reasoning about rendering performance and quality.
metadata:
  engine-version: "5.7"
  category: world-building
---

# Nanite & rendering features

UE5's renderer centers on **Nanite** (virtualized geometry), **Lumen** (dynamic GI — see
`lighting-and-lumen`), and **Virtual Shadow Maps**. This skill covers Nanite plus the broader
rendering knobs: anti-aliasing/upscaling, post process, scene capture, and scalability.

## When to use this skill

- Enabling Nanite and knowing where it does/doesn't apply.
- Choosing anti-aliasing/upscaling (TSR vs TAA vs DLSS/FSR plugins).
- Configuring post-process (DOF, motion blur, bloom, color) in code/volumes.
- Rendering the scene to a texture (minimap, security camera, mirror, portal).
- Reasoning about rendering performance/scalability.

## Nanite (virtualized geometry)

- Streams and renders enormous triangle counts efficiently, largely removing manual LOD authoring
  for dense **static** meshes. Enable per static mesh (mesh editor → Enable Nanite).
- Strengths: high-poly environment art, kitbashing, photogrammetry.
- Constraints (verify against your 5.7 build — support has been expanding across 5.x):
  historically opaque/masked geometry; limited for translucency and heavy per-vertex deformation;
  skinned/foliage support has grown but check before relying on it.
- Pair Nanite with **Virtual Shadow Maps (VSM)** for matching high-detail shadows.
- Where Nanite doesn't apply, keep traditional **LODs** (`meshes-static-and-skeletal`).

## Anti-aliasing & upscaling

- **TSR (Temporal Super Resolution)** — UE5's high-quality temporal upscaler; renders at a lower
  internal resolution and reconstructs. Good default for UE5.
- **TAA** — older temporal AA. **MSAA** only in forward rendering.
- **DLSS / FSR / XeSS** — vendor upscalers via plugins for additional perf.
Set screen percentage / upscaler in project & scalability settings; lower internal resolution is
the biggest perf lever.

## Post process (look & camera effects)

Driven by `FPostProcessSettings` (in `Scene.h`), applied via Post Process Volumes or a camera:
exposure, bloom, color grading, **depth of field**, **motion blur**, vignette, chromatic
aberration, film grain, plus Lumen/AO/reflection overrides. Tune globally with an unbound volume
and locally with bounded volumes (see `lighting-and-lumen` for exposure specifics).

## Scene capture (render to texture)

Render the scene (or a camera view) into a `UTextureRenderTarget2D` for minimaps, security
monitors, mirrors, and portals:
```cpp
USceneCaptureComponent2D* Capture = CreateDefaultSubobject<USceneCaptureComponent2D>(TEXT("Capture"));
Capture->TextureTarget = MyRenderTarget;            // UTextureRenderTarget2D asset
Capture->CaptureSource = ESceneCaptureSource::SCS_FinalColorLDR;
// Capture->bCaptureEveryFrame / CaptureScene() to control update cadence
```
Scene captures are **expensive** (they re-render the scene) — capture on demand or at reduced rate/
resolution, not every frame at full res.

## Scalability & cvars

- **Scalability groups** (View Distance, Shadows, Global Illumination, Reflections, Post Process,
  Textures, Effects, Foliage, Shading) scale quality vs perf; expose them in settings UI.
- Console variables (`r.*`) tune the renderer (e.g. `r.ScreenPercentage`, `r.Lumen.*`,
  `r.Shadow.Virtual.*`). Set via Device Profiles / config for shipping, not hardcoded.

## Performance mental model

- Resolution/screen percentage and overdraw (translucency) are top costs.
- Dynamic lights with shadows, scene captures, and heavy post-process add up.
- Nanite + VSM + Lumen are designed to scale, but still need budgeting; profile with the GPU tools
  (`profiling-and-optimization`).

## Gotchas

- **Expecting Nanite on unsupported content** (translucent/some skinned cases) — verify support.
- **Scene capture every frame at full res** → severe GPU cost; throttle.
- **Hardcoding `r.*` cvars** in code → use device profiles/scalability config instead.
- **Translucency overuse** → overdraw; reconsider materials (`materials-and-shaders`).
- **Mismatched shadows** — use Virtual Shadow Maps with Nanite/Lumen for consistent quality.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Engine/Scene.h` — `FPostProcessSettings` (DOF, motion blur, bloom, color, GI/reflection method).
- `Runtime/Engine/Classes/Engine/StaticMesh.h` — Nanite settings on the mesh.
- `Runtime/Engine/Classes/Components/SceneCaptureComponent2D.h` — `USceneCaptureComponent2D`.

Official docs (UE 5.7): Designing Visuals, Rendering, and Graphics —
<https://dev.epicgames.com/documentation/unreal-engine/designing-visuals-rendering-and-graphics-with-unreal-engine>

Related: `lighting-and-lumen`, `meshes-static-and-skeletal`, `profiling-and-optimization`.
