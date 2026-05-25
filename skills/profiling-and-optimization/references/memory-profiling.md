# Memory profiling — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `memreport`, LLM (Low Level Memory
Tracker), and Insights Memory Insights — workflow, query rules, and leak hunting.
Grounded in UE 5.7 source (`Runtime/Core/Public/HAL/LowLevelMemTracker.h`) and the
official [Memory Insights](https://dev.epicgames.com/documentation/unreal-engine/memory-insights-in-unreal-engine)
doc.

## Memory profiling layers

| Tool | Granularity | Overhead | Build |
|---|---|---|---|
| `stat memory` | Subsystem totals | Minimal | Development+ |
| `memreport -full` | Pool/asset breakdown, snapshot | Low | Development+ |
| `stat llm` / `stat llmfull` | Per-LLM-tag totals | Low (with `-llm`) | Development+ |
| Insights MemTag | Per-tag per-frame graph | Low | Development+ |
| Insights MemAlloc | Every alloc + callstack | High | Development only |

Start with `stat memory` to find which subsystem is large, then use memreport for a
full snapshot, LLM for tagged attribution, and MemAlloc for callstack-level investigation.

## memreport

`memreport -full` in the console writes a snapshot to
`<Project>/Saved/Profiling/MemReports/<timestamp>.memreport`.

The report includes:
- **Allocator summary** — total physical, virtual, slack.
- **Pool allocator buckets** — shows fragmentation.
- **UObject counts by class** — find class types with unexpected counts.
- **Texture memory** — per-texture streaming state, size.
- **RHI resources** — render target and buffer memory.
- **Audio** — wave instances, buffers.
- **Level streaming** — loaded levels and their memory.

Run `memreport` (without `-full`) for a lighter version. Use `-coalesced` for a version
sorted by size.

## LLM (Low Level Memory Tracker)

LLM instruments the allocator to tag every allocation with a named category. It adds a
small per-allocation overhead; enable only when investigating memory.

### Enabling LLM

Command line:
```
YourGame.exe -llm
YourGame.exe -llm -llmtagsets=assets   # enable per-asset tags (heavy)
```

View:
```
stat llm          # compact totals
stat llmfull      # all tags
```

### Key LLM tags

Tags are defined as enum values in `LowLevelMemTracker.h`
(`Runtime/Core/Public/HAL/LowLevelMemTracker.h`). Common tags:

| Tag | What it covers |
|---|---|
| `UObject` | All UObject allocations (actors, components, assets in memory) |
| `RenderTargets` | Render target textures |
| `Shaders` | Compiled shader bytecode |
| `Meshes` | Mesh vertex/index buffers |
| `Audio` | Decoded audio PCM data |
| `Animation` | Animation data (bones, curves) |
| `Niagara` | Particle system data |
| `PhysX` / `Chaos` | Physics simulation data |
| `EngineMisc` | Catch-all for untagged engine allocations |

LLM tag scopes in C++ use `LLM_SCOPE(ELLMTag::MyTag)` to attribute allocations within
a scope to a specific tag. Custom tags require adding an entry to the LLM tag list;
consult `LowLevelMemTracker.h` for the registration API.

### LLM in Insights

Run with `-trace=memtag,memalloc` to capture LLM data in a trace. In Memory Insights,
the **LLM Tags** panel controls visibility of per-tag graphs. The main graph shows total
tagged memory over time; each LLM tag appears as a separate graph track.

## Insights Memory Insights workflow

### Setup

Development build only for `memalloc` (callstacks). `memtag` works in any build with
`-llm`.

```
YourGame.exe -trace=memalloc,memtag,callstack,module -llm -tracehost=127.0.0.1
```

Open Unreal Insights → Session Browser → double-click the session → Menu → Memory Insights.

### Reading the main view

- **Total Allocated Memory (blue)** — all tracked allocations at each moment.
- **Live Allocation Count (yellow)** — number of live allocations.
- **Allocation/Free Event Count (green/orange)** — rate of allocs and frees per time slice.
- **LLM prefix graphs** — per-tag totals at frame granularity, starting a few seconds
  into the session.

### Investigation queries

Select a rule in the Investigation panel, drag markers A/B/C on the timeline, then
click **Run Query**:

| Rule | Timestamps | Finds |
|---|---|---|
| Active Alloc | A | Everything live at moment A |
| Growth | A, B | Allocated between A and B, still alive after B |
| Decline | A, B | Allocated before A, freed between A and B |
| Memory Leaks | A, B, C | Allocated between A and B, not freed until after C |
| Short Living | A, B | Allocated after A, freed before B (potential stack candidates) |
| Long Living | A, B | Allocated before A, freed after B |
| Alloc Events | A, B | All allocations between A and B |
| Free Events | A, B | All frees between A and B |

**Leak hunt pattern:**
1. Set A just before a level transition (or any expected cleanup point).
2. Set B just before, C just after the transition completes.
3. Run "Memory Leaks" (A, B, C) → shows what survived that should have been freed.

### Grouping query results

After a query completes, switch the Hierarchy from Flat to:
- **Tag** — group by LLM tag; see which system owns the largest allocations.
- **Callstack** / **Inverted Callstack** — trace the exact allocation site.
- **Asset** — requires `memalloc` + `assetmetadata` channel; shows cost per asset.
- **Class Name** — requires `memalloc` + `assetmetadata`; cost per UObject class.

Sort the result table by **Size** descending to find the largest offenders.

## Common memory problems and remedies

| Symptom | Likely cause | Remedy |
|---|---|---|
| UObject tag growing | Object leak, no GC trigger | Check for UPROPERTY cycles or raw pointers keeping objects alive; see `memory-and-gc` |
| RenderTargets high | Too many or oversized render targets | Audit render target pool; use `RenderTargetPool` stat |
| Shaders high | Many material permutations | Reduce `StaticSwitch` usage, share base materials; see `materials-and-shaders` |
| Meshes high | Many unique static mesh assets loaded | Cull low-LOD meshes; use Nanite; see `nanite-and-rendering` |
| Textures high | Too many streaming textures resident | Tune streaming pool size; use `stat streaming`; see `asset-management` |
| Memory spike on level load | Hard references pulling large assets | Convert to soft references and async load; see `asset-management` |

## Version notes (5.7)

- `ENABLE_LOW_LEVEL_MEM_TRACKER` is derived from `LLM_ENABLED_IN_CONFIG && PLATFORM_SUPPORTS_LLM`
  (line 20 of `LowLevelMemTracker.h`). Do not define it directly.
- `LLM_ENABLED_ON_PLATFORM` macro is deprecated in 5.7; use `PLATFORM_SUPPORTS_LLM`
  instead (line 15 of `LowLevelMemTracker.h`).
- Memory Insights Android callstack support was added in 5.4 and is available in 5.7.
- MemAlloc + Module channels must be active from process start (command-line only);
  they cannot be toggled on at runtime via the Trace widget.
