# Python `unreal` module — C++↔Python mapping reference

Deep dive for [../SKILL.md](../SKILL.md). Covers name translation rules, type coercions (and
where they stop being transparent), the subsystem getters, editor property access and its
errors, editing struct and container values in place, enums, levels and dirty packages,
transactions, progress feedback, logging, commandlet invocation, and how to expose C++ to
Python. Grounded in UE 5.9 source under `Engine/Plugins/Experimental/PythonScriptPlugin/`.
Several corrections below come from about 2,900 editor-Python calls (320 failed) in a 48-hour
UE 5.9 game-jam project (2026-11); for the 5.9 `execute_python` tool that runs scripts from an
agent, see [execute-python-toolset.md](execute-python-toolset.md).

## How the `unreal` module is generated

The Python plugin (`IPythonScriptPlugin`, `Source/PythonScriptPlugin/Public/IPythonScriptPlugin.h:15`)
generates the `unreal` module at editor startup by reflecting everything currently exposed
to Blueprints. It is **not** pre-generated; it automatically includes any class or function
that is `BlueprintCallable`, `BlueprintPure`, `BlueprintAssignable`, `BlueprintReadWrite`,
or `EditAnywhere` in any enabled plugin or project module.

What it **leaves out** (`IsScriptExposedFunction`, `Private/PyGenUtil.cpp`): functions with
`meta = (BlueprintInternalUseOnly = "true")`, `ScriptNoExport`, `CustomThunk`,
`BlueprintGetter`/`BlueprintSetter` accessors, native make/break functions, and plain C++
members that are not `UFUNCTION`s. A class whose every function is skipped is not in the
module at all: `unreal.SubsystemBlueprintLibrary` raises `module 'unreal' has no attribute
'SubsystemBlueprintLibrary'`. Enum entries marked `UMETA(Hidden)` are not exported either
(see *Enums*). Before guessing a name, check what this editor session really has (the 5.9
`search_symbols` / `get_symbol` tools, or `dir(unreal.X)` / `help(unreal.X)`).

The plugin embeds Python 3.11 (`Engine/Binaries/ThirdParty/Python3/Win64/python311.dll` in a
5.9 install). It runs in isolated mode by default — `PYTHONPATH`/`PYTHONHOME` are ignored;
only `UE_PYTHONPATH` is added to `sys.path` regardless of isolation setting.
(`PythonScriptPluginSettings.h:81` `bIsolateInterpreterEnvironment`).

---

## C++ → Python name translation

| C++ | Python | Rule |
|---|---|---|
| `UEditorAssetSubsystem` | `unreal.EditorAssetSubsystem` | Strip `U`/`A`/`F`/`T` prefix |
| `AStaticMeshActor` | `unreal.StaticMeshActor` | Strip `A` prefix |
| `UWidgetBlueprintLibrary` | `unreal.WidgetLibrary` | A `ScriptName` meta on the class wins (`UWidgetBlueprintLibrary` has `ScriptName="WidgetLibrary"`, `USlateBlueprintLibrary` is `unreal.SlateLibrary`) |
| `GetAllLevelActors()` | `.get_all_level_actors()` | `PascalCase` → `snake_case` |
| `ECollisionEnabled::QueryOnly` | `unreal.CollisionEnabled.QUERY_ONLY` | enum: strip `E`, values → `UPPER_SNAKE_CASE` |
| `FVector` | `unreal.Vector` | Strip `F` prefix |
| `TArray<AActor*>` | `unreal.Array` (list-like) | Accepts a Python list on input; a read returns an `unreal.Array`, **not** a `list` |
| `TMap<K,V>` / `TSet<T>` | `unreal.Map` / `unreal.Set` | Accept dict/set on input; reads return the wrapper types |
| `FString` | `str` | Transparent both ways |
| `FName` / `FText` | `unreal.Name` / `unreal.Text` | Accept `str` on input; reads return the wrapper, which is **not** a `str` |

Override the generated Python name with `meta = (ScriptName = "my_name")`
(`ObjectMacros.h:1285`). Several names can be given separated by `;`; the first is the
Python name and the rest are deprecated aliases (`ScriptName="GetNumLods;GetNumLODs"` →
`get_num_lods`).

### Where the coercion is not transparent

- **`Text + str` raises** `unsupported operand type(s) for +: 'Text' and 'str'`. `unreal.Text`
  defines `str()`, comparison and `format()`, but no `+` (`Private/PyWrapperText.cpp`). Convert
  first: `str(text_block.get_text()) + " suffix"`. The same holds for `unreal.Name`.
- **`json.dumps` of a read container raises** `Object of type Array is not JSON serializable`
  (likewise `Map`, `Set`, `Name`, `Text`, structs). Convert: `list(arr)`, `dict(m)`, `str(n)`,
  or `json.dumps(value, default=str)`.
- **Out-parameters change the return shape.** A C++ function with out-params returns them
  (a tuple when there are several, with the C++ return value first when it is not `void`).
  A `bool` function with out-params returns the out value(s) on success and `None` on
  failure, so `a, b = f(...)` raises `cannot unpack non-iterable NoneType` when it fails.
  Read the signature (`help(unreal.X.f)`) and handle both shapes.
- Functions that return objects (`load_asset`, `find_object`, `get_component_by_class`,
  `get_game_world`) return `None` instead of raising. Check before chaining a call on the
  result: `'NoneType' object has no attribute ...` is the second most common failure.

---

## Getting subsystems from Python

`USubsystemBlueprintLibrary` (the Blueprint getter nodes) is **not** in Python: all its
functions are `BlueprintInternalUseOnly`. The `unreal` module has one free function per
subsystem kind instead:

```python
import unreal

# Editor subsystems (editor world, assets, levels)
actor_sub  = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
asset_sub  = unreal.get_editor_subsystem(unreal.EditorAssetSubsystem)
level_sub  = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
util_sub   = unreal.get_editor_subsystem(unreal.EditorUtilitySubsystem)
ue_sub     = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)

# Engine subsystems
eng = unreal.get_engine_subsystem(unreal.MyEngineSubsystem)

# UE 5.9+: subsystems of a PIE or game world, its game instance and local players
world = ue_sub.get_game_world()                                   # None when PIE is not running
gi    = unreal.GameplayStatics.get_game_instance(world)
gis   = unreal.get_game_instance_subsystem(gi, unreal.MyGameInstanceSubsystem)
ws    = unreal.get_world_subsystem(world, unreal.MyWorldSubsystem)
lps   = unreal.get_local_player_subsystem(local_player, unreal.MyLocalPlayerSubsystem)
```

- The getter must match the subsystem's kind; a class of another kind raises
  `Cannot nativize 'X' as 'Class' (allowed Class type: 'GameInstanceSubsystem')`. Each getter
  returns `None` when its owner does not create that subsystem (`ShouldCreateSubsystem`).
- These do **not** exist: `unreal.SubsystemBlueprintLibrary`, `gi.get_subsystem(...)`,
  `unreal.get_game_instance(...)`, `MySubsystem.get()`.
- *Version note:* `get_game_instance_subsystem`, `get_world_subsystem` and
  `get_local_player_subsystem` are new in UE 5.9 (`Private/PyEngine.cpp`); in 5.8 only
  `get_editor_subsystem` and `get_engine_subsystem` exist (`Private/PyEditor.cpp`). The
  game-instance and world getters ran in the 5.9 jam project; the local-player getter was
  read in source, not run.

---

## Reading and setting properties

The Python API exposes properties in two ways depending on how they are marked in C++:

| C++ specifier | Python access | Notes |
|---|---|---|
| `BlueprintReadWrite` / `BlueprintReadOnly` | Direct attribute (`obj.prop`) | No editor callbacks |
| `EditAnywhere` / `VisibleAnywhere` | `get_editor_property` / `set_editor_property` | Triggers pre/post-edit change |
| `protected:` / `private:` C++ members (even with those specifiers) | Neither, unless `meta = (AllowPrivateAccess = "true")` | `Property 'x' ... is protected and cannot be read` |

**Use `set_editor_property` for `EditAnywhere` properties.** Direct attribute assignment
bypasses the pre/post-edit callbacks that keep internal editor state consistent — the same
callbacks fired when the user changes a value in the Details panel. Its optional third
argument is a `unreal.PropertyAccessChangeNotifyMode` (`DEFAULT` = notify only when the value
changed, `NEVER`, `ALWAYS`). On a component of a Blueprint actor a notified change re-runs the
construction script, which replaces the components; pass `NEVER` when you are writing to a
live (for example PIE) object and only want the value.

```python
import unreal

actor = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)\
    .get_actor_reference("PersistentLevel.SM_Chair")

# BlueprintReadWrite → direct is fine
name = actor.actor_label

# EditAnywhere → always use set_editor_property
actor.set_editor_property("hidden_in_game", True)
val = actor.get_editor_property("hidden_in_game")
```

Errors you will meet:

| Error | Meaning and fix |
|---|---|
| `... has no attribute ...`, `Failed to find property ...` | Not reflected, not script-exposed, or a guessed name. A value may be a property, not a getter (`obj.get_editor_property("duration")`, not `obj.get_duration()`). Check `dir()` / `get_symbol`. |
| `Property 'X' for attribute 'x' on 'Y' is protected and cannot be read` | A protected C++ property (common for `BindWidget` members and component pointers). Find a public accessor or a `BlueprintCallable` getter; you cannot reach it from Python. The editor-mode check is in `Private/PyUtil.cpp`. |
| `Cannot set 'x' on a temporary value as the change would be lost` | You assigned a field of a struct you got out of a container or a property, which is a copy. Use the 5.9 editors below, or copy, edit and write the whole value back. |

### Editing struct and container values in place (UE 5.9)

5.9 adds context-manager editors that copy a value, let you edit it, and write it back with
the right notifications when the `with` block exits without raising
(`Private/PyWrapperElementEditor.h`, used by `PyWrapperObject.cpp`, `PyWrapperStruct.cpp`,
`PyWrapperArray.cpp`, `PyWrapperMap.cpp`). Read in the 5.9 source, not run by this skill's
author:

```python
# a struct property of an object
with actor.edit_property("my_settings") as e:      # __enter__ returns the editor itself
    e.value.set_editor_property("radius", 250.0)   # e.value is the copy being edited

# an element of an array property (an array read through get_editor_property)
mats = mesh.get_editor_property("static_materials")
with mats.edit(0) as e:
    e.value.set_editor_property("material_interface", new_mat)
for e in mats.edit_each():                         # one editor per element
    with e:
        e.value.set_editor_property("material_interface", new_mat)
# function forms: obj.modify_property(name, fn), arr.modify(i, fn); maps: m.edit(key)
```

If the value changed underneath the editor before the block exits, the edit is discarded with
a `RuntimeError`.

The portable form, which also works in 5.8, builds a new list and sets it once:

```python
new = []
for m in mesh.get_editor_property("static_materials"):
    m.set_editor_property("material_interface", new_mat)   # m is a copy
    new.append(m)
mesh.set_editor_property("static_materials", new)
```

Unverified (reported by a third-party editor plugin's documentation, not run here):
`arr = obj.get_editor_property(n); arr.append(x); obj.set_editor_property(n, arr)` saves
nothing because the set sees no change. Build a new list, as above.

---

## Enums

- Exposed entries are `UPPER_SNAKE_CASE`: `unreal.MyEnum.MAIN_SET`. A value prints as
  `<MyEnum.MAIN_SET: 3>`; an entry has read-only `.name` and `.value` attributes
  (`Private/PyWrapperEnum.cpp`).
- **Entries marked `UMETA(Hidden)` are not exported** (`IsScriptExposedEnumEntry`,
  `Private/PyGenUtil.cpp`). Typical victims are `None`, `Invalid` and `MAX` sentinels. You
  cannot name them (`type object 'MyEnum' has no attribute 'NONE'`), and **reading a property
  that currently holds one raises** `PythonizeEnumEntry: Cannot pythonize '5' (int64) as
  'MyEnum'` (`Private/PyConversion.cpp`). Catch that error and treat it as the sentinel, or
  expose a `BlueprintCallable` that returns the value as an int.
- Where an enum is expected, an `int` is accepted only when it equals the value of an
  exported entry; a string, or the value of a hidden entry, fails with
  `Cannot nativize 'str' as 'MyEnum'` / `'int'`. Pass the enum member.

---

## Loading levels (UE 5.9 unsaved-changes policy)

```python
les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
les.load_level("/Game/Maps/MyMap")                                          # FAIL policy
les.load_level("/Game/Maps/MyMap", unreal.LevelEditorUnsavedChangesPolicy.DISCARD)
les.load_level("/Game/Maps/MyMap", unreal.LevelEditorUnsavedChangesPolicy.SAVE)
```

- `ULevelEditorSubsystem::LoadLevel(AssetPath, UnsavedChangesPolicy = Fail)` is new in 5.9
  (`Editor/LevelEditor/Public/LevelEditorSubsystem.h:210`, enum `ELevelEditorUnsavedChangesPolicy`
  at :39). With the default `FAIL` it refuses to load and raises a script error naming the
  dirty map packages — including a `/Temp/...` level your own script created, which gave 13
  failed `load_level` calls in the jam (`There are unsaved level changes in /Temp/...`).
  `SAVE` saves (and checks out) first; `DISCARD` loses the changes. Use `DISCARD` only for
  levels you made; never discard someone else's unsaved map. `unreal.UnsavedChangesPolicy`
  does not exist.
- `les.new_level(path)` closes the current level without saving or prompting (5.9, observed
  in the jam). With the path of the level already open it silently keeps that level: use a
  unique `/Temp/<Name>_<ms>` and check `get_editor_world().get_path_name()` afterwards.
- A map loaded as an asset (`load_asset` on a map, a Level Instance) stays resident; a
  later level switch with such a map in memory can fatal the editor ("World Memory Leaks").
  Reported by a third-party plugin's documentation; not reproduced here.

## Dirty packages and saving

- `unreal.Package` has **no** `set_dirty_flag`, `is_dirty` or `mark_package_dirty`.
- **Inspect:** `unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()` and
  `get_dirty_map_packages()` (lists of `Package`; `p.get_name()` gives the path)
  (`Editor/UnrealEd/Public/FileHelpers.h:136-144`).
- **Mark:** call `obj.modify()` before editing an object (it marks its package dirty and
  records it for undo), or use `set_editor_property`, which does the same.
- **Save regardless of the flag:** `unreal.EditorAssetLibrary.save_asset(path,
  only_if_is_dirty=False)` / `save_loaded_asset(obj, False)`, or
  `unreal.get_editor_subsystem(unreal.EditorAssetSubsystem).save_asset(path, False)`.
  A script that edits through a path the editor does not track (for example a data
  controller) may leave the flag unset, and the default `only_if_is_dirty=True` then saves
  nothing, silently.
- **Save everything:** `unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)`
  (maps, content). Look at the dirty lists first in a shared editor: a map someone else left
  dirty is theirs to save or discard.
- Packages that exist only in memory (for example textures a MetaHuman build left behind)
  fail to save; they clear on a level change plus `unreal.SystemLibrary.collect_garbage()`.

---

## Undo/redo — `ScopedEditorTransaction`

Wrap any set of editor mutations in a named transaction to make them a single undo step:

```python
import unreal

assets = [...]
with unreal.ScopedEditorTransaction("Bulk set collision") as txn:
    for asset in assets:
        asset.set_editor_property("collision_complexity", unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
```

Not every operation is undoable (e.g. asset import is not). Transactions containing
non-undoable operations may have partial undo results.

---

## Progress feedback — `ScopedSlowTask`

For operations that process many items, show progress and allow cancellation:

```python
import unreal

items = [...]
with unreal.ScopedSlowTask(len(items), "Processing assets") as slow_task:
    slow_task.make_dialog(True)       # show the dialog immediately
    for item in items:
        if slow_task.should_cancel():
            break
        slow_task.enter_progress_frame(1, f"Processing {item}")
        # ... process item
```

While this dialog is showing, the editor UI is blocked but responds to the Cancel button.
For very large jobs, chunk into smaller batches or use `UEditorUtilityTask` for
non-blocking background execution. Scripts run by an agent through the 5.9 `execute_python`
tool should instead split work across calls (see
[execute-python-toolset.md](execute-python-toolset.md)): while a slow task runs, the
editor's MCP server refuses every tool call.

---

## Logging

Always use the `unreal` logging functions rather than Python `print` for consistency with
the engine output log. Python `print` internally calls `unreal.log`.

```python
unreal.log("Informational message")
unreal.log_warning("Something may be wrong")
unreal.log_error("Fatal script error")
```

---

## Running Python from C++

`IPythonScriptPlugin::ExecPythonCommand(Command)` (`:58`) executes a Python string
synchronously. For richer control use `ExecPythonCommandEx(FPythonCommandEx&)` which
exposes `EPythonCommandExecutionMode` and `EPythonFileExecutionScope`.

```cpp
IPythonScriptPlugin* PyPlugin = IPythonScriptPlugin::Get();
if (PyPlugin && PyPlugin->IsPythonInitialized())
{
    PyPlugin->ExecPythonCommand(TEXT("import unreal; unreal.log('hello from C++')"));
}
```

Execution modes (`PythonScriptTypes.h`):
- `ExecuteFile` — treat input as a file path or multi-statement script
- `ExecuteStatement` — single statement, print result
- `EvaluateStatement` — single expression, return value

File scopes:
- `Private` — isolated locals/globals (safe default)
- `Public` — shares the console global scope (can see previously defined variables)

---

## Commandlet invocation

`UPythonScriptCommandlet` (`PythonScriptCommandlet.h:10`) runs a script headlessly:

```
UnrealEditor-Cmd.exe "Project.uproject" -run=pythonscript -script="path/to/script.py"
# Or inline code:
UnrealEditor-Cmd.exe "Project.uproject" -run=pythonscript -script="import unreal; unreal.log('done')"
```

The commandlet does **not** load a level automatically. If your script needs level content,
call `unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).load_level("/Game/Maps/...")` first.

Full editor startup (loads level, then runs script):
```
UnrealEditor-Cmd.exe "Project.uproject" -ExecutePythonScript="path/to/script.py"
```

`-ExecutePythonScript` queues the editor's exit as soon as the script returns. A script that
needs editor ticks (anything that awaits, waits on async work, or captures) should run with
`-ExecCmds="py <abs path>"` and call `unreal.SystemLibrary.quit_editor()` itself when done.
Give every extra editor its own `-ModelContextProtocolPort=<port>` when the project enables
the 5.9 MCP server, or it fights the open editor for the port.

---

## Startup scripts

Scripts can be registered to run every time the editor loads the project:

- **Project Settings → Plugins → Python → Startup Scripts**
  (`UPythonScriptPluginSettings::StartupScripts`, `PythonScriptPluginSettings.h:67`)
- **`init_unreal.py`** placed in any `Content/Python` folder of the project or an enabled
  plugin — auto-detected and run before startup scripts.
- **Additional paths** for `sys.path`: `AdditionalPaths` setting (`:71`) or the
  `UE_PYTHONPATH` environment variable (always parsed, even in isolation mode).

---

## Exposing C++ static functions as Python methods (`ScriptMethod`)

A static `UBlueprintFunctionLibrary` function taking a struct/object as first argument can
appear in Python as a method on that type:

```cpp
UFUNCTION(BlueprintCallable, meta = (ScriptMethod))
static FVector ScaleUniform(const FVector& V, float Scale);
// Python: my_vec.scale_uniform(2.0)   — method on FVector
```

`ScriptMethodSelfReturn` (`ObjectMacros.h:1726`): for structs, indicates the function
overwrites the calling struct value (equivalent to `UPARAM(ref)` semantics).

`ScriptMethodMutable` (`ObjectMacros.h:1729`): treat the first const-ref argument as
mutable (equivalent to `UPARAM(ref)` for the struct input).

A function you need from Python but that is `BlueprintInternalUseOnly`, protected, or not a
`UFUNCTION` (deferred actor spawning, `UUserWidget::GetWidgetFromName`, `USoundBase::GetDuration`)
is reachable only through your own `BlueprintCallable` wrapper in a project or plugin module.

---

## Type stub generation (IDE autocomplete)

Enable **Developer Mode** in Project Settings → Plugins → Python (per-project) or Editor
Preferences → Python. When enabled, stubs are written to:
```
<ProjectDir>/Intermediate/PythonStub/
```
Point your IDE's Python interpreter to this path for full `unreal.*` autocomplete.
See `PythonScriptPluginSettings.h:91` (`bDeveloperMode`) and the README in
`Engine/Plugins/Experimental/PythonScriptPlugin/SphinxDocs/`.

---

## Key source files

- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Public/IPythonScriptPlugin.h` — `IPythonScriptPlugin`:15, `ExecPythonCommand`:58, `IsPythonInitialized`:40
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Public/PythonScriptTypes.h` — `EPythonCommandExecutionMode`:63, `EPythonFileExecutionScope`:75, `FPythonCommandEx`:99
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PythonScriptCommandlet.h` — `UPythonScriptCommandlet`:10
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PythonScriptPluginSettings.h` — `StartupScripts`:67, `AdditionalPaths`:71, `bIsolateInterpreterEnvironment`:81, `bDeveloperMode`:91
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyEngine.cpp` — `get_world_subsystem`, `get_game_instance_subsystem`, `get_local_player_subsystem` (5.9)
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyEditor.cpp` — `get_engine_subsystem`, `get_editor_subsystem`
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyGenUtil.cpp` — `IsScriptExposedFunction` (what is left out), `IsScriptExposedEnumEntry` (hidden enum entries)
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyConversion.cpp` — `Cannot nativize ...` / `Cannot pythonize ...` messages
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyUtil.cpp` — `is protected and cannot be read`
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyWrapperStruct.cpp` — `Cannot set ... on a temporary value`, `edit_property` / `modify_property` on structs
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyWrapperArray.cpp` — `edit`, `edit_each`, `modify` (5.9)
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyWrapperText.cpp` — `unreal.Text` methods (no `+`)
- `Engine/Source/Editor/LevelEditor/Public/LevelEditorSubsystem.h` — `ELevelEditorUnsavedChangesPolicy`:39, `LoadLevel`:210, `NewLevel`:187
- `Engine/Source/Editor/UnrealEd/Public/FileHelpers.h` — `UEditorLoadingAndSavingUtils::SaveDirtyPackages`:108, `GetDirtyMapPackages`:136, `GetDirtyContentPackages`:144
- `Engine/Source/Runtime/Engine/Public/Subsystems/SubsystemBlueprintLibrary.h` — every getter `BlueprintInternalUseOnly`
- `Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h` — `ScriptName`:1285, `ScriptMethod`:1723, `ScriptMethodSelfReturn`:1726, `ScriptMethodMutable`:1729
- `Engine/Source/Runtime/CoreUObject/Public/UObject/PropertyAccessUtil.h` — `EPropertyAccessChangeNotifyMode`:51
