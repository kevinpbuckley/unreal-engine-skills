# Instrumenting C++ — full reference

Deep dive for [../SKILL.md](../SKILL.md). All C++ instrumentation macros: cycle counters,
CPU profiler trace scopes, CSV profiler, and scoped timers. Grounded in UE 5.7 source
(`Runtime/Core/Public/Stats/Stats.h`, `ProfilingDebugging/CpuProfilerTrace.h`,
`ProfilingDebugging/CsvProfiler.h`, `ProfilingDebugging/ScopedTimers.h`) and the official
[Stats System Overview](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-stats-system-overview)
doc.

## Choosing the right macro

| Need | Macro | Visible in | Shipping? |
|---|---|---|---|
| Named scope in Insights timeline (lowest overhead) | `TRACE_CPUPROFILER_EVENT_SCOPE` | Insights cpu channel | No |
| Named scope + `stat MyGroup` HUD overlay | `SCOPE_CYCLE_COUNTER` | Insights + stat overlay | No |
| Per-frame CSV column for automation tests | `CSV_SCOPED_TIMING_STAT` | CSV file | Yes (Test) |
| Quick temporary profiling, no prior declaration | `QUICK_SCOPE_CYCLE_COUNTER` | stat Quick | No |

Prefer `TRACE_CPUPROFILER_EVENT_SCOPE` for high-frequency code paths (it skips the stat
thread overhead). Use `SCOPE_CYCLE_COUNTER` when you also want the HUD overlay via
`stat <group>`.

## `TRACE_CPUPROFILER_EVENT_SCOPE` family

Header: `ProfilingDebugging/CpuProfilerTrace.h`

Enabled when `CPUPROFILERTRACE_ENABLED == 1` (Development and Test builds; line 15).
In Shipping the macros expand to nothing.

```cpp
#include "ProfilingDebugging/CpuProfilerTrace.h"

// Plain text token (lowest overhead — name is a string literal "AMySystem::ProcessItems"):
void AMySystem::ProcessItems()
{
    TRACE_CPUPROFILER_EVENT_SCOPE(AMySystem::ProcessItems);
    for (auto& Item : Items)
    {
        TRACE_CPUPROFILER_EVENT_SCOPE(AMySystem::ProcessItems::Loop);
        Item.Process();
    }
}

// Const string pointer (ANSICHAR* or TCHAR*):
TRACE_CPUPROFILER_EVENT_SCOPE_STR("MySystem::ProcessItems");

// Dynamic FName or TCHAR* (higher overhead — cache only once):
TRACE_CPUPROFILER_EVENT_SCOPE_TEXT(*DynamicLabel);

// Conditional (only emit if channel or condition active):
TRACE_CPUPROFILER_EVENT_SCOPE_CONDITIONAL(AMySystem::ProcessItems, bProfilingEnabled);

// Gated on a custom channel in addition to CpuChannel:
TRACE_CPUPROFILER_EVENT_SCOPE_ON_CHANNEL(AMySystem::ProcessItems, MyCustomChannel);
```

Key `FEventScope` constructors are at `CpuProfilerTrace.h:184-229`; the
`TRACE_CPUPROFILER_EVENT_SCOPE(Name)` macro is at line 449.

**Pitfall:** `TRACE_CPUPROFILER_EVENT_SCOPE("MyName")` — passing a quoted string literal
wraps extra quotation marks around the name in Insights. Use the `_STR` variant for
string literals, or the plain macro with a bare token.

## `DECLARE_CYCLE_STAT` + `SCOPE_CYCLE_COUNTER`

Header: `Stats/Stats.h`

```cpp
// ---- In a .cpp (file scope) ----
DECLARE_STATS_GROUP(TEXT("My Subsystem"), STATGROUP_MySubsystem, STATCAT_Advanced);
DECLARE_CYCLE_STAT(TEXT("Heavy Work"), STAT_MySubsystem_HeavyWork, STATGROUP_MySubsystem);

void UMySubsystem::DoHeavyWork()
{
    SCOPE_CYCLE_COUNTER(STAT_MySubsystem_HeavyWork);
    // ... work ...
}
```

`DECLARE_CYCLE_STAT` (line 146) emits a `static DEFINE_STAT` and must appear in exactly
one translation unit. The stat appears in:
- `stat MySubsystem` HUD overlay.
- Insights `stats` channel (when enabled).
- Timing Insights Timers tab as a named scope if the stat system bridges to trace.

### Cross-file stats

```cpp
// MySubsystem.h:
DECLARE_STATS_GROUP(TEXT("My Subsystem"), STATGROUP_MySubsystem, STATCAT_Advanced);
DECLARE_CYCLE_STAT_EXTERN(TEXT("Heavy Work"), STAT_MySubsystem_HeavyWork,
                          STATGROUP_MySubsystem, MYGAME_API);

// MySubsystem.cpp:
DEFINE_STAT(STAT_MySubsystem_HeavyWork);
```

### DECLARE_SCOPE_CYCLE_COUNTER (declare + use in one line)

Useful when a stat is only used in a single function and you don't want a file-scoped
declaration:

```cpp
void UMySubsystem::DoHeavyWork()
{
    DECLARE_SCOPE_CYCLE_COUNTER(TEXT("DoHeavyWork"), STAT_MySubsystem_DoHeavyWork,
                                STATGROUP_MySubsystem);
    // ...
}
```

Defined at `Stats.h:237`. Internally declares + immediately uses the counter.

### QUICK_SCOPE_CYCLE_COUNTER (temporary profiling)

No prior declaration needed. Stat goes into `STATGROUP_Quick`:

```cpp
void UMySubsystem::Tick(float DeltaTime)
{
    QUICK_SCOPE_CYCLE_COUNTER(STAT_MySubsystem_Tick);
    // ...
}
```

Defined at `Stats.h:242`. Remove before shipping; it's a development diagnostic.

### CONDITIONAL_SCOPE_CYCLE_COUNTER

Only accumulates time when a condition is true:

```cpp
CONDITIONAL_SCOPE_CYCLE_COUNTER(STAT_MySubsystem_HeavyWork, bDetailedProfiling);
```

Defined at `Stats.h:251`.

## CSV profiler (`CSV_SCOPED_TIMING_STAT`)

Header: `ProfilingDebugging/CsvProfiler.h`

Available in Shipping and Test builds when `CSV_PROFILER` is enabled. Records per-frame
timing columns to a `.csv` file; ideal for automated performance regression baselines.

```cpp
#include "ProfilingDebugging/CsvProfiler.h"

// Define the category once in a .cpp:
CSV_DEFINE_CATEGORY(MySubsystem, true);   // true = enabled by default

void UMySubsystem::Tick(float DeltaTime)
{
    CSV_SCOPED_TIMING_STAT(MySubsystem, MySubsystem_Tick);
    // ...
}

// Record a custom numeric value (e.g. entity count):
CSV_CUSTOM_STAT(MySubsystem, EntityCount, (float)EntityList.Num(), ECsvCustomStatOp::Set);
```

Key macros (all in `CsvProfiler.h`):

| Macro | Line | Purpose |
|---|---|---|
| `CSV_DEFINE_CATEGORY` | 51 | Define a CSV category in one .cpp |
| `CSV_SCOPED_TIMING_STAT` | 95 | Scoped timing into a named column |
| `CSV_SCOPED_TIMING_STAT_EXCLUSIVE` | 104 | Exclusive (not counting child scopes) |
| `CSV_CUSTOM_STAT` | 130 | Write a float value to a named column |
| `CSV_EVENT` | 57 | Log a string event marker |

Start/stop CSV capture from the console: `CsvProfile.start` / `CsvProfile.finish`.
Output path: `<Project>/Saved/Profiling/CSV/`.

## `FScopedDurationTimer` / `FScopedDurationTimeLogger`

Header: `ProfilingDebugging/ScopedTimers.h`

Lightweight wall-clock timers that accumulate into a `double&`. No dependency on the stat
system or trace system.

```cpp
#include "ProfilingDebugging/ScopedTimers.h"

double BuildTime = 0.0;
{
    FScopedDurationTimer Timer(BuildTime);
    BuildNavMesh();
}
UE_LOG(LogNav, Log, TEXT("NavMesh build: %.2f s"), BuildTime);
```

`FScopedDurationTimeLogger` (line 193) logs to `GLog` on destruction:

```cpp
FScopedDurationTimeLogger Timer(TEXT("NavMesh build"));
BuildNavMesh();
// Destructor prints: "NavMesh build: 0.xx secs"
```

`UE_SCOPED_TIMER(Title, Category, Verbosity)` (line 341) is a macro wrapper that
also accumulates a running total.

## Non-cycle stat updates

After declaring a counter or accumulator stat, update it at runtime:

```cpp
// Increment/decrement:
INC_DWORD_STAT(STAT_MySubsystem_ObjectCount);
DEC_DWORD_STAT(STAT_MySubsystem_ObjectCount);

// Set an absolute value:
SET_DWORD_STAT(STAT_MySubsystem_ObjectCount, NewCount);

// Float stats:
INC_FLOAT_STAT_BY(STAT_MySubsystem_WorkMS, ElapsedMs);

// Memory counters:
INC_MEMORY_STAT_BY(STAT_MySubsystem_PoolBytes, AllocSize);
DEC_MEMORY_STAT_BY(STAT_MySubsystem_PoolBytes, FreeSize);
SET_MEMORY_STAT(STAT_MySubsystem_PoolBytes, TotalBytes);
```

All update macros are in `Stats/Stats.h` and compile to no-ops when `STATS == 0`.

## Pitfalls

- **`DECLARE_CYCLE_STAT` in a header** — the `static DEFINE_STAT` it emits will produce
  a linker duplicate symbol error if the header is included in more than one `.cpp`.
  Always use the `_EXTERN` / `DEFINE_STAT` pattern for headers.
- **Nested `QUICK_SCOPE_CYCLE_COUNTER`** — using the same `Stat` token twice in the same
  scope causes a variable-name collision. Use distinct tokens per scope.
- **`TRACE_CPUPROFILER_EVENT_SCOPE` with a quoted string literal** — wraps extra quotes
  around the display name. Use `TRACE_CPUPROFILER_EVENT_SCOPE_STR("literal")` instead.
- **Stats in Shipping** — `STATS == 0`; all `DECLARE_CYCLE_STAT` / `SCOPE_CYCLE_COUNTER`
  expand to nothing. Use CSV profiler for shipping-visible metrics.
