# Python `unreal` module — C++↔Python mapping reference

Deep dive for [../SKILL.md](../SKILL.md). Covers name translation rules, type coercions,
`get_editor_subsystem`, editor property access, transactions, progress feedback, logging,
commandlet invocation, and how to expose C++ to Python. Grounded in UE 5.7 source under
`Engine/Plugins/Experimental/PythonScriptPlugin/`.

## How the `unreal` module is generated

The Python plugin (`IPythonScriptPlugin`, `Source/PythonScriptPlugin/Public/IPythonScriptPlugin.h:11`)
generates the `unreal` module at editor startup by reflecting everything currently exposed
to Blueprints. It is **not** pre-generated; it automatically includes any class or function
that is `BlueprintCallable`, `BlueprintPure`, `BlueprintAssignable`, `BlueprintReadWrite`,
or `EditAnywhere` in any enabled plugin or project module.

The plugin embeds Python 3.11.8 (UE 5.7, aligned with VFX Reference Platform CY2024).
It runs in isolated mode by default — `PYTHONPATH`/`PYTHONHOME` are ignored; only
`UE_PYTHONPATH` is added to `sys.path` regardless of isolation setting.
(`PythonScriptPluginSettings.h:81` `bIsolateInterpreterEnvironment`).

---

## C++ → Python name translation

| C++ | Python | Rule |
|---|---|---|
| `UEditorAssetSubsystem` | `unreal.EditorAssetSubsystem` | Strip `U`/`A`/`F`/`T` prefix |
| `AStaticMeshActor` | `unreal.StaticMeshActor` | Strip `A` prefix |
| `GetAllLevelActors()` | `.get_all_level_actors()` | `PascalCase` → `snake_case` |
| `ECollisionEnabled::QueryOnly` | `unreal.CollisionEnabled.QUERY_ONLY` | enum: strip `E`, values → `UPPER_SNAKE_CASE` |
| `FVector` | `unreal.Vector` | Strip `F` prefix |
| `TArray<AActor*>` | Python list (transparent) | Auto-converted to/from `unreal.Array` |
| `TMap<K,V>` | Python dict (transparent) | Auto-converted |
| `FString` / `FName` / `FText` | `str` | Transparent bidirectional |

Override the generated Python name with `meta = (ScriptName = "my_name")`
(`ObjectMacros.h:1243`).

---

## Accessing editor subsystems from Python

```python
import unreal

# Universal pattern — always use get_editor_subsystem
actor_sub  = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
asset_sub  = unreal.get_editor_subsystem(unreal.EditorAssetSubsystem)
level_sub  = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
util_sub   = unreal.get_editor_subsystem(unreal.EditorUtilitySubsystem)
ue_sub     = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
```

---

## Reading and setting properties

The Python API exposes properties in two ways depending on how they are marked in C++:

| C++ specifier | Python access | Notes |
|---|---|---|
| `BlueprintReadWrite` / `BlueprintReadOnly` | Direct attribute (`obj.prop`) | No editor callbacks |
| `EditAnywhere` / `VisibleAnywhere` | `get_editor_property` / `set_editor_property` | Triggers pre/post-edit change |

**Use `set_editor_property` for `EditAnywhere` properties.** Direct attribute assignment
bypasses the pre/post-edit callbacks that keep internal editor state consistent — the same
callbacks fired when the user changes a value in the Details panel.

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
non-blocking background execution.

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

`IPythonScriptPlugin::ExecPythonCommand(Command)` (`:49`) executes a Python string
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

---

## Startup scripts

Scripts can be registered to run every time the editor loads the project:

- **Project Settings → Plugins → Python → Startup Scripts**
  (`UPythonScriptPluginSettings::StartupScripts`, `PythonScriptPluginSettings.h:67`)
- **`init_unreal.py`** placed in any `Content/Python` folder of the project or an enabled
  plugin — auto-detected and run before startup scripts.
- **Additional paths** for `sys.path`: `AdditionalPaths` setting (`:70`) or the
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

`ScriptMethodSelfReturn` (`ObjectMacros.h:1674`): for structs, indicates the function
overwrites the calling struct value (equivalent to `UPARAM(ref)` semantics).

`ScriptMethodMutable` (`ObjectMacros.h:1677`): treat the first const-ref argument as
mutable (equivalent to `UPARAM(ref)` for the struct input).

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

- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Public/IPythonScriptPlugin.h` — `IPythonScriptPlugin`:11, `ExecPythonCommand`:49, `IsPythonInitialized`:36
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Public/PythonScriptTypes.h` — `EPythonCommandExecutionMode`:36, `EPythonFileExecutionScope`:47, `FPythonCommandEx`:72
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PythonScriptCommandlet.h` — `UPythonScriptCommandlet`:10
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PythonScriptPluginSettings.h` — `StartupScripts`:67, `AdditionalPaths`:70, `bIsolateInterpreterEnvironment`:81, `bDeveloperMode`:91
- `Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h` — `ScriptName`:1243, `ScriptMethod`:1671, `ScriptMethodSelfReturn`:1674, `ScriptMethodMutable`:1677
