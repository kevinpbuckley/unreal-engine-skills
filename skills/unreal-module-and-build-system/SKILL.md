---
name: unreal-module-and-build-system
description: Structure Unreal C++ into modules and configure the build with *.Build.cs
  (ModuleRules) and *.Target.cs (TargetRules). Use when creating a new module or plugin module,
  fixing "Unresolved external symbol"/"Cannot open include file"/module-not-found link errors,
  adding a dependency module, choosing public vs private dependencies, setting the module
  loading phase or type, or wiring IMPLEMENT_MODULE / IMPLEMENT_PRIMARY_GAME_MODULE.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Modules & the build system

Unreal code is organized into **modules** (each compiles to a DLL/lib). Unreal Build Tool
(UBT) reads C#-style `*.Build.cs` files (one per module) and `*.Target.cs` files (one per
build target) to decide what compiles and what links. Most "won't compile/link" problems are
really "wrong module dependency" problems.

## When to use this skill

- Adding a new module to a project or plugin, or splitting code out of an existing module.
- Link/include errors: unresolved external (`*_API` symbol), "cannot open include file",
  "module X not found".
- Adding a dependency (e.g. you used `UEnhancedInputComponent` and need the `EnhancedInput` module).
- Choosing `PublicDependencyModuleNames` vs `PrivateDependencyModuleNames`, or the loading phase/type.

## Mental model

- A **module** = a folder under `Source/<Module>/` with `<Module>.Build.cs`, plus `Public/`
  (headers other modules may include) and `Private/` (implementation + internal headers).
- The **`<MODULE>_API` macro** (e.g. `MYGAME_API`) exports symbols across the DLL boundary.
  Forget it on a class another module uses → unresolved external.
- To use another module's API you must (1) `#include` its public header and (2) **list that
  module** in your `Build.cs` dependencies.
- **Targets** (`*.Target.cs`) describe an executable to build (Game, Editor, Server, Client)
  and which modules it includes.

## Module layout

```
Source/MyGame/
├── MyGame.Build.cs
├── Public/        # headers includable by other modules
│   └── MyActor.h
└── Private/       # .cpp + internal-only headers
    ├── MyActor.cpp
    └── MyGame.cpp # IMPLEMENT_PRIMARY_GAME_MODULE lives here
```

`#include` paths are relative to the `Public`/`Private`/`Classes` roots, not the disk path:
a header at `Public/Weapons/Gun.h` is included as `#include "Weapons/Gun.h"`.

## `*.Build.cs` (ModuleRules)

```csharp
using UnrealBuildTool;

public class MyGame : ModuleRules
{
    public MyGame(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        // Modules whose headers appear in THIS module's PUBLIC headers → Public
        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core", "CoreUObject", "Engine", "InputCore"
        });

        // Modules used only in .cpp / Private headers → Private (keeps your public API lean)
        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "EnhancedInput", "UMG", "Slate", "SlateCore"
        });
    }
}
```

Rules of thumb:
- If a dependency's types appear in your **public headers**, it's a **public** dependency.
  If only in `.cpp`/private headers, make it **private**.
- The module name is the folder name under `Source/` (or a plugin's `Source/`) that contains a
  `<Name>.Build.cs`. Find which module owns a class by locating its header's module
  (see `navigating-unreal-engine-source`).
- Common modules: `Core`, `CoreUObject`, `Engine`, `InputCore`, `EnhancedInput`, `UMG`,
  `Slate`, `SlateCore`, `AIModule`, `GameplayTags`, `GameplayAbilities`, `NetCore`,
  `OnlineSubsystem`. Editor-only: `UnrealEd`, `Kismet`, `BlueprintGraph` (gate with
  `if (Target.bBuildEditor) { ... }` and `#if WITH_EDITOR`).

## `*.Target.cs` (TargetRules)

```csharp
using UnrealBuildTool;
using System.Collections.Generic;

public class MyGameTarget : TargetRules        // also: MyGameEditorTarget : TargetType.Editor
{
    public MyGameTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;                // Game / Editor / Server / Client / Program
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        IncludeOrderVersion  = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("MyGame");        // primary game module(s)
    }
}
```

A project normally has two targets: `<Project>.Target.cs` (TargetType.Game) and
`<Project>Editor.Target.cs` (TargetType.Editor).

## Registering the module in C++

Each module needs exactly one `IMPLEMENT_*` macro in a `.cpp` (usually `Private/<Module>.cpp`):

```cpp
#include "Modules/ModuleManager.h"
// Primary game module (the one matching the project name):
IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, MyGame, "MyGame");

// Secondary modules / plugin modules:
// IMPLEMENT_MODULE(FMyEditorModule, MyEditor);
```

For startup/shutdown hooks, implement `IModuleInterface` (`StartupModule`/`ShutdownModule`).

## Declaring the module in `.uproject` / `.uplugin`

```json
"Modules": [
  { "Name": "MyGame", "Type": "Runtime", "LoadingPhase": "Default" }
]
```
- **Type:** `Runtime`, `RuntimeNoCommandlet`, `Editor`, `Developer`, `Program`, `ServerOnly`,
  `ClientOnly`, `UncookedOnly`. `Editor` modules are stripped from packaged games.
- **LoadingPhase:** `Default` for normal gameplay code; `PostConfigInit` for very early code;
  `PreDefault`/`PostEngineInit` for ordering against engine systems.

## Adding a new module (checklist)

1. Create `Source/<New>/` with `Public/` + `Private/`.
2. Add `<New>.Build.cs` with dependencies.
3. Add a `Private/<New>.cpp` with `IMPLEMENT_MODULE(FDefaultModuleImpl, <New>)`.
4. Add the module to `.uproject`/`.uplugin` `Modules`.
5. Add `<New>` to other modules' dependency lists where they consume it.
6. Regenerate project files (right-click `.uproject` → Generate Visual Studio project files) and rebuild.

## Gotchas

- **Missing `<MODULE>_API`** on a class used by another module → unresolved external symbol.
- **Forgot to add the module to `Build.cs`** → "cannot open include file" or unresolved externals
  even though the header exists.
- **Circular module dependencies** don't link — refactor shared types into a lower-level module.
- **Editor module referenced by a runtime module** breaks packaging — keep editor code in an
  `Editor`-type module and behind `WITH_EDITOR`.
- **Changing `Build.cs` requires regenerating project files / a real build** (not just Live Coding).

## References & source material

Engine source (UE 5.7):
- `Programs/UnrealBuildTool/Configuration/ModuleRules.cs` — every `Build.cs` field and option.
- `Programs/UnrealBuildTool/Configuration/TargetRules.cs` — every `Target.cs` field, `TargetType`,
  `BuildSettingsVersion`, `EngineIncludeOrderVersion`.
- `Runtime/Core/Public/Modules/ModuleManager.h` — `IMPLEMENT_MODULE`, `IModuleInterface`, loading.
- Example: `Runtime/Engine/Engine.Build.cs` (a large real ModuleRules).

Official docs (UE 5.7): Programming with C++ —
<https://dev.epicgames.com/documentation/unreal-engine/programming-with-cplusplus-in-unreal-engine>
