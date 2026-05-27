# Attenuation & spatialization — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `FSoundAttenuationSettings`
fields, distance-volume models, spatialization algorithms, occlusion, reverb
sends, and Audio Gameplay Volumes. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Sound/SoundAttenuation.h`).

## Key types

- `USoundAttenuation` — UObject asset wrapping an `FSoundAttenuationSettings`
  struct (`SoundAttenuation.h`:442–448). Create one in the Content Browser and
  assign it to sounds or pass it to play functions.
- `FSoundAttenuationSettings` — the full settings struct (`SoundAttenuation.h`:138).
  Can be embedded directly on a `UAudioComponent` via `AttenuationOverrides` when
  `bOverrideAttenuation` is true, avoiding a separate asset.

## Distance-volume falloff

`FSoundAttenuationSettings` inherits from `FBaseAttenuationSettings` (declared in
`Engine/Attenuation.h`). The most important fields:

| Field | Type | Purpose |
|---|---|---|
| `AttenuationShape` | `EAttenuationShape` | Sphere (default), Capsule, Box, Cone |
| `AttenuationShapeExtents` | `FVector` | Shape extents: X = inner radius for sphere |
| `FalloffDistance` | `float` | Distance from inner radius to silence |
| `DistanceAlgorithm` | `EAttenuationDistanceModel` | Linear, Logarithm, Inverse, LogReverse, NaturalSound, Custom |
| `CustomAttenuationCurve` | `FRuntimeFloatCurve` | Custom volume-vs-distance curve when `DistanceAlgorithm = Custom` |
| `dBAttenuationAtMax` | `float` | Volume at the falloff boundary in dB (negative) |

A sound at or within `AttenuationShapeExtents.X` (inner radius) plays at full
volume. From the inner radius outward, volume follows `DistanceAlgorithm` until
silence at `InnerRadius + FalloffDistance`.

## Spatialization

```cpp
// In FSoundAttenuationSettings:
bool bSpatialize;                    // enable 3D panning
ESoundSpatializationAlgorithm SpatializationAlgorithm;  // Panning or HRTF plugin
```

`ESoundSpatializationAlgorithm::SPATIALIZATION_Default` uses the engine's built-in
pan law (linear or equal-power, configurable in Project Settings → Audio).
`SPATIALIZATION_HRTF` routes through the active spatialization plugin. Declared in
`SoundAttenuation.h`:31–38.

Plugin settings (`SpatializationPluginSettingsArray`) are held in
`FSoundAttenuationPluginSettings` (`SoundAttenuation.h`:79).

## Air absorption

```cpp
bool bEnableLogFrequencyScaling;    // scale absorption logarithmically
EAirAbsorptionMethod AbsorptionMethod;   // Linear or CustomCurve
float LPFRadiusMin, LPFRadiusMax;   // distance range for LP filter application
float LPFFrequencyAtMin, LPFFrequencyAtMax;  // filter frequency at min/max distance
```

Air absorption progressively low-pass-filters sounds as distance grows, simulating
high-frequency rolloff through air. `EAirAbsorptionMethod` is declared in
`SoundAttenuation.h`:40–47.

## Occlusion

```cpp
bool bEnableOcclusion;
float OcclusionLowPassFilterFrequency;  // cutoff when occluded
float OcclusionVolumeAttenuation;       // volume multiplier when occluded
bool bUseComplexCollisionForOcclusion;
```

Occlusion is checked via line trace from the sound to the listener. Heavy geometry
should use simple collision for performance; `bUseComplexCollisionForOcclusion`
enables per-triangle precision at higher cost. Occlusion plugin settings live in
`OcclusionPluginSettingsArray`.

## Reverb send

```cpp
bool bEnableReverbSend;
EReverbSendMethod ReverbSendMethod;     // Linear, CustomCurve, Manual
float ReverbWetLevelMin, ReverbWetLevelMax;
float ReverbDistanceMin, ReverbDistanceMax;
```

Reverb send level scales linearly (or via custom curve) with distance. `EReverbSendMethod`
is declared `SoundAttenuation.h`:51–61. Manual mode sends a constant level regardless
of distance — useful for 2D sounds you still want reverb on.

## Applying attenuation per-call vs. per-sound

Assign `AttenuationSettings` on the `USoundBase` asset itself for a default. Override
per-play-call:

```cpp
// Per-call override (one-shot, no component):
UGameplayStatics::PlaySoundAtLocation(this, Sound, Loc, FRotator::ZeroRotator,
    1.f, 1.f, 0.f, CustomAttenuationAsset);

// Per-component override (inline struct, no asset required):
AudioComp->bOverrideAttenuation = true;
AudioComp->AttenuationOverrides.AttenuationShapeExtents = FVector(300.f);
AudioComp->AttenuationOverrides.FalloffDistance = 2000.f;
AudioComp->SetAttenuationOverrides(AudioComp->AttenuationOverrides);
```

`SetAttenuationOverrides` (BlueprintSetter, `AudioComponent.h`:390) forwards to the
active sound if already playing.

## Audio Gameplay Volumes

Audio Gameplay Volumes (plugin: `AudioGameplayVolumes`) replace `AudioVolume`
actors for modular volume-based audio behaviour. Each volume has components
(`UAGVPrimitiveComponentProxy`) that define per-volume effects: reverb, occlusion,
ambient zone settings, and listener effects. Volumes can stack and blend as the
listener moves. Declared in
`Plugins/Runtime/AudioGameplay/Source/AudioGameplay/Public/`.

The official doc is at
<https://dev.epicgames.com/documentation/unreal-engine/audio-gameplay-volumes-in-unreal-engine>.

## Priority attenuation

```cpp
bool bEnablePriorityAttenuation;
EPriorityAttenuationMethod PriorityAttenuationMethod;  // Linear, CustomCurve, Manual
float PriorityAttenuationMin, PriorityAttenuationMax;
```

`EPriorityAttenuationMethod` (`SoundAttenuation.h`:64–74) lowers a sound's voice
priority as it moves farther away, making it easier for the concurrency system to
evict distant sounds when voices are scarce.

## Debugging attenuation

Enable the `au.3dVisualize.Attenuation 1` console command (or set `bDebug = true`
on a `USoundBase`) to draw the attenuation shape in the viewport while the sound is
audible. The **Audio Insights** plugin provides real-time per-sound distance,
priority, and virtualization state in a dedicated panel.

## Version notes

- Attenuation and spatialization APIs are stable across UE5.
- The HRTF path requires an active spatialization plugin; the built-in `Panning`
  path is always available.
- `EVirtualizationMode::SeekRestart` (experimental, `SoundBase.h`:76) added in
  UE 5.6 allows looping sounds to seek to the correct playback position when
  realized after being evicted by distance/concurrency.
