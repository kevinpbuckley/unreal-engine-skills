# `execute_python` (UE 5.9): running editor Python from an agent

Deep dive for [../SKILL.md](../SKILL.md). UE 5.9 ships an AI toolset system: the
`ToolsetRegistry` plugin registers tools (C++ `UFUNCTION`s marked `AICallable`, and Python
toolsets), and the `ModelContextProtocol` plugin serves them over MCP from the running editor.
One of those tools runs arbitrary Python in the editor:
`editor_toolset.toolsets.python_scripting.PythonScriptingTools.execute_python`, defined in
`Engine/Plugins/Experimental/Toolsets/EditorToolset/Content/Python/editor_toolset/toolsets/python_scripting.py`.
This page is the contract of that tool and the failure modes measured over about 2,900 calls
(320 failed) in a 48-hour UE 5.9 game-jam project (2026-11). What the script itself may call
is in [python-api.md](python-api.md).

## 1. The call

The tool's single parameter `script` is an `FCodeBlock` struct
(`Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/CodeBlock.h`:
`Content`, `Language`), so over MCP the arguments are an object, not a string:

```
toolset: editor_toolset.toolsets.python_scripting.PythonScriptingTools
tool:    execute_python
arguments: {"script": {"language": "Python", "content": "<python source>"}}
```

`code=...` gives `unrecognized parameter(s) [code]`; a bare string for `script` gives
`Unable to import JSON value into property script`. The same toolset has `read_me` (the
tool's own usage text, generated from the checks below: read it once per session),
`search_symbols` (`pattern` regex, `max_results`, `match`, `kinds`, `accepts`, `returns`)
and `get_symbol` (`name`). Both lookups read the live editor session, so a symbol they do not
find is not available there.

```python
import json                                   # every import at the top level
world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
pie = await call_tool("EditorToolset.EditorAppToolset.IsPIERunning")
{"level": world.get_path_name(), "pie": pie}  # the final expression is the result
```

## 2. The execution model (from `python_scripting.py`)

- **Fresh namespace per call.** `unreal`, `asyncio` and `call_tool` are injected (and `luf`
  when the editor displays coordinates in Left-Up-Forward mode). A function defined in one call
  is a `NameError` in the next. Imported modules and `sys.path` changes do persist for the
  editor session (Python's module cache), but not across an editor restart.
- **Top-level `await` is allowed**; the script is compiled with
  `PyCF_ALLOW_TOP_LEVEL_AWAIT`. A script with no top-level await runs inside one
  `ScopedEditorTransaction` ("Execute Python script", one undo step); a script that awaits
  runs with no transaction.
- **Rejected before anything runs** (the error names the line): an `import` that is not a
  top-level statement (inside a function, `if`, `try`, `with`); `from x import *`; calls to
  `time.sleep`, `subprocess.run/call/check_call/check_output`, `requests.*`,
  `urllib.request.urlopen/urlretrieve`, `socket.create_connection`, FTP/SMTP clients, and
  `unreal.ToolsetRegistry.execute_tool`. Use `await asyncio.sleep(s)`,
  `await asyncio.create_subprocess_exec(...)` and `await call_tool(...)`. The check reads only
  the submitted text: a helper module can still call `time.sleep`, and then it freezes the
  game thread (and PIE) for the duration.
- **Result:** the value of the final expression: a `str` as it is, anything else as JSON,
  with objects and classes as their paths, structs as JSON objects and enums as names. `print`
  goes to the Output Log under `LogPython`, not to the result (read it back with
  `ConsoleToolset.LogsToolset.GetLogEntries`, `logCategory="LogPython"`). Return small
  evidence; write bulky data to a file and return its path; never return base64.

## 3. `call_tool` inside a script

- `await call_tool("<Toolset>.<Tool>", **arguments)` with the tool's full name as
  `search_symbols` prints it and its own parameter names as keywords. It **returns the value
  directly**; over MCP the same tool's result arrives wrapped (`{"returnValue": ...}`), so code
  ported from MCP output must drop that level.
- **Returned dicts are strict:** reading a field the tool does not declare raises a
  `KeyError` listing the declared fields, even through `.get`. `.get(field, default)` is only
  for declared optional fields. Copy field names from `get_symbol`; they are camelCase with
  surprises (`iD`), never guessed `results` / `returnValue` / `id`.
- **Parameter names are the tool's own:** C++ tools take camelCase (`maxResolution`,
  `nameFilter`, `skillPaths`, `bForceRediscover`); Python-defined tools take snake_case
  (`max_results`). A wrong name is rejected with the list of valid ones. Pass Unreal objects,
  classes, structs and enums as they are; over MCP an object argument is
  `{"refPath": "/Game/Path/Asset.Asset"}`.
- **Toolset names are namespaced**, `<Module>.<Class>` for C++ toolsets
  (`EditorToolset.EditorAppToolset`, `AutomationTestToolset.AutomationTestToolset`,
  `ConsoleToolset.LogsToolset`, `SceneCaptureToolset.SceneCaptureToolset`). A bare class
  name gives `ToolsetIsNotRegistered` / `Toolset ... not found`. Toolset classes also appear
  as `unreal.EditorAppToolset` etc., but their tools are not Python methods: go through
  `call_tool`.

## 4. Slow tasks, timeouts, lost connections

- **`Not run: the Unreal Editor is running a slow task, which blocks editor tools. This call
  made no changes.`** The MCP server refuses every tool while a progress-bar task runs
  (`ModelContextProtocolServer.cpp`); `... modal dialog is open` is the same refusal for a
  dialog. Causes seen: editor start-up (map load, shader compile), a long build, a cook, a big
  import or save, and **your own previous script that timed out and is still running**. Do
  not retry in a loop; probe rarely (one cheap call every 30-60 s). Only a person can close a
  modal dialog, so never cause one.
- **`The operation timed out.`** The client gave up; the script was not cancelled (inferred
  from slow-task refusals that followed timeouts; not proven). Do not resend it: find out
  what it did once the editor answers. Keep **every call under about 50 s**: split work into
  phases with state in a module, and `await asyncio.sleep(0)` once per loop iteration so the
  editor ticks and the run can be interrupted between chunks (the tool's own usage text asks
  for both). For longer jobs: a background task (`asyncio.ensure_future(coro)` held in a
  module-level dict, writing JSON lines that later calls read), or a second headless editor
  (section 7). `EditorAppToolset.StartPIE` has its own 30 s limit.
- **`ECONNREFUSED` / `ECONNRESET`:** the editor is not listening (closed, restarting,
  booting, crashed). A reset in the middle of your call usually means the call killed it:
  check the process, then the newest folder under `Saved/Crashes/` and the log tail, before
  any retry. Known editor-killers in the jam: force-deleting a duplicate of an engine-plugin
  Animation Blueprint; `StateTreeComponent.set_state_tree()` on a Blueprint component
  template; a level switch inside a Slate tick callback; importing a module that calls
  `quit_editor()`.
- Right after an editor start, a correctly spelled **Python** toolset can report
  `Toolset ... not found` for a few seconds: C++ toolsets register first (inferred from one
  occurrence). Wait; do not rename.

## 5. Levels and saving from a script

- `les.load_level(path)` defaults to `LevelEditorUnsavedChangesPolicy.FAIL` and refuses while
  any map is dirty, including a `/Temp/` level you made: pass `.DISCARD` for your own temp
  level, `.SAVE` to save first (details in [python-api.md](python-api.md)).
- `les.new_level(path)` closes the current level without saving or prompting: the way out of
  a temp level, and a way to destroy real unsaved work.
- Save with `unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)` after looking
  at `get_dirty_map_packages()` / `get_dirty_content_packages()`. In a shared editor a map
  someone else dirtied is theirs.
- Do not hold level objects in variables across an `await` or a level change: fetch them
  again.

## 6. Helper modules

```python
import sys, importlib
sys.path.insert(0, r"D:/proj/Tools/editor")   # repeat in every call: sys.path resets with the editor
import my_helpers as H
importlib.reload(H)                            # only after editing the file; resets module state
await H.phase_one(call_tool)                   # call_tool exists only in the script: pass it in
```

- **A module must do nothing at import.** In the jam an agent imported an export script into
  the shared editor to reuse one function; the module ran its whole export at import and called
  `unreal.SystemLibrary.quit_editor()`, closing the editor under every agent using it. Keep
  module level to definitions, and guard the run-and-quit part of a file that is also run with
  `-ExecCmds="py ..."` by `if __name__ == "__main__":`.
- State that must survive between calls lives in a module-level dict (or `builtins`), never in
  script globals.
- The rejection check does not see module code: no `time.sleep`, blocking subprocess or
  network call in a module.

## 7. Sharing the editor; a second, headless editor

- **One agent drives a GUI editor at a time**, by convention (a lock file naming who, what,
  since when). Two drivers stop each other's PIE, switch each other's level, and save
  half-done maps.
- **Never create assets or write `Config/*.ini` while a cook runs.** A cook missed assets
  created mid-cook and failed; an ini written 40 s into a cook produced a package whose shader
  maps did not match.
- **A second, headless editor can write new assets beside the GUI editor.** Tested once:
  `UnrealEditor.exe <Project>.uproject -ExecCmds="py <abs script>" -unattended -nullrhi
  -nosplash -ModelContextProtocolPort=<free port>` with the GUI editor open on the same project;
  the script duplicated an animation to a NEW path, saved it with
  `save_asset(dst, only_if_is_dirty=False)`, wrote a JSON report and called
  `unreal.SystemLibrary.quit_editor()`. Not tested: saving over a package the GUI editor has
  loaded (its in-memory copy would win at its next save), two writers on one package, the GUI
  editor noticing the new asset, anything that needs a GPU under `-nullrhi`. Give every extra
  editor its own `-ModelContextProtocolPort` (`ModelContextProtocolSettings.cpp` parses it), or
  it competes for the GUI editor's port. Prefer `-ExecCmds="py ..."` over
  `-ExecutePythonScript` when the script needs editor ticks: the latter queues the exit as soon
  as the script returns.
- Building C++ in a second checkout while an editor with Live Coding runs: pass
  `-NoHotReloadFromIDE` to `Build.bat`, or it stops with "Unable to build while Live Coding is
  active".

## 8. Error → cause

| Error | Cause |
|---|---|
| `unrecognized parameter(s) [code]`, `Unable to import JSON value into property script` | `script` must be `{"language": "Python", "content": ...}` |
| `imports must be at the top level of the script` | An import inside a function, `if`, `try` or `with` |
| `'time.sleep(...)' blocks for the full duration` | Use `await asyncio.sleep(...)` |
| `name 'f' is not defined`, `No module named 'x'` | Fresh namespace per call; `sys.path` reset after an editor restart |
| `Not run: the Unreal Editor is running a slow task` | Wait; your own timed-out script may still be running |
| `The operation timed out.` | Client-side limit; the script keeps running. Split the work |
| `KeyError` listing fields | Reading an undeclared field of a `call_tool` result |
| `ToolsetIsNotRegistered`, `Toolset ... not found` | Bare toolset name, or Python toolsets not registered yet |
| `There are unsaved level changes in /Temp/...` | `load_level` default policy `FAIL` |
| `'NoneType' object has no attribute ...` | A lookup (`load_asset`, `find_object`, `get_game_world`) returned `None` |

## Not verified

- That a timed-out script keeps running, and that Python toolsets register after the C++
  ones: inferred from the jam's logs, not proven.
- The headless second editor beyond the single tested case above.

## Source

- `Engine/Plugins/Experimental/Toolsets/EditorToolset/Content/Python/editor_toolset/toolsets/python_scripting.py`
  — `PythonScriptingTools` (`read_me`, `execute_python`, `search_symbols`, `get_symbol`),
  `_BLOCKING_CALLS`, `_compile_repl`, `_execute`.
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/CodeBlock.h`
  — `FCodeBlock`, `ECodeBlockLanguage`.
- `Engine/Plugins/Experimental/ModelContextProtocol/Source/ModelContextProtocol/Private/ModelContextProtocolServer.cpp`
  — slow-task and modal-dialog refusals.
- `Engine/Plugins/Experimental/ModelContextProtocol/Source/ModelContextProtocol/Private/ModelContextProtocolSettings.cpp`
  — `-ModelContextProtocolPort=`.
- `Engine/Source/Editor/LevelEditor/Public/LevelEditorSubsystem.h` — `LoadLevel` and
  `ELevelEditorUnsavedChangesPolicy`.
