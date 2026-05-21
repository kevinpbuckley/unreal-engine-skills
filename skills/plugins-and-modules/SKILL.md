---
name: plugins-and-modules
description: Package Unreal functionality as plugins — the .uplugin descriptor, plugin structure
  (modules, Content, Resources), module types and loading phases, plugin dependencies, enabling
  plugins, and querying them at runtime (IPluginManager). Use when creating a reusable plugin,
  deciding plugin vs project module, structuring an editor or runtime plugin, or troubleshooting a
  plugin that won't load.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Plugins & modules

A **plugin** is a self-contained, reusable feature: a `.uplugin` descriptor plus one or more
**modules** (`unreal-module-and-build-system`) and optional content/resources. Use plugins to share
features across projects, isolate optional systems, and ship editor tools.

## When to use this skill

- Creating a reusable feature you'll use in multiple projects.
- Packaging an editor tool or a third-party integration.
- Deciding plugin vs a plain project module.
- A plugin that won't load / its module is missing.

## Plugin vs project module

- **Project module** — code that belongs to this game (`Source/`). Not reusable elsewhere without
  copying.
- **Plugin** — portable: drop into any project's `Plugins/` (or install as an engine plugin),
  enable, done. Can bundle content and multiple modules. Choose a plugin when the feature is
  reusable, optional, or a tool.

## Structure

```
Plugins/MyFeature/
├── MyFeature.uplugin           # descriptor
├── Source/
│   ├── MyFeature/              # runtime module (Build.cs, Public/, Private/)
│   └── MyFeatureEditor/        # optional editor module
├── Content/                    # optional plugin assets (mounted at /MyFeature/)
└── Resources/                  # icon, etc.
```
Each module follows the standard module layout and has its own `*.Build.cs`
(`unreal-module-and-build-system`). Plugin content mounts under `/MyFeature/...`
(`unreal-project-structure`).

## The `.uplugin` descriptor

```json
{
  "FileVersion": 3,
  "FriendlyName": "My Feature",
  "Version": 1,
  "VersionName": "1.0",
  "EnabledByDefault": true,
  "CanContainContent": true,
  "Modules": [
    { "Name": "MyFeature",       "Type": "Runtime", "LoadingPhase": "Default" },
    { "Name": "MyFeatureEditor", "Type": "Editor",  "LoadingPhase": "PostEngineInit" }
  ],
  "Plugins": [
    { "Name": "EnhancedInput", "Enabled": true }
  ]
}
```
- **Modules**: same `Type`/`LoadingPhase` rules as project modules (`Runtime`, `Editor`, `Developer`,
  …; `Default`, `PostConfigInit`, `PostEngineInit`, …).
- **Plugins**: this plugin's dependencies (other plugins that must be enabled).
- **CanContainContent**: set true to bundle assets.

## Enabling plugins

- In a project: Edit → Plugins window, or add to the `.uproject` `Plugins` array
  (`unreal-project-structure`). Disabling unused engine plugins reduces build/footprint.
- Engine plugins live under the engine's `Plugins/`; project plugins under the project's `Plugins/`.

## Module types & loading phases (recap)

- **Type** decides where the module exists: `Runtime` (in game), `Editor` (stripped from packaged
  builds), `Developer`, `Program`, `*Only` variants.
- **LoadingPhase** decides *when* it loads relative to engine init. Use `Default` for gameplay;
  earlier phases for systems other code depends on at startup.

## Querying plugins at runtime

```cpp
#include "Interfaces/IPluginManager.h"
TSharedPtr<IPlugin> P = IPluginManager::Get().FindPlugin(TEXT("MyFeature"));
if (P.IsValid() && P->IsEnabled()) { /* feature available */ }
```
Useful for optional features that may or may not be present.

## Gotchas

- **Editor module marked Runtime** (or vice versa) → packaging errors / missing functionality;
  match the type to the code.
- **Missing plugin dependency** in `.uplugin` → load failures when the dependency is off.
- **Plugin content not mounting** — `CanContainContent` must be true and content under `Content/`.
- **Circular module/plugin deps** don't link — factor shared code into a lower-level module.
- **Engine plugin vs project plugin confusion** — know which `Plugins/` it lives in.

## References & source material

Engine source (UE 5.7):
- `Runtime/Projects/Public/PluginDescriptor.h` — `.uplugin` schema.
- `Runtime/Projects/Public/Interfaces/IPluginManager.h` — `IPluginManager`/`IPlugin`.
- `Runtime/Core/Public/Modules/ModuleManager.h` — module registration/loading.

Official docs (UE 5.7): Setting Up Your Production Pipeline —
<https://dev.epicgames.com/documentation/unreal-engine/setting-up-your-production-pipeline-in-unreal-engine>

Related: `unreal-module-and-build-system`, `unreal-project-structure`, `editor-scripting-and-python`.
