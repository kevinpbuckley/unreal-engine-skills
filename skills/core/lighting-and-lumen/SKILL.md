---
name: lighting-and-lumen
description: Light Unreal scenes in C++ and configure them correctly — light component
  types (UDirectionalLightComponent, UPointLightComponent, USpotLightComponent,
  URectLightComponent, USkyLightComponent), mobility (Static/Stationary/Movable) and
  its impact on GI, baking, and runtime cost, Lumen global illumination and reflections
  (enabling, quality settings, hardware vs software ray tracing), Virtual Shadow Maps,
  sky and atmosphere (USkyAtmosphereComponent, UExponentialHeightFogComponent), post
  process volumes for exposure/auto-exposure and Lumen overrides, and reflection captures.
  Use when creating or configuring light components in C++, choosing light mobility,
  enabling or troubleshooting Lumen GI/reflections, setting up sky/fog/atmosphere,
  tuning exposure or color grading, placing reflection captures, or deciding between
  baked and dynamic lighting.
metadata:
  engine-version: "5.7"
  category: world-building
---

# Lighting & Lumen

UE5's default lighting pipeline is **fully dynamic**: Lumen provides global illumination
(GI) and reflections without a bake. Understanding the light component hierarchy,
mobility rules, and the Lumen/post-process stack lets you get correct and performant
results quickly.

## When to use this skill

- Creating or modifying a light component in C++ (type selection, intensity/color/units,
  attenuation, IES profiles, light functions).
- Choosing the right mobility for a light and understanding the GI/shadow consequences.
- Enabling, tuning, or debugging Lumen GI and Lumen Reflections.
- Setting up sky atmosphere, sky light, volumetric clouds, and exponential height fog.
- Configuring post process volumes for exposure, auto-exposure, bloom, color grading,
  or per-area Lumen overrides.
- Placing reflection captures for areas Lumen cannot reach (legacy or spec-heavy interiors).
- Deciding when to use baked Lightmass vs Lumen.

## Light component hierarchy

All light components derive from `USceneComponent` through the following chain:

```
USceneComponent
└─ ULightComponentBase        (LightComponentBase.h:14) — Intensity, LightColor, CastShadows
   ├─ ULightComponent         (LightComponent.h:45)     — Temperature, ShadowBias, IES, LightFunction
   │  ├─ ULocalLightComponent (LocalLightComponent.h:17) — AttenuationRadius, IntensityUnits
   │  │  ├─ UPointLightComponent (PointLightComponent.h:18) — SourceRadius, SourceLength
   │  │  │  └─ USpotLightComponent (SpotLightComponent.h:16) — InnerConeAngle, OuterConeAngle
   │  │  └─ URectLightComponent  (RectLightComponent.h:23) — SourceWidth, SourceHeight, BarnDoorAngle
   │  └─ UDirectionalLightComponent (DirectionalLightComponent.h:18) — DynamicShadowCascades, bAtmosphereSunLight
   └─ USkyLightComponent      (SkyLightComponent.h:101)  — bRealTimeCapture, SourceType, Cubemap
```

See [references/light-components-and-mobility.md](references/light-components-and-mobility.md)
for C++ patterns and per-type properties.

## Light types at a glance

| Component | Shape | Use for |
|---|---|---|
| `UDirectionalLightComponent` | infinite parallel rays | sun, moon, any directional source |
| `UPointLightComponent` | sphere/capsule omnidirectional | light bulbs, candles, explosions |
| `USpotLightComponent` : Point | cone | torches, headlights, stage spots |
| `URectLightComponent` | planar rectangle | TVs, windows, fluorescent strips |
| `USkyLightComponent` | cubemap capture | ambient IBL, sky bounce |

## Mobility and its lighting consequences

Mobility is set on the component via `SetMobility(EComponentMobility::Movable)`.

| Mobility | Direct light | Indirect light | Shadows | Runtime change |
|---|---|---|---|---|
| **Static** | baked into lightmaps | baked | baked | none |
| **Stationary** | dynamic direct, baked indirect | baked (Lightmass) | mixed (baked static, dynamic movable) | color/intensity only |
| **Movable** | fully dynamic | Lumen GI (no bake) | Virtual Shadow Maps | all properties |

Key rule for Lumen: **only Movable lights feed Lumen GI**. Static lights are entirely
stored in lightmaps and their contribution is disabled when Lumen is enabled.
Stationary lights contribute baked indirect; their direct pass is dynamic.

Stationary limit: a single primitive can overlap at most **four** Stationary lights
before the fifth reverts to fully dynamic (expensive). The editor shows this with a red
channel-limit indicator.

## Lumen (dynamic GI + reflections)

Lumen is the default GI system for new UE5 projects. It computes diffuse interreflection
and specular reflections in real time, across scales from millimeters to kilometers.

**Enabling:** Project Settings → Rendering → Dynamic Global Illumination: **Lumen**;
Reflection Method: **Lumen**. Enabling Lumen automatically enables Generate Mesh
Distance Fields (required for software ray tracing) and disables precomputed lightmaps.

**Two tracing modes:**
- **Software Ray Tracing** — traces against Signed Distance Fields; works on all
  DX11+ hardware; requires `Generate Mesh Distance Fields` in project settings.
- **Hardware Ray Tracing (HRT)** — uses the GPU BVH; higher quality reflections and
  hit-lighting; enabled in Project Settings → Rendering → Hardware Ray Tracing.

Quality is tuned per-camera in a `APostProcessVolume` via `FPostProcessSettings`
fields (all in `Engine/Classes/Engine/Scene.h`):

| `FPostProcessSettings` field | Purpose |
|---|---|
| `LumenSceneLightingQuality` (line 1718) | fidelity of the Lumen scene cache |
| `LumenFinalGatherQuality` (line 1734) | noise vs cost of the final gather pass |
| `LumenMaxTraceDistance` (line 1746) | max ray length; too small leaks GI into caves |
| `LumenReflectionQuality` (line 1777) | reflection ray quality |

See [references/lumen-gi-and-reflections.md](references/lumen-gi-and-reflections.md)
for the full Lumen settings table, emissive GI, and hardware ray tracing notes.

## Virtual Shadow Maps (VSMs)

VSMs are the default shadow technology for Movable and Stationary lights when Lumen
is active. They render into a virtualized (sparse) 16k×16k shadow atlas, support
Nanite geometry natively, and require no per-light manual distance tuning.

Enable via Project Settings → Rendering → Shadows → Shadow Map Method: **Virtual
Shadow Maps**. The CVars `r.Shadow.Virtual.*` control quality and cache behaviour.

Key shadow properties on `ULightComponent` (`LightComponent.h`):
- `ShadowBias` (line 110) / `ShadowSlopeBias` (line 120) — self-shadow acne
- `ContactShadowLength` (line 128) — screen-space contact shadow ray length
- `CastShadows` / `CastDynamicShadows` / `CastStaticShadows` — per-channel toggle

For `UDirectionalLightComponent`, cascaded shadow maps are set with
`DynamicShadowCascades` (line 73) and `DynamicShadowDistanceMovableLight` (line 59).

See [references/shadows-and-postprocess.md](references/shadows-and-postprocess.md).

## Sky, atmosphere, and fog

A complete outdoor sky in C++ uses three cooperating actors/components:

1. `UDirectionalLightComponent` with `bAtmosphereSunLight = true` — drives the sky color.
2. `USkyAtmosphereComponent` (`Components/SkyAtmosphereComponent.h`) — physically-based
   atmosphere scattering.
3. `USkyLightComponent` with `bRealTimeCapture = true` — recaptures the rendered sky
   every tick for ambient/IBL.

Fog depth and god rays come from `UExponentialHeightFogComponent`
(`Components/ExponentialHeightFogComponent.h`). Enable volumetric fog on it for
`VolumetricFogScatteringDistribution` and `VolumetricFogAlbedo` to feed Lumen GI.

## Post Process Volume and exposure

`APostProcessVolume` (`Engine/PostProcessVolume.h`) hosts `FPostProcessSettings`
(`Engine/Scene.h:692`). Set `bUnbound = true` for a global volume; bounded volumes
blend by distance (Priority and BlendRadius fields).

Exposure settings in `FPostProcessSettings`:
- `AutoExposureMethod` (line 1429) — `AEM_Histogram` (default) or `AEM_Basic`
- `AutoExposureBias` (line 1860) — EV100 offset for all metering modes
- `AutoExposureMinBrightness` / `AutoExposureMaxBrightness` (lines 1921, 1929) —
  clamp the auto-exposure range (in EV100 or cd/m² depending on project setting)

For predictable results, prefer **manual exposure** over auto: set
`AutoExposureMethod` to `AEM_Manual` and fix the EV100 directly with `AutoExposureBias`.
Auto-exposure "breathes" as the camera pans, which reads as incorrect to players.

Color grading and tone curve live alongside exposure in the same struct; see
[references/shadows-and-postprocess.md](references/shadows-and-postprocess.md).

## Reflection captures (legacy / spec fill)

`UReflectionCaptureComponent` (`Components/ReflectionCaptureComponent.h:29`) and its
concrete subclasses (`USphereReflectionCaptureComponent`,
`UBoxReflectionCaptureComponent`) provide cubemap IBL for surfaces with low roughness
in areas where Lumen reflections have insufficient quality (e.g., enclosed interiors or
mobile targets). They are **not** updated at runtime by default; call
`MarkDirtyForRecaptureOrUpload()` to force a refresh.

With Lumen enabled, reflection captures are mostly replaced by Lumen Reflections for
Movable surfaces. They remain relevant for Static/Stationary geometry and as a fallback
for hardware that does not meet Lumen's requirements.

## C++ snippet — creating and configuring a light

```cpp
// In actor constructor:
#include "Components/PointLightComponent.h"

UPROPERTY(VisibleAnywhere)
TObjectPtr<UPointLightComponent> FillLight;

// Constructor body:
FillLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("FillLight"));
FillLight->SetupAttachment(RootComponent);
FillLight->SetIntensity(2000.f);           // lumens (with inverse-sq falloff)
FillLight->SetLightColor(FLinearColor(1.f, 0.95f, 0.8f));
FillLight->SetAttenuationRadius(600.f);
FillLight->CastShadows = true;
```

```cpp
// Runtime: change intensity and disable shadow casting
FillLight->SetIntensity(500.f);
FillLight->SetCastShadows(false);
```

Key APIs on `ULightComponent` (all `BlueprintCallable`):
- `SetIntensity(float)` — total output in the component's intensity units
- `SetLightColor(FLinearColor, bool bSRGB)` — filter tint
- `SetTemperature(float)` / `SetUseTemperature(bool)` — color temperature (Kelvin)
- `SetShadowBias(float)` / `SetShadowSlopeBias(float)` — self-shadow tuning
- `SetLightFunctionMaterial(UMaterialInterface*)` — project a material as a cookie

On `ULocalLightComponent`:
- `SetAttenuationRadius(float)` — bounding radius; affects tile-culling cost
- `SetIntensityUnits(ELightUnits)` — `Candelas`, `Lumens`, or `EV100`

## Gotchas

- **Static lights ignored by Lumen** — Lumen disables lightmap contributions; only
  Movable (and partially Stationary) lights drive dynamic GI.
- **Mesh distance fields off** — Lumen's software path silently degrades or produces
  black GI; enable in Project Settings → Rendering → Generate Mesh Distance Fields.
- **More than four overlapping Stationary lights** — fifth light degrades to Movable
  shadow cost; keep count per-area ≤ 4.
- **Auto-exposure surprise** — scenes look inconsistent as the camera moves; use
  manual exposure for cinematic or stylized work.
- **Sky Light not recapturing** — with `bRealTimeCapture = false`, the sky light bakes
  once; call `RecaptureSky()` or set `bRealTimeCapture = true` when the sky changes.
- **VSM invalidation cost** — moving or spawning many Movable meshes near shadowed
  lights forces cache invalidation; pool or batch spawn off-screen when possible.
- **Rect lights and light functions** — `URectLightComponent` does not support
  `LightFunctionMaterial` (only Directional/Point/Spot do).
- **Lightmap UVs for baked lighting** — if you fall back to Lightmass, meshes must
  have a valid lightmap UV channel or shadows bake black.

## Version notes

- Lumen is the default GI system for new UE5 projects; existing UE4 projects converted
  to UE5 do not automatically enable it (avoids breaking baked workflows).
- MegaLights (`bAllowMegaLights` on `ULightComponent`, line 168) is a UE5.4+ feature
  for stochastic many-light rendering; present in 5.7 but experimental.
- VSMs replaced the legacy Cascaded Shadow Map default for PC/console in UE5; mobile
  platforms still use traditional shadow maps.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/Engine/Classes/`):
- `Components/LightComponentBase.h` — `ULightComponentBase`:14; `Intensity`:36,
  `LightColor`:43, `CastShadows`:57, `IndirectLightingIntensity`:115,
  `SetCastShadows()`:145, `GetLightColor()`:149.
- `Components/LightComponent.h` — `ULightComponent`:45; `Temperature`:53,
  `ShadowBias`:110, `ShadowSlopeBias`:120, `ContactShadowLength`:128,
  `bAllowMegaLights`:168, `LightFunctionMaterial`:202, `IESTexture`:217,
  `SetIntensity()`:283, `SetLightColor()`:293, `SetTemperature()`:300.
- `Components/LocalLightComponent.h` — `ULocalLightComponent`:17;
  `IntensityUnits`:27, `AttenuationRadius`:45, `SetAttenuationRadius()`:52.
- `Components/PointLightComponent.h` — `UPointLightComponent`:18;
  `SourceRadius`:44, `SourceLength`:58, `SetSourceRadius()`:70.
- `Components/SpotLightComponent.h` — `USpotLightComponent`:16;
  `InnerConeAngle`:22, `OuterConeAngle`:26.
- `Components/RectLightComponent.h` — `URectLightComponent`:23;
  `SourceWidth`:32, `SourceHeight`:39, `BarnDoorAngle`:45, `BarnDoorLength`:51.
- `Components/SkyLightComponent.h` — `USkyLightComponent`:101;
  `bRealTimeCapture`:108, `SourceType`:113, `RecaptureSky()`:303.
- `Components/DirectionalLightComponent.h` — `UDirectionalLightComponent`:18;
  `DynamicShadowDistanceMovableLight`:59, `DynamicShadowCascades`:73,
  `bAtmosphereSunLight`:164.
- `Components/ReflectionCaptureComponent.h` — `UReflectionCaptureComponent`:29.
- `Engine/PostProcessVolume.h` — `APostProcessVolume`:22; `bUnbound`:51.
- `Engine/Scene.h` — `FPostProcessSettings`:692; `AutoExposureMethod`:1429,
  `AutoExposureBias`:1860, `AutoExposureMinBrightness`:1921,
  `AutoExposureMaxBrightness`:1929, `LumenSceneLightingQuality`:1718,
  `LumenFinalGatherQuality`:1734, `LumenMaxTraceDistance`:1746,
  `LumenReflectionQuality`:1777.

Official docs (UE 5.7):
- Light Types and Their Mobility —
  <https://dev.epicgames.com/documentation/unreal-engine/light-types-and-their-mobility-in-unreal-engine>
- Lumen Global Illumination and Reflections —
  <https://dev.epicgames.com/documentation/unreal-engine/lumen-global-illumination-and-reflections-in-unreal-engine>
- Shadowing —
  <https://dev.epicgames.com/documentation/unreal-engine/shadowing-in-unreal-engine>
- Virtual Shadow Maps —
  <https://dev.epicgames.com/documentation/unreal-engine/virtual-shadow-maps-in-unreal-engine>
- Post Process Effects —
  <https://dev.epicgames.com/documentation/unreal-engine/post-process-effects-in-unreal-engine>

Deep-dive references in this skill:
- [references/light-components-and-mobility.md](references/light-components-and-mobility.md) —
  per-type component properties, C++ authoring patterns, mobility decision guide.
- [references/lumen-gi-and-reflections.md](references/lumen-gi-and-reflections.md) —
  Lumen architecture, settings table, hardware vs software RT, emissive GI, sky integration.
- [references/shadows-and-postprocess.md](references/shadows-and-postprocess.md) —
  VSMs, CSMs, shadow bias, post process volume exposure, color grading, Lumen PPV overrides.

Related skills: `nanite-and-rendering`, `materials-and-shaders`.
