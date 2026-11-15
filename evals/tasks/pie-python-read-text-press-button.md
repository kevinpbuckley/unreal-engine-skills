---
skill: ue-pie-python
title: Read a text block and press a button in a running PIE game from editor Python
---

## Prompt

A UE 5.9 project has a title screen Widget Blueprint `/Game/UI/WBP_Title` (added to the
viewport by the game at start) with a `TextBlock` named `Txt_Version` and a `Button` named
`Btn_Start`; `Btn_Start` is bound in C++ as a protected `UPROPERTY(meta = (BindWidget))`
member of the widget's C++ parent class. Pressing it removes the title screen and adds
`/Game/UI/WBP_Hud`. The game also has a `UGameInstanceSubsystem` `UFlowSubsystem` with a
`BlueprintCallable` `GetPhase()` returning an `FName`.

Write the editor Python, to be run through the UE 5.9 `execute_python` tool, that: starts
PIE in a floating 1280x720 window; waits until the title screen is on screen; returns the
version text; presses `Btn_Start`; waits until the HUD is on screen; returns the flow
subsystem's phase; captures the game viewport at 1:1 to a PNG; and stops PIE on every path,
including failures.

## Acceptance criteria

Layer 1 for this task is **runs in UE 5.9 editor Python without error** (through
`execute_python`, against a project with the widgets above) instead of a C++ compile.

- PIE is started with `EditorToolset.EditorAppToolset.StartPIE` (`options` with
  `playMode` `PlayMode_InEditorFloating`), and the window size is set on **both**
  `LevelEditorSubsystem.get_play_settings()` and `LevelEditorPlaySettings.get_default_object()`
  (`new_window_width` / `new_window_height`) before starting.
- Waiting uses `await asyncio.sleep(...)` in a bounded loop (a timeout that is reported),
  never `time.sleep`; all imports are at the top level of the script.
- The PIE world comes from `UnrealEditorSubsystem.get_game_world()` (with a `None` check),
  not from searching worlds by name.
- The live widget is found with `unreal.WidgetLibrary.get_all_widgets_of_class(world, cls,
  False)` on the class loaded from `/Game/UI/WBP_Title.WBP_Title_C`, keeping one that is in
  the viewport or has a parent (removed screens linger).
- The children are reached without `widget_tree`, `get_widget_from_name` or reading the
  protected `BindWidget` member as an attribute: `get_editor_property("<Name>")` with a
  fallback, or a match on `<widget path>.WidgetTree.<Name>` over
  `unreal.ObjectIterator(unreal.Widget)`.
- Text is returned as `str(text_block.get_text())` (no `Text + str`).
- The press is either `on_clicked.broadcast()` **stated as not proving clickability**, or a
  real click through `WidgetFinder.WidgetFinderSubsystem.Query(request=...)` +
  `SlateInspectorToolset.SlateInspectorToolset.Click(ref=...)`, with the result confirmed
  by a state read (the HUD widget appears), not assumed.
- The subsystem is read with `unreal.get_game_instance_subsystem(gi, unreal.FlowSubsystem)`
  where `gi = unreal.GameplayStatics.get_game_instance(world)`; no
  `SubsystemBlueprintLibrary`, no `gi.get_subsystem(...)`. The `FName` is returned as `str`.
- The capture uses `SceneCaptureToolset.SceneCaptureToolset.CaptureGameViewport` with the
  world and `maxResolution=1280`, decodes the base64 PNG to a file and returns the path, not
  the base64.
- `StopPIE` runs in a `finally` (or equivalent) guarded by `IsPIERunning`, and the script
  waits for `get_game_world()` to return `None`.
- The final expression returns the evidence (version text, phase, PNG path), and the script
  does not keep PIE objects across the stop.

## Common baseline failures

`unreal.SubsystemBlueprintLibrary` or `gi.get_subsystem`, `widget.widget_tree` /
`get_widget_from_name`, `unreal.WidgetBlueprintLibrary`, reading `title.btn_start` (protected:
"is protected and cannot be read"), `text + "..."` on an `unreal.Text`, `time.sleep` (rejected
by `execute_python`), imports inside a function, taking the first widget instance (a lingering
removed one), `maxResolution` omitted (a 1024-px image), returning base64, and no `StopPIE` on
the failure path.
