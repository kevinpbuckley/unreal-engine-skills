# Tracks & bindings — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `UMovieScene` data model — tracks,
sections, channels — and the binding system (possessables, spawnables, runtime overrides).
Grounded in UE 5.7 (`Engine/Source/Runtime/MovieScene/Public/MovieScene.h`,
`MovieSceneTrack.h`, `MovieSceneBinding.h`, `MovieScenePossessable.h`, `MovieSceneSpawnable.h`).

## MovieScene data model

`UMovieScene` is the inner data object of a `ULevelSequence`. It owns:

- **Master tracks** — tracks that don't belong to a specific bound object (Camera Cuts,
  Subsequences, Director, global property overrides).
- **Bindings** (`TArray<FMovieSceneBinding>`) — each binding represents one object slot.
  A binding holds a `FGuid` (the binding ID) and an array of `UMovieSceneTrack*` that animate
  that slot's properties.
- **Possessables** (`TArray<FMovieScenePossessable>`) — metadata for actor-reference bindings.
- **Spawnables** (`TArray<FMovieSceneSpawnable>`) — metadata + template for spawned actors.

At runtime the player resolves each `FGuid` to a concrete `UObject*` through the binding
reference system (`FUpgradedLevelSequenceBindingReferences`) and then evaluates each track.

## Track types

| Track | Description |
|---|---|
| `UMovieScene3DTransformTrack` | Animates Actor transform (location/rotation/scale) |
| `UMovieSceneSkeletalAnimationTrack` | Plays animation sequences/montages on Skeletal Mesh |
| `UMovieSceneAudioTrack` | Plays audio assets at specified times |
| `UMovieSceneEventTrack` | Fires events on the Director blueprint at keyframes |
| `UMovieSceneCameraCutTrack` | Switches the viewport camera (master track) |
| `UMovieSceneSubTrack` | Nests child sequences (shots, takes) |
| `UMovieSceneVisibilityTrack` | Controls actor visibility |
| `UMovieSceneFadeTrack` | Screen-space fades (master track) |
| Property tracks | Generic tracks for any `UPROPERTY(Interp, …)` field |

Each track holds one or more **sections** (`UMovieSceneSection`). Sections define a time range
and own the actual keyframe data (stored in **channels** — `FMovieSceneFloatChannel`,
`FMovieSceneBoolChannel`, etc.).

## Possessables

A possessable binding stores a soft object path to an existing level actor. The path is
serialised as `FUpgradedLevelSequenceBindingReferences` and resolved at runtime via
`ULevelSequence::BindPossessableObject` / `LocateBoundObjects`.

Implications:
- Moving the actor to a different sublevel or renaming it silently breaks the binding.
- Works well for stable hero actors placed in the persistent level.
- The sequence can animate any `UPROPERTY(Interp)` on the possessed actor or its components.

## Spawnables

A spawnable stores a template `UObject` (usually an `AActor` class + default properties)
inside the sequence asset. The player instantiates it when the spawnable's spawn range begins.

Relevant flags (`MovieSceneSpawnable.h`):
- `bContinuouslyRespawn` — re-spawn if something external destroys it during the sequence.
- `bEvaluateTracksWhenNotSpawned` — pre-evaluate tracks even before the actor exists.
- `SpawnOwnership` — `ThisSequence` (default), `RootSequence`, or `External` (never auto-
  destroyed at sequence end).

## Runtime binding overrides

`ALevelSequenceActor` maintains a `UMovieSceneBindingOverrides` object that layers on top of
the asset's bindings without modifying it. This is how you retarget a sequence to
dynamically spawned actors.

Typical C++ pattern:

```cpp
// 1. Obtain the binding ID for the tagged slot (tag set in Sequencer UI: RMB > Tags…)
FMovieSceneObjectBindingID HeroBindingId =
    PlacedSeqActor->FindNamedBinding(FName("HeroCharacter"));

// 2. Override with the runtime actor
PlacedSeqActor->SetBinding(HeroBindingId, {RuntimeHeroActor}, /*bAllowAsset=*/false);

// 3. Play
PlacedSeqActor->GetSequencePlayer()->Play();
```

`bAllowBindingsFromAsset = false` replaces the asset binding entirely.
`bAllowBindingsFromAsset = true` adds the override *in addition to* the asset binding
(useful when multiple actors should be animated together).

`ResetBindings()` restores everything to asset defaults.

### Accessing bound objects at runtime

From the player:

```cpp
TArray<UObject*> Actors = Player->GetBoundObjects(BindingId);
TArray<FMovieSceneObjectBindingID> Bindings = Player->GetObjectBindings(SomeActor);
```

From the Director Blueprint (event track context):
```cpp
// Available in ULevelSequenceDirector
TArray<UObject*> Objects = GetBoundObjects(ObjectBinding);
AActor* Actor = GetBoundActor(ObjectBinding);
```

## Dynamic Binding (UE 5.4+)

Dynamic Binding (`dynamic-binding-in-sequencer` doc) is a newer mechanism that lets a
Blueprint subclass of the Director decide *which* object to resolve for each binding,
rather than using the override table. It replaces the old "Binding Overrides" pattern for
fresh code. Under the hood it hooks `ULevelSequence::IterateDynamicBindings` (editor-only)
and a `UClass`-derived resolver at runtime.

## Sections and channels

A section (`UMovieSceneSection`) has:
- A time range (`TRange<FFrameNumber>`) marking when it is active.
- Channels (retrieved via `UMovieSceneSection::GetChannelProxy()`) that hold keyframe arrays.

Channels use `FFrameNumber` (tick-resolution integer) internally and interpolate using cubic,
linear, constant, or weighted tangent modes. You can author keyframes at runtime by obtaining
a channel, calling `AddCubicKey`, `AddLinearKey`, or using `MovieSceneKeyInterpolation::Auto`.
This is primarily an editor-side workflow; avoid doing it at game-runtime for performance.

## Version notes

- Spawnables now use the **custom binding system** (`AllowsCustomBindings`) introduced in 5.5;
  old `FMovieSceneSpawnable`-style data is automatically converted on load.
- The `FGuid FindBindingFromObject(UObject*, UObject*)` API is deprecated since 5.5; prefer
  the `SharedPlaybackState` variant or `FindNamedBinding` via tags.
- Track references: all track headers are under
  `Engine/Source/Runtime/MovieSceneTracks/Public/Tracks/`.
