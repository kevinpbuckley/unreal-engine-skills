---
name: editor-scripting-and-python
description: >
  Automate and extend the Unreal Editor using Python (the `unreal` module, startup scripts,
  commandlets), Editor Utility Widgets/Blueprints (Blutility — UEditorUtilityWidget,
  UEditorUtilityObject, UEditorUtilityWidgetBlueprint, UAssetActionUtility), the editor
  scripting subsystems (UEditorActorSubsystem, UEditorAssetSubsystem, ULevelEditorSubsystem,
  UAssetEditorSubsystem, UEditorUtilitySubsystem), and how C++ UFUNCTION specifiers
  (BlueprintCallable, CallInEditor, ScriptMethod, ScriptName) control which APIs surface in
  Python and Blueprints. Use when batch-processing assets, building in-editor tools or
  dockable UMG panels, running headless Python commandlets in CI, scripting repetitive
  editor tasks, or exposing custom C++ editor APIs to Python/Blueprints. Editor-only —
  never used in packaged games.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Editor scripting & Python

Everything in this skill is **editor-only**: it lives in editor modules or behind
`WITH_EDITOR` and is stripped from packaged games. The two main paths are: the
**Python Script Plugin** (`unreal` module) for quick automation and pipeline scripts, and
**Blutility** (Editor Utility Widgets/Blueprints) for in-editor UI tools callable by
artists and designers.

## When to use this skill

- Batch operations on assets — rename, set properties, reimport, generate LODs.
- Custom in-editor UMG panels (Editor Utility Widgets) for artists.
- Context-menu scripted actions triggered from the Content Browser or Level.
- Headless commandlet runs in CI without the full editor UI.
- Exposing a C++ function so it appears in Python/Blueprints with the correct name.
- Obtaining a reference to an editor subsystem from C++ or Python.

## Approach comparison

| Approach | When to choose |
|---|---|
| **Python** (PythonScriptPlugin) | Pipeline automation, batch asset ops, CI jobs, quick scripts |
| **Editor Utility Widget** (Blutility) | Artist-facing tool panels with UMG UI in the editor |
| **Editor Utility Blueprint** | No-UI scripted actions on assets or actors |
| **C++ editor module + UEditorSubsystem** | Robust reusable tools, Slate/menu extensions |
| **Commandlet** | Headless batch processing, `-run=pythonscript` in CI |

---

## Python (`unreal` module)

Enable the **Python Editor Script Plugin** (Plugins > Scripting). The plugin bundles
Python 3.11.8; no separate install is needed. The `unreal` module is generated at startup
from whatever is reflected to Blueprints — any `BlueprintCallable` function or class
exposed by any enabled plugin is automatically available.

**Naming convention:** C++ class `UEditorAssetSubsystem` → Python class
`unreal.EditorAssetSubsystem`. Function `GetAllLevelActors()` → `get_all_level_actors()`.
Enum values become `UPPER_SNAKE_CASE`. The `U`/`A`/`F`/`T` prefix is dropped.

**Reading/setting properties:**
```python
import unreal

actor = unreal.EditorActorSubsystem().get_actor_reference("PersistentLevel.MyActor")
# BlueprintReadWrite → direct attribute access
val = actor.some_property
# EditAnywhere → use get/set_editor_property for pre/post-edit notifications
actor.set_editor_property("hidden_in_game", True)
```

**Transactions (undo/redo support):**
```python
with unreal.ScopedEditorTransaction("Batch rename"):
    for asset in assets:
        subsystem.rename_asset(asset.get_path_name(), new_path)
```

**Progress feedback for long jobs:**
```python
with unreal.ScopedSlowTask(len(assets), "Processing...") as task:
    task.make_dialog(True)
    for asset in assets:
        if task.should_cancel():
            break
        task.enter_progress_frame(1, f"Processing {asset.get_name()}")
        # ... do work
```

**Startup scripts** — add paths under Project Settings → Plugins → Python → Startup
Scripts (stored in `UPythonScriptPluginSettings::StartupScripts`,
`Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PythonScriptPluginSettings.h:67`).
Auto-detected `init_unreal.py` in any `Content/Python` folder also runs on startup.

**Commandlet (headless):** `UPythonScriptCommandlet` runs a script without the full UI:
```
UnrealEditor-Cmd.exe MyProject.uproject -run=pythonscript -script="my_script.py"
```
Source: `Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PythonScriptCommandlet.h:10`.

See [references/python-api.md](references/python-api.md) for the C++↔Python mapping,
`get_editor_subsystem`, type coercion, logging, and subsystem access patterns.

---

## Editor Utility Widgets & Blueprints (Blutility)

Blutility classes live in `Editor/Blutility/`. The module is `Blutility`; add it to your
editor module's `PrivateDependencyModuleNames`.

### Key classes

| Class | Base | Purpose |
|---|---|---|
| `UEditorUtilityWidget` | `UUserWidget` | Dockable UMG panel running in the editor |
| `UEditorUtilityWidgetBlueprint` | `UWidgetBlueprint` | Asset that generates `UEditorUtilityWidget` |
| `UEditorUtilityObject` | `UObject` | Editor-only utility with no UI; runs on demand |
| `UAssetActionUtility` | `UEditorUtilityObject` | Right-click scripted actions in the Content Browser |
| `UEditorUtilityTask` | `UObject` | Background task managed by `UEditorUtilitySubsystem` |

**`UEditorUtilityWidget`** (`Editor/Blutility/Classes/EditorUtilityWidget.h:27`):
inherits `UUserWidget`; runs entirely in editor. `Run()` is a `BlueprintImplementableEvent`
called when the widget is auto-run. Use `TabDisplayName` to set the panel name.

**`UEditorUtilityObject`** (`Editor/Blutility/Classes/EditorUtilityObject.h:20`):
pure-logic utility, no UI. Set `bRunEditorUtilityOnStartup = true` to auto-run after
asset discovery.

**`UAssetActionUtility`** (`Editor/Blutility/Classes/AssetActionUtility.h:60`):
any `UFUNCTION(BlueprintCallable)` on a subclass appears as a right-click option in the
Content Browser. Populate `SupportedClasses` (class defaults) to filter which asset types
show the action. `GetSupportedClass()` is deprecated since UE 5.2.

**`UEditorUtilitySubsystem`** manages widget tabs and utility tasks
(`Editor/Blutility/Public/EditorUtilitySubsystem.h:46`):
```cpp
// Open an Editor Utility Widget tab from C++:
UEditorUtilitySubsystem* EUS = GEditor->GetEditorSubsystem<UEditorUtilitySubsystem>();
EUS->SpawnAndRegisterTab(MyWidgetBlueprint);  // line 87
// From Python:
// eus = unreal.get_editor_subsystem(unreal.EditorUtilitySubsystem)
// eus.spawn_and_register_tab(widget_bp)
```

See [references/editor-utility-widgets.md](references/editor-utility-widgets.md) for
Widget setup, tab lifecycle, `UEditorUtilityTask`, and scripted-actions detail.

---

## Editor scripting subsystems

All subsystems inherit `UEditorSubsystem`. Access them via
`GEditor->GetEditorSubsystem<T>()` in C++ or `unreal.get_editor_subsystem(T)` in Python.

### `UEditorActorSubsystem` (`Editor/UnrealEd/Public/Subsystems/EditorActorSubsystem.h:49`)

Actor-level operations in the current level editor world:

```cpp
UEditorActorSubsystem* AS = GEditor->GetEditorSubsystem<UEditorActorSubsystem>();
TArray<AActor*> All   = AS->GetAllLevelActors();       // :166
TArray<AActor*> Sel   = AS->GetSelectedLevelActors();  // :181
AActor* Placed = AS->SpawnActorFromClass(MyClass, Location); // :228
AS->DestroyActor(ActorToRemove);                       // :236
```

Python: `unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()`

### `UEditorAssetSubsystem` (`Editor/UnrealEd/Public/Subsystems/EditorAssetSubsystem.h:38`)

Content-browser asset operations (the preferred replacement for `UEditorAssetLibrary`):

```cpp
UEditorAssetSubsystem* EAS = GEditor->GetEditorSubsystem<UEditorAssetSubsystem>();
UObject* Loaded = EAS->LoadAsset("/Game/MyFolder/MyAsset"); // :54
EAS->SaveAsset("/Game/MyFolder/MyAsset");                   // :296
EAS->DuplicateAsset("/Game/Src", "/Game/Dst");              // :185
EAS->RenameAsset("/Game/Src", "/Game/Dst");                 // :215
EAS->DeleteAsset("/Game/MyFolder/MyAsset");                 // :155
```

### `ULevelEditorSubsystem` (`Editor/LevelEditor/Public/LevelEditorSubsystem.h:38`)

Level-file and viewport operations:

```cpp
ULevelEditorSubsystem* LS = GEditor->GetEditorSubsystem<ULevelEditorSubsystem>();
LS->NewLevel("/Game/Maps/MyLevel");        // :106
LS->LoadLevel("/Game/Maps/Existing");      // :126
LS->SaveCurrentLevel();                    // :133
LS->EditorRequestBeginPlay();              // :78
```

### `UAssetEditorSubsystem` (`Editor/UnrealEd/Public/Subsystems/AssetEditorSubsystem.h:105`)

Open assets in their specialized asset editors programmatically.

### `UUnrealEditorSubsystem` (`Editor/UnrealEd/Public/Subsystems/UnrealEditorSubsystem.h:15`)

Viewport camera query/set (`GetLevelViewportCameraInfo`, `SetLevelViewportCameraInfo`)
and `GetEditorWorld()`.

See [references/editor-subsystems.md](references/editor-subsystems.md) for all subsystem
methods and Python equivalents.

---

## Exposing C++ to editor scripting

### `UFUNCTION(BlueprintCallable)` — surfaces to both Blueprints and Python

Any `BlueprintCallable` function on a `UCLASS` is reflected to Python automatically. In
Python the class name loses its prefix and the function name becomes `snake_case`.

### `UFUNCTION(meta = (CallInEditor = "true"))` — Details panel button

Marks a function to appear as a button in the actor Details panel when an instance is
selected in the editor. Works on `AActor` and `UActorComponent` subclasses.
Source: `Runtime/CoreUObject/Public/UObject/ObjectMacros.h:1005`.

```cpp
UFUNCTION(BlueprintCallable, Category = "Validation", meta = (CallInEditor = "true"))
void ValidateSetup();
```

### `meta = (ScriptMethod)` — hoist a static function as an instance method in Python

A static `BlueprintFunctionLibrary` function that takes a struct or object as its first
parameter can be re-surfaced in Python as a method on that type:

```cpp
UFUNCTION(BlueprintCallable, meta = (ScriptMethod))
static FVector ScaleVector(const FVector& V, float Factor);
// Python: v.scale_vector(2.0)  instead of  unreal.MyLib.scale_vector(v, 2.0)
```

Source: `Runtime/CoreUObject/Public/UObject/ObjectMacros.h:1671`. Related specifiers:
`ScriptMethodSelfReturn` (:1674), `ScriptMethodMutable` (:1677).

### `meta = (ScriptName = "PythonName")` — override the Python/scripting name

```cpp
UFUNCTION(BlueprintCallable, meta = (ScriptName = "load_texture"))
static UTexture* LoadTexture_Internal(const FString& Path);
// Python: unreal.MyLib.load_texture(path)
```

Source: `Runtime/CoreUObject/Public/UObject/ObjectMacros.h:1243`.

---

## Version notes

- **`UEditorAssetLibrary` / `UEditorLevelLibrary`** (EditorScriptingUtilities plugin) were
  deprecated in UE 5.0. `UEditorLevelLibrary` functions carry
  `UE_DEPRECATED(5.0, "... Use the function in Editor Actor Utilities Subsystem")`.
  Prefer `UEditorAssetSubsystem` and `UEditorActorSubsystem` in all new code.
- `UAssetActionUtility::GetSupportedClass()` deprecated UE 5.2; use the `SupportedClasses`
  array in class defaults instead.
- Python 3.11.8 is the embedded version for UE 5.7 (VFX Reference Platform CY2024).
  Set `UE_PYTHON_DIR` to embed a different CPython build (requires source rebuild).

## Gotchas

- **Editor-only code in a runtime module** → packaging failure. Put editor code behind
  `WITH_EDITOR` or in a module with type `Editor`.
- **Python does not ship with the game** — it is a tooling/editor-only plugin.
- **Direct attribute set vs `set_editor_property`** — direct set bypasses pre/post-edit
  callbacks; `set_editor_property` triggers them (same as changing in Details panel). Use
  `set_editor_property` for `EditAnywhere` properties.
- **Long Python jobs block the editor UI** — wrap with `unreal.ScopedSlowTask` and yield
  `enter_progress_frame` to keep the editor responsive and allow cancellation.
- **Forgetting to save** — call `EAS->SaveAsset()` or the Python equivalent; unsaved
  changes to assets are lost when the editor closes.
- **Hardcoding asset paths** — use the Asset Registry to discover paths dynamically; see
  `asset-management`.
- **`SpawnActorFromClass` vs `SpawnActor`** — `SpawnActorFromClass` on
  `UEditorActorSubsystem` places into the editor world and notifies the editor; use it
  instead of `UWorld::SpawnActor` for editor-placed actors.

## References & source material

Engine source (UE 5.7):

**Blutility** (`Engine/Source/Editor/Blutility/`):
- `Classes/EditorUtilityWidget.h` — `UEditorUtilityWidget`:27, `Run()`:33, `TabDisplayName`:73
- `Classes/EditorUtilityObject.h` — `UEditorUtilityObject`:20, `bRunEditorUtilityOnStartup`:41
- `Classes/AssetActionUtility.h` — `UAssetActionUtility`:60, `SupportedClasses`, deprecated `GetSupportedClass()`:69
- `Classes/EditorUtilityTask.h` — `UEditorUtilityTask`:32, `FinishExecutingTask()`:56
- `Public/EditorUtilitySubsystem.h` — `UEditorUtilitySubsystem`:46, `SpawnAndRegisterTab`:87, `RegisterAndExecuteTask`:135, `TryRun`:75

**Editor subsystems** (`Engine/Source/Editor/UnrealEd/Public/Subsystems/`):
- `EditorActorSubsystem.h` — `UEditorActorSubsystem`:49, `GetAllLevelActors`:166, `SpawnActorFromClass`:228, `DestroyActor`:236
- `EditorAssetSubsystem.h` — `UEditorAssetSubsystem`:38, `LoadAsset`:54, `SaveAsset`:296, `DuplicateAsset`:185, `RenameAsset`:215, `DeleteAsset`:155
- `AssetEditorSubsystem.h` — `UAssetEditorSubsystem`:105
- `UnrealEditorSubsystem.h` — `UUnrealEditorSubsystem`:15, `GetLevelViewportCameraInfo`:30

**Level editor** (`Engine/Source/Editor/LevelEditor/Public/`):
- `LevelEditorSubsystem.h` — `ULevelEditorSubsystem`:38, `NewLevel`:106, `LoadLevel`:126, `SaveCurrentLevel`:133, `EditorRequestBeginPlay`:78

**Python plugin** (`Engine/Plugins/Experimental/PythonScriptPlugin/`):
- `Source/PythonScriptPlugin/Public/IPythonScriptPlugin.h` — `IPythonScriptPlugin`:11, `ExecPythonCommand`:49
- `Source/PythonScriptPlugin/Private/PythonScriptCommandlet.h` — `UPythonScriptCommandlet`:10
- `Source/PythonScriptPlugin/Private/PythonScriptPluginSettings.h` — `StartupScripts`:67, `AdditionalPaths`:70

**Reflection/meta specifiers** (`Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h`):
- `CallInEditor`:1005, `ScriptName`:1243, `ScriptMethod`:1671, `ScriptMethodSelfReturn`:1674, `ScriptMethodMutable`:1677

**Deprecated (EditorScriptingUtilities plugin, prefer subsystems)**:
- `Engine/Plugins/Editor/EditorScriptingUtilities/Source/EditorScriptingUtilities/Public/EditorAssetLibrary.h`
- `Engine/Plugins/Editor/EditorScriptingUtilities/Source/EditorScriptingUtilities/Public/EditorLevelLibrary.h` (deprecated UE 5.0)

Official docs (UE 5.7):
- Scripting and Automating the Unreal Editor — <https://dev.epicgames.com/documentation/unreal-engine/scripting-and-automating-the-unreal-editor>
- Scripting the Unreal Editor Using Python — <https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-python>
- Scripting the Unreal Editor Using Blueprints — <https://dev.epicgames.com/documentation/unreal-engine/scripting-the-unreal-editor-using-blueprints>
- Python API Reference — <https://dev.epicgames.com/documentation/unreal-engine/PythonAPI>

Deep-dive references in this skill:
- [references/editor-subsystems.md](references/editor-subsystems.md) — all subsystem classes,
  their methods, and Python equivalents.
- [references/editor-utility-widgets.md](references/editor-utility-widgets.md) — Blutility
  class hierarchy, tab lifecycle, `UEditorUtilityTask`, scripted actions.
- [references/python-api.md](references/python-api.md) — C++↔Python naming rules, type
  mapping, `get_editor_subsystem`, transactions, logging, commandlet invocation.

Related skills: `subsystems`, `plugins-and-modules`, `asset-management`.
