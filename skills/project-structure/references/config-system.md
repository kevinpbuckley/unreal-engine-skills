# Config system — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the config file hierarchy, ini syntax,
array operators, UPROPERTY(config) auto-binding, and reading/writing config values from
C++. Grounded in UE 5.7 (`Engine/Source/Runtime/Core/Public/Misc/ConfigCacheIni.h`,
`Engine/Source/Runtime/Core/Public/Misc/ConfigHierarchy.h`,
`Engine/Source/Runtime/Core/Public/CoreGlobals.h`).

Official docs (verified live):
- Configuration Files in Unreal Engine — <https://dev.epicgames.com/documentation/unreal-engine/configuration-files-in-unreal-engine>

## How the config hierarchy works

For every config category (Engine, Game, Input, …) the engine merges a stack of `.ini`
files in a fixed order, with later files overriding earlier ones. The canonical layer
order, from `ConfigHierarchy.h` (`Engine/Source/Runtime/Core/Public/Misc/ConfigHierarchy.h`):

| Order | File template | Notes |
|---|---|---|
| 1 | `{ENGINE}/Config/Base.ini` | Engine-wide absolute base |
| 2 | `{ENGINE}/Config/Base{TYPE}.ini` | e.g. `BaseEngine.ini` |
| 3 | `{ENGINE}/Config/{PLATFORM}/Base{PLATFORM}{TYPE}.ini` | Platform base |
| 4 | `{PROJECT}/Config/Default{TYPE}.ini` | **Your project's main file — edit this** |
| 5 | `{ENGINE}/Config/{PLATFORM}/{PLATFORM}{TYPE}.ini` | Engine platform override |
| 6 | `{PROJECT}/Config/{PLATFORM}/{PLATFORM}{TYPE}.ini` | Project platform override |
| 7 | `{LOCAL_APP_DATA}/.../User{TYPE}.ini` | Per-user local overrides |
| 8 | `{PROJECT}/Config/User{TYPE}.ini` | Per-user project overrides (never commit) |

`Default{TYPE}.ini` (step 4) is where you make project-specific settings. It is committed
to source control and ships with the project. Layers 7–8 are local-only and must not be
committed.

### Config categories (the `{TYPE}` token)

The most common runtime categories:

| Category | Default file | Typical contents |
|---|---|---|
| `Engine` | `DefaultEngine.ini` | Rendering, default maps and GameMode, collision, logging |
| `Game` | `DefaultGame.ini` | Project name/version, Asset Manager, game-specific settings |
| `Input` | `DefaultInput.ini` | Legacy axis/action mappings (Enhanced Input uses assets) |
| `GameUserSettings` | `DefaultGameUserSettings.ini` | Resolution, quality — may be written at runtime |
| `Scalability` | `DefaultScalability.ini` | Quality presets |
| `GameplayTags` | `DefaultGameplayTags.ini` | Tag table, redirectors |
| `DeviceProfiles` | `DefaultDeviceProfiles.ini` | Per-device quality/texture settings |

Editor-only categories (`Editor`, `EditorPerProjectUserSettings`, `EditorKeyBindings`, …)
are loaded only when the editor is running.

## Ini syntax

### Sections and keys

```ini
[/Script/EngineSettings.GameMapsSettings]
GameDefaultMap=/Game/Maps/MainMenu.MainMenu
GlobalDefaultGameMode=/Script/MyGame.MyGameMode
```

The section header for a `UCLASS(config=Engine)` is always
`[/Script/ModuleName.ClassName]` (without the `U`/`A` prefix).

### Array operators

Config arrays can be built up across multiple files in the hierarchy:

| Operator | Effect |
|---|---|
| `Key=Value` | Replace all existing values, then append this one |
| `+Key=Value` | Append if not already present |
| `.Key=Value` | Append unconditionally (allow duplicates) |
| `-Key=Value` | Remove exact match |
| `!Key=ClearArray` | Empty the array |

Example — building a tag table across BaseGameplayTags.ini and DefaultGameplayTags.ini:

```ini
; DefaultGameplayTags.ini
[/Script/GameplayTags.GameplayTagsSettings]
+GameplayTagList=(Tag="Status.Burning",DevComment="")
+GameplayTagList=(Tag="Status.Stunned",DevComment="")
```

### Console variables in config

Place console variables (cvars) in `[ConsoleVariables]` in `DefaultEngine.ini`:

```ini
[ConsoleVariables]
r.Shadow.Virtual.Enable=1
gc.MaxObjectsNotConsideredByGC=0
```

For rendering cvars (`r.*`) the canonical section is
`[/Script/Engine.RendererSettings]`; for streaming (`s.*`) use
`[/Script/Engine.StreamingSettings]`.

## UPROPERTY(config) — automatic binding

Mark a class with `UCLASS(config=<Category>)` and any member with `UPROPERTY(config)` to
have the engine populate the member automatically from the merged config hierarchy when
the CDO is constructed.

```cpp
UCLASS(config=Game)                    // reads from DefaultGame.ini and its hierarchy
class UMyGameSettings : public UObject
{
    GENERATED_BODY()

    UPROPERTY(config)
    int32 MaxPlayers = 4;

    UPROPERTY(config)
    TArray<FString> AllowedMaps;
};
```

The corresponding ini section:

```ini
[/Script/MyGame.MyGameSettings]
MaxPlayers=16
+AllowedMaps=Arena_01
+AllowedMaps=Arena_02
```

Access the CDO at runtime:

```cpp
const UMyGameSettings* Settings = GetDefault<UMyGameSettings>();
int32 Max = Settings->MaxPlayers;
```

Write back and save (e.g. from a runtime settings screen):

```cpp
UMyGameSettings* Settings = GetMutableDefault<UMyGameSettings>();
Settings->MaxPlayers = 8;
Settings->SaveConfig();   // writes to the appropriate Default*.ini or User*.ini
```

`SaveConfig` is declared on `UObject`; it respects the class's config category and writes
to the highest-priority non-read-only file in the hierarchy (typically `Default*.ini` in
dev or `User*.ini` in shipped builds).

## Reading config values manually (GConfig)

`GConfig` is a global `FConfigCacheIni*` declared in
`Runtime/Core/Public/CoreGlobals.h:96`. Use it to read arbitrary keys regardless of
whether a corresponding C++ `UPROPERTY` exists:

```cpp
#include "Misc/ConfigCacheIni.h"

int32 MaxConnections = 0;
GConfig->GetInt(
    TEXT("/Script/MyGame.MyNetworkSettings"),
    TEXT("MaxConnections"),
    MaxConnections,
    GGameIni);         // GGameIni is the resolved path for DefaultGame.ini
```

The `G<Category>Ini` globals (`GEngineIni`, `GGameIni`, `GInputIni`, …) are declared in
`CoreGlobals.h` and hold the merged filename that `FConfigCacheIni` uses as the cache key
for each category.

Available typed getters on `FConfigCacheIni` (all in `ConfigCacheIni.h`):
`GetBool`, `GetInt`, `GetInt64`, `GetFloat`, `GetDouble`, `GetString`, `GetText`,
`GetArray`.

## Saved/ vs Default*/ — a common trap

`Saved/Config/` contains **per-machine runtime overrides** written by the editor or by
`SaveConfig` when running as a game. These files:
- override `Default*.ini` values for the local machine
- are never committed (put `Saved/` in `.gitignore`)
- are regenerated whenever the editor saves project settings

If you edit `Saved/Config/WindowsEditor/Engine.ini` and a teammate doesn't have your
local override, you will see different behaviour. Always make persistent settings in
`Config/Default*.ini`.

## Command-line config overrides

Useful during automation and CI:

```
# Override a single key:
MyGame -ini:Engine:[/Script/Engine.Engine]:bSmoothFrameRate=False

# Replace the entire DefaultEngine.ini for this run:
MyGame -DefEngineIni=CI/CIEngine.ini

# Print a config value (console command in-engine):
GetIni Windows@Engine:/Script/Engine.Engine bSmoothFrameRate
```

## Version notes

- The config layer ordering is stable across UE5. The `ConfigHierarchy.h` inline array
  `GConfigLayers[]` is the canonical source of truth and has not changed since UE5.0.
- `GameUserSettings.ini` is typically written to `Saved/` (not `Config/`) at runtime so
  each player's display settings persist locally. Do not commit it.
- Enhanced Input stores bindings in `.uasset` files, not in `DefaultInput.ini`. Legacy
  `DefaultInput.ini` bindings still work for projects not using Enhanced Input.
