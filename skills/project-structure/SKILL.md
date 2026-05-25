---
name: project-structure
description: Navigate and configure an Unreal Engine project — the .uproject descriptor
  (FProjectDescriptor: FileVersion, EngineAssociation, Modules, Plugins), the standard
  folder layout (Config/ with Default*.ini files, Content/, Source/ with the primary
  game module, Plugins/, and the generated Binaries/Intermediate/DerivedDataCache/Saved/
  folders), the config file hierarchy and ini syntax (sections, array operators,
  UPROPERTY(config), GConfig), content virtual paths (/Game/ /Engine/), and which files
  to source-control versus ignore. Use when creating or opening a project, editing
  .uproject modules or plugin references, changing project settings via Config Default*.ini
  instead of the editor, deciding what to commit to Git/Perforce, writing a .gitignore,
  understanding EngineAssociation values, registering a primary game module, or debugging
  "wrong engine version" / "stale generated headers" / config-not-applying problems.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Project structure

An Unreal project is a `.uproject` file plus a set of well-known folders. Knowing what
each folder is for (and what is generated vs. authored) prevents committing junk, editing
the wrong config file, or losing work across machines.

## When to use this skill

- Creating a new project or navigating an unfamiliar existing one.
- Editing the `.uproject`: adding/removing modules, enabling/disabling plugins, or
  changing `EngineAssociation`.
- Changing project settings by editing `Config/Default*.ini` directly rather than via the
  editor UI, or understanding why an editor change didn't persist.
- Registering a primary game module (`IMPLEMENT_PRIMARY_GAME_MODULE`) or adding a second
  module to the project.
- Deciding what to commit to source control and writing or updating a `.gitignore`.
- Debugging "opens with wrong engine version", "stale generated headers", or
  "config value not applying".

## Folder layout

```
MyGame/
├── MyGame.uproject        # JSON descriptor — COMMIT
├── Config/                # Default*.ini settings — COMMIT
│   ├── DefaultEngine.ini
│   ├── DefaultGame.ini
│   ├── DefaultInput.ini
│   └── DefaultEditor.ini
├── Content/               # .uasset / .umap (binary) — COMMIT (use Git LFS)
├── Source/                # C++ source — COMMIT
│   ├── MyGame.Target.cs
│   ├── MyGameEditor.Target.cs
│   └── MyGame/            # Primary game module
│       ├── MyGame.Build.cs
│       ├── Public/
│       └── Private/
│           └── MyGameModule.cpp
├── Plugins/               # Project plugins — COMMIT (minus generated subdirs)
├── Binaries/              # GENERATED — ignore
├── Intermediate/          # GENERATED — ignore
├── DerivedDataCache/      # GENERATED — ignore
└── Saved/                 # GENERATED — ignore (logs, runtime config overrides)
```

**Authored** = committed. **Generated** = ignore; rebuilt by UBT or the engine on demand.

Full per-folder detail, content paths, and `.gitignore` recipe:
[references/folder-layout-and-vcs.md](references/folder-layout-and-vcs.md).

## The .uproject file (`FProjectDescriptor`)

The `.uproject` is a JSON file deserialised into `FProjectDescriptor`
(`Runtime/Projects/Public/ProjectDescriptor.h:43`). Minimal annotated skeleton:

```json
{
  "FileVersion": 3,
  "EngineAssociation": "5.7",
  "Modules": [
    { "Name": "MyGame", "Type": "Runtime", "LoadingPhase": "Default" }
  ],
  "Plugins": [
    { "Name": "EnhancedInput",  "Enabled": true  },
    { "Name": "ModelingToolsEditorMode", "Enabled": false }
  ]
}
```

### EngineAssociation

Controls which engine instance opens the project:

| Value | Meaning |
|---|---|
| `"5.7"` | Launcher install; any machine with UE 5.7 can open it |
| `"{GUID}"` | Local source-built engine; GUID indexes `HKCU\Software\Epic Games\Unreal Engine\Builds` |
| `"../UnrealEngine"` | Relative path to an engine subdirectory (e.g. Git submodule) |
| `""` (empty) | Walk up the directory hierarchy — use when engine and project share a repo |

Wrong `EngineAssociation` is the most common cause of "opens with the wrong engine."
Update it with the launcher or by running
`UnrealVersionSelector.exe /switchversion MyGame.uproject`.

Source: `ProjectDescriptor.h:76` (comment on `FString EngineAssociation`).

### Modules array

Each entry is `FModuleDescriptor` (`Runtime/Projects/Public/ModuleDescriptor.h:154`).
Key fields: `Name`, `Type` (`EHostType::Type`), `LoadingPhase` (`ELoadingPhase::Type`).

Common `Type` values: `Runtime` (game + editor + server), `Editor` (editor-only tools),
`DeveloperTool` (debug utilities, excluded from Shipping).

Common `LoadingPhase` values: `Default` (most gameplay code), `PreDefault` (plugin
dependencies that game code needs at startup), `PostEngineInit` (optional/deferred tools).

Full `EHostType` and `ELoadingPhase` enum tables:
[references/uproject-and-modules.md](references/uproject-and-modules.md).

### Plugins array

Enable or disable engine/project plugins. Each entry maps to `FPluginReferenceDescriptor`.
The editor's **Plugins** window writes these entries; editing the JSON directly is
equivalent.

A project with no `Source/` folder is **Blueprint-only**. Adding the first C++ class
creates `Source/` and the Target files, converting it to a C++ project.

## The primary game module

Every C++ project needs exactly one **primary game module**. It is declared with
`IMPLEMENT_PRIMARY_GAME_MODULE` in the module's `.cpp` implementation file:

```cpp
// Source/MyGame/Private/MyGameModule.cpp
#include "Modules/ModuleManager.h"

IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultModuleImpl, MyGame, "MyGame");
```

- Macro defined at `Runtime/Core/Public/Modules/ModuleManager.h:1081`.
- Use `FDefaultModuleImpl` unless you need `StartupModule`/`ShutdownModule` hooks.
- All additional modules in the project use `IMPLEMENT_MODULE` (not the primary variant).

Full primary-module mechanics, Target.cs anatomy, and plugin descriptor fields:
[references/uproject-and-modules.md](references/uproject-and-modules.md).

## Config .ini hierarchy

Settings cascade from the engine base through your project's `Default*.ini` to
per-platform and per-user files. The file you always edit is `Config/Default{Type}.ini`.

| File | Typical contents |
|---|---|
| `DefaultEngine.ini` | Rendering settings, default maps, GameMode, collision channels |
| `DefaultGame.ini` | Project name/version, Asset Manager, game-specific settings |
| `DefaultInput.ini` | Legacy input axis/action bindings |
| `DefaultEditor.ini` | Editor preferences shipped with the project |
| `DefaultGameplayTags.ini` | Gameplay tag table |

Sections use `[/Script/ModuleName.ClassName]` (class name without `U`/`A` prefix).
Example:

```ini
[/Script/EngineSettings.GameMapsSettings]
GameDefaultMap=/Game/Maps/MainMenu.MainMenu
GlobalDefaultGameMode=/Script/MyGame.MyGameMode
```

`UGameMapsSettings` is declared in
`Runtime/EngineSettings/Classes/GameMapsSettings.h:101` with
`UCLASS(config=Engine, defaultconfig)`.

### Config array operators

When a key appears multiple times across hierarchy files the operator prefix controls
the merge:

| Prefix | Meaning |
|---|---|
| (none) | Replace all, then append |
| `+` | Append if not already present |
| `.` | Append unconditionally (allow duplicates) |
| `-` | Remove exact match |
| `!` | Clear the array |

### UPROPERTY(config) — auto-binding from ini

```cpp
UCLASS(config=Game)
class UMyGameSettings : public UObject
{
    GENERATED_BODY()

    UPROPERTY(config)
    int32 MaxPlayers = 4;
};
```

The CDO is populated automatically from `DefaultGame.ini`; access it with
`GetDefault<UMyGameSettings>()`. Write and persist changes with
`GetMutableDefault<UMyGameSettings>()->SaveConfig()`.

### Reading config in C++ (GConfig)

`GConfig` (`extern FConfigCacheIni* GConfig;` — `CoreGlobals.h:96`) holds the merged
cache for all categories. Use the typed getters for arbitrary keys:

```cpp
int32 Val = 0;
GConfig->GetInt(TEXT("/Script/MyGame.MySettings"), TEXT("MaxPlayers"), Val, GGameIni);
```

`GEngineIni`, `GGameIni`, `GInputIni`, … resolve to the merged filenames for each
category.

Full hierarchy layer table, array operator examples, `SaveConfig`, console variable
sections, and command-line overrides:
[references/config-system.md](references/config-system.md).

## Content paths and mount points

Always use virtual content paths — never OS paths:

| Prefix | Resolves to |
|---|---|
| `/Game/` | Project `Content/` (`FPaths::ProjectContentDir()`) |
| `/Engine/` | Engine `Content/` |
| `/PluginName/` | Plugin `Content/` |

Asset object path format: `/Game/Path/To/Asset.Asset`.

## What to source-control (.gitignore)

Commit: `*.uproject`, `Config/`, `Content/`, `Source/`, `Plugins/**/Source`,
`Plugins/**/Content`, `*.uplugin`.

Ignore (generated):

```gitignore
Binaries/
Intermediate/
DerivedDataCache/
Saved/
.vs/
*.VC.db
Plugins/**/Binaries/
Plugins/**/Intermediate/
```

Use **Git LFS** for `.uasset`/`.umap` on real projects (they are binary and do not
text-merge). Full `.gitignore` and `.gitattributes` patterns:
[references/folder-layout-and-vcs.md](references/folder-layout-and-vcs.md).

## Gotchas

- **Wrong `EngineAssociation`** — the project opens with the wrong engine or fails to
  open on other machines. Use `UnrealVersionSelector` to set it correctly.
- **Editing `Saved/Config/` instead of `Config/Default*.ini`** — `Saved/` is a
  per-machine override; your change won't be in source control or affect teammates.
- **Committing `Binaries/`/`Intermediate/`** — bloats the repo and causes merge
  conflicts in generated files; always ignore these.
- **`.uasset` files are binary** — they don't text-merge; coordinate edits or use file
  locking (Perforce exclusive checkout or Git LFS lock).
- **Deleting `Intermediate/` fixes stale-header errors** — if UHT-generated headers are
  out of sync, delete `Intermediate/` and rebuild.
- **Blueprint-only project opened after adding C++** — the editor must regenerate project
  files; right-click the `.uproject` → "Generate Project Files".
- **`IMPLEMENT_PRIMARY_GAME_MODULE` missing** — linker error or the module fails to load
  at runtime in monolithic builds. Every C++ project needs exactly one.

## Version notes

- `TObjectPtr<T>` is the modern form for `UPROPERTY` pointers (UE5+); raw `T*` still
  works. Relevant when reading older `.uproject` or C++ examples.
- `PlatformAllowList`/`PlatformDenyList` replaced `WhitelistPlatforms`/`BlacklistPlatforms`
  in module descriptors across UE5; both are accepted by current UBT.
- Enhanced Input stores bindings in `.uasset` files, not `DefaultInput.ini`. Legacy
  `DefaultInput.ini` bindings remain functional.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/Projects/Public/ProjectDescriptor.h` — `FProjectDescriptor` struct:43,
  `EngineAssociation`:76, `Modules`:85, `Plugins`:88.
- `Runtime/Projects/Public/ModuleDescriptor.h` — `FModuleDescriptor`:154,
  `EHostType::Type`:82, `ELoadingPhase::Type`:26.
- `Runtime/Projects/Public/PluginReferenceDescriptor.h` — plugin enable/disable
  descriptor used in `"Plugins"` array.
- `Runtime/Core/Public/Modules/ModuleManager.h` — `IMPLEMENT_PRIMARY_GAME_MODULE`:1081,
  `IMPLEMENT_GAME_MODULE`:971, `IMPLEMENT_MODULE`:904.
- `Runtime/Core/Public/Misc/ConfigCacheIni.h` — `FConfigCacheIni`:1239, `GetInt`:~1400,
  `LoadGlobalIniFile`:1816.
- `Runtime/Core/Public/Misc/ConfigHierarchy.h` — `GConfigLayers[]` inline array
  defining the full hierarchy layer order.
- `Runtime/Core/Public/CoreGlobals.h` — `extern FConfigCacheIni* GConfig`:96,
  `GEngineIni`, `GGameIni` globals.
- `Runtime/Core/Public/Misc/Paths.h` — `FPaths::ProjectDir()`:277,
  `FPaths::ProjectContentDir()`:291, `FPaths::ProjectConfigDir()`:298,
  `FPaths::ProjectSavedDir()`:305.
- `Runtime/EngineSettings/Classes/GameMapsSettings.h` — `UGameMapsSettings`:101,
  `GameDefaultMap`:209, `GlobalDefaultGameMode`:217.

Official docs (UE 5.7, verified live):
- Unreal Engine Directory Structure —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-directory-structure>
- Configuration Files in Unreal Engine —
  <https://dev.epicgames.com/documentation/unreal-engine/configuration-files-in-unreal-engine>
- Unreal Engine Modules —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-modules>

Deep-dive references in this skill:
- [references/uproject-and-modules.md](references/uproject-and-modules.md) — full
  `FProjectDescriptor`/`FModuleDescriptor` schema, `EngineAssociation` variants,
  `EHostType`/`ELoadingPhase` tables, primary-game-module mechanics, Target.cs anatomy.
- [references/config-system.md](references/config-system.md) — full hierarchy layer
  table, array operators, `UPROPERTY(config)` binding, `GConfig` API, `SaveConfig`,
  console variable sections, command-line overrides.
- [references/folder-layout-and-vcs.md](references/folder-layout-and-vcs.md) — per-folder
  detail, content virtual paths, complete `.gitignore` and `.gitattributes`.

Cross-skill references:
- `module-and-build-system` — `Build.cs`, UBT dependency graph, IWYU, PCH.
- `plugins-and-modules` — authoring and distributing `.uplugin`-based plugins.
- `packaging-and-deployment` — cook, stage, and package; `StagedBuilds/` output.
