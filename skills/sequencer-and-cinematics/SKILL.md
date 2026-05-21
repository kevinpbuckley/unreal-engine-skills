---
name: sequencer-and-cinematics
description: Create and play cinematics in Unreal with Sequencer — Level Sequences, the sequence
  actor and runtime player, bindings and tracks (transform, animation, audio, camera cuts, event
  tracks), Cine Cameras, and triggering sequences and reacting to their events from C++. Use when
  building cutscenes or scripted in-game moments, animating cameras, playing a Level Sequence at
  runtime, or calling gameplay functions from a timeline.
metadata:
  engine-version: "5.7"
  category: animation
---

# Sequencer & cinematics

Sequencer is Unreal's non-linear timeline editor. A **Level Sequence** binds actors and animates
their properties over time via tracks; you play it in-editor for cutscenes or at runtime for
scripted moments, and it can call back into gameplay through event tracks.

## When to use this skill

- Cutscenes, intros, scripted in-game beats.
- Animating cameras (dolly, focus pulls, camera cuts).
- Playing a Level Sequence at runtime and knowing when it finishes.
- Driving gameplay from a timeline (event tracks calling functions).

## The pieces

| Type | Role |
|---|---|
| `ULevelSequence` | the cinematic asset (a `UMovieScene` of tracks/sections) |
| `ALevelSequenceActor` | places a sequence in a level; holds the player |
| `ULevelSequencePlayer` | plays/scrubs a sequence at runtime |
| `ACineCameraActor` / `UCineCameraComponent` | film-style camera (filmback, focus, aperture) |

A sequence has **bindings** (which actors it controls) and, per binding, **tracks** (Transform,
Skeletal Animation, Audio, Visibility, property tracks, Camera Cuts, Event tracks). Sections on a
track hold keyframes.

## Playing a sequence from C++

```cpp
#include "LevelSequencePlayer.h"
#include "LevelSequenceActor.h"

ALevelSequenceActor* SeqActor = nullptr;
FMovieSceneSequencePlaybackSettings Settings;
ULevelSequencePlayer* Player = ULevelSequencePlayer::CreateLevelSequencePlayer(
    GetWorld(), MyLevelSequence /*ULevelSequence*/, Settings, SeqActor);

Player->OnFinished.AddDynamic(this, &AMyDirector::OnCinematicDone);
Player->Play();
```
If you already placed an `ALevelSequenceActor` in the level, use its `GetSequencePlayer()->Play()`.
`OnFinished`/`OnStop` delegates tell you when to return control to gameplay.

## Cameras & camera cuts

- Add a **Camera Cuts** track to drive which camera the player views during the sequence.
- Use **Cine Camera** for cinematic look (focal length, aperture/depth of field, focus distance,
  filmback). Components: `UCineCameraComponent`; actor: `ACineCameraActor`.
- During playback the sequence overrides the view to the cut camera; on finish, view returns to the
  player's camera (configurable).

## Event tracks (timeline → gameplay)

Event tracks fire at keyframes and can call functions (on the level sequence director or bound
objects). Use them to spawn effects, toggle gameplay, or advance state at exact cinematic moments —
the timeline equivalent of anim notifies (`animation-system`).

## Common track types

Transform (move/rotate/scale actors), Skeletal Animation (play montages/sequences on characters),
Audio, Visibility/Spawn, material/property tracks, Camera Cuts, Event, and Subsequences (nest
sequences). Animate any exposed property via a property track.

## High-quality output

For rendered output (trailers, pre-rendered cinematics), use **Movie Render Queue** (plugin) rather
than the basic Sequencer render — it supports anti-aliasing accumulation, warmup frames, and
high-quality settings.

## Gameplay vs cinematic control

- Disable/limit player input during a non-interactive cutscene and restore it on `OnFinished`.
- For interactive scripted moments, keep gameplay running and use the sequence only for
  cameras/specific actors.
- Networked cinematics: trigger the sequence on all clients (e.g. via a replicated event/RPC) —
  Sequencer playback itself is local. See `networking-and-replication`.

## Gotchas

- **Bindings break** if bound actors are renamed/removed or spawned dynamically without rebinding;
  use spawnables or bind at runtime for dynamic actors.
- **Forgetting to restore input/camera** on finish leaves the player stuck in cinematic view.
- **Assuming replicated playback** — play the sequence on each client; don't expect it to replicate.
- **Heavy real-time render expectations** — use Movie Render Queue for final-quality output.

## References & source material

Engine source (UE 5.7):
- `Runtime/LevelSequence/Public/LevelSequence.h` — `ULevelSequence`.
- `Runtime/LevelSequence/Public/LevelSequenceActor.h` — `ALevelSequenceActor`.
- `Runtime/LevelSequence/Public/LevelSequencePlayer.h` — `ULevelSequencePlayer`, `OnFinished`.
- `Runtime/MovieScene/Public/MovieScene.h` — `UMovieScene` (tracks/sections model).
- `Runtime/CinematicCamera/Public/CineCameraActor.h`, `CineCameraComponent.h`.

Official docs (UE 5.7): Animating Characters and Objects —
<https://dev.epicgames.com/documentation/unreal-engine/animating-characters-and-objects-in-unreal-engine>
