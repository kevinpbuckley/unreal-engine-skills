# Build.cs (ModuleRules) Reference

Grounded in UE 5.7 engine source:
`E:\Program Files\Epic Games\UE_5.7\Engine\Source\Programs\UnrealBuildTool\Configuration\ModuleRules.cs`

See also: [../SKILL.md](../SKILL.md)

## The ModuleRules class

Every `<Name>.Build.cs` file declares a class inheriting `ModuleRules`. UBT compiles these
C# files at build time and evaluates them to determine the compile environment for each module.

Constructor signature:
```csharp
public MyModule(ReadOnlyTargetRules Target) : base(Target)
```

The `Target` parameter exposes platform, configuration, and target-type queries so your
`Build.cs` can conditionally include or exclude dependencies.

## Dependency lists

| Property | Line | Purpose |
|---|---|---|
| `PublicDependencyModuleNames` | 1189 | Types from these modules appear in your public headers. Consumers of your module inherit these includes automatically. |
| `PrivateDependencyModuleNames` | 1200 | Used only in `.cpp`/private headers. Not inherited by consuming modules. Prefer private to keep the public API surface lean. |
| `PublicIncludePathModuleNames` | (ModuleRules.cs) | Adds include paths from another module without linking — for forward-declaration-only includes. |
| `PrivateIncludePathModuleNames` | (ModuleRules.cs) | Same as above, private scope. |
| `DynamicallyLoadedModuleNames` | (ModuleRules.cs) | Modules this module may load at runtime via `FModuleManager`; not linked at compile time. |

Decision rule: if you forward-declare a type in your header and only use the full definition in
`.cpp`, that dependency can be `Private`. If the full type appears in your `.h`, it must be
`Public` so consumers can compile code that includes your header.

## PCH and IWYU settings

| Property | Values | Notes |
|---|---|---|
| `PCHUsage` | `PCHUsageMode` enum (line 193) | Controls precompiled header sharing. |
| `UseExplicitOrSharedPCHs` | (recommended) | Enables IWYU compliance. Each `.cpp` must include its matching `.h` first. A private `PrivatePCHHeaderFile` generates an explicit PCH; otherwise shares one. |
| `UseSharedPCHs` | (legacy) | Allows monolithic-style shared PCHs. Not IWYU-safe for new code. |
| `NoPCHs` | (rare) | Disable all PCHs for this module. Slow but guarantees isolated compilation. |
| `bEnforceIWYU` | bool | When `true` with `UseExplicitOrSharedPCHs`, warns on monolithic header includes. |
| `PrivatePCHHeaderFile` | string | Path to an explicit private PCH header (relative to module root). |

## Compile behavior

| Property | Notes |
|---|---|
| `OptimizeCode` | `CodeOptimization` enum — `Default` / `Never` / `InNonDebugBuilds` / `Always`. Useful to skip optimization in a debug-heavy module. |
| `bUseRTTI` | Enable RTTI (`dynamic_cast`). Off by default; enabling breaks PCH compatibility across modules. |
| `bEnableExceptions` | Enable C++ exception handling. Off by default in UE. |
| `bUseUnity` | Per-module unity build override. Unity merges `.cpp` files to reduce header parse time; disable to speed iteration on a single file. |
| `MinSourceFilesForUnityBuildOverride` | Unity kicks in only when file count exceeds this. |
| `CppStandard` | Override C++ language standard (e.g. `CppStandardVersion.Cpp20`). |
| `bWarningsAsErrors` | Treat all warnings as errors for this module. |
| `ShadowVariableWarningLevel` | `WarningLevel` — default warns on shadowed variables. |

## Include paths

`Public/` and `Private/` are discovered automatically; you rarely need to set `PublicIncludePaths`
or `PrivateIncludePaths` explicitly. They are reserved for non-standard layouts (e.g. engine
modules with `Classes/` directories) or third-party library headers.

For third-party headers, use `PublicSystemIncludePaths` so the compiler does not flag them as
first-party code during static analysis.

## Third-party library integration

```csharp
// Typical third-party module setup
using System.IO;

public class MyThirdParty : ModuleRules
{
    public MyThirdParty(ReadOnlyTargetRules Target) : base(Target)
    {
        Type = ModuleType.External;    // no C++ source in this module
        string LibPath = Path.Combine(ModuleDirectory, "lib", Target.Platform.ToString());

        PublicSystemIncludePaths.Add(Path.Combine(ModuleDirectory, "include"));
        PublicAdditionalLibraries.Add(Path.Combine(LibPath, "mylib.lib"));
        PublicDelayLoadDLLs.Add("mylib.dll");
        RuntimeDependencies.Add("$(BinaryOutputDir)/mylib.dll",
            Path.Combine(LibPath, "mylib.dll"));
    }
}
```

Key properties:
- `ModuleType.External` — no C++ source is compiled; header/lib paths only.
- `PublicAdditionalLibraries` — `.lib` or `.a` files linked into any consuming module.
- `PublicDelayLoadDLLs` — DLLs loaded on first call; pair with `RuntimeDependencies`.
- `RuntimeDependencies` — files staged alongside the cooked game.

## Module type

`Type = ModuleType.CPlusPlus` (default) or `ModuleType.External` (third-party without source).
Set in `ModuleRules.cs`:108. For plugin-hosted external modules, set this in your plugin's
`Build.cs` rather than its descriptor; the descriptor's `"Type"` is the host type, not the
module type.

## bRequiresImplementModule

`bRequiresImplementModule` (default `true`) causes UBT to check that an `IMPLEMENT_MODULE`
macro is present in the compiled output. If you have a header-only helper module you can set
it to `false`, though this is unusual for UE modules.

## Querying the target in Build.cs

```csharp
if (Target.Platform == UnrealTargetPlatform.Win64)
{
    PrivateDependencyModuleNames.Add("WindowsSpecificModule");
}

if (Target.Configuration == UnrealTargetConfiguration.Shipping)
{
    PublicDefinitions.Add("MY_FEATURE_DISABLED=1");
}

if (Target.bBuildEditor)
{
    PrivateDependencyModuleNames.Add("UnrealEd");
}
```

`ReadOnlyTargetRules` exposes `Platform`, `Configuration`, `Type` (`TargetType`), `bBuildEditor`,
`Architecture`, and more. Use these to produce a single `Build.cs` that works across all targets
rather than shipping separate files.

## Source references

- `ModuleRules.cs`:103 — `public partial class ModuleRules`
- `ModuleRules.cs`:108 — `public enum ModuleType`
- `ModuleRules.cs`:193 — `public enum PCHUsageMode`
- `ModuleRules.cs`:1189 — `PublicDependencyModuleNames`
- `ModuleRules.cs`:1200 — `PrivateDependencyModuleNames`

All paths under:
`E:\Program Files\Epic Games\UE_5.7\Engine\Source\Programs\UnrealBuildTool\Configuration\`

Official docs:
- Module Properties — <https://dev.epicgames.com/documentation/unreal-engine/module-properties-in-unreal-engine>
- IWYU — <https://dev.epicgames.com/documentation/unreal-engine/include-what-you-use-iwyu-for-unreal-engine-programming>
