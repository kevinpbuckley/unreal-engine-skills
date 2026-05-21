---
name: audio-and-metasounds
description: Play and control audio in Unreal — the sound asset types (SoundWave, SoundCue,
  MetaSound Source), playing 2D/3D sounds from C++ (UGameplayStatics, UAudioComponent), spatial
  attenuation, sound classes/submixes/concurrency for mixing, and runtime MetaSound parameters.
  Use when playing SFX/music, attaching looping sounds to actors, setting up 3D spatialization,
  mixing/ducking audio, or driving procedural audio with MetaSounds.
metadata:
  engine-version: "5.7"
  category: vfx-audio
---

# Audio & MetaSounds

Unreal audio: a **sound asset** (wave, cue, or MetaSound) is played either as a one-shot or via a
**UAudioComponent** for ongoing control, positioned in 3D with **attenuation**, and mixed through
**sound classes/submixes**. MetaSounds are the modern, node-based, parameter-driven sound sources.

## When to use this skill

- Playing SFX (one-shots), music, or UI sounds.
- Attaching looping/positional sound to an actor (engine hum, ambience).
- 3D spatialization and distance falloff.
- Mixing: ducking music under dialogue, volume groups, limiting voice counts.
- Procedural/parameterized audio (footsteps that vary, dynamic music) via MetaSounds.

## Sound asset types

| Asset | What it is | Use for |
|---|---|---|
| `USoundWave` | imported PCM audio | raw clips |
| `USoundCue` | node graph (mix/randomize/modulate) over waves | classic SFX variation |
| MetaSound Source (`UMetaSoundSource`) | node-based DSP graph with typed inputs | modern procedural/parameterized sound |
| `USoundBase` | base type of all the above | the type you pass to play functions |

Prefer **MetaSounds** for new, dynamic audio (runtime parameters, procedural synthesis);
SoundCues still work and are simpler for basic randomization.

## Playing sounds from C++

```cpp
#include "Kismet/GameplayStatics.h"

// 2D (UI/music), no spatialization:
UGameplayStatics::PlaySound2D(this, UISound /*USoundBase*/);

// 3D one-shot at a location (fire-and-forget):
UGameplayStatics::PlaySoundAtLocation(this, ExplosionSound, Location);

// Spawn a controllable component (loop/stop/fade/params):
UAudioComponent* AC = UGameplayStatics::SpawnSoundAttached(EngineLoop, CarMesh);
AC->FadeIn(0.5f);
AC->SetFloatParameter(TEXT("RPM"), 4200.f);   // MetaSound input
AC->Stop();
```
`PlaySound*` are fire-and-forget; use `SpawnSound*`/an `UAudioComponent` (or a component placed on
the actor) when you need to stop, fade, or change parameters later. Store persistent audio
components in a `UPROPERTY` (`memory-and-gc`).

## 3D spatialization & attenuation

A `USoundAttenuation` asset defines falloff (distance model, radius), spatialization, occlusion,
and air absorption. Assign it on the sound or pass it to the play function so a sound is positioned
in 3D and fades with distance. Without attenuation, a sound plays non-spatialized (2D).

## Mixing: classes, submixes, concurrency

- **Sound Classes** group sounds (SFX/Music/Voice) for volume control and properties; **Sound
  Mixes** push class adjustments (e.g. duck Music when Voice plays).
- **Submixes** are DSP buses — route audio for effects (reverb, EQ, compression) and metering.
- **Concurrency** settings cap how many instances of a sound/group play at once (prevent 50
  overlapping gunshots) with steal rules.

## MetaSound parameters at runtime

MetaSound Sources expose typed **inputs** (float/int/bool/trigger/wave). Set them live through the
audio component (`SetFloatParameter`, `SetBoolParameter`, `SetTriggerParameter`, …) to drive
dynamic audio — engine RPM, adaptive music intensity, parameterized footsteps. Input names must
match the MetaSound graph.

## Triggering from gameplay/animation

Footsteps, weapon sounds, and impacts should fire from **anim notifies** (`animation-system`) and
gameplay events, not guessed timers, so audio stays in sync at any play rate.

## Gotchas

- **Fire-and-forget when you needed control** — use `SpawnSound*`/component to stop/fade/parameterize.
- **No attenuation asset** → 3D sound plays as flat 2D.
- **Parameter/input name mismatch** on MetaSounds → no effect.
- **No concurrency limits** → audio voice spam and clipping under heavy action.
- **Persistent audio component not in a `UPROPERTY`** → GC'd, sound stops unexpectedly.
- **Importing non-WAV** — import PCM WAV; build variation/processing in cue/MetaSound, not the file.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Components/AudioComponent.h` — `UAudioComponent` (play/stop/fade/params).
- `Runtime/Engine/Classes/Sound/SoundBase.h`, `SoundWave.h`, `SoundCue.h`, `SoundAttenuation.h`.
- `Runtime/Engine/Classes/Kismet/GameplayStatics.h` — `PlaySound2D`/`PlaySoundAtLocation`/`SpawnSound*`.
- MetaSounds: `Engine/Plugins/Runtime/Metasound/Source/MetasoundEngine/Public/MetasoundSource.h`.

Official docs (UE 5.7): Working with Audio —
<https://dev.epicgames.com/documentation/unreal-engine/working-with-audio-in-unreal-engine>
