---
name: unreal-project-structure
description: Understand the layout of an Unreal project — the .uproject file, the Config/Content/
  Source/Plugins folders, the Config .ini hierarchy, and which files belong in source control.
  Use when creating or navigating a project, editing the .uproject, changing project settings via
  Config .ini files (DefaultEngine.ini/DefaultGame.ini/DefaultInput.ini), adding plugins, or
  writing a .gitignore for an Unreal project.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Project structure

An Unreal project is a `.uproject` file plus a set of well-known folders. Knowing what each
folder is (and what is generated vs. authored) prevents committing junk, editing the wrong file,
or losing work.

## When to use this skill

- Creating a new project or finding your way around an existing one.
- Editing the `.uproject` (modules, plugins, engine association).
- Changing project settings through `Config/Default*.ini` instead of the editor.
- Deciding what to source-control / writing a `.gitignore`.

## Folder layout

```
MyGame/
├── MyGame.uproject        # project descriptor (JSON)
├── Config/                # *.ini settings (AUTHORED — commit)
│   ├── DefaultEngine.ini
│   ├── DefaultGame.ini
│   ├── DefaultInput.ini
│   └── DefaultEditor.ini
├── Content/               # assets: .uasset/.umap (AUTHORED — commit, binary)
├── Source/                # C++ (AUTHORED — commit)
│   ├── MyGame/            # primary game module
│   ├── MyGame.Target.cs
│   └── MyGameEditor.Target.cs
├── Plugins/               # project plugins (each with .uplugin + Source/ + Content/)
├── Binaries/              # compiled DLLs/exe (GENERATED — ignore)
├── Intermediate/          # build temp, generated headers (GENERATED — ignore)
├── DerivedDataCache/      # cooked/derived asset cache (GENERATED — ignore)
└── Saved/                 # logs, autosaves, config overrides (GENERATED — ignore)
```

Authored = under version control. Generated = ignore (rebuilt by the engine/UBT).

## The `.uproject` file

JSON descriptor. Key fields:

```json
{
  "FileVersion": 3,
  "EngineAssociation": "5.7",
  "Category": "",
  "Description": "",
  "Modules": [
    { "Name": "MyGame", "Type": "Runtime", "LoadingPhase": "Default" }
  ],
  "Plugins": [
    { "Name": "EnhancedInput", "Enabled": true },
    { "Name": "ModelingToolsEditorMode", "Enabled": true }
  ]
}
```

- **EngineAssociation:** `"5.7"` for a launcher install; a GUID for a source-built engine
  (resolved via `HKCU\Software\Epic Games\Unreal Engine\Builds`).
- **Modules:** the game's C++ modules (see `unreal-module-and-build-system`).
- **Plugins:** enable/disable engine and project plugins here (or via the editor's Plugins window).

A project with no `Source/` folder is **Blueprint-only**; adding any C++ class creates `Source/`
and the targets, converting it to a C++ project.

## Config `.ini` hierarchy

Settings cascade: engine base config → project `Config/Default*.ini` → platform/`Saved` overrides.
You edit the **`Default*.ini`** files (committed). Common ones:

| File | Holds |
|---|---|
| `DefaultEngine.ini` | rendering, default maps & GameMode, collision channels, plugins config |
| `DefaultGame.ini` | project name/version, asset manager, game-specific settings |
| `DefaultInput.ini` | legacy input bindings (Enhanced Input uses assets instead) |
| `DefaultEditor.ini` | editor preferences shipped with the project |

Sections are `[/Script/Module.Class]`. Example — default map & GameMode:

```ini
[/Script/EngineSettings.GameMapsSettings]
GameDefaultMap=/Game/Maps/MainMenu.MainMenu
GlobalDefaultGameMode=/Script/MyGame.MyGameMode
```

Editor changes to Project Settings write into these `Default*.ini` files. Editing the `.ini`
directly is equivalent and reviewable in diffs.

## Content paths & mount points

- `/Game/...` maps to the project's `Content/` folder.
- `/Engine/...` maps to engine content; `/PluginName/...` maps to a plugin's `Content/`.
- Asset reference format: `/Game/Path/AssetName.AssetName` (object) or `…/AssetName` (package).
- Never reference assets by OS path; use these virtual paths.

## What to source-control (`.gitignore`)

Commit: `*.uproject`, `Config/`, `Content/`, `Source/`, `Plugins/*/Source`, `Plugins/*/Content`,
`*.uplugin`. Ignore the generated folders:

```gitignore
Binaries/
Intermediate/
DerivedDataCache/
Saved/
*.VC.db
.vs/
# Plugin generated dirs
Plugins/**/Binaries/
Plugins/**/Intermediate/
```

Use **Git LFS** (or Perforce) for large binary `.uasset`/`.umap` content on real projects.

## Gotchas

- **Committing `Binaries/`/`Intermediate/`** bloats the repo and causes merge pain — always ignore.
- **`.uasset` files are binary** and don't text-merge; coordinate edits or lock files.
- **Wrong `EngineAssociation`** makes the project open with the wrong engine or fail to open.
- **Editing `Saved/Config` instead of `Config/Default*.ini`** — your change won't ship; `Saved`
  is a local override that's regenerated.

## References & source material

Engine source (UE 5.7):
- `Runtime/Projects/Public/ProjectDescriptor.h` and `PluginDescriptor.h` — `.uproject`/`.uplugin` schema.
- `Runtime/Core/Public/Misc/ConfigCacheIni.h` — config system & `.ini` cascade.
- `Runtime/EngineSettings/Classes/GameMapsSettings.h` — `[GameMapsSettings]` keys.

Official docs (UE 5.7): Understanding the Basics —
<https://dev.epicgames.com/documentation/unreal-engine/understanding-the-basics-of-unreal-engine>
