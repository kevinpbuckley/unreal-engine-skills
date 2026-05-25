# Stat commands — full reference

Deep dive for [../SKILL.md](../SKILL.md). Full command table, reading `stat unit`,
custom stat groups, and stat file capture. Grounded in UE 5.7 source
(`Engine/Source/Runtime/Core/Public/Stats/Stats.h`) and the official
[Stat Commands](https://dev.epicgames.com/documentation/unreal-engine/stat-commands-in-unreal-engine)
and [Stats System Overview](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-stats-system-overview)
docs.

## How to use stat commands

Type `stat <command>` in the in-game console (PIE or standalone). Typing the same command
again toggles it off. All stat commands are available in Development and Debug builds;
most are stripped in Shipping.

`stat help` lists all registered commands. `stat list groups` lists registered stat groups.

## Reading stat unit

`stat unit` is the starting point for every performance investigation. It shows the time
in ms for each thread that contributes to a frame:

| Column | Thread | What drives it |
|---|---|---|
| **Frame** | Total | Maximum of all thread times; wall-clock frame duration |
| **Game** | Game thread | Blueprints, tick, physics on game thread, component updates |
| **Draw** | Render thread (CPU) | Draw call submission, render command generation |
| **GPU** | GPU | Shader execution, rasterization, compute |
| **RHIT** | RHI thread | Command-list translation, API calls |
| **DynRes** | — | Dynamic resolution primary × secondary screen percentage |

Decision table:
- `Frame ≈ Game` → game-thread bound; profile with `stat game`, then Insights cpu channel.
- `Frame ≈ Draw` → render-thread CPU bound; check draw call count with `stat scenerendering`.
- `Frame ≈ GPU` → GPU bound; profile with `stat gpu`, `ProfileGPU`, Insights gpu channel.
- `Frame ≈ RHIT` → RHI-thread bound; reduce command-list complexity, RHI overhead.
- All low but frame high → stall/sync between threads.

## Full stat command table (selected)

The complete table below lists the most useful commands. Type `stat <Name>` to activate.

| Command | Category | What it shows |
|---|---|---|
| `unit` | Overview | Frame/Game/Draw/GPU/RHIT split |
| `unitgraph` | Overview | Graph of `stat unit` values over time |
| `fps` | Overview | Frames per second |
| `game` | CPU | Game-thread tick breakdown by system |
| `gpu` | GPU | Per-pass GPU costs |
| `scenerendering` | Rendering | Draw calls, visible sections, render stats — key for Draw-thread issues |
| `initviews` | Rendering | Visibility culling cost and visible section count |
| `lightrendering` | Rendering | Lighting and shadow render time |
| `shadowrendering` | Rendering | Shadow calculation time (complement to `lightrendering`) |
| `memory` | Memory | Per-subsystem allocated memory |
| `memoryallocator` | Memory | Allocator-level counters |
| `llm` | Memory | LLM tag totals |
| `llmfull` | Memory | All LLM tag counters |
| `streaming` | Streaming | Streaming texture/asset memory |
| `streamingdetails` | Streaming | Streaming breakdown by type |
| `ai` | AI | Perception and overall AI cost |
| `aibehaviortree` | AI | Behavior Tree cost |
| `physics` | Physics | Chaos physics timing |
| `particles` | VFX | Niagara/CPU particle cost |
| `gpuparticles` | VFX | GPU particle cost |
| `audio` | Audio | Audio thread timing |
| `animation` | Animation | Skeletal mesh animation cost |
| `gc` | GC | Garbage collection stats |
| `slate` | UI | Slate/UMG render cost |
| `net` | Network | Networking system stats |
| `dumphitches` | Diagnostics | Log any frame exceeding `t.HitchFrameTimeThreshold` |
| `hitches` | Diagnostics | Enable hitch detection and logging |
| `startfile` / `stopfile` | Capture | Write a `.uestats` capture for Session Frontend |
| `namedEvents` | External | Enable named events for PIX, NSight, etc. |

## Custom stat groups

Every team subsystem should define its own stat group so engineers can view it with
`stat MyGroup`:

```cpp
// MySystem.cpp — file-scoped, single TU
DECLARE_STATS_GROUP(TEXT("My System"), STATGROUP_MySystem, STATCAT_Advanced);

DECLARE_CYCLE_STAT(TEXT("Step A"), STAT_MySystem_StepA, STATGROUP_MySystem);
DECLARE_CYCLE_STAT(TEXT("Step B"), STAT_MySystem_StepB, STATGROUP_MySystem);
```

For stats shared across files (declare in header, define in one `.cpp`):

```cpp
// MySystem.h
DECLARE_STATS_GROUP_EXTERN(TEXT("My System"), STATGROUP_MySystem, STATCAT_Advanced, MYGAME_API);
DECLARE_CYCLE_STAT_EXTERN(TEXT("Step A"), STAT_MySystem_StepA, STATGROUP_MySystem, MYGAME_API);

// MySystem.cpp
DEFINE_STAT(STAT_MySystem_StepA);
```

Macro reference (all in `Stats/Stats.h`):

| Macro | Line | Purpose |
|---|---|---|
| `DECLARE_STATS_GROUP` | 225 | Group enabled by default |
| `DECLARE_STATS_GROUP_VERBOSE` | 231 | Group disabled by default |
| `DECLARE_CYCLE_STAT` | 146 | Cycle counter, file-scoped |
| `DECLARE_CYCLE_STAT_EXTERN` | 187 | Cycle counter, multi-file |
| `SCOPE_CYCLE_COUNTER` | 245 | Use a declared cycle stat |
| `CONDITIONAL_SCOPE_CYCLE_COUNTER` | 251 | Conditional use |
| `DECLARE_SCOPE_CYCLE_COUNTER` | 237 | Declare + use in one function |
| `QUICK_SCOPE_CYCLE_COUNTER` | 242 | Temporary, no prior declaration |

## Stat file capture (legacy)

`stat startfile` begins writing a `.uestats` file to `<Project>/Saved/Profiling/UnrealStats/`.
`stat stopfile` ends it. Load the file in Session Frontend (Tools menu) → Profiler tab.
Prefer Unreal Insights traces for new work; stat files are the legacy workflow.

## Stat types beyond cycle counters

The stats system also supports:

| Type | Macro | Use |
|---|---|---|
| Float counter | `DECLARE_FLOAT_COUNTER_STAT` | Cleared every frame |
| DWord counter | `DECLARE_DWORD_COUNTER_STAT` | Cleared every frame |
| Float accumulator | `DECLARE_FLOAT_ACCUMULATOR_STAT` | Persistent, manually reset |
| DWord accumulator | `DECLARE_DWORD_ACCUMULATOR_STAT` | Persistent, manually reset |
| Memory counter | `DECLARE_MEMORY_STAT` | Displays in memory units |

Update non-cycle stats with `INC_DWORD_STAT`, `SET_DWORD_STAT`, `INC_FLOAT_STAT_BY`,
`SET_MEMORY_STAT`, etc. (all in `Stats/Stats.h`).

## Stripped in Shipping

`#if STATS` guards all stat macros. In Shipping, `STATS == 0` and every stat macro
expands to nothing. For production-visible profiling use `TRACE_CPUPROFILER_EVENT_SCOPE`
(disabled by `CPUPROFILERTRACE_ENABLED`, also 0 in Shipping) or `CSV_SCOPED_TIMING_STAT`
(available in Test and Shipping builds).
