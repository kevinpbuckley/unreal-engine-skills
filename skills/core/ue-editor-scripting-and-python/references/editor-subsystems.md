# Editor scripting subsystems — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers all `UEditorSubsystem` subclasses used for
editor automation, their key methods, Python equivalents, and how to obtain them in C++ and
Python. Grounded in UE 5.8 source under `Engine/Source/Editor/`.

## Subsystem access pattern

Every editor subsystem is a singleton created by the editor's `GEditor` object. Access them
with the same pattern regardless of which subsystem you need:

```cpp
// C++ — always use GEditor, never construct the subsystem yourself
UEditorActorSubsystem* AS = GEditor->GetEditorSubsystem<UEditorActorSubsystem>();
```

```python
# Python — unreal.get_editor_subsystem is the universal accessor
import unreal
as_ = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
```

All subsystems are `UEditorSubsystem` → `USubsystem` → `UObject`. Their lifetimes are
managed by the editor; never store raw pointers across frames.

---

## `UEditorActorSubsystem`

**Header:** `Engine/Source/Editor/UnrealEd/Public/Subsystems/EditorActorSubsystem.h`  
**Module:** `UnrealEd`

Operates on actors in the **current editor world** (persistent level). Editor-safe
alternatives to `UWorld::SpawnActor` etc. that also notify the editor selection/undo system.

| Method | Line | What it does |
|---|---|---|
| `GetAllLevelActors()` | 168 | All non-pending-kill actors in the editor level |
| `GetSelectedLevelActors()` | 183 | Currently selected actors |
| `SetSelectedLevelActors(Arr)` | 190 | Replace the selection set |
| `ClearActorSelectionSet()` | 194 | Deselect everything |
| `SetActorSelectionState(A, bool)` | 202 | Toggle one actor's selection state |
| `SpawnActorFromObject(Obj, Loc)` | 220 | Place from asset, archetype, or Blueprint |
| `SpawnActorFromClass(Class, Loc)` | 230 | Place from a C++ class or BP class |
| `DestroyActor(Actor)` | 238 | Remove actor and notify editor |
| `DuplicateActor(Actor, World, Offset)` | 113 | Duplicate an actor (editor-notified) |
| `GetActorReference(Path)` | 210 | Find actor by path string (e.g. `"PersistentLevel.MyActor"`) |

**Key delegates** (`BlueprintAssignable`) exposed by this subsystem:
`OnNewActorsDropped`, `OnNewActorsPlaced`, `OnActorLabelChanged`,
`OnDeleteActorsBegin`/`End`, `OnDuplicateActorsBegin`/`End`.

```python
# Python — enumerate and filter actors
import unreal
actor_sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
all_actors = actor_sub.get_all_level_actors()
lights = [a for a in all_actors if isinstance(a, unreal.Light)]
actor_sub.set_selected_level_actors(lights)
```

---

## `UEditorAssetSubsystem`

**Header:** `Engine/Source/Editor/UnrealEd/Public/Subsystems/EditorAssetSubsystem.h`  
**Module:** `UnrealEd`

The preferred replacement for the deprecated `UEditorAssetLibrary`. Covers the full
lifecycle of content-browser assets.

**Asset path formats accepted by all methods:**
- Reference/Text Path: `StaticMesh'/Game/MyFolder/MyAsset.MyAsset'`
- Path Name: `/Game/MyFolder/MyAsset.MyAsset`
- Package Name: `/Game/MyFolder/MyAsset`

| Method | Line | What it does |
|---|---|---|
| `LoadAsset(Path)` | 54 | Load or return already-loaded asset |
| `LoadBlueprintClass(Path)` | 62 | Load Blueprint and return its generated class |
| `DoesAssetExist(Path)` | 87 | Query Asset Registry without loading |
| `FindAssetData(Path)` | 79 | Retrieve `FAssetData` for registry queries |
| `SaveAsset(Path, bOnlyIfDirty)` | 308 | Save one asset |
| `DuplicateAsset(Src, Dst)` | 197 | Duplicate, fixing up references |
| `RenameAsset(Src, Dst)` | 227 | Rename (creates redirector) |
| `DeleteAsset(Path)` | 167 | Delete and remove from registry |
| `FindPackageReferencersForAsset(Path)` | 108 | Soft/hard dependency referencers |

```python
import unreal
eas = unreal.get_editor_subsystem(unreal.EditorAssetSubsystem)

# Load and inspect
mesh = eas.load_asset("/Game/Meshes/SM_Rock")
print(type(mesh))

# Batch rename and save
for path in eas.list_assets("/Game/Old", recursive=True):
    new_path = path.replace("/Old/", "/New/")
    eas.rename_asset(path, new_path)

eas.save_directory("/Game/New", only_if_is_dirty=True)
```

---

## `ULevelEditorSubsystem`

**Header:** `Engine/Source/Editor/LevelEditor/Public/LevelEditorSubsystem.h`  
**Module:** `LevelEditor`

Level file I/O and viewport control. Functions marked `DevelopmentOnly` are stripped from
shipping builds (they are editor-only in intent even within this module).

| Method | Line | What it does |
|---|---|---|
| `NewLevel(Path, bPartitioned)` | 187 | Create and load a blank (or partitioned) level |
| `NewLevelFromTemplate(Path, Tpl)` | 198 | Create level from a template |
| `LoadLevel(Path, UnsavedChangesPolicy)` | 210 | Open another level; with the default policy `Fail` it refuses while a map has unsaved changes (5.9) |
| `SaveCurrentLevel()` | 217 | Save the currently open persistent level |
| `SaveAllDirtyLevels()` | 224 | Save all dirty sublevels |
| `EditorPlaySimulate()` | 86 | Start Simulate mode |
| `EditorRequestBeginPlay()` | 101 | Request PIE start |
| `EditorRequestEndPlay()` | 121 | Request PIE stop |
| `IsInPlayInEditor()` | 124 | True while in PIE |
| `PilotLevelActor(Actor)` | 72 | Lock viewport to actor |
| `EditorSetGameView(bool)` | 95 | Toggle game view in the active viewport |

```python
import unreal
lvl = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
lvl.save_current_level()
# Open a different map then run a validation script
lvl.load_level("/Game/Maps/TestMap")
```

---

## `UAssetEditorSubsystem`

**Header:** `Engine/Source/Editor/UnrealEd/Public/Subsystems/AssetEditorSubsystem.h:112`  
**Module:** `UnrealEd`

Manages open asset editors (Static Mesh Editor, Blueprint Editor, Material Editor, etc.).
Use to programmatically open an asset in its editor, focus an already-open editor, or close
editors for an asset.

Key methods: `OpenEditorForAsset(Asset)`, `CloseAllAssetEditors()`,
`FindEditorForAsset(Asset)`, `OpenEditorForAssets(AssetList)`.

---

## `UUnrealEditorSubsystem`

**Header:** `Engine/Source/Editor/UnrealEd/Public/Subsystems/UnrealEditorSubsystem.h:17`  
**Module:** `UnrealEd`

A small utility subsystem for things that don't belong in the more specific subsystems.

| Method | Line | What it does |
|---|---|---|
| `GetLevelViewportCameraInfo(Loc, Rot)` | 32 | Read the primary viewport camera pose |
| `SetLevelViewportCameraInfo(Loc, Rot)` | 42 | Move the viewport camera |
| `GetEditorWorld()` | 49 | The `UWorld` used by the level editor |
| `GetGameWorld()` | 52 | The PIE `UWorld` (null if not in PIE) |

```python
import unreal
ue_sub = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
success, loc, rot = ue_sub.get_level_viewport_camera_info()
if success:
    print(f"Camera at {loc}")
```

---

## `UEditorUtilitySubsystem`

**Header:** `Engine/Source/Editor/Blutility/Public/EditorUtilitySubsystem.h:47`  
**Module:** `Blutility`

Manages the lifetime of Editor Utility Widget tabs and `UEditorUtilityTask` background tasks.

| Method | Line | What it does |
|---|---|---|
| `TryRun(Asset)` | 76 | Run a `UEditorUtilityObject` (or widget) |
| `SpawnAndRegisterTab(Blueprint)` | 88 | Open a widget tab in the editor |
| `SpawnAndRegisterTabWithId(BP, Id)` | 97 | Open with an explicit tab ID (useful from Python) |
| `CloseTabByID(Id)` | 124 | Close a widget tab by its ID |
| `DoesTabExist(Id)` | 120 | Check if a tab is open |
| `RegisterAndExecuteTask(Task)` | 140 | Queue a `UEditorUtilityTask` |
| `FindUtilityWidgetFromBlueprint(BP)` | 132 | Get the live widget instance |

PIE delegates: `OnBeginPIE`, `OnEndPIE` (`BlueprintAssignable`).

---

## Deprecated subsystem-library pairs (version notes)

| Deprecated (EditorScriptingUtilities plugin) | Replacement |
|---|---|
| `UEditorAssetLibrary` | `UEditorAssetSubsystem` |
| `UEditorLevelLibrary` (deprecated UE 5.0) | `UEditorActorSubsystem`, `ULevelEditorSubsystem` |

The deprecated classes still exist in
`Engine/Plugins/Editor/EditorScriptingUtilities/Source/EditorScriptingUtilities/Public/`
for backwards compatibility, but new code should use the subsystems. Python code that calls
`unreal.EditorAssetLibrary.load_asset(...)` still works but generates deprecation warnings.
