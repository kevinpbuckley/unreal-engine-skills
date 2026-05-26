# Plugin Structure & Modules Reference

Deep-dive for [../SKILL.md](../SKILL.md). Covers plugin folder conventions, multi-module
layout patterns, the runtime/editor module split, content plugins, and the `IModuleInterface`
lifecycle inside a plugin. Grounded in UE 5.7
(`Runtime/Projects/Public/PluginDescriptor.h`, `ModuleDescriptor.h`,
`Runtime/Core/Public/Modules/ModuleInterface.h`).

## Canonical folder layout

UBT and the engine discover plugins by scanning for `.uplugin` files. Once found, the engine
treats the directory containing the `.uplugin` as the plugin root. Nested plugins (a plugin
inside another plugin's `Plugins/` subdirectory) are not supported — the scanner stops
descending into a directory once a `.uplugin` is found.

Recommended layout for a plugin with runtime and editor modules and content:

```
Plugins/MyFeature/
├── MyFeature.uplugin
├── Source/
│   ├── MyFeature/                   # runtime module
│   │   ├── MyFeature.Build.cs
│   │   ├── Public/
│   │   │   └── MyFeatureSubsystem.h
│   │   └── Private/
│   │       ├── MyFeatureSubsystem.cpp
│   │       └── MyFeatureModule.cpp  # IMPLEMENT_MODULE lives here
│   └── MyFeatureEditor/             # editor-only module
│       ├── MyFeatureEditor.Build.cs
│       └── Private/
│           ├── MyFeatureEditorModule.cpp
│           └── MyFeatureDetailCustomization.cpp
├── Content/
│   └── Materials/
│       └── M_Default.uasset         # referenced as /MyFeature/Materials/M_Default
├── Config/
│   └── DefaultMyFeature.ini        # loaded automatically by the config system
└── Resources/
    └── Icon128.png                  # 128×128 px, shown in Plugin Browser
```

The `Binaries/` and `Intermediate/` directories are generated at build time; do not commit
them. The engine mounts `Content/` as a virtual package root `/MyFeature/`.

## Single-module plugin (runtime only)

The simplest code plugin: one `Runtime` module, no editor code, no content.

`.uplugin`:
```json
{
  "FileVersion": 3,
  "FriendlyName": "Simple Runtime Plugin",
  "Version": 1,
  "VersionName": "1.0",
  "EnabledByDefault": true,
  "CanContainContent": false,
  "Modules": [
    { "Name": "SimplePlugin", "Type": "Runtime", "LoadingPhase": "Default" }
  ]
}
```

`Source/SimplePlugin/SimplePlugin.Build.cs`:
```csharp
using UnrealBuildTool;

public class SimplePlugin : ModuleRules
{
    public SimplePlugin(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
    }
}
```

`Source/SimplePlugin/Private/SimplePluginModule.cpp`:
```cpp
#include "Modules/ModuleManager.h"
IMPLEMENT_MODULE(FDefaultModuleImpl, SimplePlugin)
```

`FDefaultModuleImpl` (empty `IModuleInterface`) is appropriate when the module only needs
to expose headers and compiled symbols without any startup/shutdown logic.

## Runtime + editor module split

A common pattern: a `Runtime` module holds gameplay types and logic; an `Editor` module
registers detail customizations, asset type actions, and editor commands. The editor module
depends on the runtime module but not vice versa.

`MyFeatureEditor.Build.cs`:
```csharp
using UnrealBuildTool;

public class MyFeatureEditor : ModuleRules
{
    public MyFeatureEditor(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Core", "CoreUObject", "Engine", "UnrealEd", "PropertyEditor",
            "MyFeature"   // depends on the runtime plugin module
        });
    }
}
```

`MyFeatureEditorModule.cpp`:
```cpp
#include "Modules/ModuleManager.h"
#include "PropertyEditorModule.h"
#include "MyFeatureDetailCustomization.h"

class FMyFeatureEditorModule : public IModuleInterface
{
public:
    virtual void StartupModule() override
    {
        FPropertyEditorModule& PropModule =
            FModuleManager::LoadModuleChecked<FPropertyEditorModule>("PropertyEditor");
        PropModule.RegisterCustomClassLayout(
            UMyFeatureComponent::StaticClass()->GetFName(),
            FOnGetDetailCustomizationInstance::CreateStatic(
                &FMyFeatureDetailCustomization::MakeInstance));
    }

    virtual void ShutdownModule() override
    {
        if (FModuleManager::Get().IsModuleLoaded("PropertyEditor"))
        {
            FPropertyEditorModule& PropModule =
                FModuleManager::GetModuleChecked<FPropertyEditorModule>("PropertyEditor");
            PropModule.UnregisterCustomClassLayout(
                UMyFeatureComponent::StaticClass()->GetFName());
        }
    }
};

IMPLEMENT_MODULE(FMyFeatureEditorModule, MyFeatureEditor)
```

Rules:
- Use `FModuleManager::LoadModuleChecked<T>` in `StartupModule` to declare ordering and
  ensure the dependency is loaded before you use it.
- In `ShutdownModule`, use `IsModuleLoaded` then `GetModuleChecked` (not `LoadModuleChecked`)
  — the dependency may have unloaded before your module.
- Editor modules must never be included in Runtime/Server/Client targets. Guard any shared
  header with `#if WITH_EDITOR` so packaging doesn't pull in editor symbols.

## Content-only plugin

A content-only plugin has no `Source/` directory and no `Modules` in the descriptor. The
engine mounts its `Content/` folder automatically when the plugin is enabled.

`.uplugin`:
```json
{
  "FileVersion": 3,
  "FriendlyName": "Shared Art Assets",
  "Version": 1,
  "VersionName": "1.0",
  "EnabledByDefault": true,
  "CanContainContent": true
}
```

When enabled, `/SharedArtAssets/` appears as a root content path. Assets are referenced and
cooked normally. Useful for shipping art packs or shared material libraries as drop-in plugins.

## Plugin with Blueprint-only functionality

A plugin that exposes Blueprint nodes without a full `Runtime` module can use `UncookedOnly`
type. These nodes exist in the editor and uncooked game builds but are excluded from packaged
games (the packager cooks all data references so the nodes are no longer needed at runtime):

```json
"Modules": [
  { "Name": "MyFeatureBPNodes", "Type": "UncookedOnly", "LoadingPhase": "Default" }
]
```

This pattern keeps Blueprint-facing factory nodes out of runtime binaries. The Niagara plugin
uses this for `NiagaraBlueprintNodes` (see `Niagara.uplugin`).

## IModuleInterface lifecycle in a plugin module

The lifecycle of a plugin module follows the same `IModuleInterface` contract as any other
module (`Runtime/Core/Public/Modules/ModuleInterface.h`):

| Hook | Line | When called |
|---|---|---|
| `StartupModule()` | 31 | Module DLL loaded and module object constructed |
| `ShutdownModule()` | 55 | Module about to be destroyed (reverse startup order) |
| `SupportsDynamicReloading()` | 64 | Return `false` to prevent hot-reload of this module |
| `PostLoadCallback()` | 45 | After a hot-reload of this module |

Plugin modules are loaded per the `LoadingPhase` in their `.uplugin` descriptor. The order
within the same phase is not guaranteed between modules from different plugins. Use
`FModuleManager::Get().LoadModuleChecked(TEXT("Name"))` in `StartupModule` to enforce
explicit ordering between modules.

## Module naming and the `_API` macro

Each module gets a `<MODULENAME>_API` macro from UBT. For a module named `MyFeature`, the
macro is `MYFEATURE_API`. Apply it to any class or function that another module accesses:

```cpp
// Public/MyFeatureSubsystem.h
class MYFEATURE_API UMyFeatureSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()
    // ...
};
```

Without `MYFEATURE_API`, the symbol won't export from the DLL in modular builds, and any
dependent module will get an "unresolved external symbol" link error.

## Adding a new module to a plugin (checklist)

1. Create `Source/<NewModule>/` with `Public/` and `Private/` subdirectories.
2. Write `<NewModule>.Build.cs` inheriting `ModuleRules`; add necessary dependencies.
3. Write `Private/<NewModule>Module.cpp` with `IMPLEMENT_MODULE(FDefaultModuleImpl, <NewModule>)`.
4. Add a `Modules` entry to the `.uplugin` with the correct `Type` and `LoadingPhase`.
5. If another module in the plugin depends on the new one, add it to that module's
   `PrivateDependencyModuleNames` or `PublicDependencyModuleNames`.
6. Regenerate project files and build.

## Source references

- `Runtime/Projects/Public/PluginDescriptor.h` — `FPluginDescriptor`:38
- `Runtime/Projects/Public/ModuleDescriptor.h` — `FModuleDescriptor`:154, `EHostType`:82
- `Runtime/Core/Public/Modules/ModuleInterface.h` — `IModuleInterface`, all hooks
- `Runtime/Core/Public/Modules/ModuleManager.h` — `IMPLEMENT_MODULE`:933,
  `FDefaultModuleImpl`:871
- Example: `E:\Program Files\Epic Games\UE_5.7\Engine\Plugins\FX\Niagara\Niagara.uplugin`
  (multi-module plugin with Runtime, UncookedOnly, and Editor modules)
- Official doc: <https://dev.epicgames.com/documentation/unreal-engine/plugins-in-unreal-engine>
