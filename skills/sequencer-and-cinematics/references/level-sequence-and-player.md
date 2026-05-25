# Level Sequence & Player — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the full `ULevelSequencePlayer` API,
playback settings, completion modes, the Director class, and event tracks. Grounded in UE 5.7
(`Engine/Source/Runtime/LevelSequence/Public/` and `Engine/Source/Runtime/MovieScene/Public/`).

## ULevelSequence

`ULevelSequence` (`LevelSequence/Public/LevelSequence.h`) is a `UMovieSceneSequence` asset.
Its essential data:

- `TObjectPtr<UMovieScene> MovieScene` — the timeline, holding all tracks and bindings.
- `FUpgradedLevelSequenceBindingReferences BindingReferences` — maps `FGuid` binding IDs to
  soft object paths (possessables) or spawnable templates.
- `TObjectPtr<UClass> DirectorClass` — the per-sequence Blueprint class that event-track
  functions are dispatched to.

The sequence is a pure data asset; it has no playback state of its own. Playback state lives
entirely in `ULevelSequencePlayer` / `UMovieSceneSequencePlayer`.

## ALevelSequenceActor

`ALevelSequenceActor` (`LevelSequence/Public/LevelSequenceActor.h`) is an `AActor` that acts
as the owner/context for a player. Key members:

```
UPROPERTY EditAnywhere  TObjectPtr<ULevelSequence>  LevelSequenceAsset
UPROPERTY Instanced     TObjectPtr<ULevelSequencePlayer> SequencePlayer  // deprecated 5.4
UPROPERTY EditAnywhere  FMovieSceneSequencePlaybackSettings PlaybackSettings
UPROPERTY EditAnywhere  FLevelSequenceCameraSettings CameraSettings
UPROPERTY Instanced     TObjectPtr<UMovieSceneBindingOverrides> BindingOverrides
uint8 bReplicatePlayback : 1   // line 117
```

Always retrieve the player via `GetSequencePlayer()` (line 153). The actor implements
`IMovieSceneBindingOwnerInterface` so bindings can be overridden on the actor without touching
the asset.

### Binding override API (on ALevelSequenceActor)

All these modify `BindingOverrides`, not the sequence asset, and take effect on the next
evaluation:

| Method | Signature |
|---|---|
| `SetBinding` | `(FMovieSceneObjectBindingID Binding, const TArray<AActor*>& Actors, bool bAllowBindingsFromAsset)` |
| `SetBindingByTag` | `(FName BindingTag, const TArray<AActor*>& Actors, bool bAllowBindingsFromAsset)` |
| `AddBinding` | `(FMovieSceneObjectBindingID Binding, AActor* Actor, bool bAllowBindingsFromAsset)` |
| `AddBindingByTag` | `(FName BindingTag, AActor* Actor, bool bAllowBindingsFromAsset)` |
| `RemoveBinding` | `(FMovieSceneObjectBindingID Binding, AActor* Actor)` |
| `ResetBindings` | `()` — restore all to asset defaults |
| `FindNamedBinding` | `(FName Tag) -> FMovieSceneObjectBindingID` |
| `FindNamedBindings` | `(FName Tag) -> const TArray<FMovieSceneObjectBindingID>&` |

Binding IDs are `FMovieSceneObjectBindingID` (a `FGuid` + sequence ID). Expose one as a
`UPROPERTY(EditAnywhere)` so designers can wire it in the editor, or look it up at runtime via
`FindNamedBinding` using a tag.

## ULevelSequencePlayer

`ULevelSequencePlayer` (`LevelSequence/Public/LevelSequencePlayer.h`) extends
`UMovieSceneSequencePlayer` (`MovieScene/Public/MovieSceneSequencePlayer.h`).

### Factory

```cpp
static ULevelSequencePlayer* CreateLevelSequencePlayer(
    UObject* WorldContextObject,
    ULevelSequence* LevelSequence,
    FMovieSceneSequencePlaybackSettings Settings,
    ALevelSequenceActor*& OutActor);   // line 106
```

Creates a transient `ALevelSequenceActor`, binds the sequence, and returns the player. The
spawned actor is GC-rooted while the sequence plays; hold a `TObjectPtr` or `TWeakObjectPtr`
to the actor if you need to control its lifetime separately.

### Core playback methods (from UMovieSceneSequencePlayer)

```cpp
void Play();                              // forward from current position
void PlayReverse();                       // reverse from current position
void PlayLooping(int32 NumLoops = -1);    // -1 = infinite
void Pause();
void Stop();                              // move cursor to end (or start if reversed)
void StopAtCurrentTime();                 // stop without moving cursor
void GoToEndAndStop();                    // adheres to When-Finished section rules
void SetPlayRate(float PlayRate);         // negative = reverse
void SetPlaybackPosition(FMovieSceneSequencePlaybackParams Params);
void PlayTo(FMovieSceneSequencePlaybackParams Params, FMovieSceneSequencePlayToParams PlayToParams);
FQualifiedFrameTime GetCurrentTime() const;
FQualifiedFrameTime GetDuration() const;
bool IsPlaying() const;
bool IsPaused() const;
```

### Playback params

`FMovieSceneSequencePlaybackParams` (`MovieSceneSequencePlayer.h`:91) can address a position
by frame number, seconds, marked-frame name, or SMPTE timecode:

```cpp
// Jump to frame 60 without triggering events between:
FMovieSceneSequencePlaybackParams Params;
Params.Frame = FFrameTime(60);
Params.PositionType = EMovieScenePositionType::Frame;
Params.UpdateMethod = EUpdatePositionMethod::Jump;
Player->SetPlaybackPosition(Params);
```

`EUpdatePositionMethod`: `Play` (trigger events), `Jump` (no events), `Scrub` (scrubbing status).

### Playback settings

`FMovieSceneSequencePlaybackSettings` (`MovieSceneSequencePlaybackSettings.h`):

| Field | Default | Effect |
|---|---|---|
| `bAutoPlay` | false | Start playing when the actor is created |
| `LoopCount.Value` | 0 | 0 = play once; -1 = infinite; N = N extra loops |
| `PlayRate` | 1.0f | Playback rate multiplier |
| `StartTime` | 0.0f | Seconds offset within the sequence to start |
| `bDisableMovementInput` | false | Disables player pawn movement during playback |
| `bDisableLookAtInput` | false | Disables player pawn look-at during playback |
| `bHidePlayer` | false | Hides the player pawn |
| `bHideHud` | false | Hides HUD elements |
| `bDisableCameraCuts` | false | Suppresses camera-cut override |
| `bPauseAtEnd` | false | Pause at the last frame instead of stopping |

### Completion mode

By default Sequencer restores animated properties on stop ("Restore State"). Control this:

```cpp
// Keep the final animated pose/transform after the sequence ends:
Player->SetCompletionModeOverride(EMovieSceneCompletionModeOverride::ForceKeepState);
```

Options: `None` (per-section default), `ForceKeepState`, `ForceRestoreState`.

### Player delegates

All are `FOnMovieSceneSequencePlayerEvent` (`DECLARE_DYNAMIC_MULTICAST_DELEGATE`):

| Delegate | When fires |
|---|---|
| `OnPlay` | Playback starts |
| `OnStop` | Player stopped (explicit `Stop()` or end of loop count) |
| `OnPause` | Paused |
| `OnFinished` | Reached end naturally (not via explicit `Stop()`) |
| `OnPlayReverse` | Reverse playback starts |

Native (non-dynamic) counterpart: `FOnMovieSceneSequencePlayerNativeEvent OnNativeFinished`.

ULevelSequencePlayer-specific:
- `FOnLevelSequencePlayerCameraCutEvent OnCameraCut` — fires each time the camera cut changes
  (receives the new `UCameraComponent*`). Line 110.
- `UCameraComponent* GetActiveCameraComponent() const` — returns the current camera cut
  camera. Line 114.

## ULevelSequenceDirector

The Director (`LevelSequence/Public/LevelSequenceDirector.h`) is a `UObject`-derived class
generated from the sequence's Blueprint. It is instantiated once per sequence evaluation
context (not one per bound object).

Key members:

```cpp
UPROPERTY(BlueprintReadOnly) TObjectPtr<ULevelSequencePlayer> Player;  // line 131
TArray<UObject*> GetBoundObjects(FMovieSceneObjectBindingID ObjectBinding);
AActor*          GetBoundActor(FMovieSceneObjectBindingID ObjectBinding);
FQualifiedFrameTime GetCurrentTime() const;
FQualifiedFrameTime GetRootSequenceTime() const;
```

Event-track functions are `BlueprintCallable UFUNCTION`s on the Director's Blueprint subclass.
The Director is created via `ULevelSequence::CreateDirectorInstance` when the sequence starts
evaluating.

## Event track workflow (C++/BP boundary)

1. Author a `BlueprintCallable` function on the sequence's Director Blueprint.
2. Place an Event Track on the sequence; add a keyframe; point it to that function.
3. At runtime the player invokes the function at the keyframe's frame — passing bound-object
   references as parameters if wired up.
4. The Director's `Player` pointer gives access to the player for playback control.

For C++-only event handling, prefer the `OnFinished` / `OnStop` delegates on the player plus
timed Blueprint or native calls, since the Director interface is primarily Blueprint-facing.

## Version notes

- `SequencePlayer` on `ALevelSequenceActor` is deprecated since 5.4; always use `GetSequencePlayer()`.
- `FindBindingFromObject(UObject*, UObject*)` is deprecated since 5.5; use the
  `SharedPlaybackState` overload.
- `LoopCount.Value = -1` is the correct infinite-loop idiom; the old `bLoop` bool was removed.
