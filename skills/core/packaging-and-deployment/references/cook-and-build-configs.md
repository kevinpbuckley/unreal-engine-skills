# Cook process & build configurations — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the cook pipeline internals, cook rules,
what the configurations actually control, shader sharing, iterative cook, and the cook
commandlet flags. Grounded in UE 5.7
(`Engine/Source/Developer/DeveloperToolSettings/Classes/Settings/ProjectPackagingSettings.h`
and `Engine/Source/Programs/UnrealBuildTool/Configuration/UEBuildTarget.cs`) and the
official
[Build Operations: Cook, Package, Deploy, and Run](https://dev.epicgames.com/documentation/unreal-engine/build-operations-cooking-packaging-deploying-and-running-projects-in-unreal-engine)
doc.

## What happens during a cook

1. The cooker launches as a commandlet inside `UnrealEditor-cmd.exe` (or the editor
   in a special `-run=cook` mode).
2. It starts from the set of maps/assets specified on the command line (or all maps if
   `-allmaps` is passed) and walks the hard- and soft-reference graph, adding each
   reachable package to the cook queue.
3. For each package, it serializes the in-memory object tree into the target platform's
   binary format (platform-specific texture compression, audio encoding, etc.) and
   writes the result to `Saved/Cooked/[Platform]/`.
4. A derived data cache (DDC) backs the results; on subsequent cooks only changed
   packages are re-cooked (iterative cook mode).

The cooker does **not** discover assets that have no inbound reference and are not
listed in an "always cook" rule. This is the source of the classic "missing at runtime"
bug for soft-path-only assets.

## Cook rules and `EPrimaryAssetCookRule`

Cook rules are attached to primary assets via the Asset Manager (`FPrimaryAssetRules`):

| Rule | Behavior |
|---|---|
| `Unknown` | Follow reference graph (default for most assets) |
| `AlwaysCook` | Force-cook even if no runtime reference exists |
| `AlwaysCookAndNeverBundle` | Always cook but never put into a bundle/chunk |
| `NeverCook` | Exclude from the cook even if referenced |
| `DevelopmentCook` | Include only in non-Shipping cooks |

Set via `DefaultGame.ini`:

```ini
[/Script/Engine.AssetManagerSettings]
+PrimaryAssetRules=(PrimaryAssetId="Map:/Game/Maps/MyMap",Rules=(Priority=-1,ChunkId=1,CookRule=AlwaysCook))
```

`DirectoriesToAlwaysCook` and `DirectoriesToNeverCook` in `UProjectPackagingSettings`
apply the same logic at directory granularity without touching the Asset Manager rules.

## Build configuration details

`UnrealTargetConfiguration` (source: `UEBuildTarget.cs`:1066) maps to compiler flags
and engine preprocessor macros:

**`Debug`** — no optimization (`/Od` on MSVC), full debug info. Both engine and game
modules are unoptimized. Opening the editor requires the `-debug` flag. Rarely used for
packaging; mainly for crash investigations.

**`DebugGame`** — engine modules optimized (like Development), game modules unoptimized.
The practical debugging config: editor speed is acceptable, game code is debuggable.

**`Development`** — equivalent to a release build with full logging and
`check`/`ensure`. The editor's default. Cooked builds run at near-production speed.
Use for playtests and pre-release QA.

**`Test`** — a Shipping build with a subset of console commands, stats, and profiling
tools re-enabled. The correct config for performance benchmarks and certification QA
(approximates Shipping behaviour without being completely dark).

**`Shipping`** — maximum optimization, `DO_CHECK = 0` (all `check`/`ensure` compiled
out), most `UE_LOG` categories suppressed, console commands removed. Use for store
submissions and final release builds. Treat it as a different runtime — always validate
a Shipping build separately from a Development build.

## WITH_EDITOR and editor-only guards

The preprocessor macro `WITH_EDITOR` is set to `1` for Editor target builds and `0`
for all cooked targets (Game, Client, Server). `WITH_EDITORONLY_DATA` controls whether
editor metadata is serialized into packages (it is, by default, for client configs, but
the data is stripped during cooking).

Source: `Engine/Source/Runtime/Core/Public/Misc/Build.h`:66.

Pattern for guarding editor-only code in a runtime module:

```cpp
#if WITH_EDITOR
// Safe: only compiled into Editor targets
void AMyActor::DrawDebugHelpers()
{
    // editor visualization, not available in packaged builds
}
#endif
```

A common packaging failure is calling an `UnrealEd` API (e.g. `FEditorDelegates`,
`GEditor`) from a Runtime module without this guard — it will compile and run in PIE
but fail to link in a Game target.

## Shader sharing and material libraries

`bShareMaterialShaderCode = true` extracts shader bytecode from individual material
packages and stores it in a shared shader library file (`ShaderArchive-*.ushaderbytecode`
or the platform-native equivalent). The tradeoff:

- **Benefit:** significantly reduced total package size when many materials share the
  same shader permutations.
- **Cost:** a small additional load-time step to mount the shared library before any
  material can be used.

`bDeterministicShaderCodeOrder` sorts the shared library by shader hash rather than
cook order — makes patch diffs smaller but can affect load order. Enable for shipping
builds where patch size matters.

`bSharedMaterialNativeLibraries` uses a platform-specific binary library format (e.g.
Metal function archives on iOS/macOS, pipeline caches on Vulkan) instead of the
platform-agnostic `.ushaderbytecode`. Requires a restart to take effect (`ConfigRestartRequired`).

## Iterative cook

Pass `-iterate` to UAT (or enable "Iterative Cooking" in the Project Launcher) to skip
re-cooking packages that are unchanged since the last cook. The DDC tracks hashes of
the source packages and their cook inputs.

Iterative cook is appropriate for rapid iteration during development. For CI/release
builds, always do a full (non-iterative) cook from a clean Saved/Cooked directory to
guarantee a deterministic output. A stale cooked package with the same hash as the
source but a different runtime dependency can silently produce a broken build.

## Cook commandlet flags (selected)

Used via `UnrealEditor-cmd.exe [project] -run=cook -targetplatform=[Platform] ...`:

| Flag | Effect |
|---|---|
| `-targetplatform=Win64` | Target platform for the cook |
| `-iterate` | Skip unchanged packages (iterative cook) |
| `-allmaps` | Cook all maps in the project |
| `-map=MapName` | Cook only specified map(s) |
| `-unversioned` | Omit package version — smaller patches, fragile across engine updates |
| `-compressed` | Compress cooked packages |
| `-warningsaserrors` | Fail the cook on any warning (good for CI) |
| `-cookall` | Cook every asset in Content/ regardless of references |
| `-skipeditorcontent` | Exclude editor-only content directories |
| `-ddc=DerivedDataBackendGraph` | Override the DDC backend graph |
| `-numcookerstospin=N` | Multi-process cook (see Multi-Process Cooking doc) |
