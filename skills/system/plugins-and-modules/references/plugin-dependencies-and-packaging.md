# Plugin Dependencies & Packaging Reference

Deep-dive for [../SKILL.md](../SKILL.md). Covers plugin dependency declaration and the
dependency hierarchy, optional and platform-restricted dependencies, explicit-load plugins,
runtime queries via `IPluginManager`/`IPlugin`, and packaging plugins for distribution.
Grounded in UE 5.7 (`Runtime/Projects/Public/Interfaces/IPluginManager.h`,
`PluginReferenceDescriptor.h`, `PluginDescriptor.h`).

## Plugin dependency rules

Plugins declare dependencies on other plugins via the `Plugins` array in their `.uplugin`
descriptor. When the engine enables a plugin, it first ensures all listed dependencies are
enabled. Dependency resolution is recursive: if A depends on B and B depends on C, enabling
A enables both B and C.

### Dependency hierarchy (one-way)

The engine enforces a strict one-way dependency tree:

```
Engine plugins / modules
        ↑ (can depend on)
Project plugins / modules
        ↑ (can depend on)
    (nothing below)
```

- A project plugin can depend on an engine plugin.
- An engine plugin **cannot** depend on a project plugin.
- Circular dependencies (A → B → A) fail to link.

This matches the rule for C++ modules in `Build.cs`: modules at a higher level in the
hierarchy can never depend on modules at a lower level.

### Code-level vs descriptor-level dependencies

Two separate dependency declarations are needed when a plugin module uses another plugin's C++:

1. **Descriptor-level** (`.uplugin` `Plugins` array): ensures the dependency plugin is enabled
   and loaded before this plugin.
2. **Build.cs-level** (`PublicDependencyModuleNames` / `PrivateDependencyModuleNames`): lets
   UBT link the dependency module's symbols and resolve `#include` paths.

Both are required. Adding only one leads to either load-order failures or link errors.

## `FPluginReferenceDescriptor` in detail

`Runtime/Projects/Public/PluginReferenceDescriptor.h`:27. Fields beyond the basics:

### Optional dependencies

```json
{ "Name": "OptionalHelper", "Enabled": true, "Optional": true }
```

`bOptional`:40 — when `true`, the engine silently continues startup even if the named plugin
is not installed or not enabled. Check at runtime before using optional plugin features:

```cpp
TSharedPtr<IPlugin> Helper = IPluginManager::Get().FindEnabledPlugin(TEXT("OptionalHelper"));
if (Helper.IsValid())
{
    // Optional plugin is present and enabled; safe to use its features
}
```

### Platform-restricted dependencies

```json
{
  "Name": "PlatformSpecificPlugin",
  "Enabled": true,
  "PlatformAllowList": ["Win64", "Linux"],
  "PlatformDenyList": []
}
```

`PlatformAllowList`:46 / `PlatformDenyList`:49 restrict which platforms activate the
dependency. An empty allow list means all platforms.

### Target-type-restricted dependencies

```json
{
  "Name": "ServerPlugin",
  "Enabled": true,
  "TargetAllowList": ["Server"]
}
```

`TargetAllowList`:60 / `TargetDenyList`:63 accept `EBuildTargetType` string values:
`Game`, `Editor`, `Server`, `Client`, `Program`.

### Version-pinned dependency

```json
{ "Name": "SomeSDK", "Enabled": true, "RequestedVersion": 5 }
```

`RequestedVersion`:71 (`TOptional<int32>`) pins to a specific integer `Version` from the
dependency's `.uplugin`. Use this when your plugin relies on a specific API revision.

## Explicit-load plugins

Plugins with `"ExplicitlyLoaded": true` in their `.uplugin` (`bExplicitlyLoaded`:148 in
`PluginDescriptor.h`) are not loaded automatically by the engine at startup, regardless of
the `EnabledByDefault` setting or project enable state. This is used for plugins that should
only load when explicitly requested (e.g. Game Feature Plugins, modular game content).

Mount and load an explicitly-loaded plugin at runtime:

```cpp
#include "Interfaces/IPluginManager.h"

bool bOK = IPluginManager::Get().MountExplicitlyLoadedPlugin(
    TEXT("MyContentPlugin"),
    ELoadingPhase::Default);  // max phase to load up to

if (!bOK)
{
    UE_LOG(LogTemp, Warning, TEXT("Failed to mount MyContentPlugin"));
}
```

`MountExplicitlyLoadedPlugin` (`IPluginManager.h`:545) mounts content and loads modules up
to the specified loading phase. Call `UnmountExplicitlyLoadedPlugin` to reverse this.

For plugins loaded from a `.uplugin` path on disk rather than by name:

```cpp
IPluginManager::Get().MountExplicitlyLoadedPlugin_FromFileName(
    TEXT("/path/to/MyPlugin/MyPlugin.uplugin"));
```

## `IPluginManager` API in depth

`Runtime/Projects/Public/Interfaces/IPluginManager.h`:273. Singleton via `Get()`:649.

### Finding plugins

| Method | Line | Returns | Notes |
|---|---|---|---|
| `FindPlugin(Name)` | 382 | `TSharedPtr<IPlugin>` | Any discovered plugin (enabled or not) |
| `FindEnabledPlugin(Name)` | 393 | `TSharedPtr<IPlugin>` or null | Only if currently enabled |
| `FindPluginFromPath(Path)` | 385 | `TSharedPtr<IPlugin>` | By filesystem path to plugin dir |
| `GetEnabledPlugins()` | 417 | `TArray<TSharedRef<IPlugin>>` | All enabled plugins |
| `GetEnabledPluginsWithContent()` | 424 | `TArray<TSharedRef<IPlugin>>` | Enabled + `CanContainContent` |
| `GetDiscoveredPlugins()` | 443 | `TArray<TSharedRef<IPlugin>>` | All discovered (enabled or not) |

### Mounting and refresh

| Method | Line | Notes |
|---|---|---|
| `MountNewlyCreatedPlugin(Name)` | 537 | Enables, mounts content, and loads modules for a newly created plugin |
| `MountExplicitlyLoadedPlugin(Name, Phase)` | 545 | Load an explicit-load plugin up to a given phase |
| `UnmountExplicitlyLoadedPlugin(Name, Reason)` | 578 | Unmount; does not unload compiled modules |
| `RefreshPluginsList()` | 281 | Re-scan all plugin folders |
| `AddPluginSearchPath(Path)` | 475 | Add an additional scan directory |

### Plugin dependency query

```cpp
TArray<FPluginReferenceDescriptor> Deps;
IPluginManager::Get().GetPluginDependencies(TEXT("MyPlugin"), Deps);
for (const FPluginReferenceDescriptor& Dep : Deps)
{
    UE_LOG(LogTemp, Log, TEXT("  Depends on: %s (optional=%d)"), *Dep.Name, Dep.bOptional);
}
```

`GetPluginDependencies` (`IPluginManager.h`:583) returns the list from the plugin's `Plugins`
descriptor array.

## `IPlugin` API in depth

`IPluginManager.h`:110. Obtained from `FindPlugin` / `GetEnabledPlugins` / etc.

| Method | Notes |
|---|---|
| `GetName()` | Internal name (folder name, `.uplugin` stem) |
| `GetFriendlyName()` | Display name from `FriendlyName` descriptor field |
| `GetBaseDir()` | Filesystem path to the plugin's root directory |
| `GetContentDir()` | Filesystem path to the `Content/` directory |
| `GetMountedAssetPath()` | Virtual root for asset references, e.g. `/MyFeature/` |
| `IsEnabled()` | Plugin is currently enabled |
| `IsMounted()` | Plugin content is mounted (relevant for content plugins) |
| `IsHidden()` | Plugin is hidden from the Plugin Browser |
| `CanContainContent()` | Descriptor `CanContainContent` flag |
| `GetType()` | `EPluginType`: `Engine`, `Project`, `External`, `Enterprise`, `Mod` |
| `GetLoadedFrom()` | `EPluginLoadedFrom`: `Engine` or `Project` |
| `GetDescriptor()` | Full `FPluginDescriptor` struct (all descriptor fields) |
| `UpdateDescriptor(NewDesc, Reason)` | Save a modified descriptor to disk (editor only) |

## Packaging plugins for distribution

**From the editor:** Edit → Plugins → find your plugin → click **Package...** to produce a
distributable folder containing only the built binaries and descriptor (no source).

**What gets packaged:**
- `.uplugin` descriptor
- `Binaries/` (compiled DLLs for target platforms)
- `Content/` (if `CanContainContent: true`)
- `Resources/` (icon, etc.)
- `Config/` is **not** automatically packaged; copy ini files to the project's `Config/`
  manually if needed.

**Source inclusion for Marketplace plugins:** include the `Source/` directory so buyers can
recompile for their engine version. Ship with compiled binaries as well for users without
a code project.

**Engine version compatibility:** plugin binaries compiled against one UE version are not
ABI-compatible with other versions. Precompiled plugins must be recompiled for each engine
version. The `EngineVersion` field in the descriptor is informational; UBT performs the actual
compatibility check by comparing module identifiers.

**Platform staging:** by default, plugin content and binaries are staged for all platforms.
Use `SupportedTargetPlatforms` in the descriptor or `PlatformAllowList`/`PlatformDenyList`
on individual module entries to restrict staging.

## Common dependency pitfalls

- **Enabled in `.uplugin` but not in `Build.cs`** — plugin loads but `#include` of its
  headers fails or link errors appear. Add the module name to `PrivateDependencyModuleNames`.
- **Listed in `Build.cs` but not in `.uplugin` `Plugins`** — code links in development
  builds (if the plugin happens to be enabled), but packaged builds may fail if the dependency
  plugin is not enabled by default.
- **Optional dependency not guarded at runtime** — calling into an optional plugin's module
  without first checking `FindEnabledPlugin` causes crashes when the plugin is absent.
- **`bExplicitlyLoaded` plugin used without mounting** — the engine doesn't auto-load it;
  always call `MountExplicitlyLoadedPlugin` before accessing its content or modules.
- **Dependency load phase too late** — if your plugin loads at `Default` but depends on
  another plugin that also loads at `Default`, order is undefined. Move the dependency to
  `PreDefault`.

## Source references

- `Runtime/Projects/Public/Interfaces/IPluginManager.h` — `IPlugin`:110, `IPluginManager`:273,
  `EPluginLoadedFrom`:19, `EPluginType`:31
- `Runtime/Projects/Public/PluginReferenceDescriptor.h` — `FPluginReferenceDescriptor`:27
- `Runtime/Projects/Public/PluginDescriptor.h` — `bExplicitlyLoaded`:148
- Official doc: <https://dev.epicgames.com/documentation/unreal-engine/plugins-in-unreal-engine>
