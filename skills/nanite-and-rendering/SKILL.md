---
name: nanite-and-rendering
description: Configure Nanite virtualized geometry (FMeshNaniteSettings on static and skeletal
  meshes, fallback mesh, displacement/tessellation, WPO distance threshold) and reason about
  the broader UE rendering pipeline — deferred vs forward, GPU Scene instancing, Virtual
  Shadow Maps, Virtual Textures, TSR/temporal upscaling, post-process (FPostProcessSettings),
  scene capture to render targets, and key r.* cvars. Use when enabling Nanite on a mesh,
  diagnosing Nanite support failures, choosing anti-aliasing or upscaling method, configuring
  post-process in code or volumes, rendering to a texture (minimap, mirror, portal), tuning
  scalability cvars, or understanding the deferred/forward rendering split.
metadata:
  engine-version: "5.7"
  category: world-building
---

# Nanite & rendering

UE's renderer couples **Nanite** (virtualized geometry), **Lumen** (dynamic GI — see
`lighting-and-lumen`), and **Virtual Shadow Maps** into a coherent high-fidelity pipeline.
This skill covers Nanite and the surrounding rendering systems an agent needs to configure
and reason about.

## When to use this skill

- Enabling Nanite on static or skeletal meshes in C++, editor scripting, or mesh settings.
- Diagnosing why Nanite does/doesn't apply (translucency, forward rendering, VR stereo).
- Choosing between TSR, TAA/TAAU, FXAA, MSAA and setting screen percentage.
- Configuring `FPostProcessSettings` fields in C++ or via a Post Process Volume.
- Rendering the scene to a texture (minimap, security camera, mirror, portal).
- Tuning `r.*` cvars for performance or debugging the render pipeline.

## Nanite virtualized geometry

Nanite renders pixel-scale geometry by streaming and rasterizing hierarchical triangle
clusters, automatically providing LOD without manual setup. It replaces the traditional
draw-call-per-mesh path with a GPU-driven visibility and rasterization pass.

### FMeshNaniteSettings — the control struct

`FMeshNaniteSettings` (defined in
`Runtime/Engine/Classes/Engine/EngineTypes.h`:3039) holds all per-mesh Nanite build
parameters. Key fields:

| Field | Type | Default | Purpose |
|---|---|---|---|
| `bEnabled` | `uint8:1` | `false` | Master switch — build Nanite data |
| `KeepPercentTriangles` | `float` | `1.0` | Source triangle budget (1.0 = lossless) |
| `TrimRelativeError` | `float` | `0.0` | Error-based reduction threshold |
| `GenerateFallback` | `ENaniteGenerateFallback` | `PlatformDefault` | Whether to build a fallback mesh for unsupported platforms |
| `FallbackPercentTriangles` | `float` | `1.0` | Triangle budget for the fallback mesh |
| `FallbackRelativeError` | `float` | `1.0` | Error-based fallback reduction |
| `MaxEdgeLengthFactor` | `float` | `0.0` | Limit simplification for WPO/spline meshes |
| `DisplacementMaps` | `TArray<FMeshDisplacementMap>` | empty | Offline tessellation/displacement maps |
| `PositionPrecision` | `int32` | `MIN_int32` (auto) | Vertex position quantization |

`UStaticMesh` exposes `GetNaniteSettings()`/`SetNaniteSettings()` (`StaticMesh.h`:836–848)
and `IsNaniteEnabled()` (`:1030`). `USkeletalMesh` has the same accessor pair
(`SkeletalMesh.h`:950–957).

> **5.7 deprecation note:** Direct member access to `UStaticMesh::NaniteSettings` is
> deprecated (`UE_DEPRECATED(5.7, ...)`). Use the accessor functions instead.

### Enabling Nanite from C++ editor scripting

```cpp
// Editor-only — call from a UEditorUtilityWidget or Python-exposed UFUNCTION
#if WITH_EDITOR
#include "Engine/StaticMesh.h"

void EnableNaniteOnMesh(UStaticMesh* Mesh)
{
    if (!Mesh) return;
    FMeshNaniteSettings Settings = Mesh->GetNaniteSettings();
    Settings.bEnabled = true;
    // For WPO materials or spline mesh deformation, set a non-zero MaxEdgeLengthFactor
    // to prevent oversimplification of displaced clusters:
    // Settings.MaxEdgeLengthFactor = 1.0f;
    Mesh->SetNaniteSettings(Settings);
    Mesh->PostEditChange();
    Mesh->MarkPackageDirty();
}
#endif
```

### Where Nanite applies — and where it doesn't

Nanite works on **opaque and masked** materials. Translucent materials fall back to the
fallback mesh. In UE 5.7 Nanite also supports:
- **Skeletal meshes** (animation LODs only; no geometry LODs).
- **Spline mesh components** — `MaxEdgeLengthFactor > 0` prevents over-simplification.
- **Foliage**, including WPO wind animation (clamp displacement to avoid culling drift).
- **Instanced static meshes** (HISM, foliage painter, landscape grass).
- **Geometry collections** (Chaos destruction).

Nanite is **not** supported for:
- **Forward rendering** or **MSAA** paths (these require per-draw-call mesh data).
- **VR stereo rendering** (instanced stereo is not Nanite-compatible currently).
- **Morph targets** (skinning deformation beyond a 4x3 matrix is not supported).
- **Translucent blend mode** — the Nanite fallback mesh is rendered instead.
- **Lighting channels** and **minimum screen radius / distance culling** per-object overrides.

On `UStaticMeshComponent`, `bDisallowNanite` and `bForceNaniteForMasked` let you opt
individual component instances in or out at runtime (`StaticMeshComponent.h`:157–161).
`WorldPositionOffsetDisableDistance` (`:153`) stops WPO evaluation past a given screen
distance, which also helps Nanite cluster culling.

### Fallback mesh

The fallback mesh is a conventional LOD mesh rendered on platforms that don't support
Nanite (DX11, mobile, ray-tracing passes). `HasNaniteFallbackMesh(EShaderPlatform)`
(`StaticMesh.h`:2170) queries its presence. Set `FallbackPercentTriangles` < 1.0 to reduce
its cost. For ray tracing, the fallback is used by default; lower `FallbackRelativeError`
for higher-fidelity RT shadows/reflections.

### Nanite displacement and tessellation

- **Static displacement** — offline: set `DisplacementMaps` in `FMeshNaniteSettings` and
  rebuild. The offline tessellator pre-bakes displacement into the Nanite cluster hierarchy.
- **Runtime tessellation** — dynamic programmable displacement via a displacement material
  graph node; driven per-frame on the GPU. Useful for animated terrain and Nanite landscapes.

Both are described in [references/nanite.md](references/nanite.md).

## Rendering pipeline overview

### Deferred vs forward

UE defaults to **deferred shading** (desktop/console). The G-buffer stores material
properties (base color, normals, roughness, metallic) in the depth pass and base pass; the
lighting pass reads them. This enables many dynamic lights at low per-light cost.

**Forward shading** (`r.ForwardShading 1`, `RendererSettings.h`:698) renders lighting in a
single pass per draw. It supports MSAA but does not support Nanite, has fewer features
(no deferred decals, no light functions by default), and is mainly used for VR.

Mobile has its own forward and deferred paths (`EMobileShadingPath`, `RendererSettings.h`:219–224).

### GPU Scene and instancing

`FGPUScene` (`Renderer/Private/GPUScene.h`:216) is a GPU-resident buffer of per-primitive
and per-instance data updated each frame. It enables Nanite's GPU-driven culling/rasterization
and UE5's instanced rendering path — all `UStaticMeshComponent` and HISM instances share
this buffer, eliminating per-draw-call CPU overhead. Adding or removing primitives from the
scene queues updates through `FGPUScene`; do not assume immediate GPU visibility.

### Virtual Shadow Maps

Virtual Shadow Maps (VSM) are UE5's high-resolution shadow system, designed to pair with
Nanite's pixel-scale detail. VSMs use a 16k virtual address space paged into 128x128
physical pages (`VirtualShadowMapArray.h`:72–77). Only pages that cover visible shadowed
surfaces are allocated and rendered, making the per-frame cost roughly proportional to the
number of unique shadow-casting surfaces visible, rather than a fixed resolution texture.

Key interaction: Nanite meshes render into VSM shadow passes efficiently via the same
GPU-driven cluster rasterizer. Non-Nanite meshes use the Nanite fallback when rendering
into VSMs. See [references/virtual-textures-and-shadows.md](references/virtual-textures-and-shadows.md).

### TSR and temporal upscaling

**Temporal Super Resolution (TSR)** is UE5's default temporal upscaler. It renders at a
sub-native internal resolution and reconstructs a high-quality output using data from
multiple previous frames. Set with `r.AntiAliasingMethod 4` (TSR) or in Project Settings
→ Engine → Rendering → Default Settings → Anti-Aliasing Method.

| Method | Deferred | Forward | Notes |
|---|---|---|---|
| TSR | yes | yes | Default UE5; best quality; requires temporal history |
| TAAU | yes | yes | UE4-era temporal upsampler; lower quality than TSR |
| FXAA | yes | yes | Spatial only; cheap; for low-end targets |
| MSAA | no | **yes only** | Hardware multi-sample; no Nanite support |

Screen percentage (`r.ScreenPercentage`) is the primary resolution lever: 50–70 with TSR
still produces near-native quality. Third-party temporal upscalers (DLSS, FSR 2+, XeSS)
plug in via the `ITemporalUpscaler` interface (`Renderer/Public/TemporalUpscaler.h`).

`RendererSettings.h`:829–832 maps `r.AntiAliasingMethod` to `EAntiAliasingMethod` (project
setting `DefaultFeatureAntiAliasing`). Forward shading forces FXAA or MSAA; TSR/TAAU
require deferred.

## Post process (FPostProcessSettings)

`FPostProcessSettings` (`Engine/Classes/Engine/Scene.h`:692–2596) is the single struct that
controls all post-process overrides. Apply it via:
- An unbound **Post Process Volume** (global baseline).
- A bounded volume with a Blend Radius (local override).
- A camera's `PostProcessSettings` field directly in C++.

Key categories of fields:

| Category | Notable fields |
|---|---|
| Exposure | `AutoExposureBias`, `AutoExposureMinBrightness`, `AutoExposureMaxBrightness` |
| Bloom | `BloomIntensity`, `BloomThreshold`, `BloomSizeScale` |
| Depth of Field | `DepthOfFieldFstop`, `DepthOfFieldFocalDistance`, `DepthOfFieldSensorWidth` |
| Motion Blur | `MotionBlurAmount`, `MotionBlurMax`, `MotionBlurTargetFPS` |
| Color Grading | `ColorGradingIntensity`, `ColorSaturation`, `FilmShadowTint` |
| GI/Reflections | `DynamicGlobalIlluminationMethod`, `ReflectionMethod` (override Lumen vs screen-space) |
| Ambient Occlusion | `AmbientOcclusionIntensity`, `AmbientOcclusionRadius` |

Each field has a corresponding `bOverride_<FieldName>` bool that must be `true` for the
value to take effect when set programmatically.

```cpp
// Snapshot the current post-process settings and override bloom at runtime
APostProcessVolume* PPV = /* get your volume */;
FPostProcessSettings& S = PPV->Settings;
S.bOverride_BloomIntensity = true;
S.BloomIntensity = 0.5f;
```

See [references/rendering-pipeline.md](references/rendering-pipeline.md) for the full
deferred pass order, scene view flow, and how post-process materials interact with TSR.

## Scene capture (render to texture)

`USceneCaptureComponent2D` renders a camera view into a `UTextureRenderTarget2D` each
frame or on demand. Use for minimaps, security cameras, mirrors, and portals.

```cpp
USceneCaptureComponent2D* Cap = CreateDefaultSubobject<USceneCaptureComponent2D>(TEXT("Cap"));
Cap->TextureTarget = MyRenderTarget;           // assign a UTextureRenderTarget2D asset
Cap->CaptureSource = ESceneCaptureSource::SCS_FinalColorLDR;
Cap->bCaptureEveryFrame = false;               // capture on-demand is much cheaper
// Call Cap->CaptureScene() when you need a fresh frame
```

Scene captures are expensive — they re-run visibility, shadow, and lighting passes for the
capture view. Budget them carefully: capture on demand (mirrors flip-frame), reduce
`TextureTarget` resolution, disable unneeded features (`ShowFlags`), use
`SCS_SceneColorHDR` only when HDR data is required downstream.

## Key r.* cvars

See [references/rendering-pipeline.md](references/rendering-pipeline.md) for the complete
cvar table. The highest-leverage variables for Nanite + standard desktop rendering:

| cvar | Purpose |
|---|---|
| `r.ScreenPercentage` | Primary render resolution percentage (50–100+) |
| `r.AntiAliasingMethod` | 2=TAA, 4=TSR, 0=None, 1=FXAA, 3=MSAA |
| `r.Nanite.MaxPixelsPerEdge` | Nanite rasterization target (default 1.0, lower = more detail) |
| `r.Shadow.Virtual.Enable` | Toggle Virtual Shadow Maps (1 = on) |
| `r.Shadow.Virtual.ResolutionLodBiasDirectional` | VSM directional light quality bias |
| `r.VirtualTextures` | Enable Virtual Texture streaming globally |
| `r.ForwardShading` | Toggle forward renderer (restart required) |
| `r.Lumen.Reflections.Allow` | Enable/disable Lumen reflections independently |
| `r.DefaultFeature.Bloom` | Global default for bloom |
| `r.TemporalAA.Upsampling` | Enable TAAU (older UE4-style temporal upsampler) |

Set cvars via Device Profiles or ini scalability groups in shipping builds — never
hardcode `GConsoleManager->FindTConsoleVariableDataFloat` calls in game logic.

## Performance mental model

1. **Internal resolution / screen percentage** — single biggest lever; TSR hides most cost.
2. **Overdraw** — translucency is rendered unconditionally and accumulates; limit layered
   particles and glass materials (`materials-and-shaders`).
3. **VSM page cost** — each unique light/shadow receiver combination needs pages; many
   small dynamic shadow casters in open areas is expensive.
4. **Scene captures** — each capture re-runs the renderer; prefer baked or on-demand.
5. **Nanite cluster culling budget** — very large WPO displacement without a
   `MaxEdgeLengthFactor` causes many clusters to escape culling; profile with
   `stat Nanite` and the Nanite visualization modes.
6. Profile with `profileGPU` or Unreal Insights GPU track (`profiling-and-optimization`).

## Gotchas

- **Nanite on translucent material** — silently falls back to the fallback mesh; no error
  in log unless you enable `r.Nanite.ShowMaskedMaterialWarnings`.
- **Nanite + Forward rendering** — Nanite is not supported in forward; the mesh renders
  via the fallback.
- **`bDisallowNanite` on component** — disables Nanite for that instance even if the mesh
  has it enabled; useful for LOD-authored props that need conventional rendering.
- **VR stereo + Nanite** — instanced stereo rendering is incompatible; Nanite falls back.
- **WPO displacement without `MaxEdgeLengthFactor`** — Nanite clusters are culled by
  their original bounds; large WPO offsets pop clusters in/out. Set `MaxEdgeLengthFactor`
  or set `bEvaluateWorldPositionOffset = false` past a distance threshold.
- **`bOverride_*` not set** — `FPostProcessSettings` fields are ignored without their
  paired `bOverride_` flag when applied programmatically.
- **Scene capture every frame at full res** — sets up a full render pass; throttle with
  `bCaptureEveryFrame = false` and call `CaptureScene()` selectively.
- **TSR ghosting on fast-moving thin geometry** — increase `r.TSR.History.ScreenPercentage`
  or switch to TAAU for that camera.
- **Hardcoding r.* cvars in C++** — use Device Profiles / scalability ini groups; see
  `profiling-and-optimization`.
- **Mismatched shadows** — Nanite + Lumen expect VSM; mixing Nanite with shadow maps can
  produce shadow resolution mismatches. Prefer VSM for Nanite-heavy scenes.

## Version notes

- **Nanite skeletal mesh** is production-ready in 5.5+ and fully supported in 5.7; uses
  animation LODs (not geometry LODs).
- **Nanite spline meshes** work in 5.7 by default; set `MaxEdgeLengthFactor` for road/rail
  splines with significant curvature.
- **Nanite tessellation** (runtime programmable displacement) is experimental/beta in 5.5–5.6
  and production-track in 5.7; check project settings to enable.
- `UStaticMesh::NaniteSettings` direct-access is `UE_DEPRECATED(5.7)` — use accessors.
- `TSR` is `EAntiAliasingMethod::AAM_TSR` in `EAntiAliasingMethod` enum (5.7); earlier
  builds spelled it `TemporalSuperResolution`.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/Engine/Classes/Engine/EngineTypes.h` — `FMeshNaniteSettings`:3039,
  `ENaniteGenerateFallback`:2972, `ENaniteFallbackTarget`:2981.
- `Runtime/Engine/Classes/Engine/StaticMesh.h` — `GetNaniteSettings`:836,
  `SetNaniteSettings`:845, `IsNaniteEnabled`:1030, `HasNaniteFallbackMesh`:2170;
  `NaniteSettings` member deprecated at 5.7:734.
- `Runtime/Engine/Classes/Engine/SkeletalMesh.h` — `FMeshNaniteSettings NaniteSettings`:944,
  `GetNaniteSettings`:950, `SetNaniteSettings`:954.
- `Runtime/Engine/Classes/Components/StaticMeshComponent.h` — `bDisallowNanite`:161,
  `bForceNaniteForMasked`:157, `WorldPositionOffsetDisableDistance`:153,
  `bEvaluateWorldPositionOffset`:171.
- `Runtime/Engine/Classes/Engine/Scene.h` — `FPostProcessSettings`:692.
- `Runtime/Engine/Classes/Engine/RendererSettings.h` — `DefaultFeatureAntiAliasing`:832,
  `bForwardShading`:702, `bVirtualTextures`:388, `MobileShadingPath`:316.
- `Runtime/Engine/Public/Rendering/NaniteResources.h` — `Nanite::FResources`:409
  (streaming pages, cluster hierarchy, position/normal precision stored here).
- `Runtime/Renderer/Private/GPUScene.h` — `FGPUScene`:216 (GPU-resident primitive/instance
  buffer driving Nanite and instanced rendering).
- `Runtime/Renderer/Private/VirtualShadowMaps/VirtualShadowMapArray.h` — `FVirtualShadowMap`:66,
  page size/dim constants :72–77.
- `Runtime/Renderer/Public/TemporalUpscaler.h` — `ITemporalUpscaler`:11 (plugin interface
  for third-party upscalers: DLSS, FSR, XeSS).
- `Runtime/Renderer/Private/DeferredShadingRenderer.h` — deferred renderer entry; includes
  Nanite, VSM, and Lumen integration headers.

Official docs (UE 5.7, all fetched and confirmed):
- Nanite Virtualized Geometry Overview —
  <https://dev.epicgames.com/documentation/unreal-engine/nanite-virtualized-geometry-in-unreal-engine>
- Nanite (index) — <https://dev.epicgames.com/documentation/unreal-engine/nanite-in-unreal-engine>
- Virtual Shadow Maps —
  <https://dev.epicgames.com/documentation/unreal-engine/virtual-shadow-maps-in-unreal-engine>
- Anti-Aliasing and Upscaling —
  <https://dev.epicgames.com/documentation/unreal-engine/anti-aliasing-and-upscaling-in-unreal-engine>
- Temporal Super Resolution —
  <https://dev.epicgames.com/documentation/unreal-engine/temporal-super-resolution-in-unreal-engine>
- Screen Percentage with Temporal Upscale —
  <https://dev.epicgames.com/documentation/unreal-engine/screen-percentage-with-temporal-upscale-in-unreal-engine>
- Virtual Texturing —
  <https://dev.epicgames.com/documentation/unreal-engine/virtual-texturing-in-unreal-engine>
- Forward Shading Renderer —
  <https://dev.epicgames.com/documentation/unreal-engine/forward-shading-renderer-in-unreal-engine>
- Designing Visuals, Rendering, and Graphics —
  <https://dev.epicgames.com/documentation/unreal-engine/designing-visuals-rendering-and-graphics-with-unreal-engine>

Deep-dive references in this skill:
- [references/nanite.md](references/nanite.md) — cluster hierarchy internals, displacement
  types (static vs runtime), fallback mesh details, Nanite visualization modes, common
  build/runtime diagnostics.
- [references/rendering-pipeline.md](references/rendering-pipeline.md) — deferred pass
  order, scene view flow, post-process chain, GPU Scene update, key cvar table.
- [references/virtual-textures-and-shadows.md](references/virtual-textures-and-shadows.md)
  — Virtual Textures (RVT/SVT), Virtual Shadow Maps internals, page allocation, interaction
  with Nanite and Lumen.

Related skills: `lighting-and-lumen`, `meshes-static-and-skeletal`, `profiling-and-optimization`,
`materials-and-shaders`.
