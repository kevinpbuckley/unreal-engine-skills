# Rendering pipeline — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the deferred rendering pass order, the
scene view/render flow, post-process chain interaction with TSR, GPU Scene update semantics,
and a practical cvar reference table. Grounded in UE 5.7
(`Engine/Source/Runtime/Renderer/Private/DeferredShadingRenderer.h`,
`Engine/Source/Runtime/Renderer/Private/SceneRendering.h`,
`Engine/Source/Runtime/Engine/Classes/Engine/Scene.h`).

## Deferred rendering pass order (simplified)

For a typical desktop deferred frame with Nanite + Lumen + VSM:

1. **GPU Scene update** — `FGPUScene` uploads dirty primitive/instance data for the frame.
2. **Depth prepass** — renders opaque geometry depth (for occlusion and Hi-Z).
3. **Nanite rasterization pass** — GPU-driven cluster visibility/rasterization into the
   Visibility Buffer; runs alongside or after the depth prepass.
4. **Base pass (G-buffer)** — non-Nanite opaque geometry writes base color, normals,
   roughness, metallic, emissive into G-buffer render targets.
5. **Nanite shading** — reads the Visibility Buffer, evaluates materials per visible pixel.
6. **Shadow passes** — Virtual Shadow Map page rendering for dynamic lights; Nanite
   geometry uses the GPU-driven rasterizer here too.
7. **Lighting pass** — reads G-buffer + shadow maps, accumulates direct lighting.
8. **Lumen** — screen-space GI trace + radiance cache update (see `lighting-and-lumen`).
9. **Reflections** — Lumen reflection capture or screen-space reflections.
10. **Sky/atmosphere**.
11. **Translucency** — forward-rendered; reads scene depth for soft particles. This is
    where overdraw accumulates.
12. **Velocity / motion vectors** — used by TSR, motion blur.
13. **TSR / TAAU** — temporal upscaling at the configured screen percentage.
14. **Post-process chain** — bloom, tonemapper, color grading, DOF, motion blur, chromatic
    aberration. Materials in "Before Translucency" / "Before Tonemapping" / "After Tonemapping"
    blendable locations run at their respective pipeline points.
15. **UI** — always at native resolution, after upscaling.

The TSR pass (step 13) is what makes lower screen percentages viable: passes before it run
at reduced resolution; passes after run at full display resolution.

## Scene view and render flow

`FSceneRenderer` (abstract base in `SceneRendering.h`) drives the frame. The concrete
`FDeferredShadingSceneRenderer` (`DeferredShadingRenderer.h`) handles the desktop path.
The key objects:

- **`FScene`** — the game thread's representation of the world (primitives, lights,
  cameras). Primitive additions/removals are queued and applied at the start of the render
  thread frame.
- **`FViewInfo`** — per-view data (projection, frustum, visibility) computed during
  `InitViews`. One `FViewInfo` per active camera/scene capture.
- **`FGPUScene`** (`GPUScene.h`:216) — GPU-resident buffer of `FPrimitiveUniformShaderParameters`
  and per-instance data. Updated by queued `FScenePreUpdateChangeSet` / `FScenePostUpdateChangeSet`
  at the render thread frame boundary.

Adding a `UPrimitiveComponent` to the world eventually calls
`FScene::AddPrimitive`, which enqueues a render-thread command to register the primitive
into `FGPUScene`. The primitive is not GPU-visible until the next frame's `FGPUScene::Update`.

## FPostProcessSettings interaction with the pipeline

`FPostProcessSettings` (`Scene.h`:692) fields are blended across all active Post Process
Volumes and the camera. Each field has a paired `bOverride_<FieldName>` bit. When not
overridden, the project default from `RendererSettings.h` applies (e.g.,
`bDefaultFeatureBloom`, `bDefaultFeatureMotionBlur`).

**Post-process material blendable locations:**
- `BL_BeforeTranslucency` — runs before step 11; useful for effects that must be under
  translucency (e.g., heat distortion on the background).
- `BL_BeforeTonemapping` — runs after translucency, before tonemapper; full HDR values
  available.
- `BL_AfterTonemapping` — after tonemapper + TSR; runs at full display resolution. Most
  UI-adjacent effects go here.
- `BL_ReplacingTonemapper` — replaces the built-in tonemapper entirely.

Post-process materials after TSR (`BL_AfterTonemapping`) run at full output resolution.
Use `PostProcessInput0.Size` and `InvSize` outputs from the Scene Texture expression to
get the actual pixel dimensions since `View.ViewSizeAndInvSize` still reports the
pre-TSR view size.

## TSR and screen percentage interaction

TSR renders the 3D scene at `r.ScreenPercentage / 100` of the output resolution. The
temporal history accumulates sub-pixel jitter across frames, recovering near-native sharpness.

`ITemporalUpscaler` (`TemporalUpscaler.h`:11) is the plugin interface for third-party
upscalers. DLSS 3, FSR 2+, and XeSS register implementations at engine startup and are
automatically used when the user selects them in project settings. From a C++ perspective,
the active upscaler is transparent to rendering code.

Relevant cvars:

| cvar | Effect |
|---|---|
| `r.ScreenPercentage` | 3D render resolution fraction (default 100, set lower for perf) |
| `r.AntiAliasingMethod` | 0=None, 1=FXAA, 2=TAA, 3=MSAA, 4=TSR |
| `r.TSR.History.ScreenPercentage` | TSR history resolution (higher = less ghosting, more VRAM) |
| `r.TemporalAA.Upsampling` | Enable TAAU (set 1 with `r.AntiAliasingMethod 2`) |
| `r.PostProcessAAQuality` | Temporal AA shader quality tier (3–4 for console performance) |
| `r.Upscale.Quality` | Spatial upscaler quality for FXAA/non-temporal paths |

## GPU Scene — what agents need to know

`FGPUScene` maintains two GPU buffers per frame:
- `GPUScenePrimitiveSceneData` — per-primitive uniform data (local-to-world, bounds, flags).
- `GPUSceneInstanceSceneData` / `GPUSceneInstancePayloadData` — per-instance transforms
  and custom payload (used by HISM, Nanite instancing, etc.).

Nanite's culling and rasterization reads directly from these buffers without CPU-side
draw call generation. Any `UStaticMeshComponent` or HISM instance change (transform,
visibility, material override) queues an update to `FGPUScene`; the change is visible
to Nanite on the next render frame, not the same frame.

Practical implication: if you programmatically move many instances per frame and then
immediately check their Nanite rendering, there is a one-frame lag. This is expected and
matches how the traditional mesh rendering path works.

## Key r.* cvars — complete table

### Nanite

| cvar | Default | Purpose |
|---|---|---|
| `r.Nanite.MaxPixelsPerEdge` | 1.0 | LOD threshold — lower = finer clusters (higher quality, more cost) |
| `r.Nanite.Tessellation` | 0 | Enable runtime programmable tessellation |
| `r.Nanite.Visualize` | empty | Visualization mode (Triangles, Clusters, Primitives, …) |
| `r.RayTracing.Nanite.Mode` | 0 | 0=fallback mesh RT, 1=native Nanite RT (experimental) |

### Shadows

| cvar | Default | Purpose |
|---|---|---|
| `r.Shadow.Virtual.Enable` | 1 | Enable Virtual Shadow Maps |
| `r.Shadow.Virtual.ResolutionLodBiasDirectional` | 0 | Increase to reduce directional VSM quality/cost |
| `r.Shadow.Virtual.ResolutionLodBiasLocal` | 0 | Same for local (point/spot) lights |
| `r.Shadow.Virtual.Cache.StaticSeparate` | 1 | Cache static shadow pages separately for perf |

### Virtual Texturing

| cvar | Default | Purpose |
|---|---|---|
| `r.VirtualTextures` | 0 | Enable VT globally (project restart required) |
| `r.VT.TileSize` | 128 | VT tile size in pixels |
| `r.VT.AnisotropicFiltering` | 0 | Enable VT anisotropic filtering (adds shader cost) |

### Lumen

| cvar | Default | Purpose |
|---|---|---|
| `r.Lumen.Reflections.Allow` | 1 | Toggle Lumen reflections |
| `r.Lumen.DiffuseIndirect.Allow` | 1 | Toggle Lumen GI |
| `r.Lumen.TraceMeshSDFs` | 1 | Use mesh distance fields for Lumen traces |

### Post Process / General

| cvar | Default | Purpose |
|---|---|---|
| `r.DefaultFeature.Bloom` | 1 | Project default for bloom |
| `r.DefaultFeature.MotionBlur` | 1 | Project default for motion blur |
| `r.DefaultFeature.AutoExposure` | 1 | Project default for auto exposure |
| `r.ForwardShading` | 0 | Enable forward renderer (restart) |
| `r.Mobile.ShadingPath` | 0 | 0=forward, 1=deferred on mobile |

## Render thread / game thread boundary notes

All rendering state changes (primitive add/remove, material reassignment, cvar changes)
cross the render thread boundary. Changes made on the game thread are queued and applied
at the start of the next render frame. Cvars updated via `GConsoleManager` take effect
immediately on the render thread at the cvar's declared change callback, but the actual
rendered output won't reflect them until the next frame is produced.

For shipping configurations, set cvars in Device Profiles or `DefaultScalability.ini`
(scalability groups), not in game code. Scalability groups (Shadow, GlobalIllumination,
Reflections, PostProcessing, Texture, etc.) let the engine tune quality automatically
based on hardware capability while keeping individual cvars consistent.
