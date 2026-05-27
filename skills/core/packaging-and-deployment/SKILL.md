---
name: packaging-and-deployment
description: Cook, package, and ship an Unreal project — the cook process (by-the-book vs
  on-the-fly, cook rules, always/never cook directories, shader sharing), build configurations
  (Debug/DebugGame/Development/Test/Shipping) and build targets (Game/Client/Server/Editor)
  declared in *.Target.cs files, UAT BuildCookRun command-line pipeline, pak files and the
  modern IoStore (.utoc/.ucas) container format, asset chunking and Primary Asset Rules for
  DLC/patching, ProjectPackagingSettings (bUseIoStore, bGenerateChunks, bCompressed,
  DirectoriesToAlwaysCook/NeverCook), platform targets, content-on-demand / IoStore On-Demand,
  and shipping-vs-development behavioral differences (WITH_EDITOR, stripped checks/logs). Use
  when producing a runnable build, automating cook/package in CI, diagnosing packaging failures,
  configuring what ships, or setting up chunked DLC delivery.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Packaging & deployment

Shipping an Unreal project involves three distinct stages that run in sequence:
**build** (compile the game executable), **cook** (convert assets to the target
platform's runtime format), and **package** (assemble the cooked assets and executable
into a distributable build, typically inside pak/IoStore containers). Each stage can fail
independently; diagnosing a failure means identifying which stage it belongs to.

## When to use this skill

- Producing a runnable build for a platform (automated CI or manual).
- Diagnosing a cook or package failure, or a build that works in PIE but breaks packaged.
- Configuring what content ships: always-cook directories, never-cook exclusions, shader sharing.
- Setting up pak chunking for streaming installs, patching, or DLC.
- Choosing the right build configuration and target for a given deployment scenario.

## Build configurations and targets

**Target types** — defined by `*.Target.cs` files, one per target:

| Target | Produces | Use for |
|---|---|---|
| `Game` | Cooked, monolithic game executable | Shipping, QA, end-user builds |
| `Editor` | Modular editor + DLL set | Development only; never packaged for end users |
| `Client` | Game executable, no server code | Client-only in a client/server split |
| `Server` | Headless game server, no client rendering | Dedicated server for multiplayer |
| `Program` | Standalone program (e.g. ShaderCompileWorker) | Engine tooling |

Source: `TargetType` enum — `Engine/Source/Programs/UnrealBuildTool/Configuration/TargetRules.cs`:21.

**Build configurations** — controls optimization and what debugging/logging facilities are
compiled in:

| Configuration | Optimized? | `check`/`ensure`? | Logging? | Use for |
|---|---|---|---|---|
| `Debug` | No | Yes | Full | Full engine+game debug (slow) |
| `DebugGame` | Engine yes, game no | Yes | Full | Debug game modules only |
| `Development` | Yes | Yes | Full | Daily iteration; editor default |
| `Test` | Yes | Some | Some | Performance test; shipping-like |
| `Shipping` | Max | No | Minimal | Release builds |

Source: `UnrealTargetConfiguration` enum —
`Engine/Source/Programs/UnrealBuildTool/Configuration/UEBuildTarget.cs`:1066.

The packaging UI (`EProjectPackagingBuildConfigurations`) mirrors these five values as
`PPBC_Debug … PPBC_Shipping` — see `ProjectPackagingSettings.h`:18.

**Key rule:** always test the Shipping (or Test) configuration before release. `check()`
macros, most `UE_LOG` calls, and the console are stripped or limited in Shipping — never
put logic inside a `check` or rely on console state in packaged builds. See
`logging-and-assertions`.

## The cook process

Cooking converts editor assets (`.uasset`, textures, audio) into the target platform's
runtime format. The cooker is invoked as a special commandlet mode of `UnrealEditor-cmd`.

**What gets cooked:** assets reachable via hard or soft references from the startup map
and any "always cook" directories/entries. Unreferenced content is not cooked. This is
why a purely string-loaded asset (soft path with no reference) silently disappears unless
you declare it via the Asset Manager or `DirectoriesToAlwaysCook`.

**Cook modes:**
- **By-the-book (CBTB):** entire cook runs up front; produces the full set of cooked
  packages before packaging. Required for final/CI builds.
- **Cook on the fly (COTF):** a cook server on the host machine serves packages on demand
  as a connected device requests them. Faster iteration, but not suitable for final builds.

**Cook rules** (per primary asset, set via Asset Manager or `DefaultGame.ini`):
- `AlwaysCook` — include regardless of reference.
- `NeverCook` — exclude even if referenced (e.g. editor-only test assets).
- `Unknown` — follow reference graph (default).

Shader code can be shared across materials via `bShareMaterialShaderCode` in
`UProjectPackagingSettings` — reduces duplication at a small load-time cost.

## UAT BuildCookRun — the canonical pipeline

The Unreal Automation Tool (`RunUAT.bat` / `RunUAT.sh`) orchestrates the full pipeline
via its `BuildCookRun` command:

```
Engine/Build/BatchFiles/RunUAT.bat BuildCookRun \
  -project=D:/MyGame/MyGame.uproject \
  -noP4 \
  -platform=Win64 \
  -clientconfig=Shipping \
  -build \
  -cook \
  -allmaps \
  -stage \
  -pak \
  -archive \
  -archivedirectory=D:/Builds/MyGame_Shipping
```

Each flag maps to a stage: `-build` compiles the target, `-cook` runs the cooker,
`-stage` copies to a staging directory, `-pak` wraps cooked content into .pak/IoStore
containers, `-archive` copies the final build to the output path. Omit any stage to skip
it (e.g. skip `-build` when the executable is already built by a separate CI step).

Add `-iostore` to enable IoStore container output (`.utoc`/`.ucas`) instead of classic
`.pak`-only output. This matches enabling `bUseIoStore` in Project Settings.

UAT script path (C#): `Engine/Source/Programs/AutomationTool/Scripts/BuildCookRun.Automation.cs`.

Full BuildCookRun flag reference: [references/buildcookrun-and-uat.md](references/buildcookrun-and-uat.md).

## Pak files and the IoStore container format

After cooking, content is packaged into containers for distribution:

- **Classic pak (`.pak`):** a simple archive format; a single monolithic file or one per
  chunk. Still fully supported; adequate for many projects.
- **IoStore (`.utoc` + `.ucas`):** the modern default. `.utoc` is the table of contents;
  `.ucas` holds the bulk payload. Offers faster I/O via the IoDispatcher because packages
  are addressed by hash ID rather than path. Enabled via `bUseIoStore = true` in Project
  Settings (or `-iostore` flag to UAT).

Both formats support compression (`bCompressed`, `PackageCompressionFormat`) and
encryption (configured via the crypto key system, not the deprecated ini flags).

**Chunking** splits content across multiple pak/IoStore containers for streaming installs,
DLC, or patching. Each chunk maps to a numbered `.pak` / `.ucas` file (e.g.
`pakchunk1-Windows.pak`). Chunk 0 is the base install; chunks 1+ are downloaded
separately. Configure via `bGenerateChunks = true` and Primary Asset Rules.

Details: [references/pak-iostore-and-chunking.md](references/pak-iostore-and-chunking.md).

## ProjectPackagingSettings — what ships

`UProjectPackagingSettings` (`UCLASS(config=Game, defaultconfig)`) persists to
`Config/DefaultGame.ini` under section `[/Script/UnrealEd.ProjectPackagingSettings]`.
Key properties (verified in
`Engine/Source/Developer/DeveloperToolSettings/Classes/Settings/ProjectPackagingSettings.h`):

| Property | Effect |
|---|---|
| `BuildConfiguration` (`PPBC_*`) | Which configuration to build |
| `bUseIoStore` | Use `.utoc`/`.ucas` IoStore containers |
| `bUseZenStore` | Use Zen Server as cooked data store (requires `bUseIoStore`) |
| `bGenerateChunks` | Split content into numbered chunks |
| `bGenerateNoChunks` | Override all platforms to disable chunking |
| `bChunkHardReferencesOnly` | Only hard-reference dependencies follow their chunk |
| `bCompressed` | Compress cooked packages |
| `PackageCompressionFormat` | Comma-separated list (e.g. `Oodle`) |
| `bShareMaterialShaderCode` | Deduplicate shader bytecode across materials |
| `DirectoriesToAlwaysCook` | Force-cook these content paths regardless of references |
| `DirectoriesToNeverCook` | Exclude these paths even if referenced |
| `MapsToCook` | Explicit map list when not using `-allmaps` |
| `bCookAll` | Cook every asset in the content directory |
| `bSkipEditorContent` | Exclude `/Game/Editor*` folders from the cook |

Access in code: `GetDefault<UProjectPackagingSettings>()` (editor only).

## Platforms, Device Profiles, and scalability

Each platform target (Win64, Android, iOS, console) requires its SDK and platform files.
Platform-specific packaging overrides live in `Config/[Platform]/[Platform]Game.ini`.

**Device Profiles** (`DeviceProfiles.ini`) set per-platform CVars and scalability groups —
the correct way to vary rendering quality per platform. Never hardcode `r.*` CVars in
C++ or Blueprint; use Device Profiles so the cooker and runtime can select them correctly.

A **Client/Server** split (`Game` + `Server` targets built separately) is the standard
multiplayer packaging pattern; the server binary runs headless and ships without rendering
modules. See `networking-and-replication`.

## Content-on-demand / IoStore On-Demand

The IoStore On-Demand system (`Runtime/Experimental/IoStore/OnDemand/`) allows a shipped
game to fetch content from a CDN at runtime rather than requiring it to be installed
upfront. The `IOnDemandIoStore` interface (`IoStoreOnDemand.h`) manages requests with
statuses Pending / Ok / Cancelled / Error. This is the foundation for streaming installs,
live-service content drops, and large-world on-demand streaming beyond what the base chunk
system handles.

## Shipping vs. development (mind the gap)

| Behavior | Development | Shipping |
|---|---|---|
| `check()` / `ensure()` | Fire, assert | Compiled out (`DO_CHECK=0`) |
| `UE_LOG(...)` | All categories | Most stripped; use sparingly |
| Console commands | Available | Removed |
| `WITH_EDITOR` code | Included | Excluded |
| Editor modules | Loaded | Not present |

Always smoke-test a **packaged Shipping build** before release — PIE and Development
builds mask many of these gaps. Guard editor-only code with `#if WITH_EDITOR` so it
compiles out of runtime targets. See `logging-and-assertions` for `verify` vs `check`.

## Gotchas

- **Editor-only API in runtime code** — cook/link errors; gate with `#if WITH_EDITOR`.
- **Content not reachable** — not cooked → missing at runtime. Hard-ref or add to
  `DirectoriesToAlwaysCook`. Use the Asset Audit window to inspect chunk assignments.
- **Works in PIE, broken packaged** — typically editor-only deps, uncooked assets, or
  absolute file paths.
- **`check`/`ensure`/`UE_LOG` used for logic** — silently does nothing in Shipping;
  never put required side-effects inside them.
- **Hardcoded `r.*` CVars** — bypass Device Profiles and platform-specific scalability.
- **Forgot `-iostore` flag with IoStore settings** — UAT and Project Settings must agree.
- **bUseZenStore without bUseIoStore** — Zen Store is a no-op unless IoStore is enabled.
- **Wrong target cooked** — cooking the Editor target instead of Game produces an
  unrunnable result; confirm the `BuildTarget` in `ProjectPackagingSettings`.
- **Cook time blowup** — enable iterative cooking (`-iterate` flag to UAT) during
  iteration; disable for final CI builds to guarantee a clean output.

## Version notes

- **IoStore as modern default:** `bUseIoStore` defaults to `true` for new projects as of
  UE5. Classic `.pak`-only builds still work. Console platforms often require IoStore.
- **Zen Store** (`bUseZenStore`): introduced in UE5, off by default, used by some large
  first-party titles to centralize cooked data.
- **Blueprint nativization** is deprecated (removed in UE5, `UE_DEPRECATED(5.0, ...)`);
  do not rely on it.

## References & source material

Engine source (UE 5.7):
- `UProjectPackagingSettings` (properties, enums, cook rules) —
  `Engine/Source/Developer/DeveloperToolSettings/Classes/Settings/ProjectPackagingSettings.h`:179.
  `EProjectPackagingBuildConfigurations`:18, `EAssetRegistryWritebackMethod`:105,
  `bUseIoStore`:270, `bGenerateChunks`:285, `bCompressed`:343, `DirectoriesToAlwaysCook`:588.
- `TargetType` enum — `Engine/Source/Programs/UnrealBuildTool/Configuration/TargetRules.cs`:21.
- `UnrealTargetConfiguration` enum (Debug…Shipping) —
  `Engine/Source/Programs/UnrealBuildTool/Configuration/UEBuildTarget.cs`:1066.
- `BuildCookRun` UAT command class —
  `Engine/Source/Programs/AutomationTool/Scripts/BuildCookRun.Automation.cs`:24.
- IoStore container format (`EIoStoreTocVersion`, `FIoStoreTocHeader`) —
  `Engine/Source/Runtime/Core/Internal/IO/IoStore.h`:25.
- IoStore On-Demand (`IOnDemandIoStore`, `FOnDemandRequest`) —
  `Engine/Source/Runtime/Experimental/IoStore/OnDemandCore/Public/IO/IoStoreOnDemand.h`:36.
- `WITH_EDITOR`, `WITH_EDITORONLY_DATA` preprocessor guards —
  `Engine/Source/Runtime/Core/Public/Misc/Build.h`:66.

Official docs (UE 5.7, all fetched and confirmed live):
- Build Configurations Reference —
  <https://dev.epicgames.com/documentation/unreal-engine/build-configurations-reference-for-unreal-engine>
- Build Operations: Cook, Package, Deploy, and Run —
  <https://dev.epicgames.com/documentation/unreal-engine/build-operations-cooking-packaging-deploying-and-running-projects-in-unreal-engine>
- Cooking and Chunking —
  <https://dev.epicgames.com/documentation/unreal-engine/cooking-content-and-creating-chunks-in-unreal-engine>
- Project Launcher Reference —
  <https://dev.epicgames.com/documentation/unreal-engine/using-the-project-launcher-in-unreal-engine>
- Patching, Content Delivery, and DLC —
  <https://dev.epicgames.com/documentation/unreal-engine/patching-content-delivery-and-dlc-in-unreal-engine>
- Sharing and Releasing Projects —
  <https://dev.epicgames.com/documentation/unreal-engine/sharing-and-releasing-projects-for-unreal-engine>

Deep-dive references in this skill:
- [references/cook-and-build-configs.md](references/cook-and-build-configs.md) — cook
  pipeline internals, cook rules, shader sharing, iterative cook, cook commandlet options.
- [references/buildcookrun-and-uat.md](references/buildcookrun-and-uat.md) — full
  BuildCookRun flag reference, UAT structure, CI patterns.
- [references/pak-iostore-and-chunking.md](references/pak-iostore-and-chunking.md) —
  pak vs IoStore format details, chunk assignment (Asset Manager, Primary Asset Labels,
  config overrides), compression, encryption.
- [references/platform-and-dlc.md](references/platform-and-dlc.md) — platform targets,
  Device Profiles, Client/Server split, IoStore On-Demand / content-on-demand, patching.

Related skills: `module-and-build-system`, `asset-management`, `logging-and-assertions`,
`networking-and-replication`, `project-structure`.
