# UE 5.9 toolsets for driving PIE: names, parameters, results

Deep dive for [../SKILL.md](../SKILL.md). Every tool here is an engine `UFUNCTION` marked
`AICallable` or `AIRuntimeCallable` (or a `PythonCallable` subsystem function) in UE 5.9,
served by the `ToolsetRegistry` plugin. From an `execute_python` script call them as
`await call_tool("<Toolset>.<Tool>", **kwargs)`; over MCP pass the toolset and tool names
separately. C++ parameter `MaxResolution` becomes the keyword `maxResolution`; a `b` prefix
stays (`bForceRediscover`). Objects go in as Unreal objects in a script and as
`{"refPath": "<path>"}` over MCP. Signatures were read in the 5.9 headers; the "ran" column
says what a 48-hour UE 5.9 game-jam project (2026-11) actually called.

## PIE control — `EditorToolset.EditorAppToolset`

Header: `Engine/Plugins/Experimental/Toolsets/EditorToolset/Source/EditorToolset/Private/EditorAppToolset.h`

| Tool | Parameters | Notes | Ran |
|---|---|---|---|
| `StartPIE` | `options` (optional `FPIESessionOptions`: `bSimulate`, `playMode` e.g. `"PlayMode_InEditorFloating"`, `startTransform`, `warmupSeconds` = 2) | Async; 30 s limit; errors if a session is active or queued; out-of-process play modes are downgraded to in-viewport | yes |
| `StopPIE` | — | Async; errors when no session is active | yes |
| `IsPIERunning` | — | `True` also during online login before world creation; a queued start alone is `False` | yes |

`EditorToolset.LevelToolset.GetCurrentLevel` raises `Cannot get the current level while PIE is
active` (`LevelToolset.cpp`); read the level before starting, or use the PIE world's path.

## Slate input — `SlateInspectorToolset.SlateInspectorToolset`

Header: `Engine/Plugins/Experimental/Toolsets/SlateInspectorToolset/Source/SlateInspectorToolset/Public/SlateInspectorToolset.h`

| Tool | Parameters (keyword names) | Returns | Ran |
|---|---|---|---|
| `Windows` | `action` (`"list"`, `"select"`, `"close"`, `"resize"`, `"maximize"`), `index`, `width`, `height`, `ref` | JSON string (`list`: `{index, ref, title, ...}` per window) | list, resize |
| `Snapshot` | `ref` (window ref), `maxDepth` = 30, `bIncludeSourceLocations` | text, one widget per line with `[ref=...]` and `[pos=x,y size=w,h]` (desktop pixels); collapsed/hidden widgets omitted | yes |
| `Click` | `ref`, `params` (`button` = `"left"`, `bDoubleClick`, `modifiers`, `position` normalized) | `bool` delivered | over MCP |
| `LastRefusal` | — | why the last input was refused | — |
| `PressKey` | `key` (e.g. `"Escape"`), `userIndex`, `repeatCount` | `bool` | yes |
| `Type` | `ref`, `text`, `submit` | `bool` | no |
| `Drag` | `startRef`, `endRef`, params | `bool` | no |
| `ReleaseHeldInput` | — | number released; call after an interrupted `MouseDown` / `KeyDown` | no |

`Windows(action="resize")` takes the outer window size (client area plus frame). The composite
tools (`Click`, `PressKey`, `Type`, `Drag`) leave nothing held; prefer them to the
`MouseDown`/`MouseUp` primitives.

## Finding widgets by text or type — `WidgetFinder.WidgetFinderSubsystem`

Header: `Engine/Plugins/Experimental/WidgetFinder/Source/WidgetFinder/Public/WFSubsystem.h`
(`PythonCallable`, `AIRuntimeCallable`).

1. `StartService()` — scans the widget tree; nothing is stored while the service is stopped.
2. `GetQuerySyntax()` — the query grammar; read it once.
3. `Query(request={"query": "text(*HOW TO PLAY*)"})` — the parameter is `request`. Results
   carry a `ref` (`"q_1"`) that SlateInspector tools accept. Text terms match exactly unless
   they glob with `*`.
4. `StopService()` when done; `GetServiceStatus()` to check.

## Captures — `SceneCaptureToolset.SceneCaptureToolset`

Header: `Engine/Plugins/Experimental/Toolsets/SceneCaptureToolset/Source/SceneCaptureToolset/Internal/SceneCaptureToolset.h`

- `CaptureGameViewport(world=None, maxResolution=1024)` — the PIE/game viewport as Slate draws
  it, UI included; 8-bit PNG; `maxResolution` caps the longest edge. Result (`FSceneCaptureResult`):
  `image` (base64 PNG under `data`), `width`, `height`, `metadata`, `warnings`. Raises when no
  readable game framebuffer exists. Ran in the jam.
- `ListWorlds` — world refs for over-MCP calls.
- `Capture(world, camera, mode, options)` — renders a camera view off screen (no UI, no
  temporal history); not used for PIE in the jam.

Decode in a script:

```python
import base64
r = await call_tool("SceneCaptureToolset.SceneCaptureToolset.CaptureGameViewport",
                    world=world, maxResolution=1280)
with open(r"C:/tmp/shot_01.png", "wb") as f:
    f.write(base64.b64decode(r["image"]["data"]))
r"C:/tmp/shot_01.png"
```

## Logs — `ConsoleToolset.LogsToolset`

Header: `Engine/Plugins/Experimental/Toolsets/ConsoleToolset/Source/ConsoleToolset/Private/LogsToolset.h`

`GetLogEntries(logCategory="", pattern="", maxEntries=1000, logFilePath="", maxCharsPerEntry=2000)`
returns a list of lines from the end of the log. Always pass a category or a regex pattern,
and a marker you logged first.

## Automation tests — `AutomationTestToolset.AutomationTestToolset`

Header: `Engine/Plugins/Experimental/Toolsets/AutomationTestToolset/Source/AutomationTestToolset/Public/AutomationTestToolset.h`

| Tool | Parameters | Returns |
|---|---|---|
| `DiscoverTests` | `bForceRediscover` = False | async `bool`; required once before the others |
| `ListTests` | `nameFilter`, `tagFilter`, `limit` = 200 (0 = all) | `{tests, total, returned}` |
| `RunTests` | `testNames` (full paths from `ListTests`) | async run summary |
| `RunTestsByFilter` | `filterExpression` (`StartsWith:X`, `^X`, `X$`, substring, `Group:Name`, joined by `+`) | async run summary |
| `GetTestResults` | — | run summary of the current or last run |
| `GetTestStatus` | — | controller status snapshot |
| `StopTests` | — | `bool` |

Run summary (`FAutomationTestRunResults`): `tests[]` (`name`, `state` — `"Success"` when it
passed —, `duration`, `errors[]`, `warnings[]`), `passed`, `failed`, `skipped`, `total`,
`duration`.

## Minimal driver skeleton

The pattern the jam converged on: a helper module on `sys.path` that does nothing at import,
holds state in a module-level dict, and exposes short coroutines, one per `execute_python`
call. Written for this page from the jam's working helpers; not run in this exact form.

```python
# pie_min.py — import from execute_python; never call time.sleep here
import asyncio, unreal

STATE = {}

def game_world():
    return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world()

async def start(call_tool, w=1280, h=720):
    for ps in (unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).get_play_settings(),
               unreal.LevelEditorPlaySettings.get_default_object()):
        ps.set_editor_property("new_window_width", w)
        ps.set_editor_property("new_window_height", h)
    await call_tool("EditorToolset.EditorAppToolset.StartPIE",
                    options={"playMode": "PlayMode_InEditorFloating", "warmupSeconds": 2})
    return await wait_until(lambda: game_world() and
                            unreal.GameplayStatics.get_player_controller(game_world(), 0), 10)

async def stop(call_tool):
    if await call_tool("EditorToolset.EditorAppToolset.IsPIERunning"):
        await call_tool("EditorToolset.EditorAppToolset.StopPIE")
    await wait_until(lambda: game_world() is None, 10)

async def wait_until(pred, timeout):
    t = 0.0
    while t < timeout:
        v = pred()
        if v:
            return v
        await asyncio.sleep(0.1)
        t += 0.1
    return None

def shown(class_path):
    cls = unreal.load_class(None, class_path)
    ws = unreal.WidgetLibrary.get_all_widgets_of_class(game_world(), cls, False)
    ws = [w for w in ws if w.is_in_viewport() or w.get_parent()]
    return ws[-1] if ws else None

def child(widget, name):
    try:
        c = widget.get_editor_property(name)
        if c:
            return c
    except Exception:
        pass
    want = widget.get_path_name() + ".WidgetTree." + name
    return next((w for w in unreal.ObjectIterator(unreal.Widget) if w.get_path_name() == want), None)

def text(widget, name):
    c = child(widget, name)
    return str(c.get_text()) if c else None

def press(widget, name):            # drives flow; NOT proof that a player can click it
    c = child(widget, name)
    if c:
        c.on_clicked.broadcast()
    return bool(c)
```

```python
# one execute_python call
import sys
sys.path.insert(0, r"D:/proj/Tools/pie")
import pie_min as P
await P.start(call_tool)
title = P.shown("/Game/UI/WBP_Title.WBP_Title_C")
before = P.text(title, "Txt_Version")
P.press(title, "Btn_Start")
await asyncio.sleep(0.5)
{"version": before, "hud": P.shown("/Game/UI/WBP_Hud.WBP_Hud_C") is not None}
```
