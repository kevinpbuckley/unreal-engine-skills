---
name: audio-and-metasounds
description: Play and control audio in Unreal — the sound asset types (SoundWave, SoundCue,
  MetaSound Source), playing 2D/3D sounds from C++ (UGameplayStatics, UAudioComponent),
  spatial attenuation, sound classes/submixes/concurrency for mixing, runtime MetaSound
  parameters, Quartz beat-quantized playback, and the MetaSound Builder API. Use when
  playing SFX/music, attaching looping sounds to actors, setting up 3D spatialization,
  mixing/ducking audio, driving procedural audio with MetaSounds, or debugging silent
  sounds, voice spam, or parameter mismatches.
metadata:
  engine-version: "5.7"
  category: vfx-audio
---

# Audio & MetaSounds

The Unreal audio pipeline: a **sound asset** (`USoundBase` subclass) is activated either
as a fire-and-forget one-shot or via a **`UAudioComponent`** for ongoing control. 3D
sounds are positioned and faded using a **`USoundAttenuation`** asset. Mixing is handled
through **sound classes**, **submixes**, and **concurrency** objects. MetaSounds are the
modern, node-based, parameter-driven replacement for SoundCues.

## When to use this skill

- Playing SFX (gunshots, footsteps, impacts), music, or UI sounds from C++.
- Attaching a looping or positional sound to an actor (engine hum, ambience).
- 3D spatialization and distance falloff configuration.
- Mixing: volume groups, ducking music under dialogue, limiting voice counts.
- Procedural/parameterized audio (footsteps that vary, adaptive music) via MetaSounds.
- Beat-synchronized audio events with the Quartz clock system.
- Building or modifying MetaSound graphs at runtime via the Builder API.

## Sound asset types

| Asset | Class | Best for |
|---|---|---|
| Imported PCM clip | `USoundWave` | Raw audio; compose variation in a cue or MetaSound |
| Legacy node graph | `USoundCue` | Simple randomization / modulation over waves |
| Modern graph with typed I/O | `UMetaSoundSource` | Procedural, parameter-driven, DSP-composable audio |
| Abstract base | `USoundBase` | The type accepted by all play functions |

Prefer **MetaSounds** for new dynamic audio. SoundCues remain fully supported and are
simpler for lightweight randomization. `USoundWave` is never played directly in gameplay
code — it is the leaf asset referenced inside cues or MetaSound graphs.

## Playing sounds from C++

```cpp
#include "Kismet/GameplayStatics.h"
#include "Components/AudioComponent.h"

// 2D (UI, music) — fire-and-forget, no spatialization:
UGameplayStatics::PlaySound2D(this, UISound);

// 3D at a world position — fire-and-forget:
UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, HitLocation,
    FRotator::ZeroRotator, 1.f, 1.f, 0.f, AttenuationAsset);

// 3D attached to a component — returns controllable UAudioComponent:
UAudioComponent* AC = UGameplayStatics::SpawnSoundAttached(
    EngineLoop, VehicleMesh, NAME_None);
AC->FadeIn(0.5f);

// Stop or adjust later:
AC->SetFloatParameter(TEXT("RPM"), 4200.f);  // MetaSound input
AC->FadeOut(0.3f, 0.f);
```

`PlaySound*` functions are fire-and-forget. Use `SpawnSound*` or a
`UAudioComponent` placed on the actor when you need to stop, fade, change
parameters, or react to `OnAudioFinished`. Store the component in a
`UPROPERTY()`  member so GC cannot collect it while it is playing (see
`memory-and-gc`).

### Audio component placed on an actor

```cpp
// Header — owned audio component, UPROPERTY keeps it alive:
UPROPERTY(VisibleAnywhere)
TObjectPtr<UAudioComponent> EngineAudio;

// Constructor:
EngineAudio = CreateDefaultSubobject<UAudioComponent>(TEXT("EngineAudio"));
EngineAudio->SetupAttachment(RootComponent);
EngineAudio->bAutoActivate = false;   // start silent; Play() from BeginPlay

// BeginPlay:
EngineAudio->SetSound(EngineLoopAsset);
EngineAudio->Play();
```

See [references/audiocomponent-and-playback.md](references/audiocomponent-and-playback.md)
for the full `UAudioComponent` API, delegates, and playback state machine.

## 3D spatialization & attenuation

A `USoundAttenuation` asset bundles: distance model and falloff radius,
spatialization algorithm (panning or HRTF plugin), occlusion, reverb send,
air absorption, and priority attenuation. Assign it on the sound asset itself
(`AttenuationSettings` on `USoundBase`) or override it per-call by passing it
to `PlaySoundAtLocation` / `SpawnSoundAttached`.

A sound without an attenuation asset plays as flat 2D regardless of where the
audio component is in the world. The inner radius defines a constant-volume
zone; falloff begins at the inner radius and reaches zero at the falloff
distance.

See [references/attenuation-and-spatialization.md](references/attenuation-and-spatialization.md)
for the full `FSoundAttenuationSettings` fields, distance models, HRTF, and
Audio Gameplay Volumes.

## Mixing: classes, submixes, concurrency

| Tool | Purpose |
|---|---|
| **Sound Class** (`USoundClass`) | Group sounds (SFX / Music / Voice) for shared volume, pitch, and property settings |
| **Sound Mix** (`USoundMix`) | Push temporary class adjustments — duck Music when a Voice plays |
| **Submix** (`USoundSubmix`) | DSP bus: apply effects (reverb, EQ, compression), meter, record audio |
| **Concurrency** (`USoundConcurrency`) | Cap simultaneous voices in a group; choose a steal rule when limit is hit |

A sound routes to its sound class's submix by default. Submix sends let a
sound copy signal to additional buses (e.g. a reverb or analysis bus) without
leaving the main chain. Audio Buses (`UAudioBus`) are an alternative bus type
that route before or after source effects, useful for sidechaining.

See [references/mixing-classes-submixes-concurrency.md](references/mixing-classes-submixes-concurrency.md)
for concurrency steal rules, submix effect chains, audio bus sends, and
dynamic mixing from C++.

## MetaSound parameters at runtime

MetaSound Sources expose **typed inputs** (float, int32, bool, trigger, wave)
declared in the graph. Drive them from the owning audio component:

```cpp
// Set before or during playback:
AC->SetFloatParameter(TEXT("Intensity"),   0.8f);
AC->SetBoolParameter(TEXT("IsUnderwater"), true);
AC->SetIntParameter(TEXT("FootSurface"),   2);

// Trigger a one-shot event inside the graph (stateless pulse):
AC->SetTriggerParameter(TEXT("OnImpact"));

// Swap the wave asset a graph node is playing:
AC->SetWaveParameter(TEXT("ImpactWave"), GroundHitWave);
```

Input names are **case-sensitive `FName`** values that must exactly match the
graph's Input node names. A mismatch produces no error and no effect. The
parameter interface is declared in
`Runtime/Engine/Public/Audio/SoundParameterControllerInterface.h`.

MetaSounds also expose **outputs** (e.g., a float metering value). Read them
through `UMetasoundGeneratorHandle` obtained from `UMetaSoundSource::
GetGeneratorForAudioComponent` — available only while the sound is playing.

See [references/metasound-parameters-and-builder.md](references/metasound-parameters-and-builder.md)
for the Builder API, output watching, and runtime graph authoring.

## Quartz: beat-quantized playback

Quartz provides a **game-thread musical clock** (`UQuartzClockHandle`) that
fires events on beat/bar boundaries. Use it to start sounds precisely on the
beat without drifting audio timers:

```cpp
// Obtain the clock subsystem and create or find a named clock:
UQuartzSubsystem* Quartz = UQuartzSubsystem::Get(GetWorld());
UQuartzClockHandle* Clock = Quartz->CreateNewClock(this, TEXT("MusicClock"),
    FQuartzClockSettings{});

// Schedule a sound to start on the next bar boundary:
FQuartzQuantizationBoundary Boundary;
Boundary.Quantization = EQuartzCommandQuantization::Bar;
Boundary.BoundaryType = EQuarztQuantizationBoundaryType::FromNow;
AC->PlayQuantized(GetWorld(), Clock, Boundary, {});
```

The Quartz subsystem (`UQuartzSubsystem`) lives in the Audio Mixer module.
`UAudioComponent::PlayQuantized` is declared in `AudioComponent.h`:521.

## Triggering from gameplay & animation

Footstep, impact, and weapon sounds should be triggered from **Anim Notifies**
(see `animation-system`) or gameplay events, not manual timers. This keeps
audio in sync at any play rate or time dilation. For high-frequency impacts use
concurrency to avoid voice spam — limit simultaneous instances and choose an
appropriate steal rule.

## Gotchas

- **Fire-and-forget when you needed control** — `PlaySound*` returns nothing;
  use `SpawnSound*` or a component to stop, fade, or change parameters later.
- **No attenuation asset** → 3D sound plays as 2D, no falloff.
- **Parameter name mismatch** on MetaSounds → silent no-op, no log warning.
- **No concurrency limits** → voice spam and clipping under heavy action.
- **Audio component not in a `UPROPERTY`** → GC'd while playing, sound stops.
- **`SetWaveParameter` called on a SoundCue** → no effect; wave params target
  MetaSound wave inputs (or legacy SoundCue wave params — different systems).
- **`bDisableParameterUpdatesWhilePlaying`** set on the component → parameter
  calls are queued but not forwarded to the active sound.
- **Importing non-WAV** → import PCM WAV only; build variation inside
  MetaSound or SoundCue graphs rather than baking it into the file.
- **Virtualization** — `EVirtualizationMode` on `USoundBase` controls whether
  looping sounds silently continue (`PlayWhenSilent`), restart, or drop when
  evicted. Default is `Disabled`; forgotten virtualization config is a common
  cause of music "disappearing" under heavy load.

## Version notes

- MetaSounds were introduced in UE5.0; the Builder API (Beta) expanded
  significantly in 5.4–5.5; output watching via `UMetasoundGeneratorHandle`
  was stabilised in 5.4.
- `EVirtualizationMode::SeekRestart` is experimental as of UE 5.6–5.7
  (`SoundBase.h`:76).
- `FAudioComponentParam` (old named-parameter struct) was deprecated in UE 5.0;
  use `FAudioParameter` / `SetFloatParameter` etc. instead.
- `OnGeneratorInstanceCreated` / `OnGeneratorInstanceDestroyed` on
  `UMetaSoundSource` deprecated in 5.6; use `OnGeneratorInstanceInfoCreated`
  / `OnGeneratorInstanceInfoDestroyed` (`MetasoundSource.h`:309–313).

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Components/AudioComponent.h` — `UAudioComponent`:167;
  `Play`:517, `Stop`:583, `FadeIn`:500, `FadeOut`:511, `SetFloatParameter`:548,
  `SetBoolParameter`:534, `SetIntParameter`:541, `SetWaveParameter`:622,
  `OnAudioFinished`:456, `GetPlayState`:605, `SetSubmixSend`:644.
- `Runtime/Engine/Public/Audio/SoundParameterControllerInterface.h` —
  `ISoundParameterControllerInterface`:24, `SetTriggerParameter`:32.
- `Runtime/Engine/Classes/Sound/SoundBase.h` — `USoundBase`:108,
  `SoundClassObject`:117, `AttenuationSettings`:221, `ConcurrencySet`:188,
  `VirtualizationMode`:169, `EVirtualizationMode`:56.
- `Runtime/Engine/Classes/Sound/SoundWave.h` — `USoundWave`:416 (extends
  `USoundBase`; leaf asset for raw PCM audio).
- `Runtime/Engine/Classes/Sound/SoundCue.h` — `USoundCue`:89 (legacy node
  graph over `USoundWave` assets).
- `Runtime/Engine/Classes/Sound/SoundAttenuation.h` — `USoundAttenuation`:442,
  `FSoundAttenuationSettings`:138.
- `Runtime/Engine/Classes/Sound/SoundClass.h` — `USoundClass`, `FSoundClassProperties`:54.
- `Runtime/Engine/Classes/Sound/SoundSubmix.h` — `USoundSubmix`, submix effects.
- `Runtime/Engine/Classes/Sound/SoundConcurrency.h` — `FSoundConcurrencySettings`:74,
  `EMaxConcurrentResolutionRule`:31.
- `Runtime/Engine/Classes/Sound/AudioBus.h` — `UAudioBus`, `EAudioBusChannels`:13.
- `Runtime/Engine/Classes/Kismet/GameplayStatics.h` — `PlaySound2D`:681,
  `SpawnSound2D`:700, `PlaySoundAtLocation`:733, `SpawnSoundAtLocation`:755,
  `SpawnSoundAttached`:779.
- `Plugins/Runtime/Metasound/Source/MetasoundEngine/Public/MetasoundSource.h` —
  `UMetaSoundSource`:88, `GetGeneratorForAudioComponent`:296,
  `OnGeneratorInstanceInfoCreated`:313.
- `Plugins/Runtime/Metasound/Source/MetasoundEngine/Public/MetasoundBuilderSubsystem.h`
  — `UMetaSoundBuilderSubsystem`, `UMetaSoundSourceBuilder`:71.

Official docs (UE 5.7):
- Working with Audio — <https://dev.epicgames.com/documentation/unreal-engine/working-with-audio-in-unreal-engine>
- MetaSounds — <https://dev.epicgames.com/documentation/unreal-engine/metasounds-in-unreal-engine>
- MetaSound Builder API — <https://dev.epicgames.com/documentation/unreal-engine/metasound-builder-api-in-unreal-engine>
- Spatialization and Sound Attenuation — <https://dev.epicgames.com/documentation/unreal-engine/spatialization-and-sound-attenuation-in-unreal-engine>
- Audio Mixing — <https://dev.epicgames.com/documentation/unreal-engine/audio-mixing-in-unreal-engine>
- Submixes — <https://dev.epicgames.com/documentation/unreal-engine/submixes-in-unreal-engine>

Deep-dive references in this skill:
- [references/audiocomponent-and-playback.md](references/audiocomponent-and-playback.md) —
  full `UAudioComponent` API, playback state machine, delegates, and Quartz.
- [references/attenuation-and-spatialization.md](references/attenuation-and-spatialization.md) —
  `FSoundAttenuationSettings` fields, distance models, HRTF, Audio Gameplay Volumes.
- [references/mixing-classes-submixes-concurrency.md](references/mixing-classes-submixes-concurrency.md) —
  concurrency steal rules, submix effect chains, audio bus sends, dynamic mixing.
- [references/metasound-parameters-and-builder.md](references/metasound-parameters-and-builder.md) —
  runtime parameter API, output watching, MetaSound Builder API.
