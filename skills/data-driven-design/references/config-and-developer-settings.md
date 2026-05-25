# Config properties and DeveloperSettings — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UCLASS(Config=X)` / `UPROPERTY(config)`
mechanics, the config file hierarchy, `GConfig` manual reads, and `UDeveloperSettings` for
Project Settings panel integration. Grounded in UE 5.7
(`Engine/Source/Runtime/DeveloperSettings/Public/Engine/DeveloperSettings.h`) and the official
[Configuration Files](https://dev.epicgames.com/documentation/unreal-engine/configuration-files-in-unreal-engine)
doc.

## Config UPROPERTY mechanics

To bind a C++ property to an `.ini` value:

1. Decorate the `UCLASS` with `Config=<Category>` (e.g., `Game`, `Engine`, `Input`).
2. Mark each property with `UPROPERTY(Config, ...)`.

```cpp
UCLASS(Config=Game, DefaultConfig)
class MYGAME_API UBossSettings : public UObject
{
    GENERATED_BODY()
public:
    UPROPERTY(Config, EditAnywhere, Category="Boss")
    float EnrageThreshold = 0.25f;

    UPROPERTY(Config, EditAnywhere, Category="Boss")
    TArray<FName> PhaseNames;
};
```

The engine maps the class to the `.ini` section `[/Script/MyGame.BossSettings]` (module name
dot class name, without the `U` prefix). On startup, `UObject::LoadConfig()` reads the section
from the chosen category hierarchy and populates the properties.

`DefaultConfig` writes user edits back to `Default<Category>.ini` in the project directory
(e.g., `Config/DefaultGame.ini`), rather than a per-user or per-platform override file.

### Config hierarchy

Config files load in order; later files override earlier ones:

1. `Engine/Config/Base<Category>.ini`
2. Platform-specific engine configs
3. `<Project>/Config/Default<Category>.ini`
4. Platform project configs
5. User local configs (`Saved/`)

Setting a key in `DefaultGame.ini` overrides its value from `BaseGame.ini`. The category names
are fixed (`Game`, `Engine`, `Input`, `Editor`, `GameUserSettings`, `Scalability`, etc.).

### Array operations in .ini

Config arrays support four operators, applied in order of file loading:

| Operator | Effect |
|---|---|
| `=` | Clear and set one value |
| `+` | Append if not duplicate |
| `.` | Append even if duplicate |
| `-` | Remove exact match |
| `!` | Clear the array |

```ini
[/Script/MyGame.BossSettings]
!PhaseNames=ClearArray
+PhaseNames=Phase_Intro
+PhaseNames=Phase_Enrage
```

### Manual GConfig reads

When you need values from arbitrary sections (not mapped to a class), use `GConfig` directly:

```cpp
#include "Misc/ConfigCacheIni.h"   // declares GConfig

int32 MyVal = 0;
GConfig->GetInt(TEXT("MyCategoryName"), TEXT("MyKey"), MyVal, GGameIni);
```

`G<Category>Ini` globals (`GGameIni`, `GEngineIni`, `GInputIni`, ...) are defined in
`Engine/Source/Runtime/Core/Public/CoreGlobals.h`.

### Saving config at runtime

```cpp
UBossSettings* Settings = GetMutableDefault<UBossSettings>();
Settings->EnrageThreshold = 0.15f;
Settings->SaveConfig(); // writes to Default<Category>.ini
```

Use `GetMutableDefault<T>()` only in editor tooling or at application startup — not in gameplay
tick or hot paths. `SaveConfig` writes the full set of `Config`-marked properties.

## UDeveloperSettings

`UDeveloperSettings` (`DeveloperSettings.h`:23, module `DeveloperSettings`) wraps the config
UPROPERTY mechanism with automatic Project Settings registration.

### Setup

```cpp
// MyGameSettings.h
#pragma once
#include "Engine/DeveloperSettings.h"
#include "MyGameSettings.generated.h"

UCLASS(Config=Game, DefaultConfig, meta=(DisplayName="My Game Settings"))
class MYGAME_API UMyGameSettings : public UDeveloperSettings
{
    GENERATED_BODY()
public:
    UMyGameSettings()
    {
        // CategoryName must be a known category: "Game", "Engine", "Editor", "Project"
        CategoryName = TEXT("Game");
        // SectionName becomes the sidebar entry label
        SectionName  = TEXT("MyGameSettings");
    }

    // --- designer-facing tunables ---
    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="Economy")
    int32 StartingGold = 500;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category="References",
              meta=(AllowedClasses="DataTable"))
    TSoftObjectPtr<UDataTable> ItemTable;

    // Static accessor — avoids FindObject<> calls everywhere
    static const UMyGameSettings* Get() { return GetDefault<UMyGameSettings>(); }
};
```

```cpp
// MyGame.Build.cs
PublicDependencyModuleNames.AddRange(new string[] { "DeveloperSettings" });
```

The settings appear in **Edit → Project Settings → Game → My Game Settings** automatically.
Any `Config`-marked `UPROPERTY` with `EditAnywhere` becomes editable in the panel.

### Key virtual overrides

- `GetContainerName()`:31 — returns `"Project"` or `"Editor"` (default: `"Project"`). Use
  `"Editor"` for editor-only settings.
- `GetCategoryName()`:33 — the sidebar group. Set via `CategoryName` field or override.
- `GetSectionName()`:35 — the panel entry name. Set via `SectionName` field or override.

### Responding to changes

In editor code, `UDeveloperSettings::OnSettingChanged()` (editor-only) fires after the user
edits a property in the Project Settings panel:

```cpp
#if WITH_EDITOR
virtual void PostEditChangeProperty(FPropertyChangedEvent& Event) override
{
    Super::PostEditChangeProperty(Event);
    // Invalidate caches that depend on the changed property
    if (Event.GetPropertyName() == GET_MEMBER_NAME_CHECKED(UMyGameSettings, ItemTable))
        RebuildItemCache();
}
#endif
```

### Reading settings in gameplay

```cpp
// Read-only access — safe to call anywhere, including gameplay:
const UMyGameSettings* S = UMyGameSettings::Get();
int32 Gold = S->StartingGold;

// Load a soft-referenced DataTable synchronously (one-time startup, not hot path):
UDataTable* Table = S->ItemTable.LoadSynchronous();
```

Never call `GetMutableDefault<T>()` or `SaveConfig()` in gameplay; that is for editor tooling.

## When to use Config vs DeveloperSettings vs DataAssets

| Factor | `UPROPERTY(config)` | `UDeveloperSettings` | `UDataAsset` |
|---|---|---|---|
| Audience | Programmer | Technical designer / producer | Designer |
| Editor UI | Manual `.ini` edit or custom tooling | Project Settings panel | Asset Details panel |
| Many instances | No (one value per class) | No (singleton) | Yes |
| Runtime reference to other assets | Via asset path string | Via soft/hard ptr (better) | Via soft/hard ptr |
| In source control | Yes (`.ini` in `Config/`) | Yes (`.ini` in `Config/`) | Yes (`.uasset`) |

Choose `UDeveloperSettings` over bare `UPROPERTY(config)` whenever non-programmers need to
edit the values — it provides a discoverable, validated, documented panel entry.

## Module dependency

The `DeveloperSettings` module must be in `PublicDependencyModuleNames`:

```csharp
PublicDependencyModuleNames.AddRange(new string[] { ..., "DeveloperSettings" });
```

Without this, the linker cannot find `UDeveloperSettings` or `DEVELOPERSETTINGS_API` symbols.

## Version notes

- `UDeveloperSettings` was split into its own `DeveloperSettings` module in UE5. In UE4 it was
  part of the `Engine` module, so UE4 projects did not need a separate module dependency.
- `CategoryName = TEXT("Project")` (rather than `"Game"`) places the entry at the top of the
  Project Settings list alongside engine-level settings — preferred for prominent settings.
- `SupportsAutoRegistration()`:44 can be overridden to return `false` for settings that need
  custom registration (unusual; only needed for multi-instance or plugin-sandboxed settings).
