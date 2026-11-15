---
skill: ue-web-wasm-webgpu
title: Fix a Wasm cook that fails on toolset manifests and a plugin-root never-cook
---

Scoring note: layer 1 (compiles) is **N/A - config/diagnosis task**. Layer 2 (API truth)
checks the ini section, keys and paths against the UE 5.9 install. Layer 3 is the criteria
below.

## Prompt

A UE 5.9 C++ project with Epic's AI toolset plugins enabled for the editor (`AllToolsets`,
`ToolsetRegistry`, `ModelContextProtocol`) is being packaged for the web with
`RunUAT BuildCookRun -platform=Wasm -clientconfig=Shipping -cook ...`. The `.uproject`
already gives those plugins `"TargetAllowList": ["Editor"], "PlatformDenyList": ["Wasm"]`.

The first cook failed with exit code 25:

```
LogCook: Error: Failed to cook /ToolsetRegistry/ToolsetManifestSeed/_Generated_/ConsoleToolset for platform Wasm. It imports class /Script/ToolsetRegistry.ToolsetRegistryManifest, which is in a module that is not available on the platform.
LogCook: Error: Failed to cook /ToolsetRegistry/ToolsetManifestSeed/_Generated_/InputToolset for platform Wasm. It imports class /Script/ToolsetRegistry.ToolsetRegistryManifest, which is in a module that is not available on the platform.
...
AutomationTool exiting with ExitCode=25 (Error_UnknownCookFailure)
```

A teammate then added this to `Config/DefaultGame.ini`:

```ini
[/Script/UnrealEd.ProjectPackagingSettings]
+DirectoriesToNeverCook=(Path="/ToolsetRegistry")
```

The six errors went away, but the cook now fails on:

```
Ensure condition failed: !DefaultDomain.IsValid() [File:.../AssetReferencingDomains.cpp] [Line: 101]
Registered the path /ToolsetRegistry/ for two different domains: Plugin:ToolsetRegistry and Never Cooked Content
```

Explain both failures and give the exact `Config/DefaultGame.ini` change that makes the Wasm
cook pass while the toolsets stay enabled in the editor. The project also wants its editor-only
bake intermediates under `/Game/MyGame/Editor` kept out of every cook.

## Acceptance criteria

- Explains that `ToolsetRegistry` generates the `/ToolsetRegistry/ToolsetManifestSeed/...`
  packages in memory when the cook commandlet starts, so the `.uproject` deny list (which keeps
  the plugin's modules out of the Wasm target) does not stop them being cooked; their class lives
  in a module the Wasm runtime does not have.
- Explains that a plugin's **root** mount (`/ToolsetRegistry`) cannot be a never-cook directory:
  it is already registered as the plugin's own domain, hence the "two different domains" ensure.
- The fix removes `+DirectoriesToNeverCook=(Path="/ToolsetRegistry")` and adds
  `+DirectoriesToNeverCook=(Path="/ToolsetRegistry/ToolsetManifestSeed")` under
  `[/Script/UnrealEd.ProjectPackagingSettings]` in `Config/DefaultGame.ini`.
- Adds `+DirectoriesToNeverCook=(Path="/Game/MyGame/Editor")` in the same section.
- Does not disable the toolset plugins for the editor, and does not suggest editing engine
  ini files or the plugin's own config.
- Mentions at least one of: cook again after changing a never-cook list (a referenced folder
  fails with `Content is missing from cook`); do not edit `Config/*.ini` while a cook is running.

## Common baseline failures

Keeping the plugin-root never-cook line, or "fixing" the ensure by disabling
`AssetReferenceRestrictions` or the toolsets altogether; adding more `PlatformDenyList` /
`SupportedTargetPlatforms` entries (the cook still generates the packages); inventing a
`bCookToolsetManifests` setting; putting the line in `DefaultEngine.ini` or under the wrong
section; never-cooking `/ToolsetRegistry/` with a trailing slash (still the root).
