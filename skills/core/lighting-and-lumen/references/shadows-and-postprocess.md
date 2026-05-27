# Shadows and post process — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers Virtual Shadow Maps, Cascaded Shadow
Maps, shadow bias, contact shadows, and the Post Process Volume exposure and color
grading stack. Grounded in UE 5.7 (`Engine/Source/Runtime/Engine/Classes/Components/
LightComponent.h` and `Engine/Classes/Engine/Scene.h`) and the official
[Shadowing](https://dev.epicgames.com/documentation/unreal-engine/shadowing-in-unreal-engine)
and [Virtual Shadow Maps](https://dev.epicgames.com/documentation/unreal-engine/virtual-shadow-maps-in-unreal-engine)
docs.

## Shadow methods overview

| Method | Enable | Works with Nanite | Per-light cost | Notes |
|---|---|---|---|---|
| **Shadow Mapping** | default (legacy) | no | medium | manual distance tuning required |
| **Virtual Shadow Maps (VSM)** | Project Settings → Shadows → Shadow Map Method | yes | low–medium | default for Lumen projects |
| **Ray-traced Shadows** | HRT enabled + per-light | yes | high | area soft shadows via BVH |
| **Distance Field Shadows** | `bUseRayTracedDistanceFieldShadows` on light | partial | low | good for distant sun shadows |
| **Precomputed (Lightmass)** | Static/Stationary lights + light build | N/A | zero runtime | stored in lightmaps |

## Virtual Shadow Maps (VSMs)

VSMs render into a sparse 16k×16k virtual atlas. Only the pages actually sampled by
the renderer are allocated, making large-scene shadowing efficient. VSMs require no
per-light distance configuration — they automatically adapt resolution to what is
on-screen.

Key CVars:
- `r.Shadow.Virtual.Enable 1` (set via Project Settings or DefaultEngine.ini)
- `r.Shadow.Virtual.Cache.StaticSeparate 1` — separate static/dynamic caches;
  saves cost when few dynamic objects move.
- `r.Shadow.Virtual.MaxPhysicalPages` — atlas budget (default 2048 pages).
- `r.Shadow.Virtual.SMRT.RayCountDirectional` — rays per pixel for directional lights
  (higher = softer, more accurate penumbra at greater cost).

VSMs work best with Nanite geometry. For non-Nanite meshes, standard rasterisation
still feeds the VSM atlas correctly but does not get Nanite's culling benefits.

## Cascaded Shadow Maps (CSMs)

CSMs are per-`UDirectionalLightComponent`. When using VSMs the directional light still
uses CSM-like cascades internally, but the VSM system manages them automatically.

Manual CSM controls on `UDirectionalLightComponent` (`DirectionalLightComponent.h`):
- `DynamicShadowCascades:int32` (line 73) — cascade count 0–4 (0 disables CSMs)
- `DynamicShadowDistanceMovableLight:float` (line 59) — max shadow distance for
  Movable lights
- `DynamicShadowDistanceStationaryLight:float` (line 65) — max distance for
  Stationary lights
- `CascadeDistributionExponent:float` (line 79) — distribute cascades towards camera
  (>1) or uniformly (1)
- `FarShadowCascadeCount:int32` (line 111) — extra far cascades beyond
  `DynamicShadowDistanceMovableLight`; requires `FarShadowDistance`

## Shadow bias properties (ULightComponent, LightComponent.h)

Shadow bias controls self-shadow artefacts (surface acne). All fields are
`BlueprintReadOnly` with `BlueprintCallable` setters:

| Property | Line | Setter | Purpose |
|---|---|---|---|
| `ShadowBias` | 110 | `SetShadowBias(float)` | Constant offset pushing receiver away from the shadow map |
| `ShadowSlopeBias` | 120 | `SetShadowSlopeBias(float)` | Bias proportional to surface slope; reduces grazing-angle artefacts |
| `ShadowResolutionScale` | 101 | — | Multiplies the auto-chosen shadow map resolution |
| `ShadowSharpen` | 124 | — | Additional sharpening of the filter (0–1) |

Typical starting point: `ShadowBias = 0.5`, `ShadowSlopeBias = 0.5`. Increase if
objects appear to "float" (bias too high causes this) or decrease if you see acne
(bias too low).

## Contact shadows (ULightComponent, LightComponent.h)

Contact shadows are a screen-space ray cast from the shading pixel towards the light,
using the scene depth buffer. They add fine contact hardening on top of any other
shadow method.

- `ContactShadowLength:float` (line 128) — ray length in screen space (0 = off,
  1 = full screen height) or in world units when `ContactShadowLengthInWS = true`.
- `ContactShadowCastingIntensity:float` (line 136) — shadow darkness for primitives
  that opt into contact shadows (default 1.0).
- `ContactShadowNonCastingIntensity:float` (line 140) — shadow for primitives that
  do not cast contact shadows (default 0.0).

Contact shadows are view-dependent and miss occluders outside the viewport; they are
a supplement, not a replacement for standard shadow maps.

## Post Process Volume — exposure

`APostProcessVolume` (`Engine/PostProcessVolume.h:22`) blends `FPostProcessSettings`
(`Engine/Scene.h:692`). Relevant exposure fields:

| Field | Line | Notes |
|---|---|---|
| `AutoExposureMethod` | 1429 | `AEM_Histogram` (default), `AEM_Basic`, `AEM_Manual` |
| `AutoExposureBias` | 1860 | EV100 offset applied on top of the metering result |
| `AutoExposureMinBrightness` | 1921 | Clamp floor for histogram (cd/m² or EV100) |
| `AutoExposureMaxBrightness` | 1929 | Clamp ceiling for histogram |
| `AutoExposureLowPercent` | 1903 | % of pixels excluded from the dark side of the histogram |
| `AutoExposureHighPercent` | 1913 | % of pixels excluded from the bright side |

### Manual exposure

Set `AutoExposureMethod` to `AEM_Manual`. The camera's EV100 is then determined
entirely by `AutoExposureBias`. No histogram computation happens, which eliminates
the "breathing" artefact and makes the cost cheaper.

In C++, set overrides in `FPostProcessSettings`:

```cpp
FPostProcessSettings PPSettings;
PPSettings.bOverride_AutoExposureMethod = true;
PPSettings.AutoExposureMethod = AEM_Manual;
PPSettings.bOverride_AutoExposureBias = true;
PPSettings.AutoExposureBias = 1.0f;   // EV100 compensation

PostProcessVolume->Settings = PPSettings;
```

(Field and enum declarations are in `Engine/Classes/Engine/Scene.h`.)

## Post Process Volume — color grading

All tone-mapping and color-grading properties are members of `FPostProcessSettings`
in the `Color Grading` and `Tone Mapper` categories in the editor. Key fields
(all `BlueprintReadWrite`, `interp`):

- `ColorGain` / `ColorOffset` / `ColorSaturation` — shadow/midtone/highlight split
  via `FVector4` (RGBA; A is the master weight).
- `ColorContrast` — per-range contrast control.
- `WhiteBalance_TemperatureType` / `WhiteBalance_WhiteTemp` — color temperature
  balancing.
- `FilmShoulder`, `FilmHeel`, `FilmBlackClip`, `FilmWhiteClip` — parametric tone
  curve controls.

Color grading changes are broadcast to the render thread and are safe to set at
runtime on any `APostProcessVolume`.

## Reflection captures

`UReflectionCaptureComponent` and its concrete subclasses provide cubemap IBL for
spec-heavy or enclosed areas where Lumen reflections are insufficient.

- `USphereReflectionCaptureComponent` — spherical capture radius; best for rooms.
- `UBoxReflectionCaptureComponent` — box-projected capture; corrects parallax in
  rectangular rooms.

Both are registered in the scene and blended by the renderer based on the camera
position and the capture's `Brightness` and `CaptureOffset` (`ReflectionCaptureComponent.h`).

With Lumen enabled, these captures are largely superseded for Movable geometry. They
remain useful for:
- Static/Stationary geometry with high specular requirements (polished floors, mirrors).
- Mobile or VR targets where Lumen is too costly.
- Indoor interiors where Lumen ray tracing does not reach (very enclosed geometry).

Recapture on demand:
```cpp
CaptureComponent->MarkDirtyForRecaptureOrUpload();
```

## Sky and atmosphere components (quick reference)

- `USkyAtmosphereComponent` (`Components/SkyAtmosphereComponent.h`) — physical Rayleigh
  and Mie scattering. Driven by the directional light's orientation when
  `bAtmosphereSunLight = true`.
- `UExponentialHeightFogComponent` (`Components/ExponentialHeightFogComponent.h`) —
  height-based fog with optional volumetric fog. Feeds Lumen's GI indirectly via
  volumetric scattering when `VolumetricFog` is enabled.

## Performance notes

- Disabling `CastShadows` on non-critical Movable lights is the highest-ROI shadow
  optimization; non-shadowing Movable lights are much cheaper than shadowing ones.
- Set `MaxDrawDistance` on small local lights; this cuts both the lighting and shadow
  evaluation cost beyond that distance.
- VSM cache invalidation is the main runtime cost of Movable objects; minimize large
  dynamic objects in shadow frustums where possible.
- Contact shadows add a screen-space pass per light; limit to the two or three most
  important lights in a scene.
