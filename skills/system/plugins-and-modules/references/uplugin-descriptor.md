# `.uplugin` Descriptor Reference

Full field reference for the `.uplugin` JSON descriptor. Grounded in UE 5.7
`Runtime/Projects/Public/PluginDescriptor.h` (`FPluginDescriptor`:38) and the official
[Plugins in Unreal Engine](https://dev.epicgames.com/documentation/unreal-engine/plugins-in-unreal-engine)
doc. See [../SKILL.md](../SKILL.md) for the plugin overview and common patterns.

## File format

A `.uplugin` file is UTF-8 JSON. The file name (without extension) must exactly match the
plugin's folder name — the engine and UBT use the file name as the plugin's internal name.
`FileVersion` is the only required field; it should be `3` for all current UE projects.

JSON field names for `bool` variables drop the leading `b` from the C++ member name. For
example `FPluginDescriptor::bCanContainContent` becomes `"CanContainContent"` in JSON.

## Top-level fields

Fields map to `FPluginDescriptor` in `Runtime/Projects/Public/PluginDescriptor.h`:38.

| JSON key | C++ field | Type | Notes |
|---|---|---|---|
| `FileVersion` | — | int | Required. Use `3`. |
| `Version` | `Version`:43 | int | Must increase with every release. Not shown in UI. |
| `VersionName` | `VersionName`:47 | string | Human-readable version ("1.0", "2.3.1"). |
| `FriendlyName` | `FriendlyName`:50 | string | Display name in the Plugin Browser. |
| `Description` | `Description`:53 | string | Short description shown in Plugin Browser. |
| `Category` | `Category`:56 | string | Browser category (e.g. "Gameplay", "FX"). |
| `CreatedBy` | `CreatedBy`:59 | string | Author name; optional, shown in UI. |
| `CreatedByURL` | `CreatedByURL`:62 | string | Author URL; optional. |
| `DocsURL` | `DocsURL`:65 | string | Documentation URL; optional. |
| `MarketplaceURL` | `MarketplaceURL`:68 | string | Marketplace URL embedded in projects. |
| `SupportURL` | `SupportURL`:71 | string | Support URL or email; optional. |
| `EngineVersion` | `EngineVersion`:74 | string | Compatible engine version; optional. |
| `EnabledByDefault` | `EnabledByDefault`:118 (`EPluginEnabledByDefault`:28) | bool/omit | `true`/`false`; omit for `Unspecified` (user decides). |
| `CanContainContent` | `bCanContainContent`:121 | bool | Must be `true` to mount the `Content/` folder. |
| `IsBetaVersion` | `bIsBetaVersion`:128 | bool | Shows a "Beta" badge in Plugin Browser. |
| `IsExperimentalVersion` | `bIsExperimentalVersion`:131 | bool | Shows "Experimental" badge. |
| `Installed` | `bInstalled`:133 | bool | `true` for installed (Marketplace) plugins. |
| `ExplicitlyLoaded` | `bExplicitlyLoaded`:148 | bool | Plugin won't load automatically; must call `MountExplicitlyLoadedPlugin`. |
| `SupportedTargetPlatforms` | `SupportedTargetPlatforms`:81 | string[] | Limits which platforms stage this plugin. |
| `Modules` | `Modules`:90 (`TArray<FModuleDescriptor>`) | object[] | Code modules; see below. |
| `Plugins` | `Plugins`:163 (`TArray<FPluginReferenceDescriptor>`) | object[] | Dependency plugins; see below. |

Rarely-needed fields: `ParentPluginName` (extending another plugin), `bNoCode` (content-only
enforcement), `bIsSealed` (prevents other plugins depending on this one),
`bHasExplicitPlatforms` (interpret empty `SupportedTargetPlatforms` as "no platforms"),
`bIsHidden` (hide from Plugin Browser), `PreBuildSteps` / `PostBuildSteps`
(custom build steps per host platform).

## Module descriptor (`FModuleDescriptor`)

Each entry in `"Modules"` corresponds to `FModuleDescriptor`
(`Runtime/Projects/Public/ModuleDescriptor.h`:154).

```json
{
  "Name": "MyFeature",
  "Type": "Runtime",
  "LoadingPhase": "Default"
}
```

| Field | C++ member | Notes |
|---|---|---|
| `Name` | `Name`:157 (`FName`) | Must match the `.Build.cs` file name (and the DLL name). |
| `Type` | `Type`:160 (`EHostType::Type`) | Which targets load this module. See `EHostType` table below. |
| `LoadingPhase` | `LoadingPhase`:163 (`ELoadingPhase::Type`) | When to load relative to engine startup. See `ELoadingPhase` table below. |
| `PlatformAllowList` | `PlatformAllowList`:166 | Load only on listed platforms (empty = all). |
| `PlatformDenyList` | `PlatformDenyList`:169 | Skip listed platforms. |
| `TargetAllowList` | `TargetAllowList`:175 | Load only for listed `EBuildTargetType` values. |
| `TargetDenyList` | `TargetDenyList`:178 | Skip listed target types. |
| `AdditionalDependencies` | `AdditionalDependencies`:201 | Extra link-time dependencies for UBT. |

### `EHostType` values (`ModuleDescriptor.h`:82)

| Value | When loaded |
|---|---|
| `Runtime` | All targets (game, editor, server, client) — most common for gameplay code |
| `RuntimeNoCommandlet` | All runtime targets except editor commandlets |
| `RuntimeAndProgram` | All targets including standalone programs |
| `CookedOnly` | Only in cooked game builds |
| `UncookedOnly` | Only in uncooked builds (Blueprint graph nodes, editor-side features) |
| `Developer` | Deprecated; prefer `DeveloperTool` |
| `DeveloperTool` | Builds with developer tools enabled (debug utilities, profiling tools) |
| `Editor` | Editor only; stripped from packaged games |
| `EditorNoCommandlet` | Editor only, not in commandlets |
| `EditorAndProgram` | Editor and program targets |
| `Program` | Standalone programs only |
| `ServerOnly` | All targets except dedicated clients |
| `ClientOnly` | All targets except dedicated servers |
| `ClientOnlyNoCommandlet` | Client targets, not commandlets |

### `ELoadingPhase` values (`ModuleDescriptor.h`:24)

| Value | When |
|---|---|
| `EarliestPossible` | As soon as the pak file system is ready |
| `PostConfigInit` | After config system init, before most engine systems |
| `PostSplashScreen` | After the splash screen is first rendered |
| `PreEarlyLoadingScreen` | Before early loading screen |
| `PreLoadingScreen` | Before the main loading screen fires |
| `PreDefault` | Just before `Default`; use when other `Default`-phase modules depend on your types |
| `Default` | Standard (after game modules in earlier phases); use for nearly all plugin code |
| `PostDefault` | Just after `Default` |
| `PostEngineInit` | After engine fully initialized; use when you need all subsystems available |
| `None` | Not loaded automatically; load on demand via `FModuleManager` |

## Plugin reference descriptor (`FPluginReferenceDescriptor`)

Each entry in `"Plugins"` corresponds to `FPluginReferenceDescriptor`
(`Runtime/Projects/Public/PluginReferenceDescriptor.h`:27):

```json
{
  "Name": "EnhancedInput",
  "Enabled": true
}
```

| Field | C++ member | Notes |
|---|---|---|
| `Name` | `Name`:29 | Internal name of the dependency plugin. |
| `Enabled` | `bEnabled`:37 | Must be `true` to activate the dependency. |
| `Optional` | `bOptional`:40 | If `true`, the plugin silently ignores the dependency being absent. |
| `PlatformAllowList` | `PlatformAllowList`:46 | Enable on listed platforms only. |
| `PlatformDenyList` | `PlatformDenyList`:49 | Disable on listed platforms. |
| `TargetAllowList` | `TargetAllowList`:60 | Enable for listed `EBuildTargetType` values only. |
| `TargetDenyList` | `TargetDenyList`:63 | Disable for listed target types. |
| `RequestedVersion` | `RequestedVersion`:71 | Pin a specific plugin `Version` integer. |

## Complete example

A plugin with a runtime module, an editor module, and plugin content, depending on
`EnhancedInput` and optionally on a third-party plugin:

```json
{
  "FileVersion": 3,
  "FriendlyName": "My Feature Plugin",
  "Version": 2,
  "VersionName": "2.0",
  "Description": "Provides the MyFeature runtime system and editor tooling.",
  "Category": "Gameplay",
  "CreatedBy": "Studio Name",
  "EnabledByDefault": true,
  "CanContainContent": true,
  "Modules": [
    { "Name": "MyFeature",       "Type": "Runtime",  "LoadingPhase": "Default" },
    { "Name": "MyFeatureEditor", "Type": "Editor",   "LoadingPhase": "Default" }
  ],
  "Plugins": [
    { "Name": "EnhancedInput",   "Enabled": true },
    { "Name": "MyOptionalHelper","Enabled": true, "Optional": true }
  ]
}
```

## Source references

- `Runtime/Projects/Public/PluginDescriptor.h` — `FPluginDescriptor`:38
- `Runtime/Projects/Public/ModuleDescriptor.h` — `FModuleDescriptor`:154, `EHostType`:82,
  `ELoadingPhase`:24
- `Runtime/Projects/Public/PluginReferenceDescriptor.h` — `FPluginReferenceDescriptor`:27
- Official doc: <https://dev.epicgames.com/documentation/unreal-engine/plugins-in-unreal-engine>
