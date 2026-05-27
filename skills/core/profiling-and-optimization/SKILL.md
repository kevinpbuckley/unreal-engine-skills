---
name: profiling-and-optimization
description: Profile and optimize Unreal Engine performance — Unreal Insights (trace-based
  CPU/GPU/memory profiling, .utrace sessions, Timing Insights, Memory Insights), stat
  commands (stat unit/fps/game/gpu/scenerendering/memory and the full stat command table),
  stat groups, C++ instrumentation (DECLARE_STATS_GROUP, DECLARE_CYCLE_STAT,
  SCOPE_CYCLE_COUNTER, QUICK_SCOPE_CYCLE_COUNTER, TRACE_CPUPROFILER_EVENT_SCOPE,
  CSV_SCOPED_TIMING_STAT), memory profiling (LLM, MemReport, memreport -full), and the
  measurement-first optimization workflow. Use when diagnosing frame-rate drops, hitches,
  CPU/GPU bottlenecks, or memory growth, when adding timing instrumentation to find a
  hotspot, or when deciding on CPU vs GPU vs memory optimization levers.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Profiling & optimization

Optimize by measurement, not guesswork: capture data, find the actual hotspot, fix it,
re-measure. The three tool layers are **Unreal Insights** (deep trace-based profiling),
the in-game **stat** commands (quick triage), and **instrumentation** macros for your own
code. Start with stat commands to identify which thread owns the frame budget, then open
Insights for a precise call-by-call view.

## When to use this skill

- Frame rate is low or hitching; determining whether the game thread, render thread, or
  GPU is the bottleneck.
- Adding per-system timing so it appears by name in Insights and `stat` output.
- Memory growth, out-of-memory events, or finding which system owns an allocation.
- Deciding which optimization lever to pull after identifying the hotspot.

## Triage first: stat commands

In the console (PIE or standalone game):

| Command | What it shows |
|---|---|
| `stat unit` | Frame / Game / Draw / GPU / RHIT split — the first command to run |
| `stat fps` | Raw frame rate |
| `stat game` | Game-thread breakdown by system |
| `stat gpu` | GPU pass costs (requires `-trace=gpu` or GPU channel) |
| `stat scenerendering` | Draw-call counts, visible sections, render overhead |
| `stat memory` | Per-subsystem memory counters |
| `stat streaming` | Streaming texture and asset memory |
| `stat initviews` | Visibility culling cost and visible section count |
| `stat dumphitches` | Log any hitch above `t.HitchFrameTimeThreshold` |
| `stat startfile` / `stat stopfile` | Capture a `.uestats` file for legacy Session Frontend |
| `stat llm` | Low Level Memory Tracker totals |
| `stat lllmfull` | Expanded LLM counters per tag |

Read `stat unit` first:
- **Game** dominates → optimize C++ / Blueprint / tick overhead.
- **Draw** dominates → reduce draw calls, draw-thread CPU cost.
- **GPU** dominates → rendering budget, resolution, overdraw, shadows, post-process.
- **RHIT** (RHI Thread) high → command-list heavy; reduce batching or RHI overhead.

See [references/stat-commands.md](references/stat-commands.md) for the full command table
and per-command interpretation guidance.

## Unreal Insights — the full profiler

Trace-based, low overhead, works in PIE and packaged builds. Produces `.utrace` files
opened in `Engine\Binaries\Win64\UnrealInsights.exe`.

### Starting a trace

From the Editor bottom toolbar — click **Trace** to open the Trace widget; select channels
and click **Start Trace**. From the command line:

```
MyGame.exe -trace=cpu,gpu,frame,bookmark,log -tracehost=127.0.0.1
```

Channels of interest:

| Channel | Captures |
|---|---|
| `cpu` | Named CPU timers (`TRACE_CPUPROFILER_EVENT_SCOPE`, `SCOPE_CYCLE_COUNTER`) |
| `gpu` | Named GPU pass timers |
| `frame` | Game/render frame markers |
| `memalloc` | Every allocation + callstack (heavy — Development build only) |
| `memtag` | LLM tag snapshots per frame (lighter) |
| `bookmark` | `TRACE_BOOKMARK` markers |
| `stats` | Stats-system counters |
| `log` | UE_LOG output |

### Timing Insights window

Opens from the Session Browser. Key views:
- **Frames panel** — bar chart of per-frame cost; click a spike to zoom in.
- **Timing panel** — per-thread timeline of named CPU/GPU scopes, nested call hierarchy.
- **Timers tab** — aggregated total/avg/max per named scope for the selected time range;
  sort by Inclusive Time to find the heaviest leaf callers.
- **Callers/Callees** — trace who calls a selected scope and what it calls.

### Memory Insights window

Opened from Menu > Memory Insights inside a trace that has `memalloc` or `memtag` active.
- Timeline shows total allocated bytes, live allocation count, and LLM-tagged graphs.
- **Investigation** panel runs queries: Active Alloc, Growth (A→B), Memory Leaks (A→B→C),
  Short Living, Long Living.
- Results break down by LLM tag, callstack, asset name, or class name.

Full workflow: [references/unreal-insights-and-trace.md](references/unreal-insights-and-trace.md).

## Instrumentation — stat groups and cycle counters

The stat system shows named timers in `stat <group>` output and in Insights.

```cpp
// In a .cpp (file scope — single translation unit):
DECLARE_STATS_GROUP(TEXT("MySystem"), STATGROUP_MySystem, STATCAT_Advanced);
DECLARE_CYCLE_STAT(TEXT("MySystem Update"), STAT_MySystemUpdate, STATGROUP_MySystem);

// In the function:
void UMySystem::Update()
{
    SCOPE_CYCLE_COUNTER(STAT_MySystemUpdate);
    // ... work ...
}
```

For a stat accessible across multiple files, declare with `DECLARE_CYCLE_STAT_EXTERN` in
the header and `DEFINE_STAT` in the `.cpp`.

`QUICK_SCOPE_CYCLE_COUNTER` is a one-liner for temporary instrumentation — it creates and
uses a cycle counter in STATGROUP_Quick with no prior declaration:

```cpp
void AMyActor::Tick(float DeltaTime)
{
    QUICK_SCOPE_CYCLE_COUNTER(STAT_MyActor_Tick);
    // ... work ...
}
```

## Instrumentation — CPU profiler trace scopes

`TRACE_CPUPROFILER_EVENT_SCOPE` writes directly to the Trace system (cpu channel) and
is visible in the Timing Insights timeline. Lower overhead than the stat system; preferred
for high-frequency scopes.

```cpp
#include "ProfilingDebugging/CpuProfilerTrace.h"

void AMySystem::Step()
{
    TRACE_CPUPROFILER_EVENT_SCOPE(AMySystem::Step);
    // ... work ...
}
```

For a dynamic (runtime-determined) scope name use `TRACE_CPUPROFILER_EVENT_SCOPE_TEXT`:

```cpp
TRACE_CPUPROFILER_EVENT_SCOPE_TEXT(*DynamicName);
```

Scope variants (all in `CpuProfilerTrace.h:449`):
- `TRACE_CPUPROFILER_EVENT_SCOPE(Name)` — literal token, lowest overhead.
- `TRACE_CPUPROFILER_EVENT_SCOPE_STR(NameStr)` — const string pointer.
- `TRACE_CPUPROFILER_EVENT_SCOPE_TEXT(Name)` — dynamic `TCHAR*`/`FName`.
- `TRACE_CPUPROFILER_EVENT_SCOPE_ON_CHANNEL(Name, Channel)` — gated on a custom channel.

`CPUPROFILERTRACE_ENABLED` is 1 in Development/Test builds and 0 in Shipping.

## Instrumentation — CSV profiler

`CSV_SCOPED_TIMING_STAT` records per-frame timings to a CSV file, usable in Shipping and
Test builds. Useful for automated performance regression tests.

```cpp
#include "ProfilingDebugging/CsvProfiler.h"

CSV_DEFINE_CATEGORY(MySystem, true);

void UMySubsystem::Tick(float DeltaTime)
{
    CSV_SCOPED_TIMING_STAT(MySystem, MySubsystem_Tick);
    // ... work ...
}
```

Full reference: [references/instrumenting-cpp.md](references/instrumenting-cpp.md).

## Memory profiling

### Quick snapshot

```
memreport -full
```

Dumps a detailed memory breakdown to `Saved/Profiling/MemReports/`. Covers pool allocators,
UObject counts, asset memory, texture streaming, etc.

### LLM (Low Level Memory Tracker)

LLM instruments every allocation with a tag. Enable with `-llm` on the command line; view
with `stat llm`, `stat llmfull`, or via Insights MemTag channel.

LLM tags are defined in `LowLevelMemTracker.h`
(`Runtime/Core/Public/HAL/LowLevelMemTracker.h`). Tags relevant to games: `UObject`,
`RenderTargets`, `Shaders`, `Meshes`, `Audio`, `Animation`.

### Insights Memory Insights

Run with `-trace=memalloc,memtag,callstack,module` (Development build). Open Memory
Insights from the Menu inside a loaded trace. Use "Memory Leaks" query to find allocations
alive across a level transition, or "Growth" to find what grew between two moments.

Full workflow: [references/memory-profiling.md](references/memory-profiling.md).

## GPU profiling

- `stat gpu` — per-pass totals in the console.
- `ProfileGPU` (console command) / GPU Visualizer (Editor menu) — one-frame GPU breakdown,
  shows pass tree with ms costs.
- Insights GPU track — timeline view of GPU passes alongside CPU work; requires
  `-trace=gpu`.

Common GPU costs to investigate: shadow passes (`stat shadowrendering`), translucency
overdraw, post-process stack, screen percentage, too many dynamic lights.

## Common optimization levers (after measuring)

| Symptom | Lever |
|---|---|
| Game thread high, many ticks | Disable unnecessary ticking; use timers/events (`timers-and-async`) |
| Blueprint hot path | Move heavy per-frame logic to C++ |
| Draw thread high | Reduce draw calls: ISM/HISM instancing, fewer unique materials, merge meshes (`materials-and-shaders`, `nanite-and-rendering`) |
| GPU overdraw / fill rate | Reduce translucency layers, cull small objects, lower screen percentage |
| GC spike | Reduce UObject churn; pool objects; tune GC settings (`memory-and-gc`) |
| Memory growth | Avoid hard references pulling large assets; stream assets async (`asset-management`) |
| Streaming hitches | Prestream assets before they're needed; adjust streaming budget |

## Gotchas

- **Profiling in Development/Editor** misleads on absolute timing; use Shipping-config
  packaged builds for final numbers. Use Development PIE for iteration.
- **Confusing CPU- and GPU-bound** — fix the wrong side. Always read `stat unit` first.
- **`TRACE_CPUPROFILER_EVENT_SCOPE` with a string literal** — use `_STR` variant instead;
  passing a quoted string to the plain macro adds extra quotation marks in the name.
- **`DECLARE_CYCLE_STAT` in a header** — the `static DEFINE_STAT` it emits causes a
  linker duplicate if included in multiple TUs. Use the `_EXTERN` + `DEFINE_STAT` pair.
- **memalloc tracing at scale** — capturing every allocation produces enormous traces;
  prefer `memtag` for long sessions and use `memalloc` only for targeted leak hunts.
- **Optimizing without measuring** — always profile first; fixing a non-bottleneck wastes
  time and can obscure the real hotspot.
- **Stats stripped in Shipping** — `STATS` is 0 in Shipping; use
  `TRACE_CPUPROFILER_EVENT_SCOPE` (disabled by `CPUPROFILERTRACE_ENABLED`) or
  `CSV_SCOPED_TIMING_STAT` (available in Test/Shipping) for production-visible metrics.

## Version notes

- `Stats2.h` is deprecated in 5.6 and redirects to `Stats.h`; include `Stats/Stats.h`.
- `CPUPROFILERTRACE_ENABLED` evaluates to 0 in Shipping builds (5.7: `CpuProfilerTrace.h:15`).
- Memory Insights Android callstack support was added in 5.4; available in 5.7.
- Timing Insights gained a **Verse Sampling** track in 5.7.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/Core/Public/`):
- `Stats/Stats.h` — `DECLARE_STATS_GROUP`:225, `DECLARE_CYCLE_STAT`:146,
  `SCOPE_CYCLE_COUNTER`:245, `QUICK_SCOPE_CYCLE_COUNTER`:242,
  `DECLARE_SCOPE_CYCLE_COUNTER`:237, `CONDITIONAL_SCOPE_CYCLE_COUNTER`:251.
- `Stats/Stats2.h` — deprecated header; redirects to `Stats/Stats.h` since 5.6.
- `ProfilingDebugging/CpuProfilerTrace.h` — `TRACE_CPUPROFILER_EVENT_SCOPE`:449,
  `TRACE_CPUPROFILER_EVENT_SCOPE_STR`:404, `TRACE_CPUPROFILER_EVENT_SCOPE_TEXT`:485,
  `CPUPROFILERTRACE_ENABLED`:15, `FCpuProfilerTrace::FEventScope`:181.
- `ProfilingDebugging/CsvProfiler.h` — `CSV_SCOPED_TIMING_STAT`:95,
  `CSV_DEFINE_CATEGORY`:51, `CSV_CUSTOM_STAT`:130.
- `ProfilingDebugging/ScopedTimers.h` — `FDurationTimer`:32, `FScopedDurationTimer`:66,
  `FScopedDurationTimeLogger`:193.
- `HAL/LowLevelMemTracker.h` — `ENABLE_LOW_LEVEL_MEM_TRACKER`:20, LLM tag scopes.

Official docs (UE 5.7, fetched and confirmed live):
- Unreal Insights — <https://dev.epicgames.com/documentation/unreal-engine/unreal-insights-in-unreal-engine>
- Trace — <https://dev.epicgames.com/documentation/unreal-engine/trace-in-unreal-engine-5>
- Timing Insights — <https://dev.epicgames.com/documentation/unreal-engine/timing-insights-in-unreal-engine-5>
- Memory Insights — <https://dev.epicgames.com/documentation/unreal-engine/memory-insights-in-unreal-engine>
- Stat Commands — <https://dev.epicgames.com/documentation/unreal-engine/stat-commands-in-unreal-engine>
- Stats System Overview — <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-stats-system-overview>
- Testing and Optimizing — <https://dev.epicgames.com/documentation/unreal-engine/testing-and-optimizing-your-content>

Deep-dive references in this skill:
- [references/unreal-insights-and-trace.md](references/unreal-insights-and-trace.md) —
  trace channels, session workflow, Timing Insights anatomy, GPU track.
- [references/stat-commands.md](references/stat-commands.md) — full stat command table,
  reading `stat unit`, stat groups for custom subsystems.
- [references/instrumenting-cpp.md](references/instrumenting-cpp.md) — all instrumentation
  macros, CSV profiler, cross-file stat patterns, `DEFINE_STAT` pitfalls.
- [references/memory-profiling.md](references/memory-profiling.md) — LLM, memreport,
  Insights Memory Insights workflow, query rules, leak hunting.

Related skills: `nanite-and-rendering`, `materials-and-shaders`, `timers-and-async`,
`memory-and-gc`, `debugging-techniques`.
