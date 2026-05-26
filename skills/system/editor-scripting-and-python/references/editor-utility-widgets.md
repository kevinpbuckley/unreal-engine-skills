# Editor Utility Widgets & Blutility — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the Blutility class hierarchy, how widget
tabs are registered and closed, `UEditorUtilityTask` for background work, scripted actions
(`UAssetActionUtility`, `UEditorUtilityObject`), and the "Call in Editor" button pattern.
Grounded in UE 5.7 source under `Engine/Source/Editor/Blutility/`.

## Blutility class hierarchy

```
UObject
├── UEditorUtilityObject              — editor-only logic, no UI
│   └── UAssetActionUtility           — right-click scripted actions
│   └── UEditorUtilityTask            — async background task
UUserWidget
└── UEditorUtilityWidget              — dockable UMG panel in the editor
UBlueprint
└── UWidgetBlueprint
    └── UEditorUtilityWidgetBlueprint — asset for UEditorUtilityWidget BPs
```

---

## `UEditorUtilityWidget` — dockable editor panels

**Source:** `Engine/Source/Editor/Blutility/Classes/EditorUtilityWidget.h:27`  
**Module:** `Blutility`  
**Base:** `UUserWidget`

An `UEditorUtilityWidget` is a standard UMG widget that the editor can host in a dockable
tab. Create one in the Content Browser (right-click → Editor Utilities → Editor Utility
Widget), author its layout and Blueprint graph like any UMG widget, then open it via
right-click → Run Editor Utility Widget, or programmatically via `UEditorUtilitySubsystem`.

Key members:

| Member | Location | Notes |
|---|---|---|
| `Run()` | :33 | `BlueprintImplementableEvent`; called when auto-run or `bAutoRunDefaultAction` fires |
| `TabDisplayName` | :73 | `UPROPERTY(EditDefaultsOnly, BlueprintReadWrite)` — the panel's tab label |
| `HelpText` | :76 | Shown in the tab's tooltip |
| `FindChildWidgetByName(Name)` | :44 | Find a named widget in this utility's hierarchy |
| `NativeOnInitialized()` | :70 | Override to fire an OnEditorToolStarted event |

**Asset:** `UEditorUtilityWidgetBlueprint` (`:38` of `Classes/EditorUtilityWidgetBlueprint.h`)
is the `.uasset` that generates the widget. It inherits `UWidgetBlueprint` and adds the
tab-spawning plumbing used by `UEditorUtilitySubsystem`.

**Tab lifecycle:**

1. `UEditorUtilitySubsystem::SpawnAndRegisterTab(Blueprint)` registers a tab spawner and
   immediately opens the tab (`:87`).
2. Each tab is identified by a `FName` tab ID. Use `SpawnAndRegisterTabWithId` (`:96`) to
   control the ID from Python or another system.
3. To close: `CloseTabByID(Id)` (`:122`) or simply close the tab in the UI.
4. To check if open: `DoesTabExist(Id)` (`:119`).
5. `UnregisterTabByID(Id)` (`:127`) closes and removes the spawner registration.

```cpp
// C++ — open a widget from a soft object path at startup
void UMyEditorModule::OpenMyTool()
{
    UEditorUtilitySubsystem* EUS = GEditor->GetEditorSubsystem<UEditorUtilitySubsystem>();
    UEditorUtilityWidgetBlueprint* BP = LoadObject<UEditorUtilityWidgetBlueprint>(
        nullptr, TEXT("/Game/Tools/WBP_MyTool.WBP_MyTool"));
    if (BP)
    {
        EUS->SpawnAndRegisterTab(BP);
    }
}
```

---

## `UEditorUtilityObject` — no-UI utilities

**Source:** `Engine/Source/Editor/Blutility/Classes/EditorUtilityObject.h:20`

A plain `UObject` subclass that can be created as a Blueprint and run by the editor. Does
not produce a visible panel. Use for headless automation triggered from the right-click
menu, from Python, or at startup.

`bRunEditorUtilityOnStartup` (`:41`): if `true` in class defaults, the editor runs this
object automatically after asset discovery completes (post-plugin-loading startup phase).

Run programmatically:
```cpp
UEditorUtilitySubsystem* EUS = GEditor->GetEditorSubsystem<UEditorUtilitySubsystem>();
EUS->TryRun(MyUtilityObjectInstance);   // dispatches the Run() event
```

---

## `UAssetActionUtility` — Content Browser scripted actions

**Source:** `Engine/Source/Editor/Blutility/Classes/AssetActionUtility.h:60`  
**Base:** `UEditorUtilityObject`

Any `UFUNCTION(BlueprintCallable)` on an `UAssetActionUtility` Blueprint subclass appears
as a context-menu action in the Content Browser. The functions receive the set of selected
assets automatically via the function parameter convention.

**Setup:**
1. Create a Blueprint with parent class `AssetActionUtility`.
2. In class defaults, populate the `SupportedClasses` array to restrict which asset types
   show the menu entries (e.g. only `StaticMesh`). Leave empty to show for all asset types.
3. Add `BlueprintCallable` functions. Each function's name becomes the menu entry label.

**Deprecation note:** `GetSupportedClass()` (`:69`, deprecated UE 5.2) was the old way to
restrict asset types. Use the `SupportedClasses` array in class defaults instead.

```cpp
// Example: a C++ AssetActionUtility that bulk-validates meshes
UCLASS()
class UMeshValidator : public UAssetActionUtility
{
    GENERATED_BODY()
public:
    // This function appears in the Content Browser right-click menu for StaticMesh assets
    UFUNCTION(BlueprintCallable, Category = "Validation")
    void ValidateMeshLODs();
};
```

---

## `UEditorUtilityTask` — async background work

**Source:** `Engine/Source/Editor/Blutility/Classes/EditorUtilityTask.h:32`  
**Base:** `UObject`  
**Module:** `Blutility`

A `UEditorUtilityTask` is a discrete unit of editor work that `UEditorUtilitySubsystem`
queues and manages. It can show async notification UI and supports parent/child task
hierarchies.

Key methods:

| Method | Line | Notes |
|---|---|---|
| `Run()` | 43 | Called when the task starts (override in Blueprint or C++) |
| `FinishExecutingTask(bSuccess)` | 56 | Call to signal completion; triggers cleanup |
| `SetTaskNotificationText(Text)` | 59 | Update the async notification toast |

Tasks are registered via `UEditorUtilitySubsystem::RegisterAndExecuteTask(Task, Parent)` (`:135`).
Parent tasks can own child tasks; the subsystem tracks the active task stack via `ActiveTaskStack`.

---

## "Call in Editor" button (per-actor functions)

Mark any `UFUNCTION` with `meta = (CallInEditor = "true")` to add a button in the actor
Details panel. Clicking it invokes the function on the selected actor instance.

```cpp
// Works on any AActor or UActorComponent subclass
UFUNCTION(BlueprintCallable, Category = "Debug", meta = (CallInEditor = "true"))
void PrintDebugState();
```

The specifier is defined at `Runtime/CoreUObject/Public/UObject/ObjectMacros.h:1005`.
This does **not** make the function editor-only by itself — also guard with `WITH_EDITOR`
if the body uses editor-only APIs.

---

## Module dependencies

If you add Blutility classes to a C++ editor module, include in your `Build.cs`:

```csharp
PrivateDependencyModuleNames.AddRange(new string[] {
    "Blutility",          // UEditorUtilityWidget, UEditorUtilitySubsystem, etc.
    "UnrealEd",           // UEditorActorSubsystem, UEditorAssetSubsystem
    "LevelEditor",        // ULevelEditorSubsystem
    "UMG",                // UUserWidget base for UEditorUtilityWidget
});
```

The module must have `Type = ModuleType.Editor` in its descriptor to keep editor-only code
out of shipping builds.

---

## Common patterns

**Spawn a widget tab from Python (e.g. from a startup script):**
```python
import unreal

eus = unreal.get_editor_subsystem(unreal.EditorUtilitySubsystem)
widget_bp = unreal.load_asset("/Game/Tools/WBP_MyTool")
eus.spawn_and_register_tab(widget_bp)
```

**Run a no-UI utility from Python:**
```python
import unreal

util_obj = unreal.load_asset("/Game/Tools/BP_BatchProcessor")
eus = unreal.get_editor_subsystem(unreal.EditorUtilitySubsystem)
eus.try_run(util_obj.get_default_object())
```

**Hook PIE events from a widget:**
```python
# From within an Editor Utility Widget's BeginPlay-equivalent
import unreal
eus = unreal.get_editor_subsystem(unreal.EditorUtilitySubsystem)
def on_end_pie(is_simulating):
    unreal.log("PIE ended, refreshing tool state")
eus.on_end_pie.add_callable(on_end_pie)
```
