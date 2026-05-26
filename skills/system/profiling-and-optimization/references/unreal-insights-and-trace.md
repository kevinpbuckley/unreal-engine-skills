# Unreal Insights & Trace — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the Trace framework, channel selection,
session workflow, Timing Insights anatomy, and GPU profiling. Grounded in UE 5.7 source
(`Engine/Source/Runtime/Core/Public/ProfilingDebugging/CpuProfilerTrace.h`) and the
official [Unreal Insights](https://dev.epicgames.com/documentation/unreal-engine/unreal-insights-in-unreal-engine),
[Trace](https://dev.epicgames.com/documentation/unreal-engine/trace-in-unreal-engine-5),
and [Timing Insights](https://dev.epicgames.com/documentation/unreal-engine/timing-insights-in-unreal-engine-5)
docs.

## Trace architecture

**Trace** is a structured, low-overhead event logging framework. Three components work
together:

- **Engine instrumentation** — macros emit typed events to a per-thread ring buffer.
- **UnrealTraceServer** (`Engine/Binaries/Win64/UnrealTraceServer.exe`) — background
  service listening on port 1981; records streams to `.utrace` files.
- **Unreal Insights** (`Engine/Binaries/Win64/UnrealInsights.exe`) — offline or live
  viewer that reads `.utrace`/`.ucache` files.

Traces are self-describing and version-tolerant; a 5.5 trace opens in a 5.7 viewer.

## Channels

Each event type belongs to one or more channels. Channels control data rate. Key channels
for game development:

| Channel | What is captured |
|---|---|
| `cpu` | All `TRACE_CPUPROFILER_EVENT_SCOPE` and stat-named-events scopes |
| `gpu` | GPU pass timers from GpuProfiler |
| `frame` | Game and render frame boundaries |
| `stats` | Stats system counters (`DECLARE_CYCLE_STAT` etc.) |
| `memalloc` | Every malloc/free with callstack (heavy; Development only) |
| `memtag` | LLM per-frame tag snapshots (lighter; fine for long sessions) |
| `callstack` | Callstack descriptions needed by `memalloc` |
| `module` | Module load info; required for callstack symbol resolution |
| `bookmark` | `TRACE_BOOKMARK` string markers |
| `log` | All `UE_LOG` messages |
| `contextswitches` | OS thread context switches (Windows: requires admin) |
| `task` | Task Graph task lifecycle |

Default channels (enabled automatically): `cpu`, `frame`, `gpu`, `bookmark`, `log`,
`screenshot`.

`memalloc` and `module` must be set before process start (command-line only).

## Starting a trace

### From the Editor

Bottom toolbar → **Trace** → choose channels → **Start Trace**. The Trace Insights widget
in the toolbar shows status and lets you save a snapshot.

### From the command line

```
# Record to the Trace Server (live view in Insights):
YourGame.exe -trace=cpu,gpu,frame,stats,bookmark,log -tracehost=127.0.0.1

# Record to a file:
YourGame.exe -trace=cpu,gpu,frame,memtag -tracefile=C:\Traces\session.utrace

# Memory leak hunt (Development build):
YourGame.exe -trace=cpu,memalloc,memtag,callstack,module -llm
```

### From the console at runtime

```
Trace.Start cpu,gpu,frame
Trace.Stop
Trace.Status            # shows channels, memory used, sent bytes
trace.bookmark MyLabel  # emit a bookmark
```

## Timing Insights anatomy

Open a `.utrace` by double-clicking in the Insights Session Browser.

| Panel | Purpose |
|---|---|
| **Frames panel** | Bar chart of per-frame cost; click to select, drag for a range |
| **Timing panel** | Thread-per-row timeline; each colored bar is one named scope |
| **Timers tab** | Sorted table of inclusive/exclusive time, call count for the selected range |
| **Counters tab** | Stats-system counter values over the selected range |
| **Callers/Callees** | Who calls a selected scope and what that scope calls |
| **Log** | `UE_LOG` messages with synchronized timeline position |

### Reading the Timing panel

The Timing panel shows one row per thread: `GameThread`, `RenderThread`, `RHIThread`,
worker threads, and the `GPU` row. Nested scopes appear as stacked bars.

To find a hotspot:
1. Select a spike in the Frames panel.
2. In the Timers tab, sort by **Inclusive Time** descending.
3. Click the top entry to highlight it in the Timing panel; inspect Callers/Callees.
4. Double-click the bar in the Timing panel to zoom into that scope.

### GPU track

The GPU row requires the `gpu` channel. It shows GPU pass names from GpuProfiler.
Cross-reference with `stat gpu` in-game. To see both CPU submission and GPU execution
for a pass, enable `RHICommands` and `RenderCommands` channels.

## ProfileGPU / GPU Visualizer

`ProfileGPU` in the console captures a one-frame GPU pass tree with per-pass ms costs.
The GPU Visualizer (Editor: Tools menu) shows the same data as a hierarchical tree.
Useful for a quick GPU audit without setting up a full Insights trace.

## Bookmarks and screenshots

Place markers in a trace for easier navigation:

```cpp
#include "ProfilingDebugging/MiscTrace.h"
TRACE_BOOKMARK(TEXT("LevelLoaded"));
```

Or from the console: `trace.bookmark LevelLoaded`. Bookmarks appear as vertical lines in
the Timing panel markers track and in the Log view.

## Callstack symbol resolution

Insights resolves callstack addresses using `.pdb` (Windows) or `.elf` files. Paths
searched in order:
1. Paths the user adds in the Modules panel.
2. Executable directory (if embedded).
3. `UE_INSIGHTS_SYMBOLPATH` environment variable (semicolon-separated).
4. `_NT_SYMBOL_PATH`.
5. User config file.

Resolved symbols are cached in the `.ucache` file next to the trace.

## Late connect

Insights can connect to a running game after it starts. Important events are cached on
the client and sent on connection, so one-time events are not missed. Trigger with:

```
trace.send 127.0.0.1     # in-game console; send to Insights on localhost
```

## Version notes (5.7)

- Timing Insights gained a **Verse Sampling** track in 5.7 (toggle `Shift+V`).
- `UnrealTraceServer` has been the unified trace server across desktop platforms since 5.3.
- Memory Insights Android callstack support added in 5.4; available in 5.7.
