# Target.cs (TargetRules) Reference

Grounded in UE 5.7 engine source:
`E:\Program Files\Epic Games\UE_5.7\Engine\Source\Programs\UnrealBuildTool\Configuration\TargetRules.cs`

See also: [../SKILL.md](../SKILL.md)

## Purpose of Target.cs

A target file describes one runnable artifact UBT can build. Every project needs at minimum:
- `<Project>.Target.cs` — the cooked game (or server/client) binary.
- `<Project>Editor.Target.cs` — the editor binary that loads your game modules.

Each inherits `TargetRules` and sets properties in its constructor.

## TargetType enum (`TargetRules.cs`:21)

| Value | Artifact | Link style |
|---|---|---|
| `Game` | `<Game>.exe` — cooked, standalone | Monolithic on most platforms |
| `Editor` | `UnrealEditor.exe` + game DLLs | Modular (separate DLLs) |
| `Client` | Cooked client-only binary (no server code) | Monolithic |
| `Server` | Cooked server-only binary (no client/rendering code) | Monolithic |
| `Program` | Standalone tool (e.g. `ShaderCompileWorker`) | Configurable |

Editor targets link modularly because the editor needs to reload DLLs for Live Coding and
hot-reload. Game/Server/Client link monolithically on consoles and for packaged builds.

## TargetLinkType (`TargetRules.cs`:52)

- `Default` — inferred from `TargetType`: Editor → Modular, everything else → Monolithic.
- `Monolithic` — all modules compiled into a single executable. `_API` macros are empty.
- `Modular` — each module is a DLL. `_API` macros emit dllexport/dllimport.

You rarely override `LinkType` for game targets.

## Key TargetRules properties

| Property | Line | Notes |
|---|---|---|
| `Type` | 705 | `TargetType` value — set this first. |
| `DefaultBuildSettings` | 711 | `BuildSettingsVersion` — controls which default flags UBT applies. Use `V5` for UE 5.x projects. |
| `IncludeOrderVersion` | 176 (`EngineIncludeOrderVersion` enum) | Sets which set of deprecated include guards to enable. Use `Latest` (= `Unreal5_7`) for new code. |
| `ExtraModuleNames` | 2654 | Module names compiled into this target beyond the engine defaults. Add your primary game module here. |
| `bBuildEditor` | ~1100 | True for `TargetType.Editor`. Read-only; use `if (Target.bBuildEditor)` in `Build.cs`. |
| `bCompileAgainstEditor` | ~1287 | True for Editor targets; can be set for Program targets that need editor code. |

## Minimal Target.cs pair

```csharp
// MyGame.Target.cs
using UnrealBuildTool;
public class MyGameTarget : TargetRules
{
    public MyGameTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion  = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("MyGame");
    }
}

// MyGameEditor.Target.cs
using UnrealBuildTool;
public class MyGameEditorTarget : TargetRules
{
    public MyGameEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion  = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("MyGame");
    }
}
```

## Adding a server target

Server targets compile without rendering, audio, or client-side input:

```csharp
// MyGameServer.Target.cs
using UnrealBuildTool;
public class MyGameServerTarget : TargetRules
{
    public MyGameServerTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Server;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion  = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("MyGame");
        // Server targets exclude client-side rendering automatically.
        // Guard server-only code in Build.cs: if (Target.Type == TargetType.Server)
    }
}
```

## Gating editor dependencies in Build.cs

Because `TargetRules.bBuildEditor` is read-only and exposed through `ReadOnlyTargetRules`,
you query it in `Build.cs`:

```csharp
if (Target.bBuildEditor)
{
    PrivateDependencyModuleNames.Add("UnrealEd");
    PrivateDependencyModuleNames.Add("Kismet");
}
```

Wrapping editor code in `#if WITH_EDITOR` in C++ prevents it from compiling into cooked builds
even if the `Build.cs` guard is inadvertently missing.

## BuildSettingsVersion

`BuildSettingsVersion` controls default UBT behaviour introduced in each engine release
(warning levels, include order defaults, etc.). Setting it to a lower version preserves older
defaults for legacy projects. New 5.7 projects should use `V5` or `Latest`.

The `EngineIncludeOrderVersion` enum has an entry per engine release; `Latest` always points
to the current release (`Unreal5_7` in 5.7, `TargetRules.cs`:455).

## Source references

All paths under:
`E:\Program Files\Epic Games\UE_5.7\Engine\Source\Programs\UnrealBuildTool\Configuration\`

- `TargetRules.cs`:21 — `public enum TargetType`
- `TargetRules.cs`:52 — `public enum TargetLinkType`
- `TargetRules.cs`:162 — `public enum BuildSettingsVersion`
- `TargetRules.cs`:176 — `public enum EngineIncludeOrderVersion`
- `TargetRules.cs`:705 — `Type` property
- `TargetRules.cs`:711 — `DefaultBuildSettings` property
- `TargetRules.cs`:2654 — `ExtraModuleNames`

Official docs:
- UBT Targets reference — <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-build-tool-target-reference>
