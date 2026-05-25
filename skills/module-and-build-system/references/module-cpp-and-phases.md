# Module C++ & Loading Phases Reference

Grounded in UE 5.7 engine source:
- `E:\Program Files\Epic Games\UE_5.7\Engine\Source\Runtime\Core\Public\Modules\ModuleInterface.h`
- `E:\Program Files\Epic Games\UE_5.7\Engine\Source\Runtime\Core\Public\Modules\ModuleManager.h`
- `E:\Program Files\Epic Games\UE_5.7\Engine\Source\Programs\UnrealBuildTool\System\ModuleDescriptor.cs`

See also: [../SKILL.md](../SKILL.md)

## IModuleInterface (`ModuleInterface.h`)

`IModuleInterface` is the base for all module implementation classes. It provides five virtual
hooks:

| Method | Line | When called |
|---|---|---|
| `StartupModule()` | 31 | Immediately after the module DLL is loaded and the module object is constructed. |
| `PreUnloadCallback()` | 38 | Called before the module is unloaded; runs before `ShutdownModule`. |
| `ShutdownModule()` | 55 | Just before the module object is destroyed. Guaranteed to be called in reverse startup order when modules list each other in `StartupModule`. |
| `PostLoadCallback()` | 45 | Called after the module has been reloaded (hot-reload / Live Coding). |
| `SupportsDynamicReloading()` | 64 | Return `false` to prevent dynamic unloading of this module. |
| `IsGameModule()` | 84 | Return `true` if this module hosts gameplay code (set automatically by `FDefaultGameModuleImpl`). |

All methods have empty default implementations, so you only override what you need.

## Startup/shutdown ordering guarantee

The module system guarantees that if module A loads module B during `StartupModule`, B's
`ShutdownModule` will be called before A's — provided A holds a reference from
`LoadModuleChecked`. This makes it safe to use B's interfaces in A's `ShutdownModule`.
Load dependencies explicitly in `StartupModule`; do not rely on phase-level load ordering
within the same phase.

## Concrete implementation classes

### `FDefaultModuleImpl` (`ModuleManager.h`:871)

```cpp
class FDefaultModuleImpl : public IModuleInterface { };
```

Empty: no startup/shutdown. Used for modules that only need to expose headers and compiled
code without any explicit initialization sequence.

### `FDefaultGameModuleImpl` (`ModuleManager.h`:879)

```cpp
class FDefaultGameModuleImpl : public FDefaultModuleImpl
{
    virtual bool IsGameModule() const override { return true; }
};
```

Identical to `FDefaultModuleImpl` except `IsGameModule()` returns `true`, which the engine
uses to identify player-facing gameplay code in diagnostics and loading heuristics.

## Custom module class pattern

```cpp
// MyModule.h (in Public/ if other modules query it via FModuleManager)
#pragma once
#include "Modules/ModuleManager.h"

class FMyModule : public IModuleInterface
{
public:
    static FMyModule& Get()
    {
        return FModuleManager::LoadModuleChecked<FMyModule>("MyModule");
    }

    virtual void StartupModule() override;
    virtual void ShutdownModule() override;

    // Optional: expose module-level services
    void RegisterMyService(/* ... */);
};
```

```cpp
// Private/MyModuleModule.cpp
#include "MyModule.h"

IMPLEMENT_MODULE(FMyModule, MyModule)

void FMyModule::StartupModule()
{
    // Load a module this module depends on to ensure ordering
    FModuleManager::Get().LoadModuleChecked(TEXT("MyDependency"));
    // Register services, detail customizers, asset type actions, etc.
}

void FMyModule::ShutdownModule()
{
    // Mirror every registration done in StartupModule
}
```

## IMPLEMENT_MODULE variants (`ModuleManager.h`)

| Macro | Line | Use |
|---|---|---|
| `IMPLEMENT_MODULE(Impl, Name)` | 933 | Standard modules and plugin modules. |
| `IMPLEMENT_PRIMARY_GAME_MODULE(Impl, Name, GameName)` | 1081 | The one module whose name matches the `.uproject`. Sets `GInternalProjectName` in monolithic builds. In modular builds it is equivalent to `IMPLEMENT_MODULE`. |

There must be exactly one call per module `.cpp` translation unit. Placing it in a `.h` or
calling it twice in the same module → linker error.

## FModuleManager (`ModuleManager.h`:170)

`FModuleManager` is the singleton that tracks loaded modules. Common methods:

| Method | Notes |
|---|---|
| `FModuleManager::Get()` | Singleton accessor. |
| `LoadModuleChecked<T>(Name)` | Load and return as `T&`; throws if not found. Use in `StartupModule` to declare ordering. |
| `LoadModule(Name)` | Load; returns `IModuleInterface*` or `nullptr` on failure. |
| `GetModule(Name)` | Return already-loaded module or `nullptr`. Does not trigger load. |
| `IsModuleLoaded(Name)` | O(1) check whether module is currently loaded. |
| `UnloadModule(Name)` | Unload if `SupportsDynamicReloading()` returns `true`. |

Use `GetModule` (not `LoadModuleChecked`) in `ShutdownModule` — the dependent module may have
already been unloaded.

## IMPLEMENT_MODULE and PER_MODULE_BOILERPLATE

`IMPLEMENT_MODULE` includes `PER_MODULE_BOILERPLATE` (`ModuleBoilerplate.h`:114), which
overrides `new`/`delete` to route through Unreal's `FMemory` allocator. This is why every UE
module must use `IMPLEMENT_MODULE` (or the engine equivalent) — without it, memory allocated
in the module is freed by a different heap than the one that allocated it.

## Loading phases deep-dive

Defined in `ModuleDescriptor.cs`:104 as `public enum ModuleLoadingPhase`.

| Phase | Notes |
|---|---|
| `EarliestPossible` | Immediately after GConfig is available. Rare — only for very low-level modules that need to intercept config loading. |
| `PostConfigInit` | After config, before most engine systems including CoreUObject. Needed for modules that must intercept early engine init hooks. |
| `PreEarlyLoadingScreen` | Before early boot loading screens. For loading screen implementors. |
| `PreLoadingScreen` | Before the main loading screen fires. Used by loading screen plugins. |
| `PreDefault` | Just before the Default phase. Plugins providing base types or factories that `Default`-phase modules depend on. |
| `Default` | Standard phase; after all game modules in earlier phases are initialized. Correct for nearly all gameplay code. |
| `PostDefault` | Just after Default; for modules that post-process something registered during Default. |
| `PostEngineInit` | After the engine is fully initialized. For systems that need all engine subsystems available. |
| `None` | Module is declared but not loaded automatically; must be loaded on demand via `FModuleManager`. |

### Diagnosing phase problems

Symptom: the editor complains "could not find class X" or "plugin module not loaded" on startup.

1. Check that the module's `"LoadingPhase"` in `.uproject`/`.uplugin` is early enough for its
   consumers. Try `PreDefault` if others load at `Default`.
2. Check that `StartupModule` calls `LoadModuleChecked` for any module it depends on at startup
   time, rather than relying on implicit phase ordering.
3. Check that the module entry is present in `.uproject`/`.uplugin` `Modules` array at all —
   regenerating project files does not automatically add a new module to the descriptor.

## Source references

- `ModuleInterface.h` — `IModuleInterface`: full interface (91 lines).
- `ModuleManager.h`:170 — `FModuleManager` class.
- `ModuleManager.h`:871 — `FDefaultModuleImpl`.
- `ModuleManager.h`:879 — `FDefaultGameModuleImpl`.
- `ModuleManager.h`:933 — `IMPLEMENT_MODULE` (modular build variant).
- `ModuleManager.h`:1081–1123 — `IMPLEMENT_PRIMARY_GAME_MODULE`.
- `Boilerplate/ModuleBoilerplate.h`:114 — `PER_MODULE_BOILERPLATE` macro.
- `ModuleDescriptor.cs`:104 — `public enum ModuleLoadingPhase`.
- `ModuleDescriptor.cs`:18 — `public enum ModuleHostType`.

Official docs:
- Unreal Engine Modules — <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-modules>
- Creating a Gameplay Module — <https://dev.epicgames.com/documentation/unreal-engine/how-to-make-a-gameplay-module-in-unreal-engine>
