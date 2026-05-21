---
name: editor-scripting-and-python
description: Automate and extend the Unreal Editor — Python scripting (the unreal module, startup
  scripts, commandlets), Editor Utility Widgets/Blueprints (Blutility), the editor scripting
  libraries (EditorAssetLibrary, EditorActorSubsystem), and editor subsystems. Use when batch-
  processing assets, building custom editor tools/automation, running headless content jobs, or
  scripting repetitive editor tasks. Editor-only — not for shipping/runtime gameplay.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Editor scripting & Python

This is about extending the **editor** and automating content/pipeline work — not runtime gameplay.
Everything here is editor-only: it lives in editor modules / behind `WITH_EDITOR` and is stripped
from packaged games.

## When to use this skill

- Batch operations on assets (rename, set properties, reimport, generate).
- Custom in-editor tools and one-click utilities.
- Headless content jobs (commandlets) in CI / build pipelines.
- Automating repetitive editor steps.

## Options (pick by need)

| Approach | Use for |
|---|---|
| **Python** (PythonScriptPlugin) | quick automation, batch asset ops, pipeline glue, CI jobs |
| **Editor Utility Widget/Blueprint** (Blutility) | artist/designer-facing tool UIs inside the editor |
| **C++ editor module / subsystem** | robust, reusable tools; menu/toolbar extensions |
| **Commandlet** | headless batch processing run from the command line |

## Python

Enable the **Python Editor Script Plugin**. Scripts use the `unreal` module:
```python
import unreal
# Batch: set a property on all selected static meshes
for asset in unreal.EditorUtilityLibrary.get_selected_assets():
    if isinstance(asset, unreal.StaticMesh):
        unreal.EditorAssetLibrary.save_loaded_asset(asset)
```
Run from the editor Python console, a startup script (Project Settings → Python), or headless via a
commandlet (`UnrealEditor-Cmd.exe <Project> -run=pythonscript -script="..."`). Great for pipeline
automation and CI. Python is editor/tooling-only.

## Editor Utility Widgets/Blueprints (Blutility)

- `UEditorUtilityWidget` — a UMG widget that runs **in the editor** as a dockable tool (buttons that
  call editor functions). `UEditorUtilityObject` — a runnable Blutility without UI.
- Build artist/designer tools (validators, batch setup, scene fixers) without a C++ tool module.

## Editor scripting libraries (C++ & Python)

- `UEditorAssetLibrary` — asset operations (load/save/duplicate/delete/rename, list by path).
- `UEditorActorSubsystem` — spawn/select/transform actors in the current level.
- `UEditorLevelLibrary` / asset registry (`asset-management`) for level/asset queries.
These are callable from both C++ and Python — the same automation surface.

## C++ editor tools & subsystems

For durable tools, write an **editor module** (Type `Editor`, `module-and-build-system`) and
use a `UEditorSubsystem` (`subsystems`) plus Slate/menu extensions to add toolbar/menu
entries. Keep this code out of runtime modules.

## Commandlets (headless)

Subclass `UCommandlet` (or run the Python commandlet) to process content without opening the full
editor — asset cooking checks, bulk reimports, validation in CI.

## Gotchas

- **Editor-only code in a runtime module** → packaging failures; use an `Editor` module / `WITH_EDITOR`.
- **Assuming Python ships** — it doesn't; it's an editor/tooling tool, not a runtime scripting language.
- **Batch ops without saving** — call save (`EditorAssetLibrary.save_*`) or changes are lost.
- **Long editor scripts on the game thread** can stall the editor; chunk big jobs.
- **Hardcoding asset paths** — discover via the asset registry instead.

## References & source material

Engine source (UE 5.7):
- `Editor/Blutility/Classes/EditorUtilityWidget.h`, `EditorUtilityObject.h` — Blutility.
- `Plugins/Editor/EditorScriptingUtilities/Source/EditorScriptingUtilities/Public/EditorAssetLibrary.h`.
- `Editor/UnrealEd/Public/Subsystems/EditorActorSubsystem.h` — actor editor ops.
- `Plugins/Experimental/PythonScriptPlugin/PythonScriptPlugin.uplugin` — Python plugin.

Official docs (UE 5.7): Setting Up Your Production Pipeline —
<https://dev.epicgames.com/documentation/unreal-engine/setting-up-your-production-pipeline-in-unreal-engine>

Related: `subsystems`, `plugins-and-modules`, `asset-management`.
