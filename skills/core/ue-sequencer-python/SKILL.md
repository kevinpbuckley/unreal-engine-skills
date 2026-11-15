---
name: ue-sequencer-python
description: >
  Author Level Sequences (Sequencer, MovieScene, cutscenes) from UE 5.9 editor Python and
  scrub them at runtime - binding proxy vs MovieSceneObjectBindingID, display rate vs tick
  resolution, camera cuts, CineCamera lens properties, animation play rate
  (MovieSceneTimeWarpVariant), easing, 5.9 mark ranges, replaceable bindings with
  set_binding_by_tag, audio sections, LevelSequencePlayer playback params. Use before Python
  touches unreal.LevelSequence, tracks, sections or bindings, and on the errors "has no
  attribute 'guid'", "Cannot find the requested movie scene binding", "Cannot nativize
  'float' as 'MovieSceneTimeWarpVariant'", "Failed to find property
  'manual_ease_in_duration'", "frame_number is read-only", "no attribute
  'get_sequence_player'", "no attribute 'set_current_focal_length'", "Section does not have
  a start frame", "MovieScene has no attribute get_display_rate", "playing past section end".
metadata:
  engine-version: "5.9"
  category: animation
  aliases: "sequencer python, level sequence python, movie scene scripting, cutscene script, cinematic python, camera cut python, marked frame, time warp, play rate, LevelSequenceEditorSubsystem, SequencerScripting"
---

# Level Sequences from editor Python (UE 5.9)

Sequencer's Python API is a set of **extension libraries** (`MovieSceneSequenceExtensions`,
`MovieSceneSectionExtensions`, `MovieSceneBindingExtensions`, ...) whose static functions are
hoisted onto the objects as snake_case methods (`ScriptMethod`), plus the editor-only
`LevelSequenceEditorSubsystem`. The names do not follow what you would guess from C++ or the
Sequencer UI. In a 48-hour UE 5.9 game-jam project (2026-11) 133 editor scripts touched
MovieScene and about 28 calls failed on a guessed name; this skill is the corrected list.
C++ runtime playback is in `ue-sequencer-and-cinematics`; the general Python rules are in
`ue-editor-scripting-and-python`.

## When to use this skill

- Building or editing a Level Sequence from Python: bindings, tracks, sections, keys, cuts.
- Retiming: section ranges, animation play rate, loop offsets, easing, marked frames.
- Runtime binding overrides for actors gameplay supplies (replaceable bindings, tags).
- Scrubbing a sequence in the editor or in PIE to capture or inspect a frame.
- Any `unreal.` AttributeError, "Cannot nativize" or "Failed to find property" on a MovieScene type.

## Mental model

1. **Methods live on the sequence asset, not on `UMovieScene`.** `seq.get_display_rate()`,
   `seq.get_tick_resolution()`, `seq.get_bindings()`, `seq.add_marked_frame_range_to_sequence(...)`.
   `UMovieScene::GetDisplayRate` is plain C++ (not a `UFUNCTION`), so `seq.get_movie_scene().get_display_rate()`
   is an AttributeError.
2. **Two binding handles.** A `MovieSceneBindingProxy` (guid + sequence) is what you add tracks to.
   A `MovieSceneObjectBindingID` is an opaque stored reference (guid + sequence ID + parent index) for
   camera-cut sections and runtime overrides. Its `Guid` is not Blueprint-visible, so `.guid` fails.
3. **Four time units.** Display-rate frames (what the UI shows), tick-resolution frames (storage,
   for example 24000/s), seconds, and `FrameTime` (frame + subframe). Each call takes exactly one.
4. **Use the property when a getter/setter is missing.** `lsa.get_sequence_player()` and
   `cine.set_current_focal_length()` raise AttributeError in 5.9 Python; both `UFUNCTION`s are their
   property's `BlueprintGetter` / `BlueprintSetter`. Use `get_editor_property` /
   `set_editor_property` on the property instead.
5. **The editor subsystem needs an open sequence.** Spawnable, camera and bound-object calls on
   `LevelSequenceEditorSubsystem` act on the sequence open in Sequencer.

## Error -> cure

| Error | Cause and what to write instead |
|---|---|
| `'MovieSceneObjectBindingID' object has no attribute 'guid'`, `Cannot nativize 'MovieSceneObjectBindingID' as 'Guid'` | Make an ID with `seq.get_binding_id(proxy)` or `root.get_portable_binding_id(dest_seq, proxy)`; turn one back with `root.resolve_binding_id(bid)` -> proxy, then `proxy.get_id()`. To read just the guid, `bid.get_editor_property("guid")` works (`Guid` is `EditAnywhere`, not Blueprint-visible). |
| `MovieSceneBindingProxy: Cannot find the requested movie scene binding` | The proxy points at nothing: a lookup missed (`find_binding_by_name` matches the internal name, not the display name), or the binding was converted (`convert_to_custom_binding`, `convert_to_spawnable`, `convert_to_possessable` return a NEW proxy) or the sequence was recreated. Re-read `seq.get_bindings()` after any structural change. |
| `Cannot nativize 'float' as 'MovieSceneTimeWarpVariant'`, `must be real number, not MovieSceneTimeWarpVariant` | A skeletal animation section's `params.play_rate` is a `MovieSceneTimeWarpVariant` in 5.9. See *Animation sections*. |
| `MovieSceneEasingSettings: Failed to find property 'manual_ease_in_duration'` | The easing struct's members are plain `UPROPERTY()`, not script-visible. Use `section.set_ease_in_duration(ticks)` / `set_ease_out_duration(ticks)` (tick-resolution frames). |
| `MovieSceneMarkedFrame: ... 'frame_number' ... is read-only`, `no attribute 'comment'` | 5.9 deprecated `FrameNumber` (now `BlueprintReadOnly`) and moved marks to ranges; `Comment` was never Blueprint-visible. See *Marked frames*. |
| `'LevelSequenceActor' object has no attribute 'get_sequence_player'` | `GetSequencePlayer` is the `SequencePlayer` property's `BlueprintGetter`: `lsa.get_editor_property("sequence_player")`. |
| `'CineCameraComponent' object has no attribute 'set_current_focal_length'` / `'set_current_aperture'` | Both are `BlueprintSetter`s: `cc.set_editor_property("current_focal_length", 35.0)`, `"current_aperture"`. |
| `MovieSceneBindingLifetimeSection: Section does not have a start frame` | Sections can be open-ended (binding lifetime, spawn, infinite). Check `sec.has_start_frame()` / `has_end_frame()` before `get_start_frame()` / `get_end_frame()`. |
| `'MovieScene' object has no attribute 'get_display_rate'` | Call it on the sequence: `seq.get_display_rate()`. |
| `'SoundWave' object has no attribute 'get_duration'` | `GetDuration` is not a `UFUNCTION`; read the property: `snd.get_editor_property("duration")` (seconds). |
| Log: `Sequencer sound playing past section end` | An audio section ends after the playback end (or has no end). See *Audio sections*. |

## Core workflow

```python
import unreal
lse = unreal.get_editor_subsystem(unreal.LevelSequenceEditorSubsystem)
FPS = 30

seq = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
    "LS_Example", "/Game/Cinematics", unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
seq.set_display_rate(unreal.FrameRate(FPS, 1))    # FIRST: every later frame number is in this rate
seq.set_playback_start(0)                          # display-rate frames, end is exclusive
seq.set_playback_end(12 * FPS)
seq.set_view_range_start(-0.5); seq.set_view_range_end(12.5)    # view and work ranges are SECONDS
seq.set_work_range_start(0.0);  seq.set_work_range_end(12.0)
# open it before any spawnable / camera / bound-object call (returns an async result object)
lse.open_level_sequence_async(seq)
```

- Set the display rate before computing frames. `set_range` and `add_key` convert display frames
  to ticks when called, so numbers computed at another rate land at the wrong time.
- Read the tick resolution, do not change it: `seq.set_tick_resolution(rate)` migrates every
  stored time, `set_tick_resolution_directly(rate)` reinterprets them.
- Save with `unreal.EditorAssetLibrary.save_loaded_asset(seq, False)` (`False` = save even when
  your edits did not mark the package dirty).

## Time units, per call

| Unit | Calls |
|---|---|
| Display-rate frames (`int`) | `set_playback_start/end`, `section.set_range(s, e)`, `set_start_frame`, `set_end_frame`, `get_start_frame`, `get_end_frame` |
| Explicit `MovieSceneTimeUnit` | `channel.add_key(unreal.FrameNumber(f), v, 0.0, unreal.MovieSceneTimeUnit.DISPLAY_RATE, interp)`; marked-frame calls; `get_marked_frames_from_sequence(unit)`. Always pass `DISPLAY_RATE` explicitly. |
| Tick-resolution frames | `params.start_frame_offset`, `params.first_loop_start_frame_offset`, `params.end_frame_offset`, ease durations |
| Seconds (`float`) | `set_view_range_*`, `set_work_range_*`, `set_range_seconds`, `get_start_frame_seconds` |

Seconds to ticks: `t = seq.get_tick_resolution(); int(round(sec * t.numerator / t.denominator))`.

## Bindings

```python
actor_b = seq.add_possessable(level_actor)                     # an actor already in the level
cls = unreal.load_asset("/Game/Chars/BP_Hero").generated_class()
hero_b = lse.add_spawnable_from_class(seq, cls)                 # a template owned by the sequence
cam_b, cam_actor = lse.create_camera(True)                      # out-param -> (proxy, actor)
for child in hero_b.get_child_possessables():                   # component bindings
    print(child.get_display_name())
proxy = next(b for b in seq.get_bindings() if str(b.get_display_name()) == "Hero")
```

- **Possessable** = an actor in the level. **Spawnable** = a template the sequence owns. After
  changing a spawnable's live actor (mesh, start pose, light values) call
  `lse.save_default_spawnable_state(proxy)` or the change is lost.
- Sequencer **auto-adds tracks** keyed at class defaults that override the template: lens tracks
  on a camera component, Control Rig tracks on a MetaHuman. Key them to your values or remove them.
- A spawnable's Spawn track section must cover the playback range; a camera is placed by its
  transform keys, not by the spawn pose (the auto-added transform section wins).
- **Actors that gameplay supplies at run time:** author a stand-in as a spawnable, convert it with
  `nb = lse.convert_to_custom_binding(proxy, unreal.MovieSceneReplaceableActorBinding)` (use `nb`;
  the old proxy is dead), then `nb.tag_binding("Hero")`. Gameplay calls
  `lsa.set_binding_by_tag("Hero", [actor], False)` **before** `play()`. With
  `bAllowBindingsFromAsset = False` an overridden spawnable is never spawned, so the stand-in never
  appears beside the real actor. A **possessable** stand-in is a level actor: the override only stops
  the sequence animating it, and it stays rendered where it stands. (jam)
- Tracks on a component binding resolve by component **name** on the actor that fills the binding:
  every actor that can fill a tag needs the same component names. Never let two tags in one
  sequence resolve to the same actor; their tracks fight.

## Tracks, sections, cameras

```python
# camera cut: the camera is in this sequence
cut_track = seq.add_track(unreal.MovieSceneCameraCutTrack)
sec = cut_track.add_section()
sec.set_range(0, 5 * FPS)
sec.set_camera_binding_id(seq.get_binding_id(cam_b))

# lens values on the component (BlueprintSetter properties -> set the property)
cc = cam_actor.get_cine_camera_component()
cc.set_editor_property("current_focal_length", 35.0)
cc.set_editor_property("current_aperture", 2.8)
fs = cc.get_editor_property("focus_settings")                 # struct: read, modify, write back
fs.focus_method = unreal.CameraFocusMethod.MANUAL
fs.manual_focus_distance = 320.0
cc.set_editor_property("focus_settings", fs)
lse.save_default_spawnable_state(cam_b)
```

- Camera-cut sections store a `MovieSceneObjectBindingID`. When the camera lives in a
  sub-sequence use `root.get_portable_binding_id(sequence_that_owns_the_cut_track, cam_proxy)`.
  `create_camera` adds a default cut section that does not span your range: rebuild the cuts.
- CineCamera properties that work: `current_focal_length`, `current_aperture`, `filmback`
  (`sensor_width`, `sensor_height`), `focus_settings` (`focus_method`, `manual_focus_distance`),
  `constrain_aspect_ratio`, `post_process_settings` (set `override_<field>` True **and** the field),
  `post_process_blend_weight`. As keyed property tracks on the camera **component** binding the
  paths are `CurrentFocalLength`, `CurrentAperture`, `FocusSettings.ManualFocusDistance`.
- A property track needs `track.set_property_name_and_path(label, path)` or its keys drive nothing.
- Write struct and array values back with `set_editor_property` (as above). An element read out of
  an array is a copy, and a field written in place on a struct property sends no change
  notification, so the component may not react to it.

### Animation sections

```python
body_b = seq.add_possessable(skeletal_mesh_component)   # or the component child of a spawnable
tr = body_b.add_track(unreal.MovieSceneSkeletalAnimationTrack)
sec = tr.add_section()
sec.set_range(0, 6 * FPS)
p = sec.get_editor_property("params")                  # FMovieSceneSkeletalAnimationParams copy
p.set_editor_property("animation", unreal.load_asset("/Game/Anims/A_Walk"))
rate = unreal.MovieSceneTimeWarpVariant()
rate.set_fixed_play_rate(0.7)                          # read back: p.play_rate.to_fixed_play_rate()
p.set_editor_property("play_rate", rate)
sec.set_editor_property("params", p)
```

- `params.play_rate` is a `MovieSceneTimeWarpVariant`; it has no `.value`.
  5.9 also has `unreal.MovieSceneTimeWarpExtensions.set_section_play_rate(section, rate)` /
  `get_section_play_rate(section)` (class functions, not methods on the section).
- To start a looping clip partway in: `p.first_loop_start_frame_offset = unreal.FrameNumber(ticks)`
  (tick-resolution frames), then write `params` back.
- Easing: `sec.set_ease_in_duration(ticks)` / `set_ease_out_duration(ticks)` set the manual
  override; `get_ease_in_duration()` returns the effective value. Ticks, not display frames.

### Marked frames (changed in 5.9)

5.9 turned a mark into a `[Start, End)` range. `FMovieSceneMarkedFrame::FrameNumber` is
`UE_DEPRECATED(5.9, ...)` and `BlueprintReadOnly`; the position is a `Range` written through
`SetRange`. In 5.8 `FrameNumber` was `BlueprintReadWrite` and there was no range and no
`AddMarkedFrameRangeToSequence`.

```python
U = unreal.MovieSceneTimeUnit.DISPLAY_RATE
i = seq.add_marked_frame_range_to_sequence(unreal.FrameNumber(150), unreal.FrameNumber(150), U, "CUT to B")  # start == end: single mark
j = seq.add_marked_frame_range_to_sequence(unreal.FrameNumber(150), unreal.FrameNumber(210), U, "Hold")
seq.set_marked_frame_color(i, unreal.LinearColor(1, 0.3, 0.1, 1))
seq.set_marked_frame_comment(i, "cut under black")
for m in seq.get_marked_frames_from_sequence(U):
    print(m.label, m.get_start_frame().value, m.get_end_frame().value, m.is_range())
```

- Attribute assignment `m.frame_number = x` raises read-only. The jam's working fallback for a
  single mark: `m = unreal.MovieSceneMarkedFrame(); m.set_editor_property("frame_number", f);
  m.set_editor_property("label", "X"); seq.add_marked_frame_to_sequence(m, U)` (the add migrates the
  legacy frame number). Prefer the range call.
- Comment and colour are set by index (`set_marked_frame_comment`, `set_marked_frame_color`); a
  mark has no `comment` attribute. Indices change when marks re-sort: re-find with
  `seq.find_marked_frame_by_label(label)`.
- `set_marked_frame_in_sequence(index, frame, unit)` is deprecated in 5.9; use
  `set_marked_frame_range(index, start, end, unit)`.

### Audio sections

```python
snd = unreal.load_asset("/Game/Audio/VO_Line_01")
tr = seq.add_track(unreal.MovieSceneAudioTrack)
sec = tr.add_section()
dur = int(round(snd.get_editor_property("duration") * FPS))
sec.set_range(start, min(start + dur, seq.get_playback_end()))
sec.set_sound(snd)
```

- A section that ends after the playback end logs `Sequencer sound playing past section end` and
  the sound is cut by whatever follows the sequence; a section shorter than its sound stops dead.
  Before saving, list audio sections whose end is open or past `seq.get_playback_end()` and fix
  each: trim the section and key the volume channel (from `sec.get_all_channels()`) linearly to 0
  over the last 0.5-1 s.
- Time shots from **measured** take lengths (`duration`), not from a words-per-second estimate:
  recorded lines ran longer and every cut had to be re-timed. (jam)

## Runtime playback and scrubbing

```python
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()   # PIE; None outside PIE
player, lsa = unreal.LevelSequencePlayer.create_level_sequence_player(
    world, seq, unreal.MovieSceneSequencePlaybackSettings())                # out-param -> (player, actor)
lsa.set_binding_by_tag("Hero", [hero_actor], False)                         # before play()
p = unreal.MovieSceneSequencePlaybackParams()
p.frame = unreal.FrameTime(unreal.FrameNumber(140))      # display-rate frame
p.position_type = unreal.MovieScenePositionType.FRAME     # or TIME with p.time (seconds), MARKED_FRAME with p.marked_frame
p.update_method = unreal.UpdatePositionMethod.SCRUB       # or JUMP / PLAY
player.set_playback_position(p)
existing = some_level_sequence_actor.get_editor_property("sequence_player")
```

- Step in from a few frames earlier so cuts and poses evaluate forward, and let the frame settle
  (about 1 s for temporal AA and texture streaming) before capturing.
- Current time in seconds: `t = player.get_current_time()` (a `QualifiedFrameTime`) and
  `r = player.get_frame_rate()`, then `t.time.frame_number.value * r.denominator / r.numerator`.
- **"Not playing" is not "finished".** A flow that ended its beat on the first tick the player was
  not playing cut a 21 s scene at 14 s after a one-frame hitch (web build). End at the sequence end
  time, or after the player has been stopped for well over a second. (jam)
- **Root motion carries characters away from the actor origin.** With the default
  `OnlyTickPoseWhenRendered` the bounds go stale, the mesh stops updating and drops out of the
  shot. On every skeletal mesh component of such actors set `visibility_based_anim_tick_option =
  unreal.VisibilityBasedAnimTickOption.ALWAYS_TICK_POSE_AND_REFRESH_BONES`. (jam)

## Gotchas

- `find_binding_by_name` matches the internal name; match `get_display_name()` instead.
- Visibility tracks drive `bHiddenInGame`: they show in PIE, not in the editor viewport. For
  MetaHumans, visibility tracks and binding overrides, only PIE is the truth.
- Cut cameras under a fade at 1 (black), not mid-picture, when a pose must be right on reveal.
- A call that returns has written keys; it has not made a shot. Capture the start, middle and end of
  each shot and both sides of every cut, then look; read numbers back
  (`sec.get_start_frame()`, `[(k.get_time(U).frame_number.value, k.get_value()) for k in ch.get_keys()]`).
- Camera-cut blending ("Can Blend") is off by default; with it off overlapping cuts and ease
  durations on cut sections do nothing. Epic's in-editor Sequencer camera skill says it cannot be set
  from script; in 5.9 `unreal.MovieSceneTrackExtensions.set_camera_cut_can_blend(track, True)` exists
  and is accepted (the call ran; the resulting blend was not looked at).
- Epic ships in-editor Sequencer guidance as agent skills (`SequencerCoreSkill`,
  `SequencerBindingsSkill`, `SequencerCameraSkill`, `SequencerKeyframingSkill`, ...) in
  `Engine/Plugins/Experimental/Toolsets/AnimationAssistantToolset/Content/Python/animation_toolset/skills/`
  (`sequencer_core.py` and siblings, the `_INSTRUCTIONS` string). Read them for which editor tool
  does what; this skill covers the Python names and the runtime side.

## Verification status

Run in a headless UE 5.9 editor (2026-11, a script without Sequencer open; calls returned and
values read back, no picture was looked at): the *Core workflow* setters, `get_display_rate` /
`get_tick_resolution`, every marked-frame call above including a single-frame mark with
start == end (reads back `is_range() == False`) and the legacy `frame_number` fallback,
`add_possessable`, `get_binding_id`, `get_portable_binding_id`, `resolve_binding_id`,
`proxy.is_valid()`, `proxy.get_id()`, `tag_binding`, the camera-cut section, the CineCamera
property writes, the animation-section `play_rate` round trip, `set_ease_in_duration` /
`set_ease_out_duration`, `add_key` with read-back, and these class-function spellings:
`unreal.MovieSceneSectionExtensions.set_camera_cut_binding(section, binding_proxy, None)`,
`unreal.MovieSceneTrackExtensions.set_camera_cut_can_blend(track, True)`,
`unreal.MovieSceneTimeWarpExtensions.set_section_play_rate(section, rate)`. Reproduced there
from the error table: the `guid`, `comment`, `get_sequence_player`, `set_current_focal_length`,
`get_display_rate` and `get_duration` AttributeErrors, `Cannot find the requested movie scene
binding`, `Cannot nativize 'float' as 'MovieSceneTimeWarpVariant'`, `Failed to find property
'manual_ease_in_duration'` and the read-only `frame_number`. The other rows come from the jam's
logs and the source.

## Unverified

- The `LevelSequenceEditorSubsystem` calls (`create_camera`, `add_spawnable_from_class`,
  `convert_to_custom_binding`, `save_default_spawnable_state`) and runtime playback
  (`create_level_sequence_player`, `set_binding_by_tag`, `set_playback_position`) ran in the jam
  project; in the headless check only their existence was confirmed.
- Whether `sound_volume` set on an audio section takes effect (the jam set it inside a try/except
  and never checked); key the volume channel instead.
- How to persist `AlwaysTickPoseAndRefreshBones` from Python on placed actors; the Blueprint
  component default also holds it.

## References & source material

Engine source (UE 5.9):

- `Engine/Plugins/MovieScene/SequencerScripting/Source/SequencerScripting/Public/ExtensionLibraries/MovieSceneSequenceExtensions.h` — display rate, tick resolution, ranges, bindings, binding IDs, marked frames
- `Engine/Plugins/MovieScene/SequencerScripting/Source/SequencerScripting/Public/ExtensionLibraries/MovieSceneSectionExtensions.h` — `SetRange`, `HasStartFrame`, `SetCameraCutBinding`
- `Engine/Plugins/MovieScene/SequencerScripting/Source/SequencerScripting/Public/ExtensionLibraries/MovieSceneSectionEasingExtensions.h` — ease durations in ticks
- `Engine/Plugins/MovieScene/SequencerScripting/Source/SequencerScripting/Public/ExtensionLibraries/MovieSceneTimeWarpExtensions.h` — `SetFixedPlayRate`, `ToFixedPlayRate`, `SetSectionPlayRate`
- `Engine/Plugins/MovieScene/SequencerScripting/Source/SequencerScripting/Public/ExtensionLibraries/MovieSceneBindingExtensions.h` — `AddTrack`, `GetChildPossessables`, `GetDisplayName`
- `Engine/Plugins/MovieScene/SequencerScripting/Source/SequencerScripting/Public/ExtensionLibraries/MovieSceneBindingTagExtensions.h` — `TagBinding`
- `Engine/Plugins/MovieScene/SequencerScripting/Source/SequencerScripting/Public/ExtensionLibraries/MovieSceneTrackExtensions.h` — `SetCameraCutCanBlend`
- `Engine/Plugins/MovieScene/SequencerScripting/Source/SequencerScripting/Private/KeysAndChannels/MovieSceneScriptingFloat.h` — `AddKey(time, value, subframe, unit, interpolation)`
- `Engine/Plugins/MovieScene/LevelSequenceEditor/Source/LevelSequenceEditor/Public/LevelSequenceEditorSubsystem.h` — spawnables, `CreateCamera`, `ConvertToCustomBinding`, `SaveDefaultSpawnableState`, `OpenLevelSequenceAsync`
- `Engine/Source/Runtime/MovieScene/Public/MovieSceneMarkedFrame.h` — 5.9 range marks, deprecated `FrameNumber`
- `Engine/Source/Runtime/MovieScene/Public/MovieSceneObjectBindingID.h` — `Guid` is not Blueprint-visible
- `Engine/Source/Runtime/MovieScene/Public/MovieSceneSection.h` — `FMovieSceneEasingSettings` members are plain `UPROPERTY()`
- `Engine/Source/Runtime/MovieScene/Public/Variants/MovieSceneTimeWarpVariant.h` — the play-rate variant
- `Engine/Source/Runtime/MovieScene/Public/MovieSceneSequencePlayer.h` — `FMovieSceneSequencePlaybackParams`, `EMovieScenePositionType`, `EUpdatePositionMethod`
- `Engine/Source/Runtime/MovieScene/Public/MovieSceneTimeUnit.h` — `DisplayRate` vs `TickResolution`
- `Engine/Source/Runtime/MovieSceneTracks/Public/Sections/MovieSceneSkeletalAnimationSection.h` — `FMovieSceneSkeletalAnimationParams` (`PlayRate`, offsets)
- `Engine/Source/Runtime/MovieSceneTracks/Public/Sections/MovieSceneCameraCutSection.h` — `SetCameraBindingID`
- `Engine/Source/Runtime/MovieSceneTracks/Public/Sections/MovieSceneAudioSection.h` — `SetSound`, volume channel
- `Engine/Source/Runtime/MovieSceneTracks/Private/Systems/MovieSceneAudioSystem.cpp` — the "playing past section end" warning
- `Engine/Source/Runtime/MovieSceneTracks/Public/Bindings/MovieSceneReplaceableActorBinding.h` — replaceable bindings
- `Engine/Source/Runtime/LevelSequence/Public/LevelSequenceActor.h` — `SequencePlayer` + `BlueprintGetter`, `SetBindingByTag`
- `Engine/Source/Runtime/LevelSequence/Public/LevelSequencePlayer.h` — `CreateLevelSequencePlayer`
- `Engine/Source/Runtime/CinematicCamera/Public/CineCameraComponent.h` — `CurrentFocalLength` / `CurrentAperture` with `BlueprintSetter`
- `Engine/Source/Runtime/Engine/Classes/Sound/SoundBase.h` — `Duration` property
- `Engine/Source/Runtime/Engine/Classes/Components/SkinnedMeshComponent.h` — `EVisibilityBasedAnimTickOption`

Related skills: `ue-sequencer-and-cinematics` (C++ playback, concepts),
`ue-editor-scripting-and-python` (Python wrapper rules), `ue-animation-authoring`.
