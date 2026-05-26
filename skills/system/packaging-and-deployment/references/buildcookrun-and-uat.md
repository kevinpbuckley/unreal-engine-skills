# BuildCookRun & UAT — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the Unreal Automation Tool structure,
BuildCookRun stages, flag reference, and CI pipeline patterns. Grounded in UE 5.7
(`Engine/Source/Programs/AutomationTool/Scripts/BuildCookRun.Automation.cs`) and the
official
[Build Operations: Cook, Package, Deploy, and Run](https://dev.epicgames.com/documentation/unreal-engine/build-operations-cooking-packaging-deploying-and-running-projects-in-unreal-engine)
doc.

## UAT structure

The Unreal Automation Tool (UAT) is a C# program that lives under
`Engine/Source/Programs/AutomationTool/`. It discovers automation scripts (`.Automation.cs`
files) at startup and executes named commands. The entry point for packaging is the
`BuildCookRun` command class (`BuildCookRun.Automation.cs`:24), which delegates to a
`ProjectParams` object and then calls stage methods in sequence.

The runner scripts are at `Engine/Build/BatchFiles/`:
- Windows: `RunUAT.bat`
- macOS/Linux: `RunUAT.sh`

## BuildCookRun pipeline stages

Each stage is individually enabled by a flag; stages that are disabled are skipped:

| Stage | Flag | What it does |
|---|---|---|
| Build | `-build` | Compiles the game executable via UBT for the target platform |
| Cook | `-cook` | Runs the cooker commandlet to convert assets |
| Stage | `-stage` | Copies executables and cooked content to a staging directory |
| Pak/IoStore | `-pak` / `-iostore` | Wraps staged content into container files |
| Archive | `-archive` | Copies the staged build to the archive directory |
| Deploy | `-deploy` | Installs the build on a connected device |
| Run | `-run` | Launches the game on the device after deployment |

A typical CI packaging command uses `-build -cook -stage -pak -archive` and omits
`-deploy` and `-run` (those are for on-device testing, not final builds).

## Essential flags

### Project and platform

| Flag | Example / Notes |
|---|---|
| `-project=<path>` | Full path to `.uproject`. Required. |
| `-platform=<name>` | `Win64`, `Android`, `IOS`, `Linux`, etc. |
| `-targetplatform=<name>` | Cook-only platform override (same values as `-platform`) |
| `-noP4` | Disable Perforce integration (use in most CI environments) |

### Build configuration

| Flag | Notes |
|---|---|
| `-clientconfig=<config>` | Configuration for the client/game target: `Debug`, `DebugGame`, `Development`, `Test`, `Shipping` |
| `-serverconfig=<config>` | Configuration for the server target |
| `-nodebuginfo` | Omit debug symbols from the staged build |

### Cook flags

| Flag | Notes |
|---|---|
| `-cook` | Enable the cook stage |
| `-allmaps` | Cook all maps discovered in the project |
| `-map=<map>` | Cook only specified maps (repeatable) |
| `-iterate` | Iterative cook — skip unchanged packages |
| `-skipeditorcontent` | Skip `Editor/` content directories during cook |
| `-cookall` | Cook every package in the Content/ directory |
| `-compressed` | Compress cooked packages |
| `-unversioned` | Remove version data from packages (smaller patches, fragile) |
| `-warningsaserrors` | Treat cook warnings as errors (CI recommendation) |
| `-ddc=<graph>` | Override DDC backend graph (e.g. a shared DDC network path) |
| `-numcookerstospin=<N>` | Spin up N additional cook-worker processes |

### Packaging and containers

| Flag | Notes |
|---|---|
| `-pak` | Wrap cooked content in `.pak` files |
| `-iostore` | Use IoStore (`.utoc` / `.ucas`) container format |
| `-makebinaryconfig` | Bake config into a binary file for faster startup |
| `-generatechunks` | Split content into numbered chunks |
| `-nochunks` | Override: disable chunking even if Project Settings enables it |
| `-encrypt` | Apply encryption (key config comes from `CryptoKeys.json`) |

### Staging and archiving

| Flag | Notes |
|---|---|
| `-stage` | Copy to staging directory |
| `-stagingdirectory=<path>` | Override default staging path |
| `-archive` | Copy staged build to archive directory |
| `-archivedirectory=<path>` | Destination for the archived build |
| `-clean` | Clean the staging directory before staging |

### Deploy and launch

| Flag | Notes |
|---|---|
| `-deploy` | Deploy to a connected device after packaging |
| `-device=<id>` | Target device ID |
| `-run` | Launch on device after deployment |
| `-addcmdline="<args>"` | Pass extra command-line arguments to the launched game |

## Minimal CI example (Win64 Shipping)

```bat
Engine\Build\BatchFiles\RunUAT.bat BuildCookRun ^
  -project=D:\MyGame\MyGame.uproject ^
  -noP4 ^
  -platform=Win64 ^
  -clientconfig=Shipping ^
  -build ^
  -cook ^
  -allmaps ^
  -stage ^
  -pak ^
  -iostore ^
  -archive ^
  -archivedirectory=D:\Builds\MyGame_Win64_Shipping ^
  -warningsaserrors
```

## Skipping the build stage in CI

When a dedicated build step already compiled the executable (common in
multi-stage pipelines), omit `-build` from the package step. The cook and pak
stages do not require a fresh compile if the executable is already on disk.

```bat
RunUAT.bat BuildCookRun -project=... -platform=Win64 -clientconfig=Shipping ^
  -cook -allmaps -stage -pak -iostore -archive -archivedirectory=...
```

## ProjectParams and custom automation

`ProjectParams` (set up in `BuildCookRun.Automation.cs:48`) is the C# object that
accumulates all parsed flags and is passed to each stage. Advanced pipelines can
author their own UAT scripts that construct `ProjectParams` directly, skipping the
flag-parsing layer — useful when packaging multiple platform targets in a single
automation script with shared cook output.

## Build operations via the Project Launcher (equivalent)

The Project Launcher generates a `BuildCookRun` command line from its UI; the Output
Log shows the exact command run. Everything that follows `BuildCookRun` in that log can
be pasted after `RunUAT.bat BuildCookRun` to reproduce the same build from the command
line. This is a reliable way to discover the correct flags for a new platform without
hand-authoring them.
