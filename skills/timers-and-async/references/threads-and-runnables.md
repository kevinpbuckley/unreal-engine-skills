# FRunnable & FRunnableThread — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `FRunnable` lifecycle, creating and
stopping threads with `FRunnableThread`, thread priorities, safe stopping patterns, and
when to prefer `FRunnable` over the Tasks System or `Async`. Grounded in UE 5.7:
`Runtime/Core/Public/HAL/Runnable.h` and `Runtime/Core/Public/HAL/RunnableThread.h`.

## When to use FRunnable

`FRunnable` / `FRunnableThread` is the right tool when you need a **dedicated OS thread**
with an indefinite lifetime:

- Streaming services that must run continuously (network I/O, audio decode, telemetry).
- Simulation loops that run at a fixed rate decoupled from the game frame.
- Worker daemons that poll a queue until explicitly shut down.

For bounded, pool-able work (tasks that finish and release the thread), prefer
`Async(EAsyncExecution::ThreadPool, ...)` or `UE::Tasks::Launch`, which share `GThreadPool`
and avoid the overhead of spawning a dedicated OS thread.

## FRunnable lifecycle

Declared at `Runtime/Core/Public/HAL/Runnable.h`:19. The virtual interface:

| Method | Called by | Notes |
|---|---|---|
| `Init()` | Thread start | Return `false` to abort; `Run()` is skipped |
| `Run()` | Thread, after `Init()` | Main work loop; return value is the OS exit code |
| `Stop()` | Any thread | Signal `Run()` to exit; must be non-blocking |
| `Exit()` | Thread, after `Run()` | Cleanup on the thread (TLS, etc.) |

`Stop()` is informational — it does not forcibly terminate `Run()`. You must implement the
coordination yourself, typically with an atomic flag:

```cpp
class FStreamWorker : public FRunnable
{
public:
    virtual bool Init() override
    {
        bRunning = true;
        return OpenStream();      // false = abort
    }

    virtual uint32 Run() override
    {
        while (bRunning.load(std::memory_order_relaxed))
        {
            ProcessNextPacket();  // never touch UObjects here
        }
        return 0;
    }

    virtual void Stop() override
    {
        bRunning = false;         // signal Run() to exit
        CloseStream();            // release blocking I/O so Run() can observe the flag
    }

    virtual void Exit() override
    {
        CleanupTLS();
    }

private:
    std::atomic<bool> bRunning{ false };
};
```

`TAtomic<bool>` (UE wrapper) or `std::atomic<bool>` work equally well for the stop flag.

## FRunnableThread::Create

Declared at `Runtime/Core/Public/HAL/RunnableThread.h`:44:

```cpp
static CORE_API FRunnableThread* Create(
    class FRunnable* InRunnable,
    const TCHAR*    ThreadName,
    uint32          InStackSize   = 0,          // 0 = platform default
    EThreadPriority InThreadPri   = TPri_Normal,
    uint64          AffinityMask  = FPlatformAffinity::GetNoAffinityMask(),
    EThreadCreateFlags InCreateFlags = EThreadCreateFlags::None);
```

Returns `nullptr` on unsupported platforms (single-threaded mode). Always null-check.

### Thread priority

| `EThreadPriority` | Notes |
|---|---|
| `TPri_TimeCritical` | Highest; only for latency-critical real-time work |
| `TPri_Highest` | |
| `TPri_AboveNormal` | |
| `TPri_Normal` | Default; use for most background workers |
| `TPri_BelowNormal` | |
| `TPri_Lowest` | |
| `TPri_SlightlyBelowNormal` | |

Avoid `TPri_TimeCritical` and `TPri_Highest` in gameplay code — they can starve the render
thread on constrained hardware.

## Ownership and shutdown pattern

The actor (or subsystem) that creates the thread must shut it down in `EndPlay` /
`Shutdown`. The safest pattern:

```cpp
// Actor members:
TUniquePtr<FMyWorker>   Worker;
FRunnableThread*        Thread = nullptr;

void AMyActor::BeginPlay()
{
    Super::BeginPlay();
    Worker = MakeUnique<FMyWorker>();
    Thread = FRunnableThread::Create(Worker.Get(), TEXT("MyWorkerThread"));
    if (!Thread)
    {
        // single-threaded platform — run synchronously or skip
    }
}

void AMyActor::EndPlay(const EEndPlayReason::Type Reason)
{
    Super::EndPlay(Reason);
    if (Thread)
    {
        Thread->Kill(/*bShouldWait*/ true);  // calls Stop(), waits for Run() to exit
        delete Thread;
        Thread = nullptr;
    }
    Worker.Reset();
}
```

`Kill(true)` calls `Stop()` on the runnable, then blocks until the OS thread exits. Never
delete the `FRunnableThread` while it is still running — use `Kill(true)` first.

## Single-threaded mode

On platforms where `FPlatformProcess::SupportsMultithreading()` returns `false` (some
consoles, single-threaded cooking), `FRunnableThread::Create` returns `nullptr`. The
engine will still call `Init`, `Run`, and `Exit` on the game thread when
`FRunnableThread::Tick` is driven (via `FSingleThreadRunnable`). Override
`GetSingleThreadInterface()` on your `FRunnable` if you need single-thread fallback
behavior (verified: `Runnable.h`:69).

## Communicating results back to the game thread

The same rule applies as with `Async`: never touch UObjects from the worker thread.
Use a thread-safe queue or atomic to store results, then consume them from the game thread
(a timer, `FTSTicker`, or `Tick`):

```cpp
// Shared result queue (lock-free):
TQueue<FMyResult, EQueueMode::Mpsc> ResultQueue;

// In FMyWorker::Run():
ResultQueue.Enqueue(ComputedResult);

// In actor Tick() or a timer callback (game thread):
FMyResult R;
while (ResultQueue.Dequeue(R))
{
    ApplyResult(R);
}
```

## Version notes

The `FRunnable`/`FRunnableThread` API is stable across UE4 and UE5. No major changes in
5.7. If you need a simpler dedicated-thread abstraction with less boilerplate, consider
`Async(EAsyncExecution::Thread, ...)` which internally wraps a `FRunnableThread` for you
(verified: `Async.h` line 324-336).
