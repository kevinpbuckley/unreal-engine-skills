# .uproject descriptor and module system — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `FProjectDescriptor` schema, the
`FModuleDescriptor` fields, primary-game-module registration, and how the module manager
loads them. Grounded in UE 5.7
(`Engine/Source/Runtime/Projects/Public/ProjectDescriptor.h`,
`Engine/Source/Runtime/Projects/Public/ModuleDescriptor.h`,
`Engine/Source/Runtime/Core/Public/Modules/ModuleManager.h`).

Official docs (verified live):
- Unreal Engine Modules — <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-modules>

## The .uproject schema (`FProjectDescriptor`)

A `.uproject` file is JSON that the engine deserialises into `FProjectDescriptor`
(`Runtime/Projects/Public/ProjectDescriptor.h`). Every top-level JSON key maps to a
field on the struct:

| JSON key | C++ field | Purpose |
|---|---|---|
| `FileVersion` | `EProjectDescriptorVersion::Type FileVersion` | Schema version; must be `3` (Latest). |
| `EngineAssociation` | `FString EngineAssociation` | Which engine to use (see below). |
| `Modules` | `TArray<FModuleDescriptor> Modules` | C++ modules the project owns. |
| `Plugins` | `TArray<FPluginReferenceDescriptor> Plugins` | Engine/project plugins to enable or disable. |
| `TargetPlatforms` | `TArray<FName> TargetPlatforms` | Platforms the project targets (used by the launcher). |
| `bIsEnterpriseProject` | `bool bIsEnterpriseProject` | Enables enterprise features. |
| `bDisableEnginePluginsByDefault` | `bool bDisableEnginePluginsByDefault` | Opt all engine plugins out by default. |
| `AdditionalPluginDirectories` | private `TArray<FString>` | Extra directories to scan for plugins. |

### EngineAssociation values

The `EngineAssociation` field is resolved differently depending on how the engine was
obtained:

- **Launcher install** — a stable version string such as `"5.7"`. Binaries for each major
  version live in a fixed registry-tracked location; any machine with the same launcher
  version can open the project.
- **Source-built engine with a foreign project** — a GUID that indexes a per-machine
  registry entry under `HKCU\Software\Epic Games\Unreal Engine\Builds`. The GUID forces
  the engine-selection UI on a machine that has never registered it, which is the desired
  behaviour.
- **Engine as a subdirectory / Git submodule** — a relative path (`"../UnrealEngine"`)
  pointing from the project to the engine root. No registry lookup needed.
- **Perforce/Git branch of engine+project** — an empty string. The engine is found by
  walking up the directory hierarchy.

Source: `ProjectDescriptor.h:76` (comment on `FString EngineAssociation`).

## Module descriptors (`FModuleDescriptor`)

`FModuleDescriptor` (`Runtime/Projects/Public/ModuleDescriptor.h`) carries the per-module
configuration that appears under `"Modules"` in the `.uproject` or `"Modules"` in a
`.uplugin`.

### Key fields

| Field | Type | JSON key | Notes |
|---|---|---|---|
| `Name` | `FName` | `"Name"` | Must match the folder name and `Build.cs` class name. |
| `Type` | `EHostType::Type` | `"Type"` | When/where the module is compiled in. |
| `LoadingPhase` | `ELoadingPhase::Type` | `"LoadingPhase"` | When during startup the module is loaded. Omitting defaults to `Default`. |
| `PlatformAllowList` / `PlatformDenyList` | `TArray<FString>` | `"PlatformAllowList"` etc. | Restrict compilation to specific platforms. |
| `TargetAllowList` / `TargetDenyList` | `TArray<EBuildTargetType>` | `"IncludelistTargets"` etc. | Game/Editor/Server/Client/Program. |

### `EHostType::Type` — common values

| Value | When loaded |
|---|---|
| `Runtime` | All targets (game, editor, server), not standalone programs |
| `RuntimeNoCommandlet` | Like Runtime but skips commandlet mode |
| `Editor` | Editor builds only (tools, asset importers, custom panels) |
| `EditorNoCommandlet` | Editor builds, excluding commandlets |
| `DeveloperTool` | Loaded where `bBuildDeveloperTools` is enabled; skipped in Shipping |
| `CookedOnly` | Only in cooked game builds |
| `UncookedOnly` | Only in uncooked games (useful for Blueprint-based editor nodes) |

Source: `ModuleDescriptor.h:82–150`.

### `ELoadingPhase::Type` — common values

| Value | When |
|---|---|
| `Default` | After game modules load, during engine init — use for gameplay code |
| `PreDefault` | Just before Default — common for plugins that game code depends on |
| `PostDefault` | Just after Default |
| `PostEngineInit` | After the full engine init — use for deferred/optional tooling |
| `PostConfigInit` | Very early, immediately after the config system — subsystem hooks |
| `EarliestPossible` | As early as possible, before pak mounts — compression plugins |

Source: `ModuleDescriptor.h:26–58`.

## The primary game module

Every C++ project must designate exactly one module as the **primary game module** by
calling `IMPLEMENT_PRIMARY_GAME_MODULE` in its `.cpp` implementation file.

```cpp
// MyGame/Source/MyGame/Private/MyGameModule.cpp
#include "Modules/ModuleManager.h"

IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultModuleImpl, MyGame, "MyGame");
```

- The macro is defined at `Runtime/Core/Public/Modules/ModuleManager.h:1081–1122`.
- In modular (editor/development) builds it expands to `IMPLEMENT_GAME_MODULE`, which
  itself expands to `IMPLEMENT_MODULE`. In monolithic (shipping) builds it additionally
  writes the project name string into `GInternalProjectName` so the executable knows what
  project it represents.
- `FDefaultModuleImpl` is a no-op `IModuleInterface` subclass. Replace it with a custom
  subclass if you need `StartupModule`/`ShutdownModule` callbacks.
- Use `IMPLEMENT_MODULE` (not the `_PRIMARY_GAME_MODULE` variant) for all additional
  modules in your project or plugin.

### Source/MyGame.Target.cs

The Target file declares how to build a final executable. A minimal game target:

```csharp
using UnrealBuildTool;

public class MyGameTarget : TargetRules
{
    public MyGameTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.Latest;
        ExtraModuleNames.Add("MyGame");   // the primary game module
    }
}
```

The editor target uses `TargetType.Editor` and conventionally adds an `MyGameEditor`
module (or at minimum the same `MyGame` module). UBT discovers Target files in `Source/`.

## Plugin references in .uproject

Under `"Plugins"`, each entry is an `FPluginReferenceDescriptor`
(`Runtime/Projects/Public/PluginReferenceDescriptor.h`). The most-used fields:

```json
{ "Name": "EnhancedInput", "Enabled": true }
{ "Name": "MyProjectPlugin", "Enabled": true, "Type": "Project" }
{ "Name": "ModelingToolsEditorMode", "Enabled": false }
```

- Omitting a plugin means the engine default (usually enabled for built-in plugins) applies.
- Setting `"Enabled": false` on a built-in plugin disables it for the project even when
  `bDisableEnginePluginsByDefault` is false.
- The editor's **Plugins** window writes these entries automatically.

## Version notes

- `FModuleDescriptor` field names `PlatformAllowList`/`PlatformDenyList` replaced
  `WhitelistPlatforms`/`BlacklistPlatforms` across UE5 releases. Use the new names in
  new `.uproject` files; UBT accepts both during a transition period.
- `IMPLEMENT_PRIMARY_GAME_MODULE`'s third argument (`GameName`) is marked
  `DEPRECATED_GameName` in the macro comment (UE 5.x); the project name is now supplied
  from `UE_PROJECT_NAME` by UBT. Pass any string — it is ignored in modular builds.
