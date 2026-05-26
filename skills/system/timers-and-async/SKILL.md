---
name: timers-and-async
description: Schedule and defer work in Unreal C++ — FTimerManager (SetTimer with FTimerHandle,
  looping and one-shot timers, SetTimerForNextTick, ClearTimer, PauseTimer/UnPauseTimer,
  timer delegates with payloads), async work (Async/EAsyncExecution, AsyncTask/ENamedThreads,
  TFuture/TPromise, FNonAbandonableTask/FAutoDeleteAsyncTask/FAsyncTask, FRunnable/FRunnableThread,
  the UE Tasks System UE::Tasks::Launch/FTask/FPipe), FTSTicker for non-actor ticking,
  thread-safety and game-thread marshaling, latent actions overview. Use when implementing
  a delay or repeating callback, replacing per-frame Tick with a periodic timer, deferring
  one frame, offloading CPU-heavy work to a background thread, or building a non-actor
  ticker. Cross-references actors-and-components (EndPlay cleanup) and delegates-and-events.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Timers & async work

Most "do this later / every N seconds" needs belong in a **timer**, not `Tick`. For
CPU-intensive work, move computation off the game thread using `Async` or the Tasks System,
then marshal results back — UObjects and actors must only be touched on the game thread.

## When to use this skill

- A delay ("respawn in 3 s") or repeating callback ("regen every 0.5 s").
- Replacing a per-frame accumulator with a world-time-aware periodic timer.
- Deferring one frame (`SetTimerForNextTick`), e.g. waiting for another actor to finish
  spawning before continuing initialization.
- Offloading expensive work (procedural gen, parsing, path pre-computation) to a worker
  thread and applying the result on the game thread.
- Ticking a non-actor subsystem without a `UActorComponent` (`FTSTicker`).

## Timers — FTimerManager

`FTimerManager` manages all gameplay timers for a `UWorld`. Actors reach it via
`GetWorldTimerManager()`; non-actor code uses `GetWorld()->GetTimerManager()` or the
global instance on `UGameInstance`.

### Setting a timer

```cpp
// In actor header:
FTimerHandle RegenHandle;

// In BeginPlay — looping every 0.5 s:
GetWorldTimerManager().SetTimer(
    RegenHandle,
    this, &AMyHero::OnRegen,
    0.5f,
    /*bLoop*/ true);

// One-shot after 3 s:
FTimerHandle RespawnHandle;
GetWorldTimerManager().SetTimer(
    RespawnHandle,
    this, &AMyHero::OnRespawn,
    3.f,
    /*bLoop*/ false);

// Lambda variant — first delay differs from repeat rate:
FTimerHandle WarmupHandle;
GetWorldTimerManager().SetTimer(
    WarmupHandle,
    [this]{ OnWarmupComplete(); },
    1.f,
    /*bLoop*/ false,
    /*FirstDelay*/ 2.f);   // fires at 2 s, not 1 s
```

Keep `FTimerHandle` as a member so you can cancel or query the timer later. Calling
`SetTimer` on an already-valid handle cancels the old timer and starts a fresh one.

### Next-tick scheduling

```cpp
// Defer one frame — no handle returned; cannot be cancelled:
GetWorldTimerManager().SetTimerForNextTick(this, &AMyActor::AfterSpawn);
```

### Querying and cancelling

```cpp
GetWorldTimerManager().IsTimerActive(RegenHandle);      // true if running and not paused
GetWorldTimerManager().GetTimerRemaining(RegenHandle);  // seconds until next fire; -1 if invalid
GetWorldTimerManager().GetTimerElapsed(RegenHandle);
GetWorldTimerManager().PauseTimer(RegenHandle);
GetWorldTimerManager().UnPauseTimer(RegenHandle);
GetWorldTimerManager().ClearTimer(RegenHandle);         // stops and invalidates the handle
GetWorldTimerManager().ClearAllTimersForObject(this);   // clears every timer bound to this
```

`ClearTimer` invalidates the handle. Passing a rate `<= 0` to `SetTimer` is equivalent to
`ClearTimer`.

### Mandatory EndPlay cleanup

```cpp
virtual void EndPlay(const EEndPlayReason::Type Reason) override
{
    Super::EndPlay(Reason);
    GetWorldTimerManager().ClearTimer(RegenHandle);
    GetWorldTimerManager().ClearTimer(RespawnHandle);
}
```

Clear every looping timer in `EndPlay`. A looping timer that outlives its bound object
will attempt to call a dangling pointer. `EndPlay` covers *all* exit reasons (destroy,
level unload, PIE end) — see `actors-and-components`.

### How timers interact with game time

Timers advance on **world time**, so they automatically respect `WorldSettings` time
dilation, pausing (`SetPause`), and slow-motion. They do **not** fire more than once per
game frame even if the accumulated delta exceeds the rate (modulo `bMaxOncePerFrame` on
`FTimerData`). The game-thread-only note in the engine docs is accurate: `FTimerManager`
is not thread-safe; never set or clear timers from a background thread.

Full reference: [references/timer-manager.md](references/timer-manager.md).

## Async work off the game thread

### Async / AsyncTask (quick lambdas)

```cpp
#include "Async/Async.h"

// Fire heavy work on the thread pool; marshal result back to the game thread:
Async(EAsyncExecution::ThreadPool, [Payload]()
{
    // Worker thread — NO UObject/actor/component access:
    const FResult R = ComputeHeavyResult(Payload);

    // Marshal back:
    AsyncTask(ENamedThreads::GameThread, [R]()
    {
        // Game thread — safe to modify actors, components, UObjects:
        ApplyResult(R);
    });
});
```

`Async` returns a `TFuture<T>` that lets callers poll or wait for the result. Prefer
`EAsyncExecution::ThreadPool` for short-to-medium work; use `EAsyncExecution::Thread` for
long-running work that must not block the pool.

```cpp
// Capture a UObject safely across threads:
TWeakObjectPtr<AMyActor> WeakSelf(this);

Async(EAsyncExecution::ThreadPool, [WeakSelf, Data]()
{
    FResult R = DoWork(Data);
    AsyncTask(ENamedThreads::GameThread, [WeakSelf, R]()
    {
        if (AMyActor* Self = WeakSelf.Get())  // re-validate on game thread
        {
            Self->ApplyResult(R);
        }
    });
});
```

**Never** capture a raw `UObject*` or `AActor*` for use on another thread — the object
can be garbage-collected while the lambda is in flight. Capture a `TWeakObjectPtr` and
call `.Get()` after you are back on the game thread.

### FNonAbandonableTask / FAutoDeleteAsyncTask

For reusable, structured background tasks with their own data:

```cpp
// Declare the task work class:
class FMyProcessTask : public FNonAbandonableTask
{
    friend class FAutoDeleteAsyncTask<FMyProcessTask>;

    TArray<FVector> Points;

    explicit FMyProcessTask(TArray<FVector>&& InPoints)
        : Points(MoveTemp(InPoints)) {}

    void DoWork()
    {
        // Worker thread — pure computation, no UObjects:
        ProcessPoints(Points);
    }

    FORCEINLINE TStatId GetStatId() const
    {
        RETURN_QUICK_DECLARE_CYCLE_STAT(FMyProcessTask, STATGROUP_ThreadPoolAsyncTasks);
    }
};

// Launch — task self-deletes on completion:
(new FAutoDeleteAsyncTask<FMyProcessTask>(MoveTemp(SomePoints)))->StartBackgroundTask();
```

When you need to wait for completion or retrieve the result, use `FAsyncTask<T>` instead,
which exposes `EnsureCompletion()` and `IsDone()`.

Full reference: [references/async-and-tasks.md](references/async-and-tasks.md).

## UE Tasks System (UE 5.1+, preferred for new code)

The modern **Tasks System** (`UE::Tasks`) builds on the same worker-thread backend as the
task graph but with a cleaner API, dependency graphs, and pipes.

```cpp
#include "Tasks/Task.h"

using namespace UE::Tasks;

// Fire and forget:
Launch(UE_SOURCE_LOCATION, []{ DoWork(); });

// Capture result:
TTask<int32> Task = Launch(UE_SOURCE_LOCATION,
    []{ return ComputeValue(); });

// Wait and retrieve (blocks calling thread):
int32 Val = Task.GetResult();

// Dependency chain: B runs after A completes:
FTask A = Launch(UE_SOURCE_LOCATION, []{ StepOne(); });
FTask B = Launch(UE_SOURCE_LOCATION, []{ StepTwo(); }, A);

// Pipe: sequential non-concurrent access to a shared resource:
FPipe ResourcePipe{ TEXT("MyResourcePipe") };
FTask T = ResourcePipe.Launch(UE_SOURCE_LOCATION,
    [this]{ Resource.Mutate(); });
```

Prefer this over raw `Async`/`AsyncTask` for new code that needs DAG-style dependencies
or serialized access to a shared resource.

Full reference: [references/async-and-tasks.md](references/async-and-tasks.md).

## FRunnable / FRunnableThread (long-running dedicated threads)

For long-running services (audio streaming, network I/O, simulation loops) that must own
a dedicated OS thread:

```cpp
#include "HAL/Runnable.h"
#include "HAL/RunnableThread.h"

class FMyWorker : public FRunnable
{
public:
    FMyWorker() : bStop(false) {}

    virtual bool Init() override { return true; }

    virtual uint32 Run() override
    {
        while (!bStop)
        {
            DoIterationWork();          // never touch UObjects here
            FPlatformProcess::Sleep(0.01f);
        }
        return 0;
    }

    virtual void Stop() override { bStop = true; }
    virtual void Exit() override {}

private:
    TAtomic<bool> bStop;
};

// Ownership pattern — actor creates and destroys:
FMyWorker*      Worker = nullptr;
FRunnableThread* Thread = nullptr;

void AMyActor::BeginPlay()
{
    Super::BeginPlay();
    Worker = new FMyWorker();
    Thread = FRunnableThread::Create(Worker, TEXT("MyWorker"));
}

void AMyActor::EndPlay(const EEndPlayReason::Type Reason)
{
    Super::EndPlay(Reason);
    if (Thread) { Thread->Kill(/*bWait*/ true); delete Thread; Thread = nullptr; }
    delete Worker; Worker = nullptr;
}
```

Full reference: [references/threads-and-runnables.md](references/threads-and-runnables.md).

## FTSTicker — non-actor periodic ticking

`FTSTicker` provides a periodic callback for subsystems and objects that do not have a
`UActorComponent`. It replaces the older `FTicker` (removed in UE5).

```cpp
#include "Containers/Ticker.h"

// Register: return true to keep ticking, false for one-shot:
FTSTicker::FDelegateHandle TickHandle =
    FTSTicker::GetCoreTicker().AddTicker(
        TEXT("MySubsystemTick"),
        0.25f,                          // delay between fires (seconds)
        [this](float DeltaTime) -> bool
        {
            PollSubsystem(DeltaTime);
            return true;                // keep ticking
        });

// Unregister (e.g. in destructor or shutdown):
FTSTicker::RemoveTicker(TickHandle);
```

`FTSTickerObjectBase` is a convenience base class — subclass it and override `Tick(float)`
instead of managing the handle manually.

Full reference: [references/tickers-and-latent.md](references/tickers-and-latent.md).

## Thread-safety rules (critical)

- **Never** read or write `UObject` / `AActor` / `UActorComponent` state off the game
  thread. This includes `GetWorld()`, spawning, delegate broadcast, and GC-tracked pointers.
- Capture **copies** of plain data (structs, `int32`, `float`) into lambdas that cross
  threads. Capture `TWeakObjectPtr<T>` for any UObject; validate with `.Get()` after
  returning to the game thread.
- Protect mutable non-UObject state shared between threads with `FCriticalSection` /
  `FScopeLock` (`HAL/CriticalSection.h`, `Misc/ScopeLock.h`).
- `FTimerManager` itself is game-thread-only; set/clear timers only from the game thread.
- `FTSTicker::AddTicker` is thread-safe (the callback fires on the game thread); the
  `FTSTicker::RemoveTicker` call blocks until any in-progress callback finishes.

## Choosing the right mechanism

| Need | Mechanism |
|---|---|
| Delay or repeat at a fixed cadence | `FTimerManager::SetTimer` |
| Defer exactly one frame | `SetTimerForNextTick` |
| Per-frame smooth interpolation | `Tick` (enable selectively) |
| Short background work, fire-and-forget | `Async(EAsyncExecution::ThreadPool, ...)` |
| Background work with result / dependencies | `UE::Tasks::Launch` |
| Reusable background task class | `FNonAbandonableTask` + `FAutoDeleteAsyncTask` |
| Long-running dedicated OS thread | `FRunnable` + `FRunnableThread` |
| Non-actor periodic callback | `FTSTicker` |

## Latent actions (Blueprint async nodes)

Blueprint `Delay` nodes and latent `K2` functions are backed by `FPendingLatentAction`
(registered on `UWorld::GetLatentActionManager()`). From C++, prefer timers for actor
logic. If you need a Blueprint-exposed "async node" that shows a white execution pin,
subclass `UBlueprintAsyncActionBase` instead of implementing a raw `FPendingLatentAction`.

## Gotchas

- **Lost `FTimerHandle`** — a looping timer without a stored handle cannot be cancelled;
  it runs until the world tears down.
- **No EndPlay cleanup** — a looping timer whose delegate references `this` will call
  into freed memory after the actor is destroyed; always clear in `EndPlay`.
- **Raw `UObject*` captured across threads** — GC can collect the object while the lambda
  is in flight; use `TWeakObjectPtr` and re-validate on the game thread.
- **Timer rate `<= 0`** — silently treated as `ClearTimer`; guard against accidental
  zero rates when computing a dynamic interval.
- **`SetTimerForNextTick` has no handle** — it cannot be cancelled; do not call it if the
  actor might be destroyed before the next frame.
- **Blocking the game thread on a future** — calling `TFuture::Get()` or `FTask::Wait()`
  from the game thread stalls rendering; only block from worker/background threads or a
  known safe point (e.g. level loading).
- **`FTicker` vs `FTSTicker`** — `FTicker` was removed in UE5; always use `FTSTicker`.

## Version notes

- `FTSTicker` replaced `FTicker` in UE5. Any UE4-era code using `FTicker::GetCoreTicker()`
  must be ported to `FTSTicker::GetCoreTicker()`.
- The **UE Tasks System** (`UE::Tasks`) was introduced in UE 5.0. Prefer it over direct
  task-graph usage (`TGraphTask`) for new code in 5.7.
- Busy-waiting in `UE::Tasks` was deprecated in UE 5.5 and replaced by oversubscription
  (standby threads). Do not call the removed busy-wait APIs.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/Engine/Classes/Engine/TimerHandle.h` — `FTimerHandle`:11.
- `Runtime/Engine/Public/TimerManager.h` — `FTimerManager`:132, `SetTimer`:162,
  `SetTimerForNextTick`:244, `ClearTimer`:276, `PauseTimer`:299, `UnPauseTimer`:306,
  `IsTimerActive`:326, `GetTimerRemaining`:385, `ClearAllTimersForObject`:286,
  `FTimerManagerTimerParameters`:122.
- `Runtime/Core/Public/Async/Async.h` — `EAsyncExecution`:27 (enum with `TaskGraph`,
  `Thread`, `ThreadPool`, `TaskGraphMainThread`, `TaskGraphMainTick`), `Async`:299,
  `AsyncTask`:463.
- `Runtime/Core/Public/Async/AsyncWork.h` — `FAutoDeleteAsyncTask`:60,
  `FAsyncTaskBase`:206, `FAsyncTask`:583, `FNonAbandonableTask`:662.
- `Runtime/Core/Public/Async/TaskGraphInterfaces.h` — `ENamedThreads`:54 (namespace,
  `GameThread`, `AnyThread`, `RHIThread`).
- `Runtime/Core/Public/Async/Future.h` — `TFuture`:391, `TPromise`:540.
- `Runtime/Core/Public/Tasks/Task.h` — `UE::Tasks::TTask`, `FTask` alias, `Launch`,
  `AddNested`, `Wait` in `namespace UE::Tasks`.
- `Runtime/Core/Public/Tasks/Pipe.h` — `UE::Tasks::FPipe`:28.
- `Runtime/Core/Public/HAL/Runnable.h` — `FRunnable`:19 (`Init`, `Run`, `Stop`, `Exit`).
- `Runtime/Core/Public/HAL/RunnableThread.h` — `FRunnableThread`:19, `Create`:44.
- `Runtime/Core/Public/Containers/Ticker.h` — `FTSTicker`:26, `AddTicker`:45,
  `RemoveTicker`:66, `FTSTickerObjectBase`:136.
- `Runtime/Core/Public/HAL/CriticalSection.h` — `FCriticalSection`:53 (alias for
  `UE::FPlatformRecursiveMutex`).
- `Runtime/Core/Public/Misc/ScopeLock.h` — `FScopeLock`:140.

Official docs (UE 5.7, verified):
- Gameplay Timers —
  <https://dev.epicgames.com/documentation/unreal-engine/gameplay-timers-in-unreal-engine>
- Tasks System —
  <https://dev.epicgames.com/documentation/unreal-engine/tasks-systems-in-unreal-engine>

Deep-dive references in this skill:
- [references/timer-manager.md](references/timer-manager.md) — FTimerManager internals,
  delegate variants, timer parameters struct, time-dilation interaction.
- [references/async-and-tasks.md](references/async-and-tasks.md) — Async/AsyncTask
  patterns, TFuture/TPromise, FNonAbandonableTask, the UE Tasks System (Launch, FPipe,
  prerequisites, task events).
- [references/threads-and-runnables.md](references/threads-and-runnables.md) — FRunnable
  lifecycle, FRunnableThread::Create, thread priorities, stopping safely.
- [references/tickers-and-latent.md](references/tickers-and-latent.md) — FTSTicker API,
  FTSTickerObjectBase pattern, latent actions overview.
