# UAudioComponent & playback — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the full `UAudioComponent` API,
the playback state machine, delegates, Quartz beat-quantized playback, and tips
for managed vs. fire-and-forget audio. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Components/AudioComponent.h`).

## UAudioComponent class hierarchy

`UAudioComponent` extends `USceneComponent` (so it has a 3D transform and can
attach to actors or sockets) and implements `ISoundParameterControllerInterface`
(typed parameter setters) and `FQuartzTickableObject` (Quartz integration).

Declaration: `AudioComponent.h`:167.

## Playback control

| Method | Signature (abridged) | Notes |
|---|---|---|
| `Play` | `Play(float StartTime = 0.f)` | Starts or restarts from `StartTime` |
| `Stop` | `Stop()` | Immediate stop |
| `StopDelayed` | `StopDelayed(float Delay)` | Stop after `Delay` seconds |
| `FadeIn` | `FadeIn(float Duration, float TargetVol = 1.f, float StartTime = 0.f, EAudioFaderCurve Curve = Linear)` | Start with a volume ramp |
| `FadeOut` | `FadeOut(float Duration, float TargetVol, EAudioFaderCurve Curve = Linear)` | Fade to `TargetVol` then stop |
| `AdjustVolume` | `AdjustVolume(float Duration, float Level, EAudioFaderCurve Curve)` | Smoothly change volume while playing |
| `SetPaused` | `SetPaused(bool bPause)` | Pause or resume without losing position |
| `IsPlaying` | `IsPlaying() const` | True if active and not paused/fading-out |
| `GetPlayState` | `GetPlayState() const -> EAudioComponentPlayState` | Full state: Playing / Stopped / Paused / FadingIn / FadingOut |

`EAudioFaderCurve` options: `Linear`, `Logarithmic`, `SCurve`, `Sin`.

## Delegates

Bind to `OnAudioFinished` (Blueprint-assignable) or `OnAudioFinishedNative`
(native, multi-cast) to respond when playback ends:

```cpp
// In BeginPlay — fires when the sound completes or Stop() is called:
EngineAudio->OnAudioFinishedNative.AddUObject(this, &AMyActor::HandleAudioDone);
```

`OnAudioPlayStateChanged` and `OnAudioPlayStateChangedNative` fire whenever the
`EAudioComponentPlayState` transitions — useful for syncing animations to audio state.

`OnAudioVirtualizationChanged` fires when the sound becomes virtualized (evicted
from a hardware voice) or realized (resumes on a voice).

All delegates are declared in `AudioComponent.h`:61–107.

## Per-component property overrides

These `UPROPERTY`s on the component override values set on the sound asset:

```cpp
AC->VolumeMultiplier      = 0.5f;   // scale final volume
AC->PitchMultiplier       = 1.1f;   // shift pitch up 10%
AC->AttenuationSettings   = MyAttenuationAsset;  // override attenuation
AC->SoundClassOverride    = MusicSoundClass;      // override sound class
AC->bAllowSpatialization  = false;  // force 2D even with attenuation set
AC->bIsUISound            = true;   // audible while game is paused

// Per-voice LP/HP filter (audio mixer only):
AC->SetLowPassFilterEnabled(true);
AC->SetLowPassFilterFrequency(2000.f);  // Hz
AC->SetHighPassFilterEnabled(true);
AC->SetHighPassFilterFrequency(200.f);
```

## Submix and bus sends at runtime

```cpp
// Send signal to a submix (e.g. a reverb bus):
AC->SetSubmixSend(ReverbSubmix, 0.4f);

// Send to a source bus before source effects:
AC->SetSourceBusSendPreEffect(SidechainBus, 0.8f);

// Send to an audio bus after source effects:
AC->SetAudioBusSendPostEffect(MasterAudioBus, 1.0f);
```

These calls are forwarded to the active sound; if no sound is playing they take
effect on next play. Methods: `SetSubmixSend`:644, `SetSourceBusSendPreEffect`:653,
`SetAudioBusSendPostEffect`:677.

## Sound-swap without stopping

`SetSound(USoundBase* NewSound)` replaces the asset reference but does **not**
automatically restart. Call `Stop()` then `Play()` after setting if you need
the new sound to begin immediately:

```cpp
AC->SetSound(NewMusicTrack);
AC->Play();
```

## bAutoManageAttachment

`bAutoManageAttachment` (declared `AudioComponent.h`:296) lets an audio component
automatically attach to `AutoAttachParent` when `Play()` is called and detach when
playback completes. Useful for sounds that should follow an actor while playing but
not remain attached otherwise. The relative transform from activation time is
restored on detach.

## Quartz beat-quantized playback

Quartz provides a game-thread musical clock with sample-accurate triggering. It
lives in the `AudioMixer` module (`QuartzQuantizationUtilities.h`):

```cpp
#include "Sound/QuartzQuantizationUtilities.h"
#include "QuartzSubsystem.h"

// 1. Create a clock (once, e.g. from a music manager subsystem):
UQuartzSubsystem* QS = UQuartzSubsystem::Get(GetWorld());
FQuartzClockSettings Settings;
Settings.TimeSignature = { 4, EQuartzTimeSignatureQuantization::QuarterNote };
Settings.bIgnoreLevelChange = true;
UQuartzClockHandle* Clock = QS->CreateNewClock(this, TEXT("GameClock"), Settings);

// 2. Schedule a sound on the next bar:
FQuartzQuantizationBoundary Boundary;
Boundary.Quantization   = EQuartzCommandQuantization::Bar;
Boundary.BoundaryType   = EQuarztQuantizationBoundaryType::FromNow;
Boundary.bFireOnClockStart = true;

FOnQuartzCommandEventBP EventDelegate; // optional BP delegate on quantization events
AC->PlayQuantized(GetWorld(), Clock, Boundary, EventDelegate);
```

`PlayQuantized` is declared `AudioComponent.h`:521. The clock ticks independently
of frame rate, producing accurate musical events even under frame time spikes.
Use `UQuartzSubsystem::FindClockHandle` to retrieve a named clock from another
actor or subsystem.

## Lifecycle relationship with actors

An `AudioComponent` owned by an actor through `CreateDefaultSubobject` follows the
actor's `EndPlay` — it stops automatically when the actor is destroyed. A component
obtained via `SpawnSoundAttached` has `bStopWhenOwnerDestroyed` set by default.
Components created via `SpawnSound2D` optionally persist across level transitions
(`bPersistAcrossLevelTransition`).

## Version notes

- `FAudioComponentParam` (the old USTRUCT-based parameter system) was deprecated in
  UE 5.0 with `UE_DEPRECATED(5.0, ...)` in `AudioComponent.h`:132. Use
  `FAudioParameter` / the `SetXParameter` family instead.
- `PlayQuantized` was added in UE 5.0 alongside the Quartz system.
- `SetHighPassFilterEnabled` / `SetHighPassFilterFrequency` require the Audio Mixer
  (`au.IsUsingSteamAudio 0` / platform Audio Mixer enabled).
