---
name: logging-and-assertions
description: Add structured logging and runtime checks to Unreal C++ — UE_LOG with custom log
  categories (DECLARE_LOG_CATEGORY_EXTERN/DEFINE_LOG_CATEGORY), all seven verbosity levels
  (Fatal/Error/Warning/Display/Log/Verbose/VeryVerbose), structured named-field logging with
  UE_LOGFMT, the assertion families check/checkf (halts, compiled out in shipping),
  verify/verifyf (expression always evaluates), ensure/ensureMsgf/ensureAlways (non-fatal,
  reports once), and the FMsg/FDebug helpers. Use when adding diagnostics to gameplay or
  engine code, defining a dedicated log category for a module or feature, choosing between
  crashing and recovering on a bad assumption, printing transient values to screen during PIE,
  filtering log output by category, or debugging shipping-only crashes where ensures would help.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Logging & assertions

Good diagnostics make UE bugs findable in minutes rather than hours. Use **log categories**
(not `LogTemp`), pick the right **verbosity** so logs stay scannable, and choose **check vs
ensure** deliberately — one halts, the other reports and continues.

## When to use this skill

- Defining a log category for a new game module or feature subsystem.
- Adding `UE_LOG` / `UE_LOGFMT` calls with the right verbosity for the context.
- Choosing between `check`, `verify`, and `ensure` for a given assumption.
- Deciding whether a bad state should crash the program or just report.
- Filtering or silencing verbose logs per-category at runtime or in builds.

## Log categories

Every `UE_LOG` call names a category. Use the built-in `LogTemp` for quick prototyping;
give each module its own category in production so Output Log filtering works.

Declare in a header, define once in a `.cpp`:

```cpp
// MyFeature.h  (or a dedicated Logging.h for the module)
DECLARE_LOG_CATEGORY_EXTERN(LogMyFeature, Log, All);
//                                         ^--- default runtime verbosity
//                                               ^--- compile-time maximum (All = keep everything)

// MyFeature.cpp
DEFINE_LOG_CATEGORY(LogMyFeature);
```

`DECLARE_LOG_CATEGORY_EXTERN` generates an `extern` struct; `DEFINE_LOG_CATEGORY` provides
the definition. A file-private category uses `DEFINE_LOG_CATEGORY_STATIC` and needs no
header declaration — appropriate for a single `.cpp` implementation file.

The **compile-time maximum** (`All` above) determines which verbosity levels are compiled in.
Setting it to `Warning` strips `Log`/`Verbose`/`VeryVerbose` calls at compile time in that
category, even in debug builds. `All` is the standard choice; tighten only for hot-path code.

See [references/log-categories-and-verbosity.md](references/log-categories-and-verbosity.md)
for the full verbosity table, runtime console commands, command-line flags, and
`DEFINE_LOG_CATEGORY_STATIC` vs class-static patterns.

## UE_LOG — formatted logging

```cpp
// Basic usage: category, verbosity, format string (must be TEXT()), then args
UE_LOG(LogMyFeature, Log,     TEXT("Spawned %s at %s"), *Actor->GetName(), *Loc.ToString());
UE_LOG(LogMyFeature, Warning, TEXT("Ammo low: remaining=%d"), Ammo);
UE_LOG(LogMyFeature, Error,   TEXT("Null weapon on %s — skipping fire"), *GetName());
```

Format specifiers: `%s` expects a `const TCHAR*` — dereference `FString` with `*` to get one.
`%d` int32, `%f` float/double, `%p` pointer. Using an `FString` directly (without `*`) as
`%s` is the most common logging bug.

`UE_CLOG(Condition, Category, Verbosity, Format, ...)` is the conditional variant — the
format is only evaluated when `Condition` is true.

## UE_LOGFMT — structured logging (UE 5.2+)

`UE_LOGFMT` records a structured log event with named fields, enabling machine-readable
output and richer tooling. Requires `#include "Logging/StructuredLog.h"`.

```cpp
#include "Logging/StructuredLog.h"

// Positional: values map left-to-right to {field} placeholders in format
UE_LOGFMT(LogMyFeature, Warning, "Weapon '{Name}' fired with {Ammo} rounds left",
    *WeaponName, AmmoCount);

// Named: order is irrelevant; extra fields are allowed
UE_LOGFMT(LogMyFeature, Warning, "Weapon '{Name}' fired with {Ammo} rounds left",
    ("Name", *WeaponName), ("Ammo", AmmoCount), ("ActorTag", *GetName()));
```

Field names must match `[A-Za-z0-9_]+` and be unique within the call. Do not mix positional
and named styles in the same call. Supports up to 16 fields via `UE_LOGFMT`; use
`UE_LOGFMT_EX` with `UE_LOGFMT_FIELD("Name", Value)` wrappers for more.

See [references/structured-logging.md](references/structured-logging.md) for the field
serialization protocol, `UE_LOG_CONTEXT`, `FLogRecord`, and thread-local context scopes.

## Verbosity levels

From most to least severe (verbosity `Fatal` = highest priority):

| Level | Output | Typical use |
|---|---|---|
| `Fatal` | Crashes immediately, always, even with `NO_LOGGING` | Truly unrecoverable error |
| `Error` | Console + log file, highlighted red | Wrong state that will cause visible malfunction |
| `Warning` | Console + log file, highlighted yellow | Recoverable but unexpected; code worked around it |
| `Display` | Console + log file | Infrequent informational events (startup, asset loads) |
| `Log` | Log file only (not console) | Normal operational info; may be noisy |
| `Verbose` | Log file if category enabled | Detailed trace, disabled by default |
| `VeryVerbose` | Log file if category enabled | Per-frame or very-high-frequency trace |

Runtime adjustment without restarting: `Log LogMyFeature Verbose` (console) or
`-LogCmds="LogMyFeature Verbose"` (command line). The runtime level cannot exceed the
compile-time maximum baked into the category.

## Assertions

Three families — choose based on whether the expression must run and what happens on failure:

| Macro | Dev behavior | Shipping | Expression runs in shipping? |
|---|---|---|---|
| `check(expr)` | halts + callstack | **compiled out** | no |
| `checkf(expr, fmt, ...)` | halts + message + callstack | compiled out | no |
| `checkSlow(expr)` | halts in Debug only | compiled out | no |
| `checkNoEntry()` | halts if hit | compiled out | — |
| `verify(expr)` | halts if false | expression runs, no halt | **yes** |
| `verifyf(expr, fmt, ...)` | halts + message | expression runs, no halt | yes |
| `ensure(expr)` | logs + callstack once, **continues** | expression runs, no report | yes |
| `ensureMsgf(expr, fmt, ...)` | logs + message + callstack once, continues | expression runs | yes |
| `ensureAlways(expr)` | logs + callstack every time | expression runs | yes |

```cpp
// check: hard invariant — continuing is unsafe if false
check(Weapon != nullptr);
checkf(Index >= 0 && Index < Count, TEXT("Index %d out of range [0, %d)"), Index, Count);

// verify: side-effecting call that must both run and succeed
verify((Mesh = GetRenderMesh()) != nullptr);  // GetRenderMesh() runs even in shipping

// ensure: unexpected-but-recoverable; keeps editor alive, submits crash report once
if (!ensure(Target != nullptr)) { return; }
ensureMsgf(bInitialized, TEXT("%s used before Init()"), *GetName());

// checkNoEntry: unreachable code sentinel
default: checkNoEntry(); break;
```

**Rule of thumb for gameplay code:** prefer `ensure` over `check`. An editor that continues
running lets you investigate the bad state in the Output Log and debugger; a crash destroys
that context. Reserve `check` for truly invariant conditions where execution past the failure
would corrupt state or crash anyway.

See [references/assertions.md](references/assertions.md) for compile-flag mechanics
(`DO_CHECK`, `DO_ENSURE`, `USE_CHECKS_IN_SHIPPING`), `FDebug` helpers, and `LowLevelFatalError`.

## On-screen debug messages (PIE only)

```cpp
if (GEngine)
{
    GEngine->AddOnScreenDebugMessage(
        -1,              // key: -1 = no deduplication; use a stable int to overwrite the same slot
        5.f,             // seconds to display
        FColor::Yellow,
        FString::Printf(TEXT("HP: %d / %d"), Hp, MaxHp));
}
```

Key `-1` lets messages pile up; pass a stable non-negative integer (e.g. `GetUniqueID()`) to
overwrite the same line each tick. Gate with `#if !UE_BUILD_SHIPPING` or remove before ship —
this is PIE debugging only.

## Where logs go

| Destination | How to reach it |
|---|---|
| Editor Output Log | Window › Output Log; filter by category name |
| Log file on disk | `<Project>/Saved/Logs/<ProjectName>.log` |
| Console (in-game) | `~` key; `Log CategoryName Verbosity` to change level |

## Gotchas

- **`%s` with an `FString` without `*`** — passes the `FString` object as a vararg, which
  reads garbage bytes; always write `*MyString`.
- **`check` in shipping** is compiled to nothing — never put required side effects inside
  `check(expr)`. If the call must execute, use `verify(expr)`.
- **`ensure` fires only once per call site** in a session by default — it will not spam, but
  a second hit in the same run is silently skipped. Use `ensureAlways` if every occurrence
  matters.
- **Logging in a tick at `Log` or `Warning`** spams the log file and slows the editor;
  use `Verbose`/`VeryVerbose` for per-frame data, or `UE_CLOG` to conditionalize.
- **Compile-time verbosity too low** — if your `DECLARE_LOG_CATEGORY_EXTERN` sets
  `CompileTimeVerbosity` to `Warning`, `UE_LOG(Cat, Verbose, ...)` is silently stripped at
  compile time regardless of runtime settings.
- **`Fatal` verbosity always runs**, even when `NO_LOGGING` is defined — it maps to
  `LowLevelFatalError` which crashes unconditionally.
- **`UE_LOGFMT` requires the header** — `#include "Logging/StructuredLog.h"`; missing it
  produces an undefined-macro error, not a useful diagnostic.

## Version notes

- `UE_LOGFMT` and `UE_LOG_CONTEXT` were introduced in UE 5.2 and are stable through 5.7.
- The `FStaticEnsureRecord` per-call-site mechanism (atomic `bGEnsureHasExecuted`) replaced
  a simpler boolean in UE 5.x; the user-facing macro signatures are unchanged.
- `LowLevelFatalErrorHandler` was deprecated in 5.7; use `LowLevelFatalError` (macro).

## Cross-references

- `debugging-techniques` — `DrawDebug*`, Visual Logger, Gameplay Debugger, native debugger
  usage; these complement logging for spatial and timeline debugging.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/Core/Public/`):
- `Logging/LogMacros.h` — `UE_LOG`:270, `UE_CLOG`:298, `DECLARE_LOG_CATEGORY_EXTERN`:361,
  `DEFINE_LOG_CATEGORY`:371, `DEFINE_LOG_CATEGORY_STATIC`:380, `FMsg::Logf`:60,
  `FMsg::Logf_Internal`:70.
- `Logging/LogVerbosity.h` — `ELogVerbosity::Type` enum:16 (`Fatal`:22 through
  `VeryVerbose`:52, `All`:57, `VerbosityMask`:58).
- `Logging/LogCategory.h` — `FLogCategoryBase`:20, `FLogCategory<>` template:84,
  `IsSuppressed`:44, `SetVerbosity`:58.
- `Logging/StructuredLog.h` — `UE_LOGFMT`:46, `UE_LOGFMT_EX`:64, `UE_LOG_CONTEXT`:143,
  `FLogRecord`:183, `SerializeForLog`:289.
- `Misc/AssertionMacros.h` — `check`:232, `verify`:229, `checkf`:258, `verifyf`:255,
  `checkSlow`:328, `checkNoEntry`:278, `ensure`:456, `ensureMsgf`:457, `ensureAlways`:458,
  `ensureAlwaysMsgf`:459, `FDebug`:68, `LowLevelFatalError`:554.

Official docs (UE 5.7, fetched and confirmed):
- Logging in Unreal Engine —
  <https://dev.epicgames.com/documentation/unreal-engine/logging-in-unreal-engine>
- Asserts in Unreal Engine —
  <https://dev.epicgames.com/documentation/unreal-engine/asserts-in-unreal-engine>

Deep-dive references in this skill:
- [references/log-categories-and-verbosity.md](references/log-categories-and-verbosity.md) —
  full category declaration patterns, verbosity table, runtime/build-time filtering, console
  and command-line controls.
- [references/assertions.md](references/assertions.md) — compile flags (`DO_CHECK`,
  `DO_ENSURE`), `USE_CHECKS_IN_SHIPPING`, `FDebug` helpers, shipping behavior details.
- [references/structured-logging.md](references/structured-logging.md) — `UE_LOGFMT`
  positional vs named fields, `UE_LOG_CONTEXT` thread-local scopes, `FLogRecord`,
  `SerializeForLog` customization.
