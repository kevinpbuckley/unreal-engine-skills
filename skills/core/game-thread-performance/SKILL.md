---
name: game-thread-performance
description: Explain how game-thread time drives frame rate and how to optimize it. Use when profiling CPU-bound frame-time spikes, tick-heavy actors, hitches, or when deciding whether to move work off the game thread.
metadata:
  engine-version: "5.7"
  category: performance
---

# Game-thread performance

The game thread is the main bottleneck for many Unreal projects: it owns actor ticking,
Blueprint execution, input, physics callbacks, and UI updates. If the game thread misses
its per-frame budget, the frame is delayed even when the GPU is idle.

## When to use this skill

- Frame rate feels low but the GPU looks underused.
- `stat unit` or `stat game` shows the Game thread dominating the frame.
- Tick-heavy actors, Blueprint hot paths, or frequent `Tick()` work are causing hitches.
- You need a quick mental model for how game-thread time translates into FPS.

## Mental model: frame budget is fixed

The hard ceiling for one frame is `1000 / TargetFPS` milliseconds, so every
extra millisecond of game-thread work costs real frame time:

| Target FPS | Budget per frame |
|---|---:|
| 30 FPS | 33.33 ms |
| 60 FPS | 16.66 ms |
| 120 FPS | 8.33 ms |
| 240 FPS | 4.16 ms |
| 360 FPS | 2.77 ms |

A useful rule of thumb:
- If the Game thread uses most of the frame budget, the game is CPU-bound.
- If the GPU or Render Thread dominates, the issue is rendering or fill-rate related.

## What eats the game-thread budget

Common heavy paths on the game thread:
- Actor and component `Tick()`
- Blueprint logic on every frame
- Excessive `GetWorld()`, `GetOwner()`, `Cast<>`, or `FindComponentByClass()` in hot paths
- Repeated allocations, string building, and UObject churn
- Physics / collision / navigation updates that are too frequent
- Widget updates and Slate invalidation
- Large numbers of timers or delegate broadcasts every frame

The result is not just lower FPS. It is also more variance in frame timing, which feels like
stutter, input lag, or hitchy gameplay even when the average FPS looks acceptable.

## Quick triage workflow

1. Run `stat unit` first.
   - Game > Render / GPU? The game thread is the limiter.
   - Render / GPU > Game? The problem is likely draw calls, overdraw, or post-process.
2. Run `stat game` to see which systems own the most game-thread time.
3. If the hotspot is in your code, instrument it with `DECLARE_CYCLE_STAT`,
   `SCOPE_CYCLE_COUNTER`, or `TRACE_CPUPROFILER_EVENT_SCOPE`.
4. Re-test after each fix; optimize the real hotspot, not the obvious one.

## Optimization levers

### 1. Reduce per-frame work

- Disable ticking when the actor does not need it:
  - `PrimaryActorTick.bCanEverTick = false`
  - only enable ticking when the object is actually active
- Use timers or events instead of `Tick()` for infrequent logic.
- Cache references once instead of recomputing them every frame.
- Avoid expensive string formatting, allocations, or `NewObject` churn in Tick.

### 2. Move expensive work off the game thread

- Put heavy CPU work on worker threads with `AsyncTask`, `TaskGraph`, or a background job.
- Keep the final UObject / actor mutation on the game thread only.
- Use queues or atomics to pass data from worker threads back to the game thread.

### 3. Optimize hot Blueprint and C++ paths

- Move per-frame hot paths from Blueprint to C++.
- Replace lots of tiny operations with fewer batched operations.
- Avoid repeated `GetPawn()`, `GetComponentByClass()`, `Cast<>`, or `FindField<>` calls in `Tick()`.

### 4. Reduce physics, AI, and widget overhead

- Limit the number of actors doing expensive movement, collision, or simulation updates.
- Batch UI updates instead of invalidating widgets every frame.
- Reduce duplicate AI / EQS / navmesh work during gameplay.

### 5. Tune expectations for high-FPS targets

At 120 FPS, the full frame budget is only 8.33 ms. At 240 FPS, it is 4.16 ms.
If your game thread consumes 5 ms of that at 120 FPS, you are already spending most of the
budget before rendering starts. This is why high-refresh targets are unforgiving.

## Example: safe game-thread reduction

```cpp
void AMyActor::Tick(float DeltaSeconds)
{
    QUICK_SCOPE_CYCLE_COUNTER(STAT_MyActor_Tick);

    // Cache references once in BeginPlay / constructor when possible.
    // Avoid expensive work here if it can run less often.
    if (!bReady) return;

    // Do only the minimal per-frame logic that must stay on the game thread.
}
```

If the work is heavy, move it to a worker task and apply the result back on the game thread:

```cpp
AsyncTask(ENamedThreads::AnyBackgroundThreadNormalTask, [WeakThis = TWeakObjectPtr<AMyActor>(this)]()
{
    // Heavy CPU work here.
    // Do NOT touch UObject / Actor state from this thread.
});
```

## Gotchas

- **Do not assume GPU is the bottleneck** just because the frame rate is low.
  Check `stat unit` and `stat game` first.
- **High FPS targets are not free** — 240 FPS and 360 FPS leave very little time for the
  game thread, so hot-path cleanup matters more, not less.
- **Moving the wrong things off-thread** can create bugs. Only move work that is genuinely
  CPU-bound and thread-safe; marshal actor/UObject mutations back to the game thread.
- **Blueprint-heavy Tick** is often the easiest win in a gameplay project.

## References & source material

Engine source (UE 5.7):
- `Engine/Source/Runtime/Core/Public/Stats/Stats.h` — stats and cycle counter helpers.
- `Engine/Source/Runtime/Engine/Private/LevelTick.cpp` — per-frame tick flow in the engine.
- `Engine/Source/Runtime/Engine/Private/TimerManager.cpp` — timer-based deferral paths.

Official docs (UE 5.7):
- Unreal Insights — https://dev.epicgames.com/documentation/unreal-engine/unreal-insights-in-unreal-engine
- Trace — https://dev.epicgames.com/documentation/unreal-engine/trace-in-unreal-engine-5
- Stat Commands — https://dev.epicgames.com/documentation/unreal-engine/stat-commands-in-unreal-engine
- Testing and Optimizing — https://dev.epicgames.com/documentation/unreal-engine/testing-and-optimizing-your-content

Related skills: `profiling-and-optimization`, `timers-and-async`, `debugging-techniques`.
