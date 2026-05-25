# Mixing: classes, submixes & concurrency — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers sound classes, sound mixes,
submix DSP chains, audio buses, concurrency rules, and dynamic mixing from C++.
Grounded in UE 5.7 engine source under `Runtime/Engine/Classes/Sound/`.

## Sound Classes

`USoundClass` (`SoundClass.h`) groups sounds that should share volume, pitch, and
send properties. `FSoundClassProperties` holds the key scalars:

| Property | Type | Effect |
|---|---|---|
| `Volume` | `float` | Multiplied onto every sound in the class |
| `Pitch` | `float` | Multiplied onto every sound in the class |
| `VoiceCenterChannelVolume` | `float` | Center-channel amount for 5.1+ outputs |
| `RadioFilterVolume` | `float` | Radio effect send |
| `bApplyEffects` | `bool` | Apply audio effects set in Project Settings |
| `bAlwaysPlay` | `bool` | Exempt from concurrency and priority eviction |
| `bIsUISound` | `bool` | Continues playing when game is paused |

Sound classes form a **tree hierarchy** — child class properties are multiplied
by parent class properties, allowing a `SFX_Weapons` child to inherit from
`SFX` parent properties. Assign the class on the `USoundBase` asset or override
it per-component via `UAudioComponent::SoundClassOverride`.

## Sound Mixes

`USoundMix` is a snapshot of class property adjustments applied dynamically
at runtime (e.g., duck all `Music` volume to 0.2 while a `Voice` is active).

```cpp
// Push a mix (e.g. ducking music for cinematic dialogue):
UGameplayStatics::PushSoundMixModifier(GetWorld(), DialogueDuckMix);

// Pop when done:
UGameplayStatics::PopSoundMixModifier(GetWorld(), DialogueDuckMix);

// Override a class property directly (without a mix asset):
UGameplayStatics::SetSoundMixClassOverride(GetWorld(), BaseMix,
    MusicClass, /*volume*/ 0.2f, /*pitch*/ 1.f, /*fade*/ 1.f);
```

Sound mixes are the legacy approach. For more flexible dynamic mixing, prefer
audio modulation (Control Bus, `AudioModulation` plugin) which supports
parameterised, curve-driven volume and pitch control without per-class assets.

## Submixes

`USoundSubmix` is a DSP bus in the audio mixer's effect graph. Every sound routes
to a submix (either the sound's base submix or the Master Submix fallback).
Submixes form a tree; child submixes sum into parents before final hardware output.

```cpp
// Route a sound to a specific submix at the asset level:
MySoundBase->SoundSubmixObject = ReverbSubmix;

// Or send a copy at runtime from the component:
AudioComp->SetSubmixSend(AnalysisBus, 0.5f);
```

### Submix effect chains

Effects applied on a submix process all audio passing through that bus:

1. Create a `USoundEffectSubmixPreset` subclass (e.g., built-in
   `USubmixEffectReverbPreset`, `USubmixEffectEQPreset`).
2. Drag it onto the submix in the editor, or add it via
   `UGameplayStatics::AddSoundToMix` from code.
3. Effects run in serial order in the chain.

Submixes also support recording (`StartRecordingOutput`) and spectral analysis
(`AddSpectralAnalysisDelegate`) — useful for visualizing audio in-game.

### Master Submix tree

Default route (configurable in Project Settings → Audio):

```
Master Submix
  ├─ Master Reverb Submix  (receives reverb sends from attenuation settings)
  ├─ Master EQ Submix
  └─ [project-defined submixes]
```

## Audio Buses (UAudioBus)

`UAudioBus` (`AudioBus.h`) is a signal bus that runs through the source effect
pipeline rather than the submix graph. Audio buses are useful for sidechaining
(measure the volume of a bus to duck another sound) and for routing audio before
it enters the submix tree.

```cpp
// Send from a sound to an audio bus (before source effects):
AudioComp->SetAudioBusSendPreEffect(SidechainBus, 1.0f);

// Send after source effects:
AudioComp->SetAudioBusSendPostEffect(MasterBus, 1.0f);
```

`EAudioBusChannels` defines channel counts: Mono, Stereo, Quad, 5.1, 7.1
(`AudioBus.h`:12–20).

Audio buses are used extensively with MetaSounds: a MetaSound graph node can read
from an audio bus, enabling runtime sidechaining and audio analysis inside the DSP
graph.

## Concurrency (USoundConcurrency)

`USoundConcurrency` caps how many instances of a sound (or group of sounds sharing
the same concurrency asset) play simultaneously. Create one asset and reference it
from multiple `USoundBase` assets, or assign it directly on the component.

Key fields in `FSoundConcurrencySettings` (`SoundConcurrency.h`:74):

| Field | Type | Purpose |
|---|---|---|
| `MaxCount` | `int32` | Maximum simultaneous active voices in the group |
| `bLimitToOwner` | `bool` | Limit is per-owning-actor, not global |
| `ResolutionRule` | `EMaxConcurrentResolutionRule` | What to do when at the limit |
| `VolumeScaleMode` | `EConcurrencyVolumeScaleMode` | How to scale volume of older sounds |
| `VolumeScale` | `float` | Volume multiplier applied to older voices when at limit |
| `bVolumeScaleCanRelease` | `bool` | Allow volume to recover when group size drops |

### Steal rules (EMaxConcurrentResolutionRule)

Declared in `SoundConcurrency.h`:31–57:

| Rule | Behaviour |
|---|---|
| `PreventNew` | Reject the new sound, keep existing ones |
| `StopOldest` | Stop the oldest active sound to make room |
| `StopFarthestThenPreventNew` | Stop the farthest, or reject if all equidistant |
| `StopFarthestThenOldest` | Stop the farthest, or stop oldest if equidistant |
| `StopLowestPriority` | Stop the lowest-priority voice |
| `StopQuietest` | Stop the quietest voice |
| `StopLowestPriorityThenPreventNew` | Stop lowest priority, or reject if all equal |

For gunshots and impacts, `StopLowestPriority` or `StopFarthestThenOldest` are
typical starting points. For music stems, `PreventNew` prevents accidental double-starts.

### Applying concurrency

A sound can reference **multiple** concurrency assets (`USoundBase::ConcurrencySet`).
It must pass *all* of them to be eligible to play — combine a global-limit asset with
a per-actor-limit asset for layered rules.

```cpp
// Override concurrency inline without an asset:
MySoundBase->bOverrideConcurrency = true;
MySoundBase->ConcurrencyOverrides.MaxCount = 4;
MySoundBase->ConcurrencyOverrides.ResolutionRule =
    EMaxConcurrentResolutionRule::StopFarthestThenOldest;
```

## Dynamic mixing from C++

### Activating a Sound Mix at runtime

```cpp
// Activate (push) a Sound Mix:
UGameplayStatics::PushSoundMixModifier(GetWorld(), CombatMix);

// Deactivate after event ends:
UGameplayStatics::PopSoundMixModifier(GetWorld(), CombatMix);
```

### Audio Modulation (Control Bus)

The `AudioModulation` plugin provides `USoundControlBus` objects that map
parameters (modulation sources) to destinations (volume, pitch of sounds in a
class). This is the modern approach: define a control bus, set its value at
runtime, and all sounds subscribed to it respond automatically — no per-sound
code needed.

Official doc: <https://dev.epicgames.com/documentation/unreal-engine/audio-modulation-in-unreal-engine>

## Version notes

- Sound Mixes are legacy; Audio Modulation (introduced UE 4.25, expanded in 5.x)
  is the modern approach for dynamic mixing.
- `EMaxConcurrentResolutionRule::StopQuietest` was added later in UE4's lifecycle
  and is fully supported in UE5.
- `bEnableMaxCountPlatformScaling` (`SoundConcurrency.h`:83) enables platform-scaled
  `MaxCount` tables — useful for lower-end mobile targets.
