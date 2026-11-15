# Light components and mobility — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the component class hierarchy,
per-type property reference, C++ authoring patterns, and how to pick the right
mobility for a given scenario. Grounded in UE 5.8
(`Engine/Source/Runtime/Engine/Classes/Components/`).

## Component class hierarchy

```
ULightComponentBase  (LightComponentBase.h:15)
├─ Intensity:float (line 37)          — total energy emitted
├─ LightColor:FColor (line 44)        — filter tint
├─ CastShadows:uint32 (line 58)
├─ IndirectLightingIntensity (line 116) — GI contribution scale
└─ SetCastShadows(bool) (line 146)

ULightComponent : ULightComponentBase  (LightComponent.h:48)
├─ Temperature:float (line 57)        — colour temperature (Kelvin, white = 6500)
├─ bUseTemperature:uint32 (line 69)
├─ ShadowBias:float (line 113)        — prevent self-shadow acne
├─ ShadowSlopeBias:float (line 123)
├─ ContactShadowLength:float (line 131)
├─ bAllowMegaLights:uint32 (line 171) — opt into stochastic many-light (UE5.5+)
├─ LightFunctionMaterial (line 208)   — cookie material (not supported on RectLight)
├─ IESTexture (line 222)              — real-world luminaire distribution
├─ SetIntensity(float) (line 289)
├─ SetLightColor(FLinearColor, bSRGB) (line 299)
└─ SetTemperature(float) (line 306)

ULocalLightComponent : ULightComponent  (LocalLightComponent.h:18)
├─ IntensityUnits:ELightUnits (line 28)   — Candelas | Lumens | EV100
├─ InverseExposureBlend:float (line 36)   — constant on-screen brightness blend
├─ AttenuationRadius:float (line 46)      — bounding sphere; affects tile culling
└─ SetAttenuationRadius(float) (line 53)

UPointLightComponent : ULocalLightComponent  (PointLightComponent.h:19)
├─ bUseInverseSquaredFalloff:uint32 (line 30)
├─ SourceRadius:float (line 45)      — sphere radius; softens penumbra
├─ SoftSourceRadius:float (line 52)
└─ SourceLength:float (line 59)      — capsule extension for tube lights

USpotLightComponent : UPointLightComponent  (SpotLightComponent.h:17)
├─ InnerConeAngle:float (line 23)    — degrees, full-intensity cone
└─ OuterConeAngle:float (line 27)    — degrees, penumbra edge

URectLightComponent : ULocalLightComponent  (RectLightComponent.h:24)
├─ SourceWidth:float (line 33)
├─ SourceHeight:float (line 40)
├─ BarnDoorAngle:float (line 46)     — occlusion flap angle (deg)
└─ BarnDoorLength:float (line 52)

UDirectionalLightComponent : ULightComponent  (DirectionalLightComponent.h:18)
├─ DynamicShadowDistanceMovableLight:float (line 59)
├─ DynamicShadowCascades:int32 (line 73)   — CSM cascade count (0–4)
├─ LightSourceAngle:float (line 138)       — angular diameter in degrees (sun ≈ 0.54)
├─ bAtmosphereSunLight:uint32 (line 164)   — drives USkyAtmosphereComponent
└─ SetAtmosphereSunLight(bool) (line 311)

USkyLightComponent : ULightComponentBase  (SkyLightComponent.h:116)
├─ bRealTimeCapture:bool (line 123)        — recapture every frame
├─ SourceType:ESkyLightSourceType (line 127) — CapturedScene | SpecifiedCubemap
├─ Cubemap:UTextureCube* (line 131)
└─ RecaptureSky() (line 319)
```

## Intensity units for local lights

`ULocalLightComponent::IntensityUnits` (`ELightUnits`):
- `Candelas` — luminous intensity at the peak direction.
- `Lumens` — total luminous flux. With inverse-squared falloff, 1700 lm ≈ 100 W bulb.
- `EV100` — photographic exposure value; ties intensity to camera settings.

When `bUseInverseSquaredFalloff` is off on a point/spot, `Intensity` is a
dimensionless brightness scale (legacy mode). Prefer lumens or candelas for physical
accuracy.

## C++ authoring patterns

### Point light as a default subobject

```cpp
// Header
UPROPERTY(VisibleAnywhere)
TObjectPtr<UPointLightComponent> FillLight;

// Constructor
FillLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("FillLight"));
FillLight->SetupAttachment(RootComponent);
FillLight->SetIntensity(1700.f);                     // ~100 W equivalent in lumens
FillLight->SetLightColor(FLinearColor(1.f, 0.9f, 0.75f));
FillLight->SetAttenuationRadius(500.f);
FillLight->CastShadows = true;
```

### Directional light as the sun

```cpp
#include "Components/DirectionalLightComponent.h"

Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun"));
Sun->SetupAttachment(RootComponent);
Sun->SetIntensity(10.f);               // lux for directional lights
Sun->bAtmosphereSunLight = true;       // connects to USkyAtmosphereComponent
Sun->LightSourceAngle = 0.5357f;       // angular diameter of the sun (degrees)
Sun->DynamicShadowCascades = 4;
```

### Sky light with real-time capture

```cpp
#include "Components/SkyLightComponent.h"

SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
SkyLight->SetupAttachment(RootComponent);
SkyLight->bRealTimeCapture = true;     // recaptures the sky every tick
```

### Runtime mobility change (only works before registration in practice)

Mobility is a property inherited from `USceneComponent` (`Mobility` field, typed
`EComponentMobility::Type`). It can be set in the constructor or via
`SetMobility()`. Changing mobility after registration requires
`UnregisterComponent()` / re-register, which is expensive; set it up-front.

## Mobility decision guide

| Scenario | Recommended mobility |
|---|---|
| Sun in an outdoor scene with Lumen | Movable |
| Background fill lights (never change) | Static (bake once, zero runtime cost) |
| Candles that flicker in gameplay | Movable (dynamic intensity) |
| Window daylight with door that can open | Stationary (baked indirect, dynamic direct) |
| Cinematic spotlight that animates | Movable |
| Mobile or performance-constrained targets | Static or Stationary + bake |

Stationary caveats:
- Only the **direct** contribution is dynamic; indirect/GI is baked by Lightmass.
- A primitive can be affected by at most **four** overlapping Stationary lights before
  the fifth exceeds the channel limit and becomes fully dynamic (shadow cost spikes).
- Color and intensity can be changed at runtime; position cannot.

## Light function materials

A light function (`LightFunctionMaterial`) is a Material domain set to
`MD_LightFunction` that masks or animates the light's output. Works on Directional,
Point, and Spot lights. Rect lights use `SourceTexture` instead and do not support
`LightFunctionMaterial`. Light functions are supported in volumetric fog for
Directional/Point/Spot.

## IES profiles

`ULightComponent::IESTexture` accepts a `UTextureLightProfile` asset (imported from a
real-world IES photometric data file). Set `bUseIESBrightness = true` to have the
profile also drive intensity. `IESBrightnessScale` multiplies the profile's brightness
contribution.

## Version notes

- `MegaLights` (`bAllowMegaLights`, `MegaLightsShadowMethod`) was added in UE5.5 for
  stochastic many-light evaluation; available in 5.8 but still experimental.
- `TObjectPtr<T>` is the modern member UPROPERTY form (UE5+); raw `T*` still compiles.
