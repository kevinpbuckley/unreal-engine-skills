---
name: packaging-and-deployment
description: Build, cook, package, and ship an Unreal project — build configurations (Development/
  Shipping/Test) and target types, cooking content for a platform, packaging via the editor or UAT
  BuildCookRun, pak files and chunking, packaging settings, and shipping vs development differences.
  Use when producing a runnable build, setting up cook/package in CI, troubleshooting packaging
  failures, or configuring what ships.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Packaging & deployment

Shipping an Unreal game means **building** code for a target, **cooking** content into the
platform's format, and **packaging** it into a runnable build (with pak files). Most packaging
failures are editor-only code leaking into runtime, missing references, or config mistakes.

## When to use this skill

- Producing a packaged build for a platform.
- Automating cook/package in CI.
- A build that fails to cook/package, or runs in editor but not packaged.
- Configuring what's included and how it's chunked/compressed.

## Build configurations & targets

- **Configurations:** `Debug`, `DebugGame`, **`Development`** (default for iteration; logging +
  `check`), **`Test`** (shipping-like with some tooling), **`Shipping`** (optimized; `check`
  compiled out, minimal logging). See `unreal-logging-and-assertions` for what changes.
- **Target types** (`*.Target.cs`, `unreal-module-and-build-system`): `Game`, `Editor`, `Server`,
  `Client`, `Program`. You package the Game/Client/Server targets, not Editor.

## Cooking

Cooking converts editor assets into the **target platform's** runtime format (shaders, textures,
audio) and gathers what's referenced. Only referenced/needed content is cooked (plus anything in
"always cook" directories / asset manager rules). Unreferenced content is left out — which is why a
hard vs soft reference and Asset Manager setup matters (`asset-management`).

## Packaging

- **Editor:** Platforms → Package Project → pick platform & configuration.
- **Command line / CI:** `RunUAT BuildCookRun` (Unreal Automation Tool):
  ```
  RunUAT BuildCookRun -project=<Path>.uproject -noP4 -platform=Win64 ^
    -clientconfig=Shipping -cook -allmaps -build -stage -pak -archive -archivedirectory=<Out>
  ```
  This builds, cooks, stages, paks, and archives a runnable build — the canonical CI command.

## Pak files & chunking

- Cooked content is packed into **.pak** files (optionally compressed/encrypted).
- **Chunking:** the Asset Manager assigns assets to chunks (chunk IDs) to split content for
  patching/DLC/on-demand download. Configure primary asset rules + chunk assignments for large titles.

## Packaging settings (what ships)

Project Settings → Packaging (writes to `Config/DefaultGame.ini`): which maps to include, build
configuration, full vs iterative cook, compression, "Directories to always cook/never cook", and
list of maps. Project Settings → Maps & Modes sets the default/startup map.

## Platforms & scalability

- Each target platform needs its SDK and platform files; **Device Profiles** set per-platform
  scalability/cvars (`nanite-and-rendering`) — don't hardcode `r.*` in code.
- Server/Client split builds for dedicated-server multiplayer (`networking-and-replication`).

## Shipping vs development (mind the gap)

- `check`/`ensure` and most `UE_LOG` are stripped/limited in Shipping — don't rely on them for
  logic; never put required side effects in `check` (use `verify`, `unreal-logging-and-assertions`).
- Editor-only code (`WITH_EDITOR`, editor modules) isn't present — guard runtime code accordingly.
- Always smoke-test the **packaged** build, not just PIE.

## Gotchas

- **Editor-only API in runtime code** → cook/package errors; gate with `WITH_EDITOR` / editor modules.
- **Content not referenced** → not cooked → missing at runtime; use hard refs or Asset Manager
  "always cook" rules for things loaded purely by string/soft path.
- **Works in PIE, broken packaged** → usually editor-only deps, absolute paths, or uncooked content.
- **Shipping logic depending on `check`/logs** that get stripped.
- **Hardcoded `r.*` cvars** instead of device profiles.

## References & source material

Engine source (UE 5.7):
- `Programs/UnrealBuildTool/Configuration/TargetRules.cs` — target types, build configuration fields.
- Packaging settings live in `Config/DefaultGame.ini` (`[/Script/UnrealEd.ProjectPackagingSettings]`)
  and Maps & Modes in `DefaultEngine.ini` (`unreal-project-structure`).
- Build/cook/package is driven by UAT/UBT under `Engine/Source/Programs/`.

Official docs (UE 5.7): Sharing and Releasing Projects —
<https://dev.epicgames.com/documentation/unreal-engine/sharing-and-releasing-projects-for-unreal-engine>

Related: `unreal-module-and-build-system`, `asset-management`, `unreal-logging-and-assertions`.
