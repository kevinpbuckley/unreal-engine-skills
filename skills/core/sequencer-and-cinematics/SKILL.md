---
name: sequencer-and-cinematics
description: Create and drive Unreal Engine cinematics from C++ — ULevelSequence (the cinematic
  asset), ALevelSequenceActor (the level-placed container), ULevelSequencePlayer
  (CreateLevelSequencePlayer, Play, Stop, PlayLooping, SetPlaybackPosition, OnFinished),
  possessables vs spawnables, runtime binding overrides (SetBinding/SetBindingByTag),
  track and MovieScene concepts, Cine Camera (UCineCameraComponent, ACineCameraActor —
  filmback, focal length, aperture, focus), Camera Cuts track, and Movie Render Queue for
  high-quality offline output. Use when triggering or controlling a cutscene at runtime,
  overriding sequence bindings for dynamic actors, reacting to sequence-end events,
  animating a film-style camera, firing gameplay callbacks from an event track, or
  rendering frames with the Movie Render Pipeline.
metadata:
  engine-version: "5.7"
  category: animation
---

# Sequencer & cinematics

Sequencer is Unreal's non-linear timeline editor. A **Level Sequence** (`ULevelSequence`) binds
actors and animates their properties via tracks; you play it at runtime through a
`ULevelSequencePlayer` for cutscenes or scripted moments, and feed gameplay events back through
event tracks or the `OnFinished` delegate.

## When to use this skill

- Triggering a cutscene or scripted in-game beat from C++ and reacting when it ends.
- Overriding which actors a sequence controls at runtime (dynamic/spawned characters).
- Animating a film-style camera (focal length, aperture, depth of field) via Cine Camera.
- Firing gameplay functions at exact timeline positions (event tracks / Director blueprint).
- Using Movie Render Queue for offline high-quality output from a sequence asset.

## The pieces

| Type | Role |
|---|---|
| `ULevelSequence` | Cinematic asset — wraps `UMovieScene` (tracks, sections, bindings) |
| `ALevelSequenceActor` | Level-placed actor that holds the player and settings |
| `ULevelSequencePlayer` | Runtime player: play/stop/scrub/loop, delegates, binding overrides |
| `ULevelSequenceDirector` | Per-sequence Blueprint class that event tracks call into |
| `ACineCameraActor` / `UCineCameraComponent` | Film-style camera (filmback, focus, aperture) |

Modules to add to your `.Build.cs`:

```
"LevelSequence", "MovieScene", "CinematicCamera"
```

For Movie Render Queue also add `"MovieRenderPipelineCore"` (and enable the plugin).

## Playing a sequence from C++

The factory method `ULevelSequencePlayer::CreateLevelSequencePlayer` spawns a transient
`ALevelSequenceActor`, initialises its player, and returns the player ready to use. The
out-param `SeqActor` receives the spawned actor (useful for lifecycle control).

```cpp
#include "LevelSequence.h"
#include "LevelSequenceActor.h"
#include "LevelSequencePlayer.h"
#include "MovieSceneSequencePlayer.h"

// Called from BeginPlay or a gameplay event — never from a constructor.
void AMyDirector::PlayCutscene()
{
    if (!CutsceneAsset) { return; }  // UPROPERTY TObjectPtr<ULevelSequence> CutsceneAsset

    FMovieSceneSequencePlaybackSettings Settings;
    // Settings.bAutoPlay = false;   // default; we call Play() explicitly
    // Settings.LoopCount.Value = 0; // play once; -1 = infinite

    ALevelSequenceActor* SeqActor = nullptr;
    ULevelSequencePlayer* Player = ULevelSequencePlayer::CreateLevelSequencePlayer(
        GetWorld(), CutsceneAsset, Settings, SeqActor);

    if (Player)
    {
        Player->OnFinished.AddDynamic(this, &AMyDirector::OnCutsceneDone);
        Player->Play();
    }
}

UFUNCTION()
void AMyDirector::OnCutsceneDone()
{
    // Re-enable player input, restore camera, advance game state.
}
```

If you placed an `ALevelSequenceActor` in the level, prefer:

```cpp
// PlacedSeqActor is a UPROPERTY TObjectPtr<ALevelSequenceActor> set in the editor.
if (ULevelSequencePlayer* P = PlacedSeqActor->GetSequencePlayer())
{
    P->OnFinished.AddDynamic(this, &AMyDirector::OnCutsceneDone);
    P->Play();
}
```

Key player methods (all on `UMovieSceneSequencePlayer`, base of `ULevelSequencePlayer`):

| Method | Effect |
|---|---|
| `Play()` | Forward from current position |
| `PlayLooping(int32 NumLoops = -1)` | Loop: -1 = infinite, 0 = play once more |
| `Stop()` | Stop and move cursor to end (or start if reversed) |
| `Pause()` | Pause at current position |
| `SetPlaybackPosition(FMovieSceneSequencePlaybackParams)` | Jump or scrub to a time/frame |
| `SetPlayRate(float)` | Negative for reverse |
| `GetCurrentTime()` | Returns `FQualifiedFrameTime` |

Source: `Runtime/MovieScene/Public/MovieSceneSequencePlayer.h` — `Play`:193, `PlayLooping`:208,
`Stop`:220, `Pause`:211, `SetPlaybackPosition`:344, `OnFinished`:426.

## Bindings — possessables vs spawnables

A **possessable** references a pre-existing level actor (linked by soft object path). A
**spawnable** is an actor template embedded in the sequence that the player spawns/destroys
for the duration of playback.

- **Possessable**: stable cross-level binding; breaks if the target actor is renamed, moved to
  another level, or replaced at runtime without rebinding.
- **Spawnable**: self-contained; the sequence owns the actor's lifetime, making the sequence
  portable and usable without placing anything in the level. Prefer spawnables for cinematic-
  only characters or props that don't need to interact with gameplay after the cutscene.

### Runtime binding override

For dynamic actors (spawned at runtime, procedurally placed), override a binding on the
`ALevelSequenceActor` rather than editing the asset:

```cpp
// Binding must be tagged in the Sequencer UI (RMB on binding > Tags…).
// FMovieSceneObjectBindingID can come from FindNamedBinding() or a designer-exposed
// UPROPERTY(EditAnywhere) FMovieSceneObjectBindingID.
PlacedSeqActor->SetBindingByTag(
    FName("HeroCharacter"),        // tag set in the Sequencer UI
    {DynamicallySpawnedHero},      // TArray<AActor*>
    /*bAllowBindingsFromAsset=*/false);
```

`SetBinding` / `SetBindingByTag` / `AddBinding` / `ResetBindings` are all on
`ALevelSequenceActor` (`LevelSequenceActor.h`:178–238). They write into the actor's
`UMovieSceneBindingOverrides` object without modifying the sequence asset.

Full binding and track internals: [references/tracks-and-bindings.md](references/tracks-and-bindings.md).

## Cameras & camera cuts

Add a **Camera Cuts** track to the sequence to drive which camera the viewer sees. During
playback the player overrides the viewport to the active cut camera; on finish the view returns
to the player camera (controllable via `FLevelSequenceCameraSettings`).

Use `ACineCameraActor` / `UCineCameraComponent` for cinematic look. Key properties (all
`UPROPERTY(Interp, …)`, so they can be keyframed in Sequencer):

| Property | Type | Effect |
|---|---|---|
| `CurrentFocalLength` | `float` | Zoom; derives FoV from filmback |
| `CurrentAperture` | `float` | f-stop — controls depth of field |
| `Filmback` | `FCameraFilmbackSettings` | Sensor size (width × height mm) |
| `FocusSettings` | `FCameraFocusSettings` | Manual / tracking / disable DoF |

`UCineCameraComponent` inherits from `UCameraComponent`; `ACineCameraActor` wraps it and
adds `LookatTrackingSettings`. Source: `Runtime/CinematicCamera/Public/CineCameraComponent.h`
and `CineCameraActor.h`.

Camera and camera-cuts deep dive: [references/cameras-and-cuts.md](references/cameras-and-cuts.md).

## Event tracks (timeline → gameplay)

Event tracks fire at keyframe positions and invoke functions on the sequence's
`ULevelSequenceDirector` subclass (a Blueprint). The director receives bound-object references
through `GetBoundObjects(FMovieSceneObjectBindingID)` / `GetBoundActor(…)`.

Use event tracks to spawn effects, toggle gameplay flags, or advance state at exact cinematic
beats — the timeline analog of anim notifies (see `animation-system`). For gameplay → timeline
(driving a sequence from code), just call `SetPlaybackPosition` or `PlayTo`.

The Director's player pointer is `UPROPERTY(BlueprintReadOnly) TObjectPtr<ULevelSequencePlayer>
Player` (`LevelSequenceDirector.h`:131).

## Movie Render Queue

For offline renders (trailers, pre-rendered cutscenes), use the **Movie Render Pipeline**
plugin rather than the editor's legacy "Render Movie" button. It supports multi-sample anti-
aliasing accumulation, warmup frames, EXR / PNG / ProRes output, and render passes.

The queue is managed via editor subsystem (`MoviePipelineQueueSubsystem`) or Python/Blueprint
scripting; runtime rendering in a packaged build uses `UMoviePipeline` directly.

Plugin headers live in:
`Engine/Plugins/MovieScene/MovieRenderPipeline/Source/MovieRenderPipelineCore/Public/`

Full MRQ setup and scripting: [references/movie-render-queue.md](references/movie-render-queue.md).

## Gameplay vs cinematic control

- Disable player input with `APlayerController::SetInputMode` / `DisableInput` during non-
  interactive cutscenes; restore in `OnFinished`.
- For interactive moments (player can still move), skip disabling input and use the sequence
  only for cameras or specific actors.
- Networked cinematics: trigger the sequence on every client via an RPC/replicated event.
  `ALevelSequenceActor` has `bReplicatePlayback` (`LevelSequenceActor.h`:117) but Sequencer
  playback itself is not automatically synchronised — coordinate timing explicitly.
  See `networking-and-replication`.

## Gotchas

- **Possessable binding breaks on rename/move** — if the bound actor is renamed or moved to a
  sublevel, the soft-object-path reference breaks. Use tags + `SetBindingByTag` at runtime.
- **Forgetting to restore input/camera** — always hook `OnFinished` and undo any cinematic-mode
  state (input, camera, HUD visibility) there.
- **Null player after `CreateLevelSequencePlayer`** — this returns null if `GetWorld()` is null
  (CDO, editor context) or `LevelSequence` is null. Guard both.
- **Replicated playback is not frame-accurate** — `bReplicatePlayback` gives clients a status
  update, not a sample-accurate sync. For frame-locked sync, implement your own timing.
- **Event track functions must exist on the Director blueprint** — functions called by event
  tracks must be `BlueprintCallable` and present in the Director class; mismatches are silent.
- **Forgetting module deps** — missing `"LevelSequence"` in `.Build.cs` causes include errors
  for `ULevelSequencePlayer` and `ALevelSequenceActor`.
- **Completion mode** — by default Sequencer restores animated properties on stop. Set
  `EMovieSceneCompletionModeOverride::ForceKeepState` via `Player->SetCompletionModeOverride`
  if you want animated transforms to persist after the sequence ends.

## Version notes

- `ALevelSequenceActor::SequencePlayer` is deprecated in 5.4; always use `GetSequencePlayer()`
  (`LevelSequenceActor.h`:153).
- The `FGuid FindBindingFromObject(UObject*, UObject*)` overload is deprecated in 5.5; use the
  `SharedPlaybackState` variant.
- For Control Rig-authored animation played inside Sequencer, see `control-rig-and-ik`.
- For skeletal animation tracks and Anim Notifies, see `animation-system`.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/`):
- `LevelSequence/Public/LevelSequence.h` — `ULevelSequence`, `MovieScene`, `DirectorClass`.
- `LevelSequence/Public/LevelSequenceActor.h` — `ALevelSequenceActor`, `GetSequencePlayer`:153,
  `SetBinding`:178, `SetBindingByTag`:190, `FindNamedBinding`:244, `bReplicatePlayback`:117.
- `LevelSequence/Public/LevelSequencePlayer.h` — `ULevelSequencePlayer`,
  `CreateLevelSequencePlayer`:106, `OnCameraCut`:110, `GetActiveCameraComponent`:114.
- `LevelSequence/Public/LevelSequenceDirector.h` — `ULevelSequenceDirector`, `Player`:131,
  `GetBoundObjects`:65, `GetBoundActor`:95.
- `MovieScene/Public/MovieSceneSequencePlayer.h` — `Play`:193, `PlayLooping`:208, `Stop`:220,
  `Pause`:211, `SetPlaybackPosition`:344, `OnFinished`:426, `OnStop`:418, `OnPlay`:410.
- `MovieScene/Public/MovieSceneSequencePlaybackSettings.h` — `FMovieSceneSequencePlaybackSettings`.
- `MovieScene/Public/MovieScene.h` — `UMovieScene` (tracks/sections/bindings model).
- `CinematicCamera/Public/CineCameraComponent.h` — `UCineCameraComponent`, `CurrentFocalLength`:66,
  `CurrentAperture`:70, `Filmback`:38, `FocusSettings`:53.
- `CinematicCamera/Public/CineCameraActor.h` — `ACineCameraActor`, `GetCineCameraComponent`:90.

Plugin source (UE 5.7):
- `Engine/Plugins/MovieScene/MovieRenderPipeline/Source/MovieRenderPipelineCore/Public/MoviePipelineQueue.h`

Official docs (UE 5.7, verified):
- Cinematics and Sequencer —
  <https://dev.epicgames.com/documentation/unreal-engine/cinematics-and-movie-making-in-unreal-engine>
- Sequencer Overview —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-sequencer-movie-tool-overview>
- Spawnables and Possessables —
  <https://dev.epicgames.com/documentation/unreal-engine/spawn-temporary-actors-in-unreal-engine-cinematics>
- Movie Render Pipeline —
  <https://dev.epicgames.com/documentation/unreal-engine/movie-render-pipeline-in-unreal-engine>
- Cameras in Sequencer —
  <https://dev.epicgames.com/documentation/unreal-engine/movie-and-cinematic-cameras-in-unreal-engine>

Deep-dive references in this skill:
- [references/tracks-and-bindings.md](references/tracks-and-bindings.md) — MovieScene data
  model (tracks, sections, channels), binding types, runtime binding override API.
- [references/cameras-and-cuts.md](references/cameras-and-cuts.md) — Cine Camera properties,
  Camera Cuts track, camera blending, `OnCameraCut` delegate.
- [references/level-sequence-and-player.md](references/level-sequence-and-player.md) — full
  player API, playback settings, completion modes, Director, event tracks.
- [references/movie-render-queue.md](references/movie-render-queue.md) — MRQ pipeline,
  scripting renders, runtime builds, render passes.
