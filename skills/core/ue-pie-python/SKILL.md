---
name: ue-pie-python
description: >
  Drive and inspect a running Play-In-Editor (PIE) game from editor Python in UE 5.9 -
  the PIE world, game-instance/world/local-player subsystems, GameplayStatics lookups, live
  UMG widgets and their children, reading text, pressing buttons, real Slate clicks with
  the engine's SlateInspector and WidgetFinder toolsets, starting and stopping PIE with
  EditorAppToolset, window size, viewport captures with SceneCaptureToolset, and automation
  tests with AutomationTestToolset. Use for automated playtests, UI checks, in-game
  screenshots and smoke runs, and on these errors - "has no attribute
  'SubsystemBlueprintLibrary'", "'GameInstance' object has no attribute 'get_subsystem'",
  "Failed to find property 'widget_tree'", "has no attribute 'get_widget_from_name'",
  "is protected and cannot be read", "Not supported during PIE", "Cannot get the current
  level while PIE is active", "is not a live Editor, PIE, or Game world", "No test names
  provided", or a PIE that runs at a few frames per second.
metadata:
  engine-version: "5.9"
  category: tooling
  aliases: "PIE, play in editor, playtest, running game, game world, live widget, UMG from Python, click button, press button, read text block, in-game screenshot, smoke test, automation test, execute_python PIE"
---

# Python against a running PIE game

Editor Python can reach into a running Play-In-Editor session: find the game world, read
game state, find the on-screen widgets, read their text, press their buttons, capture the
viewport and run automation tests. Almost every failure is a guessed name: the Python API
exposes only reflected, script-visible members, and the UMG/Slate internals people reach for
first (`widget_tree`, `GetWidgetFromName`, cached geometry, `SubsystemBlueprintLibrary`) are
not among them. In a 48-hour UE 5.9 game-jam project (2026-11) about 40 failed calls came
from exactly this, and agents wrote a PIE driver at least eight times. This skill is the set of
calls that worked, checked against the 5.9 source.

The Python mechanics (name mapping, property access, enums, the `execute_python` tool's
contract) are in `ue-editor-scripting-and-python`; Level Sequence playback and scrubbing in
PIE are in the Sequencer skills.

## When to use this skill

- An automated playtest or smoke run: start PIE, drive the game, assert on state, capture.
- Reading or pressing UI in the running game: menus, HUD text, text entry, buttons.
- Getting a game subsystem, the game mode, the player controller or actors from PIE.
- Screenshots of the running game (with UI) at fixed window sizes.
- Running the project's automation tests from a script.

## Mental model

1. **Two worlds.** The editor world (`get_editor_world()`) and the PIE world
   (`get_game_world()`, `None` when nothing runs). Everything game-side (game instance,
   subsystems, widgets, pawns) lives in the PIE world and dies when PIE stops; wrappers you
   kept become invalid. Fetch them again in every call.
2. **Only reflected API.** A C++ function is callable from Python only if it is a
   `UFUNCTION` that is `BlueprintCallable`/`BlueprintPure` (or `PythonCallable`) and not
   `BlueprintInternalUseOnly`; a property only if it is reflected, script-visible and not
   protected. Drive the game through its own `BlueprintCallable` functions (start with a
   seed, skip the intro) rather than poking internals. When something you need is not
   exposed, add a small `BlueprintCallable` in the game module.
3. **PIE blocks editing.** While PIE runs the editor refuses some edits
   (`CompileWidgetBlueprint: Not supported during PIE`, `Cannot get the current level while
   PIE is active`). Save and compile first; stop PIE, fix, start again.
4. **The game only advances while the editor ticks.** A script that blocks (a `time.sleep`
   in a helper module, a long synchronous loop) freezes PIE. Wait with
   `await asyncio.sleep(...)`, which lets the editor tick.

## 1. Session: start, size, stop

```python
# before PIE: save, so nothing you will want to fix is pending
unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
level = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world().get_path_name()

# window size: set BOTH settings objects (different objects; with one set the window
# reopens at the size it last closed at)
for ps in (unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).get_play_settings(),
           unreal.LevelEditorPlaySettings.get_default_object()):
    ps.set_editor_property("new_window_width", 1280)
    ps.set_editor_property("new_window_height", 720)
    ps.set_editor_property("new_window_position", unreal.IntPoint(100, 100))

await call_tool("EditorToolset.EditorAppToolset.StartPIE",
                options={"playMode": "PlayMode_InEditorFloating", "warmupSeconds": 2})
ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
for _ in range(100):                                   # wait for a player controller
    world = ues.get_game_world()
    if world and unreal.GameplayStatics.get_player_controller(world, 0):
        break
    await asyncio.sleep(0.1)                           # the editor ticks during the await
```

- `StartPIE` (`EditorAppToolset.h`) takes an optional `FPIESessionOptions`: `bSimulate`,
  `PlayMode` (in-viewport by default; out-of-process modes are downgraded to in-viewport),
  `StartTransform`, `WarmupSeconds` (default 2). It errors if a session is active or queued and
  has a 30 s limit. A **floating window** (`PlayMode_InEditorFloating`) has a size you control
  and a title you can find (`"<Project> Preview [NetMode: ...]"`).
- Stop on every path, failures included: `IsPIERunning` first (`StopPIE` errors when nothing
  runs), then `StopPIE`, then wait for `get_game_world()` to return `None`.
- **A backgrounded editor runs PIE at a few frames per second, and a minimized one freezes it
  (world time stays 0).** Timed waits and sequences then go wrong. `t.IdleWhenNotInForeground`
  and `Slate.bAllowThrottling` did not control it in the jam, and
  `unreal.EditorPerformanceSettings` is not in the Python API: keep the editor in the
  foreground and restored while a run needs real time.
- **Console variables outlive PIE.** A cvar set during PIE stays set for the editor session;
  one left at 0 by a capture run made an unrelated automation test fail later. Put back every
  cvar you change. `unreal.SystemLibrary.execute_console_command(world, "DisableAllScreenMessages")`
  keeps shader-compile and lighting warnings out of captures.
- Keep each `execute_python` call under about 50 s; split a run into short phases with state
  in a helper module, or run it as a background task that writes JSON lines a later call
  reads.

## 2. Finding things in the PIE world

```python
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()
gi    = unreal.GameplayStatics.get_game_instance(world)
flow  = unreal.get_game_instance_subsystem(gi, unreal.MyFlowSubsystem)   # 5.9+
ws    = unreal.get_world_subsystem(world, unreal.MyWorldSubsystem)       # 5.9+
gm    = unreal.GameplayStatics.get_game_mode(world)
pc    = unreal.GameplayStatics.get_player_controller(world, 0)
doors = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.MyDoor)
tagged = unreal.GameplayStatics.get_all_actors_with_tag(world, "Suspect")
```

- `USubsystemBlueprintLibrary` is not in Python (all `BlueprintInternalUseOnly`), and
  `gi.get_subsystem(...)`, `unreal.get_game_instance(...)`, `MySubsystem.get()` do not exist.
  The getter must match the subsystem kind, or it raises
  `Cannot nativize 'X' as 'Class' (allowed Class type: 'GameInstanceSubsystem')`.
- `get_local_player_subsystem(local_player, cls)` needs a `LocalPlayer`, and
  `APlayerController::GetLocalPlayer` is C++ only. Iterating
  `unreal.ObjectIterator(unreal.LocalPlayer)` and keeping the one whose outer is your game
  instance is one route (not run); a `BlueprintCallable` getter in the game is the reliable
  one.
- Never search worlds by name: stale `/Memory/UEDPIE_*` worlds linger after a session.
- Out-param functions return their outputs (`get_all_actors_of_class` returns the list).

## 3. Live widgets

```python
cls = unreal.load_class(None, "/Game/UI/WBP_Title.WBP_Title_C")          # the generated class
found = unreal.WidgetLibrary.get_all_widgets_of_class(world, cls, False)  # False: not top-level only
shown = [w for w in found if w.is_in_viewport() or w.get_parent()]
title = shown[-1] if shown else None
```

- The Python name is `unreal.WidgetLibrary` (`UWidgetBlueprintLibrary` has
  `ScriptName="WidgetLibrary"`); `unreal.WidgetBlueprintLibrary` does not exist. Likewise
  `unreal.SlateLibrary`, not `SlateBlueprintLibrary`.
- **Removed screens linger** until garbage collection and still react to presses. Take a
  widget that is in the viewport or has a parent, the last one when several qualify.
- **Child widgets.** A widget that is a Blueprint variable reads with
  `title.get_editor_property("Btn_Start")`. For the rest (not a variable, created by C++ at run
  time, or a C++ `BindWidget` member that is protected: `is protected and cannot be read`),
  iterate objects and match the path; a child's path is `<widget path>.WidgetTree.<Name>`:

  ```python
  def child(widget, name):
      try:
          c = widget.get_editor_property(name)
          if c: return c
      except Exception:
          pass
      prefix = widget.get_path_name() + ".WidgetTree."
      for w in unreal.ObjectIterator(unreal.Widget):
          if w.get_path_name() == prefix + name:
              return w
      return None
  ```
- **These fail; do not try them:** `widget.widget_tree` / `get_editor_property("widget_tree")`
  (`UUserWidget::WidgetTree` has no script-visible specifier), `widget.get_widget_from_name(...)`
  (`GetWidgetFromName` is not a `UFUNCTION`), `unreal.WidgetBlueprintLibrary`. On the
  **asset** side, `WidgetBlueprint` has no Python `widget_tree` or `parent_class` either; a
  design-time widget can be loaded by path:
  `unreal.load_object(None, "/Game/UI/WBP_X.WBP_X:WidgetTree.<Name>")` (not run in the jam).
- **Text:** `str(text_block.get_text())`; `Text + str` is a `TypeError`. A text entry:
  `entry.set_text("110")`.
- **Geometry reads zero from Python.** `widget.get_cached_geometry()` through
  `unreal.SlateLibrary.local_to_absolute` / `get_absolute_size`, and
  `unreal.WidgetLayoutLibrary.get_viewport_widget_geometry(world)`, returned all zeros on two
  days of the jam while the same geometry was real in C++. Take positions from a SlateInspector
  snapshot (section 4). `unreal.WidgetLayoutLibrary.get_viewport_size(world)` did return the
  viewport size.

## 4. Pressing, clicking, typing

Order of preference: press through the game's own flow to move the game along; prove each
interactive screen once with a real Slate click; keys and Enhanced Input actions through the
engine's input toolset.

- **`button.on_clicked.broadcast()` is not a click.** It runs the bound handlers and skips hit
  testing, focus and visibility, so it "clicks" a covered button or one on a removed screen.
  Use it to drive flow; do not take it as proof the player can click.
- **A real click** goes through the engine's 5.9 toolsets (`WidgetFinder` plugin and
  `SlateInspectorToolset`). As it ran in the jam:
  `WidgetFinder.WidgetFinderSubsystem.StartService` → `GetQuerySyntax` (read the grammar once)
  → `Query` with `request={"query": "text(*HOW TO PLAY*)"}` (the argument is `request`, not
  `query`) → take `results[0].ref` → `SlateInspectorToolset.SlateInspectorToolset.Click` with
  `ref=<ref>` → `True`, and the page opened. Text matches exactly unless it globs:
  `text(HOW TO PLAY)` found nothing, `text(*HOW TO PLAY*)` found the label, and clicking the
  label's ref pressed its button. `True` means delivered, not handled: confirm with a capture
  or a state read; on `False` read `LastRefusal`. `StopService` when done.
- **Refs and positions without WidgetFinder:** `Windows(action="list")` returns JSON with each
  window's `ref` and `title` (the PIE window's title contains `Preview`); `Snapshot(ref=<window
  ref>, maxDepth=60)` returns one widget per line with `[ref=...]` and `[pos=x,y size=w,h]` in
  desktop pixels. Collapsed and hidden widgets are left out: a missing line means not visible.
  `PressKey(key="Escape")`, `Type(ref, text, submit)`, `Hover`, `Drag(startRef, endRef)`,
  `ReleaseHeldInput` (after an interrupted `MouseDown`/`KeyDown`) are on the same toolset.
- **Resize a running window:** `Windows(action="resize", ref=<ref>, width=..., height=...)`
  sets the outer size (client plus frame); read the result back with
  `unreal.WidgetLayoutLibrary.get_viewport_size(world)`.
- The editor serves Epic's own guidance for this as in-engine skills (`debug_runtime_ui_bug`
  in `EditorToolset`, `input_simulation` in `SlateInspectorToolset`); list them with
  `ToolsetRegistry.AgentSkillToolset.ListSkills`.

Toolset and parameter details: [references/pie-toolsets.md](references/pie-toolsets.md).

## 5. Writing to live objects and spawning

- **Call setters, not `set_editor_property`, on live game objects.** On a component of a
  Blueprint actor a notified property change re-runs the construction script and replaces the
  components. If you must write a property, pass
  `unreal.PropertyAccessChangeNotifyMode.NEVER` as the third argument.
- **Deferred spawning is not exposed:** `GameplayStatics.BeginDeferredActorSpawnFromClass` /
  `FinishSpawningActor` are `BlueprintInternalUseOnly`. `EditorActorSubsystem.spawn_actor_*`
  places into the editor world, not the PIE world. To spawn into PIE, call a game-side
  `BlueprintCallable` that spawns (it can do the deferred spawn in C++), or have the game
  spawn it. A debug camera you spawn this way: set it as the view target with
  `pc.set_view_target_with_blend(cam, 0.0)`; a light you move must be Movable.

## 6. Captures

- `SceneCaptureToolset.SceneCaptureToolset.CaptureGameViewport(World, MaxResolution)` captures
  the PIE viewport as Slate draws it, UMG included. In a script pass the world object
  (`world=world, maxResolution=1280`); over MCP pass `{"refPath": ...}` of a world from
  `ListWorlds`. A wrong or empty world gives `the given world is not a live Editor, PIE, or
  Game world`. `maxResolution` caps the **longest** edge and defaults to 1024: pass the window
  width for a 1:1 image.
- In a script the result carries the PNG as base64 under `image` → `data`: decode it to a file
  and return the path, never the base64.
- Settle before capturing: about 0.3-0.4 s after a UI change, about 1 s after a camera cut or a
  sequence scrub (temporal AA, texture streaming). Look at every capture you report.

## 7. Logs and assertions

- `ConsoleToolset.LogsToolset.GetLogEntries(logCategory, pattern, maxEntries, logFilePath,
  maxCharsPerEntry)` returns recent log lines. Nothing scopes it to your run: write a marker
  first (`unreal.log("RUN 7f3 start")`) and judge only what follows. `print` lands under
  `LogPython`.
- A step is an assertion only if it compares: return expected and actual. Input + wait +
  screenshot proves nothing by itself; the game's own log lines are good evidence that an
  input arrived.

## 8. Automation tests

Toolset `AutomationTestToolset.AutomationTestToolset` (a bare `AutomationTestToolset` gives
`ToolsetIsNotRegistered`):

1. `DiscoverTests(bForceRediscover=False)` once per editor session (seconds).
2. `ListTests(nameFilter, tagFilter, limit)` → `{tests, total, returned}`; `limit` defaults to
   200, 0 = all. The parameter is `nameFilter`; `filter` is rejected.
3. `RunTests(testNames=[...])` (`No test names provided` = an empty list, usually the wrong
   field of `ListTests`), or `RunTestsByFilter(filterExpression)` with `"StartsWith:MyGame."`,
   `"^MyGame."`, `"Suffix$"`, a bare substring or `"Group:Smoke"`, joined with `+`.
4. The summary has `passed`, `failed`, `skipped`, `total`, `duration`, `tests`; each test has
   `name`, `state` (`"Success"` when it passed), `duration`, `errors`, `warnings`. There is no
   `results` or `returnValue` key inside a script.
5. A run longer than one call: poll `GetTestStatus`, read `GetTestResults`; `StopTests` cancels.

Editor session state leaks into tests (a cvar left behind, assets already loaded): confirm a new
failure in a fresh editor before calling it a regression.

## 9. Full-playthrough smoke runs

- **Fresh PIE world per case**: a reused world carries widgets, timers and subsystem state.
- **Fixed seed, ground truth logged first**, so a failure replays.
- **A win path and a fail path**, asserting the end state and that the ending really played.
- **Bounded waits that record their outcome** (wait for a state with a budget, log a timeout),
  never fixed sleeps.
- Drive most steps through the game's flow API and one case through the real UI. Logic belongs
  in automation tests; the PIE run covers what they cannot: sequences, cameras, UI and audio
  really playing.

## Error → cure

| Error | Cure |
|---|---|
| `module 'unreal' has no attribute 'SubsystemBlueprintLibrary'`, `'GameInstance' object has no attribute 'get_subsystem'` | `unreal.get_game_instance_subsystem(gi, cls)`, `get_world_subsystem(world, cls)` (5.9) |
| `Failed to find property 'widget_tree'`, `has no attribute 'get_widget_from_name'` | `get_editor_property("<VarName>")` or `ObjectIterator(unreal.Widget)` path match (section 3) |
| `module 'unreal' has no attribute 'WidgetBlueprintLibrary'` | `unreal.WidgetLibrary` |
| `Property ... is protected and cannot be read` | The `BindWidget` member is protected: find the child by path, or add a getter |
| `unsupported operand type(s) for +: 'Text' and 'str'` | `str(text)` |
| `CompileWidgetBlueprint: Not supported during PIE`, `Cannot get the current level while PIE is active` | Stop PIE first, or read the level before starting / use the PIE world's path |
| `the given world is not a live Editor, PIE, or Game world` | Pass the PIE world object (or its `refPath` from `ListWorlds`) |
| `was called with unrecognized parameter(s) [filter]` (ListTests) | `nameFilter` |
| `No test names provided` | `testNames` was empty |
| `ToolsetIsNotRegistered` | Use the namespaced name, `<Module>.<Class>` |
| World time stays 0, PIE at a few fps | Editor minimized or in the background |
| `'NoneType' object has no attribute ...` | `get_game_world()` / a lookup returned `None` (PIE not running, wrong class path) |

## Unverified (read in 5.9 source, not run in the jam)

- `unreal.get_local_player_subsystem(local_player, cls)`, and reaching a `LocalPlayer` through
  `ObjectIterator`.
- SlateInspectorToolset `Drag`, `Type`, `HitTest`, `WaitFor` (checks once: poll it),
  `Observe`/`Unobserve`, `Focus`, `Scroll`, `MouseDown`/`MouseMove`/`MouseUp`,
  `ReleaseHeldInput`, `GetUMGInfo`; `Click` ran over MCP only, never inside a script.
- The engine's `InputToolset` `ApplyInput` for keys and Enhanced Input actions; SceneCapture
  viewport recording to MP4; WidgetFinder `WaitForQuery` and `Highlight`.
- `unreal.load_object(None, "/Game/UI/W_X.W_X:WidgetTree.<Name>")` for a design-time widget.

## References & source material

Engine source (UE 5.9):
- `Engine/Source/Editor/UnrealEd/Public/Subsystems/UnrealEditorSubsystem.h` — `GetEditorWorld`,
  `GetGameWorld`.
- `Engine/Source/Editor/LevelEditor/Public/LevelEditorSubsystem.h` — `GetPlaySettings`.
- `Engine/Source/Editor/UnrealEd/Classes/Settings/LevelEditorPlaySettings.h` — `NewWindowWidth`,
  `NewWindowHeight`, `NewWindowPosition`.
- `Engine/Source/Runtime/Engine/Classes/Kismet/GameplayStatics.h` — `GetGameInstance`,
  `GetPlayerController`, `GetGameMode`, `GetAllActorsOfClass`, `GetAllActorsWithTag`;
  `BeginDeferredActorSpawnFromClass` / `FinishSpawningActor` (`BlueprintInternalUseOnly`).
- `Engine/Source/Runtime/Engine/Public/Subsystems/SubsystemBlueprintLibrary.h` — Blueprint-only
  subsystem getters.
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyEngine.cpp`
  — `get_world_subsystem`, `get_game_instance_subsystem`, `get_local_player_subsystem`.
- `Engine/Source/Runtime/UMG/Public/Blueprint/WidgetBlueprintLibrary.h` — `ScriptName="WidgetLibrary"`,
  `GetAllWidgetsOfClass`.
- `Engine/Source/Runtime/UMG/Public/Blueprint/WidgetLayoutLibrary.h` — `GetViewportSize`,
  `GetViewportWidgetGeometry`.
- `Engine/Source/Runtime/UMG/Public/Blueprint/SlateBlueprintLibrary.h` — `ScriptName="SlateLibrary"`.
- `Engine/Source/Runtime/UMG/Public/Blueprint/UserWidget.h` — `WidgetTree` (no script
  specifier), `GetWidgetFromName` (not a `UFUNCTION`).
- `Engine/Plugins/Experimental/Toolsets/EditorToolset/Source/EditorToolset/Private/EditorAppToolset.h`
  — `FPIESessionOptions`, `StartPIE`, `StopPIE`, `IsPIERunning`.
- `Engine/Plugins/Experimental/Toolsets/EditorToolset/Source/EditorToolset/Private/LevelToolset.cpp`
  — `Cannot get the current level while PIE is active`.
- `Engine/Plugins/Experimental/Toolsets/SlateInspectorToolset/Source/SlateInspectorToolset/Public/SlateInspectorToolset.h`
  — `Windows`, `Snapshot`, `Click`, `LastRefusal`, `PressKey`, `Type`, `Drag`, `ReleaseHeldInput`.
- `Engine/Plugins/Experimental/WidgetFinder/Source/WidgetFinder/Public/WFSubsystem.h` —
  `StartService`, `GetQuerySyntax`, `Query(Request)`, `StopService`.
- `Engine/Plugins/Experimental/Toolsets/SceneCaptureToolset/Source/SceneCaptureToolset/Internal/SceneCaptureToolset.h`
  — `CaptureGameViewport(World, MaxResolution = 1024)`.
- `Engine/Plugins/Experimental/Toolsets/AutomationTestToolset/Source/AutomationTestToolset/Public/AutomationTestToolset.h`
  — `DiscoverTests`, `ListTests`, `RunTests`, `RunTestsByFilter`, `GetTestResults`,
  `GetTestStatus`, `StopTests`, result structs.
- `Engine/Plugins/Experimental/Toolsets/ConsoleToolset/Source/ConsoleToolset/Private/LogsToolset.h`
  — `GetLogEntries`.

Deep-dive references in this skill:
- [references/pie-toolsets.md](references/pie-toolsets.md) — tool names, parameters and result
  fields for PIE control, Slate input, WidgetFinder, captures, logs and automation tests, plus a
  minimal driver skeleton.

Related skills: `ue-editor-scripting-and-python` (Python mapping, `execute_python` contract),
`ue-umg-and-slate`, `ue-automation-and-testing`, `ue-subsystems`.
