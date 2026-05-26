# Log categories & verbosity — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers all category declaration patterns,
verbosity semantics, build-time stripping, and runtime controls. Grounded in UE 5.7
(`Engine/Source/Runtime/Core/Public/Logging/LogMacros.h`,
`Engine/Source/Runtime/Core/Public/Logging/LogCategory.h`,
`Engine/Source/Runtime/Core/Public/Logging/LogVerbosity.h`).

## Category declaration patterns

### Module-wide extern (recommended)

Used for a category shared across multiple `.cpp` files in a module. The header goes in a
`Logging.h` or at the top of the module's main header; the define goes in exactly one `.cpp`.

```cpp
// MyModule/Public/MyModuleLogging.h
#pragma once
#include "Logging/LogMacros.h"

DECLARE_LOG_CATEGORY_EXTERN(LogMyModule, Log, All);
```

```cpp
// MyModule/Private/MyModule.cpp  (or any single .cpp in the module)
#include "MyModuleLogging.h"
DEFINE_LOG_CATEGORY(LogMyModule);
```

### File-private static category

Visible only in the `.cpp` that declares it. No header required.

```cpp
// SomeSystem.cpp
DEFINE_LOG_CATEGORY_STATIC(LogSomeSystem, Log, All);
```

### Class-static category

Scoped to a class. Declare in the class body, define in the `.cpp`:

```cpp
// MyClass.h  (inside class body)
DECLARE_LOG_CATEGORY_CLASS(LogMyClass, Log, All);

// MyClass.cpp
DEFINE_LOG_CATEGORY_CLASS(UMyClass, LogMyClass);
```

`DECLARE_LOG_CATEGORY_CLASS` expands to `DEFINE_LOG_CATEGORY_STATIC` — both declaration and
definition are in the header, so the matching `DEFINE_LOG_CATEGORY_CLASS` provides the
out-of-class definition.

## Verbosity semantics in detail

`ELogVerbosity::Type` is a `uint8` enum in `LogVerbosity.h`:16.

| Value | Integer | Console | Log file | Notes |
|---|---|---|---|---|
| `Fatal` | 1 | yes (crash) | yes | Always runs even when `NO_LOGGING` is set. Maps to `LowLevelFatalError`. |
| `Error` | 2 | yes (red) | yes | Commandlet failure; editor collects and reports. |
| `Warning` | 3 | yes (yellow) | yes | Editor collects; can be escalated to error. |
| `Display` | 4 | yes (grey) | yes | For infrequent always-visible events. |
| `Log` | 5 | **no** | yes | Default production level for informational messages. |
| `Verbose` | 6 | no | if enabled | Requires explicit category enablement. |
| `VeryVerbose` | 7 | no | if enabled | For per-frame or very high frequency trace. |

`All` is an alias for `VeryVerbose` (value 7) used as `CompileTimeVerbosity` to keep all
levels compiled in.

## Compile-time filtering

`DECLARE_LOG_CATEGORY_EXTERN(Name, DefaultVerbosity, CompileTimeVerbosity)`:

- `CompileTimeVerbosity` = `All` (7) — every level is compiled in; runtime controls apply.
- `CompileTimeVerbosity` = `Warning` (3) — `Log`/`Verbose`/`VeryVerbose` calls for this
  category are **removed by the preprocessor** unconditionally, in all build types. Runtime
  changes cannot restore them.
- This check is done via `if constexpr` inside `UE_PRIVATE_LOG` (`LogMacros.h`:318), so
  there is no runtime overhead for suppressed levels.

Monolithic builds can additionally define `COMPILED_IN_MINIMUM_VERBOSITY` to apply a global
floor across all categories (`LogMacros.h`:91–96).

## Runtime verbosity controls

### Console (in-game or PIE)

```
Log LogMyModule Verbose       ; set LogMyModule to Verbose at runtime
Log LogMyModule Log           ; restore to Log
Log all Error                 ; suppress everything to Error
```

`UE_SET_LOG_VERBOSITY(CategoryName, Verbosity)` is the C++ equivalent (`LogMacros.h`:260).

### Command line

```
-LogCmds="LogMyModule Verbose, LogPhysics Warning"
```

Multiple categories can be specified as a comma-separated list. An `all` pseudo-category
applies to every category.

### `UE_LOG_ACTIVE` / `UE_GET_LOG_VERBOSITY`

```cpp
// Check whether a category+verbosity is active before constructing expensive arguments:
if (UE_LOG_ACTIVE(LogMyModule, Verbose))
{
    FString Expensive = BuildExpensiveString();
    UE_LOG(LogMyModule, Verbose, TEXT("%s"), *Expensive);
}

ELogVerbosity::Type Current = UE_GET_LOG_VERBOSITY(LogMyModule);
```

`UE_LOG_ACTIVE` checks both compile-time and runtime suppression. Declared in
`LogMacros.h`:255.

## Built-in engine categories

Common categories you will encounter in engine code (defined in `CoreGlobals.h` and
module-specific headers):

| Category | Module | Default |
|---|---|---|
| `LogTemp` | Core | Log |
| `LogCore` | Core | Log |
| `LogEngine` | Engine | Log |
| `LogActor` | Engine | Warning |
| `LogScript` | Engine | Warning |
| `LogPhysics` | Engine | Warning |
| `LogNet` | Engine | Warning |

Use `LogTemp` only for throwaway debugging. Give production code its own category so team
members can filter and silence unrelated subsystems.

## Output log destinations

- **Editor Output Log** (`Window › Output Log`): shows `Display` and above from console, all
  levels from the log file if enabled. Filter bar searches category name and message text.
- **Log file**: `<ProjectRoot>/Saved/Logs/<ProjectName>.log`. Rotated on startup; previous
  run is `<ProjectName>-backup-YYYY.MM.DD-HH.MM.SS.log`.
- **Console** (in-game `~`): shows `Display` and above.
- **`FOutputDevice` subclass**: implement your own sink by overriding `Serialize`; register
  with `GLog->AddOutputDevice(...)`.
