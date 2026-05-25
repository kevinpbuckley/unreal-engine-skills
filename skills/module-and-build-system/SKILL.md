---
name: module-and-build-system
description: Structure Unreal C++ into modules and configure the build with *.Build.cs
  (ModuleRules) and *.Target.cs (TargetRules). Use when creating a new module, splitting
  code out of an existing module, adding a dependency, fixing "unresolved external symbol" /
  "cannot open include file" / "module not found" link errors, choosing public vs private
  dependencies, wiring IMPLEMENT_MODULE / IMPLEMENT_PRIMARY_GAME_MODULE / IModuleInterface,
  setting the module loading phase or host type, or understanding how UnrealBuildTool (UBT)
  discovers and compiles modules. Related to plugins: see plugins-and-modules for packaging
  modules inside .uplugin files.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Modules & the build system

Every Unreal C++ feature lives in a **module**: a directory that compiles into its own DLL
(modular builds) or static lib (monolithic builds). **UnrealBuildTool (UBT)** reads C#-style
`*.Build.cs` files (one per module) and `*.Target.cs` files (one per build target) to decide
what to compile and link. Most "won't compile / won't link" problems are really "wrong module
dependency" problems.

Note: UE modules are independent of C++20 language modules.

## When to use this skill

- Adding a new module to a project or plugin, or splitting a growing module into smaller units.
- Link/include errors: unresolved external (`*_API` symbol), "cannot open include file",
  "module X not found at startup".
- Adding a dependency (e.g. you used `UEnhancedInputComponent` and need `EnhancedInput`).
- Choosing `PublicDependencyModuleNames` vs `PrivateDependencyModuleNames`, or the loading
  phase and host type.
- Understanding how UBT discovers modules and when to regenerate project files.

## Mental model

- A **module** = a folder under `Source/<Module>/` with `<Module>.Build.cs` plus `Public/`
  (headers other modules may include) and `Private/` (implementation + internal headers).
- The **`<MODULE>_API` macro** (e.g. `MYGAME_API`) expands to `__declspec(dllexport/dllimport)`
  in modular builds and to nothing in monolithic builds. Missing it on a class another module
  uses → unresolved external symbol.
- To use another module's API you must (1) `#include` its public header **and** (2) list that
  module in your `Build.cs` dependencies. Both are required.
- **Targets** (`*.Target.cs`) describe an executable: which modules it boots with and whether
  the build links them as a monolith or as separate DLLs.
- UBT ignores the IDE solution when building — it reads only `Build.cs`/`Target.cs` files.
  Regenerate project files any time you add, move, or rename source files.

## Module layout

```
Source/MyGame/
├── MyGame.Build.cs
├── Public/                # headers exposed to other modules
│   └── MyActor.h
└── Private/               # .cpp files + internal-only headers
    ├── MyActor.cpp
    └── MyGameModule.cpp   # IMPLEMENT_PRIMARY_GAME_MODULE lives here
```

`#include` paths resolve from the `Public`/`Private` root, not the disk path:
a header at `Public/Weapons/Gun.h` is included as `#include "Weapons/Gun.h"`.
Files outside these canonical folders are treated as private automatically.

## `*.Build.cs` — ModuleRules

Each module has exactly one `<Name>.Build.cs` in its root. UBT compiles it at build time.

```csharp
using UnrealBuildTool;

public class MyGame : ModuleRules
{
    public MyGame(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;  // required for IWYU compliance

        // Types from these modules appear in THIS module's PUBLIC headers → Public
        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core", "CoreUObject", "Engine", "InputCore"
        });

        // Types used only in .cpp or private headers → Private (faster builds, leaner API)
        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "EnhancedInput", "UMG", "Slate", "SlateCore"
        });

        // Editor-only dependencies — gate to avoid packaging bloat
        if (Target.bBuildEditor)
        {
            PrivateDependencyModuleNames.Add("UnrealEd");
        }
    }
}
```

Key rules:
- If a dependency's types appear in your **public headers**, it must be a **public** dependency.
  If only in `.cpp`/private headers, prefer **private**.
- The module name is the folder name containing the `Build.cs` (or the engine module's name).
- Find which engine module owns a class by locating its header; see `navigating-engine-source`.
- `PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs` enables IWYU-safe precompiled headers.
  Each `.cpp` must include its matching `.h` first, and no monolithic headers (`Engine.h`).

See [references/build-cs-reference.md](references/build-cs-reference.md) for the full property
list, advanced options, and third-party library integration.

## `*.Target.cs` — TargetRules

A project normally has two: `<Project>.Target.cs` (Game) and `<Project>Editor.Target.cs`
(Editor).

```csharp
using UnrealBuildTool;

public class MyGameTarget : TargetRules
{
    public MyGameTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;                          // Game / Editor / Server / Client / Program
        DefaultBuildSettings = BuildSettingsVersion.V5; // use engine defaults from 5.x
        IncludeOrderVersion  = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("MyGame");                  // primary game module(s)
    }
}
```

`TargetType` values: `Game` (cooked monolithic), `Editor` (modular with editor DLLs),
`Server`, `Client`, `Program`. Editor targets link modularly; Game/Server/Client link
monolithically on most platforms.

See [references/target-cs-reference.md](references/target-cs-reference.md) for all
`TargetRules` fields, link types, and build settings.

## Registering the module in C++

Every module needs exactly one registration macro in a single `.cpp`:

```cpp
#include "Modules/ModuleManager.h"

// For the primary game module (name matches .uproject):
IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, MyGame, "MyGame");

// For secondary modules or plugin modules:
// IMPLEMENT_MODULE(FDefaultModuleImpl, MySecondaryModule);
```

- `FDefaultModuleImpl` — empty `IModuleInterface`; does nothing at startup/shutdown.
  (`ModuleManager.h`:871)
- `FDefaultGameModuleImpl : FDefaultModuleImpl` — overrides `IsGameModule()` to return `true`.
  (`ModuleManager.h`:879)
- For startup/shutdown hooks, subclass `IModuleInterface` and override `StartupModule()` /
  `ShutdownModule()`. Use `StartupModule` to load dependent modules with
  `FModuleManager::Get().LoadModuleChecked(TEXT("MyDep"))`.

```cpp
// MyEditorModule.cpp
#include "Modules/ModuleManager.h"
#include "MyEditorModule.h"

IMPLEMENT_MODULE(FMyEditorModule, MyEditorModule)

void FMyEditorModule::StartupModule()
{
    // register editor extensions, detail customizations, etc.
}

void FMyEditorModule::ShutdownModule()
{
    // unregister everything registered in StartupModule
}
```

See [references/module-cpp-and-phases.md](references/module-cpp-and-phases.md) for the full
`IModuleInterface` API, loading-phase details, and `FModuleManager` query methods.

## Declaring the module in `.uproject` / `.uplugin`

```json
"Modules": [
  {
    "Name": "MyGame",
    "Type": "Runtime",
    "LoadingPhase": "Default"
  },
  {
    "Name": "MyGameEditor",
    "Type": "Editor",
    "LoadingPhase": "Default"
  }
]
```

**Type** (`ModuleHostType` enum, `ModuleDescriptor.cs`:18):

| Type | Loaded in |
|---|---|
| `Runtime` | any target using the UE runtime |
| `RuntimeNoCommandlet` | runtime targets, except commandlets |
| `Editor` | editor only — stripped from packaged games |
| `EditorNoCommandlet` | editor only, not in commandlets |
| `Developer` / `DeveloperTool` | builds with developer tools enabled |
| `ServerOnly` / `ClientOnly` | server-only or client-only targets |
| `UncookedOnly` | uncooked builds only |
| `Program` | standalone programs |

**LoadingPhase** (`ModuleLoadingPhase` enum, `ModuleDescriptor.cs`:104):

| Phase | When |
|---|---|
| `EarliestPossible` | as soon as GConfig is ready |
| `PostConfigInit` | after config, before most engine systems |
| `PreLoadingScreen` | before the loading screen fires |
| `PreDefault` | just before Default |
| `Default` | after game modules are loaded (standard) |
| `PostDefault` | just after Default |
| `PostEngineInit` | after engine is fully initialized |
| `None` | not loaded automatically |

Most gameplay code uses `Default`. Plugin modules that provide factories or types needed by
other modules often use `PreDefault`. If the editor keeps throwing "class not found" for your
plugin, try `PreDefault`.

## Adding a new module (checklist)

1. Create `Source/<New>/` with `Public/` and `Private/` subdirectories.
2. Add `<New>.Build.cs` inheriting `ModuleRules`, list dependencies.
3. Add `Private/<New>Module.cpp` with `IMPLEMENT_MODULE(FDefaultModuleImpl, <New>)`.
4. Add the module entry to `.uproject`/`.uplugin` `Modules` array.
5. Add `<New>` to other modules' dependency lists where they consume it.
6. Regenerate project files (right-click `.uproject` → Generate Visual Studio Project Files).
7. Build.

## `<MODULE>_API` export macros

`MYGAME_API` expands to `__declspec(dllexport)` when compiling the module and
`__declspec(dllimport)` when another module includes it, and to nothing in monolithic
builds. Apply it to the class keyword or individual functions:

```cpp
// Export the whole class — all virtual and non-inline members cross the DLL boundary
class MYGAME_API UMyComponent : public UActorComponent { ... };

// Export only a free function
MYGAME_API void MyGlobalHelper();
```

Rules:
- Apply `MYGAME_API` to any class, function, or data symbol another module accesses.
- Inner classes and nested types need their own `_API` if used externally.
- Do **not** apply to template class bodies — templates are header-only.
- Forgetting `_API` on a class used by another module → unresolved external symbol at link.

## Gotchas

- **Missing `<MODULE>_API`** on a class used cross-module → unresolved external symbol.
- **Forgot to add the module to `Build.cs`** → "cannot open include file" even though the
  header exists on disk; or unresolved externals for symbols in that header.
- **Circular module dependencies** fail to link — extract shared types to a lower-level module.
- **Editor module referenced by a runtime module** breaks packaging — keep editor code in an
  `Editor`-type module and guard with `#if WITH_EDITOR`.
- **Changing `Build.cs` or moving source files** requires regenerating project files **before**
  building, not just a Live Coding reload.
- **`FModuleManager::LoadModuleChecked`** in `StartupModule` ensures the dependency is loaded
  before your module uses it. Relying on load order without this can produce intermittent
  crashes when the phase is shared with other modules.
- **Monolithic vs modular builds:** in a shipped game (monolithic) `_API` macros are empty and
  DLL boundary rules don't apply; but code written without `_API` will fail in Editor builds
  (modular). Always use the macro correctly.

## Version notes

- `BuildSettingsVersion.V5` is the current recommended value in UE 5.7 (`TargetRules.cs`:162).
  New projects generated by the engine use `BuildSettingsVersion.Latest` / `V5`.
- `EngineIncludeOrderVersion.Latest` (= `Unreal5_7`) in UE 5.7 (`TargetRules.cs`:455).
- The `bRequiresImplementModule` property (default `true`) in `ModuleRules.cs` enforces the
  `IMPLEMENT_MODULE` macro presence at link time.

## Cross-references

- `plugins-and-modules` — packaging modules inside a `.uplugin`; plugin vs project module.
- `project-structure` — `.uproject` layout, Source/ and Config/ conventions.
- `navigating-engine-source` — finding which module owns a class or header.
- `cpp-fundamentals` — `UCLASS`/`USTRUCT`/`UENUM`, the reflection system.

## References & source material

Engine source (UE 5.7, under `E:\Program Files\Epic Games\UE_5.7\Engine\Source\`):

**C++ module system (Runtime/Core/Public/Modules/):**
- `ModuleInterface.h` — `IModuleInterface`: `StartupModule()`:31, `ShutdownModule()`:55,
  `SupportsDynamicReloading()`:64, `IsGameModule()`:84.
- `ModuleManager.h` — `FModuleManager`:170, `FDefaultModuleImpl`:871,
  `FDefaultGameModuleImpl`:879, `IMPLEMENT_MODULE` macro:933,
  `IMPLEMENT_PRIMARY_GAME_MODULE` macro:1081/1117.
- `Boilerplate/ModuleBoilerplate.h` — `PER_MODULE_BOILERPLATE`:114 (new/delete overrides,
  memory wrapper definitions placed in every module).

**UBT C# configuration (Programs/UnrealBuildTool/Configuration/):**
- `ModuleRules.cs` — `ModuleRules` class:103, `PCHUsageMode` enum:193,
  `PublicDependencyModuleNames`:1189, `PrivateDependencyModuleNames`:1200.
- `TargetRules.cs` — `TargetType` enum:21, `TargetLinkType` enum:52,
  `DefaultBuildSettings`:711, `ExtraModuleNames`:2654.

**UBT C# system (Programs/UnrealBuildTool/System/):**
- `ModuleDescriptor.cs` — `ModuleHostType` enum:18, `ModuleLoadingPhase` enum:104,
  `ModuleDescriptor` class:161.

Official docs (UE 5.7, all fetched and verified):
- Unreal Engine Modules —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-modules>
- Creating a Gameplay Module —
  <https://dev.epicgames.com/documentation/unreal-engine/how-to-make-a-gameplay-module-in-unreal-engine>
- Module Properties (UBT Build.cs reference) —
  <https://dev.epicgames.com/documentation/unreal-engine/module-properties-in-unreal-engine>
- Module API Specifiers —
  <https://dev.epicgames.com/documentation/unreal-engine/module-api-specifiers-in-unreal-engine>
- Include What You Use (IWYU) —
  <https://dev.epicgames.com/documentation/unreal-engine/include-what-you-use-iwyu-for-unreal-engine-programming>
- UBT Targets reference —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-build-tool-target-reference>

Deep-dive references in this skill:
- [references/build-cs-reference.md](references/build-cs-reference.md) — full `ModuleRules`
  property catalogue, PCH modes, third-party library integration, IWYU settings.
- [references/target-cs-reference.md](references/target-cs-reference.md) — `TargetRules`
  fields, `TargetType`/`TargetLinkType`, build settings versions, per-target editor gating.
- [references/module-cpp-and-phases.md](references/module-cpp-and-phases.md) — `IModuleInterface`
  full API, `FModuleManager` query methods, loading phases deep-dive, startup/shutdown ordering.
