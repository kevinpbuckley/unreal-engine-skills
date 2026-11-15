---
skill: ue-sequencer-python
title: Level Sequence from editor Python with a camera cut, a slowed animation and a mark
---

## Prompt

In an Unreal Engine 5.9 project with the Python Editor Script Plugin enabled, write one editor
Python script that creates `/Game/Eval/LS_EvalCut` (delete it first if it exists) at 30 fps,
10 seconds long, and:

1. adds two spawnable Cine Camera actors, `Cam_A` (35 mm, f/2.8) and `Cam_B` (50 mm), each with a
   static transform key;
2. adds a Camera Cuts track that shows `Cam_A` for 0-4 s and `Cam_B` for 4-10 s;
3. possesses the first `SkeletalMeshActor` found in the open level and plays
   `/Game/Eval/A_Walk` on its skeletal mesh component from 0 to 10 s at **0.7x** play rate;
4. adds a single-frame mark labelled `CUT` at 4 s;
5. saves the asset and returns, as the script's final value, the section ranges, the play rate read
   back from the animation section and the marks read back from the sequence.

## Acceptance criteria

Layer 1 for this task is **"runs in the UE 5.9 editor's Python without an exception"** (paste into
the Output Log's Python console or run with `-ExecCmds="py <file>"`), instead of a C++ compile.
Layer 2 (API truth) is checked against the 5.9 SequencerScripting / LevelSequenceEditor headers.

- Creates the asset with `AssetToolsHelpers.get_asset_tools().create_asset(name, folder,
  unreal.LevelSequence, unreal.LevelSequenceFactoryNew())`.
- Calls `seq.set_display_rate(unreal.FrameRate(30, 1))` **before** any frame arithmetic; uses
  `set_playback_start(0)` / `set_playback_end(300)` (display-rate frames, not seconds).
- Opens the sequence (`LevelSequenceEditorSubsystem.open_level_sequence_async(seq)`) before
  `create_camera` / `add_spawnable_from_class`, and unpacks `create_camera(True)` as
  `(binding_proxy, actor)`.
- Lens values set as properties: `cine_camera_component.set_editor_property("current_focal_length", ...)`
  and `"current_aperture"` (not `set_current_focal_length` / `set_current_aperture`), followed by
  `save_default_spawnable_state(proxy)`, or keyed on the auto-added lens tracks.
- Camera cut sections bound with `section.set_camera_binding_id(seq.get_binding_id(cam_proxy))`
  (or `set_camera_cut_binding`); never a raw Guid, never `binding_id.guid`. Section ranges set with
  `section.set_range(0, 120)` and `set_range(120, 300)`.
- Animation added on the **component** binding (`seq.add_possessable(skeletal_mesh_component)` or a
  child possessable), with a `MovieSceneSkeletalAnimationTrack` section whose `params` struct is read,
  modified and written back (`get_editor_property("params")` ... `set_editor_property("params", p)`).
- Play rate written as a `unreal.MovieSceneTimeWarpVariant` with `set_fixed_play_rate(0.7)` (or
  `MovieSceneTimeWarpExtensions.set_section_play_rate`), and read back with `to_fixed_play_rate()`
  ≈ 0.7. Assigning a float to `play_rate` fails this criterion.
- Mark added with `seq.add_marked_frame_range_to_sequence(unreal.FrameNumber(120),
  unreal.FrameNumber(120), unreal.MovieSceneTimeUnit.DISPLAY_RATE, "CUT")` (or a
  `MovieSceneMarkedFrame` given its frame through `set_editor_property` and added with
  `add_marked_frame_to_sequence(m, DISPLAY_RATE)`); no attribute assignment to `frame_number`, no
  `comment` attribute. Read back with `get_marked_frames_from_sequence(DISPLAY_RATE)` and
  `m.get_start_frame()`.
- Display-rate vs tick units are not mixed: every `add_key` passes `MovieSceneTimeUnit.DISPLAY_RATE`.
- Saves with `EditorAssetLibrary.save_loaded_asset(seq, False)` (or `save_asset(path,
  only_if_is_dirty=False)`).
- The returned values show cut ranges `[0,120)` and `[120,300)`, play rate 0.7, one mark at 120.

## Common baseline failures

`seq.get_movie_scene().get_display_rate()` (AttributeError: the method is on the sequence);
`p.play_rate = 0.7` ("Cannot nativize 'float' as 'MovieSceneTimeWarpVariant'");
`m.frame_number = ...` ("read-only" in 5.9); `lsa.get_sequence_player()` style getter/setter calls
(`set_current_focal_length`); passing a `MovieSceneObjectBindingID`'s `.guid`; frames computed at the
default display rate before it was set; the animation added on the actor binding instead of the
skeletal mesh component; the camera placed by its spawn location while an auto-added transform
section keyed at the origin overrides it.
