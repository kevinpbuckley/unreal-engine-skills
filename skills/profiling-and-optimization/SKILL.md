---
name: profiling-and-optimization
description: Profile and optimize Unreal performance — Unreal Insights (trace-based CPU/GPU/memory),
  the stat commands (stat fps/unit/game/gpu), custom timing with stat macros and CPU profiler trace
  scopes, GPU profiling, and memory tools. Use when diagnosing frame-rate drops, hitches, GPU/CPU
  bottlenecks, or memory growth, or when adding instrumentation to find a hotspot. Measure first,
  then optimize.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Profiling & optimization

Optimize by measurement, not guesswork: capture data, find the actual hotspot, fix it, re-measure.
Unreal's tools are **Unreal Insights** (deep trace-based profiling), the in-game **stat** commands
(quick triage), and **instrumentation** macros for your own code.

## When to use this skill

- Frame rate is low or hitching; you need to find why.
- Deciding whether you're CPU- or GPU-bound.
- Memory growth / out-of-memory.
- Adding timing instrumentation to your own systems.

## Triage first: stat commands

In the console (PIE or game):
- `stat unit` — frame time split: **Game** (CPU game thread), **Draw** (render thread/CPU),
  **GPU**, **RHIT**. This tells you which thread bounds the frame.
- `stat fps` — frame rate.
- `stat game` — game-thread breakdown; `stat gpu` — GPU pass breakdown.
- `stat sceneRendering`, `stat memory`, `stat streaming`, etc. for subsystem detail.

Read `stat unit` first: if **GPU** dominates → optimize rendering (`nanite-and-rendering`,
`materials-and-shaders`, lighting); if **Game** dominates → optimize C++/Blueprint/tick; if **Draw**
dominates → reduce draw calls / primitive count.

## Unreal Insights (the real profiler)

Trace-based, low-overhead, captures CPU/GPU/Frames/Memory/Loading/Tasks:
1. Launch with tracing (e.g. `-trace=cpu,gpu,frame,bookmark` or via the Trace settings), or use the
   Insights "Connect" to a running session.
2. Open the `.utrace` in Unreal Insights; use the Timing Insights view to find expensive scopes,
   the Memory Insights for allocations, etc.
Prefer Insights over the legacy stat-file profiler for anything non-trivial.

## Instrument your own code

```cpp
// Named scope visible in Insights Timing view:
void AMySystem::Step()
{
    TRACE_CPUPROFILER_EVENT_SCOPE(AMySystem::Step);
    // ... work ...
}

// Stat group + cycle counter (shows in `stat mygroup`):
DECLARE_CYCLE_STAT(TEXT("MySystem Update"), STAT_MySystemUpdate, STATGROUP_Game);
void AMySystem::Update()
{
    SCOPE_CYCLE_COUNTER(STAT_MySystemUpdate);
    // ... work ...
}
```
Add scopes around suspect systems so they show up by name in the profiler.

## GPU profiling

- `ProfileGPU` (or the GPU Visualizer) gives a one-frame GPU pass breakdown.
- Insights GPU track for timeline view.
- Common GPU costs: resolution/screen percentage, overdraw (translucency), shadow passes, post
  process, too many dynamic lights (`lighting-and-lumen`, `nanite-and-rendering`).

## Memory

- `stat memory`, `memreport -full` for a snapshot.
- **LLM (Low-Level Memory tracker)** and Insights Memory for allocation attribution.
- Watch hard references pulling large assets into memory (`asset-management`) and leaks from
  unmanaged objects (`memory-and-gc`).

## Common optimization levers (after measuring)

- **Tick**: disable unnecessary ticking; use timers/events (`timers-and-async`).
- **Draw calls**: instancing (ISM/HISM), merging, fewer unique materials (`materials-and-shaders`).
- **Blueprint hot paths**: move heavy per-frame logic to C++.
- **GC spikes**: reduce churn of UObjects; pool where appropriate.
- **Async** heavy work off the game thread (`timers-and-async`); stream assets (`asset-management`).

## Gotchas

- **Optimizing without measuring** → wasted effort on non-hotspots.
- **Profiling in the editor / Development build** can mislead; profile a packaged build for shipping
  numbers, but use Insights in PIE for iteration.
- **Confusing CPU- vs GPU-bound** → fixing the wrong side; read `stat unit` first.
- **Microoptimizing** code that isn't the bottleneck.
- **Hardcoding scalability** instead of using device profiles (`nanite-and-rendering`).

## References & source material

Engine source (UE 5.7):
- `Runtime/Core/Public/Stats/Stats.h`, `Stats2.h` — `DECLARE_CYCLE_STAT`, `SCOPE_CYCLE_COUNTER`, stat groups.
- `Runtime/Core/Public/ProfilingDebugging/CpuProfilerTrace.h` — `TRACE_CPUPROFILER_EVENT_SCOPE`.

Official docs (UE 5.7): Testing and Optimizing Your Content —
<https://dev.epicgames.com/documentation/unreal-engine/testing-and-optimizing-your-content>

Related: `nanite-and-rendering`, `materials-and-shaders`, `timers-and-async`, `memory-and-gc`.
