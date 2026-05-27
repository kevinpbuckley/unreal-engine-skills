# Async work & the Tasks System — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `Async`/`AsyncTask`, `TFuture`/`TPromise`,
`FNonAbandonableTask`/`FAutoDeleteAsyncTask`/`FAsyncTask`, and the modern UE Tasks System
(`UE::Tasks::Launch`, `FTask`, `FPipe`, prerequisites, task events). Grounded in UE 5.7
sources and the official
[Tasks System](https://dev.epicgames.com/documentation/unreal-engine/tasks-systems-in-unreal-engine)
doc.

## Async / AsyncTask

Declared in `Runtime/Core/Public/Async/Async.h`.

```cpp
// Signature (line 299):
template<typename CallableType>
auto Async(EAsyncExecution Execution, CallableType&& Callable,
           TUniqueFunction<void()> CompletionCallback = nullptr)
    -> TFuture<decltype(...)>;

// Signature (line 463):
CORE_API void AsyncTask(ENamedThreads::Type Thread, TUniqueFunction<void()> Function);
```

`Async` returns a `TFuture<ResultType>`. The future can be stored and `.Get()` called
later (blocking) or a completion callback attached (non-blocking) via the third parameter.

`EAsyncExecution` values (verified: `Async.h`:27-53):

| Value | When to use |
|---|---|
| `TaskGraph` | Short CPU-bound work on an available worker thread |
| `TaskGraphMainThread` | Short work that must run on the game thread (safe inside waits) |
| `TaskGraphMainTick` | Short work on the game thread at a safe "tick" point |
| `Thread` | Long-running work needing a dedicated OS thread |
| `ThreadPool` | Medium work queued to the global `GThreadPool` |

`AsyncTask(ENamedThreads::GameThread, Lambda)` is the idiomatic way to hop back to the
game thread from a worker. `ENamedThreads` is a namespace with `int32` enum values
(verified: `TaskGraphInterfaces.h`:54), including `GameThread`, `RHIThread`, `AnyThread`,
and priority-combined values like `AnyNormalThreadNormalTask`.

## TFuture / TPromise

Declared in `Runtime/Core/Public/Async/Future.h`.

`TPromise<T>` creates a `TFuture<T>` via `GetFuture()`. The promise holds a shared state;
when `SetValue(...)` is called the future becomes ready and any registered callbacks fire.

```cpp
TPromise<int32> Promise;
TFuture<int32> Future = Promise.GetFuture();

// On a background thread:
Promise.SetValue(42);

// On the game thread (or any thread that wants the result):
int32 Val = Future.Get();   // blocks until ready
```

`TFuture` is **movable-only** (copy is deleted — verified: `Future.h`:413-416). Do not
store a `TFuture` in a `UPROPERTY`; store plain data or use a `TSharedPtr` wrapper.

`Async` wires the promise internally — callers usually only hold the returned `TFuture`.

## FNonAbandonableTask, FAutoDeleteAsyncTask, FAsyncTask

Declared in `Runtime/Core/Public/Async/AsyncWork.h`.

### FNonAbandonableTask (base mixin)

A stub base (lines 662-672) that implements `CanAbandon() { return false; }` and a no-op
`Abandon()`. Derive your task class from it when the work must always run to completion
(i.e. cannot be abandoned if the thread pool shuts down early).

### FAutoDeleteAsyncTask (fire-and-forget)

`FAutoDeleteAsyncTask<TTask>` (line 60) wraps your `TTask` in a queued work item that
self-deletes after `DoWork()` completes. There is no way to wait for it after launch.

```cpp
class FBuildNavTask : public FNonAbandonableTask
{
    friend class FAutoDeleteAsyncTask<FBuildNavTask>;

    FNavMeshData Data;
    explicit FBuildNavTask(FNavMeshData&& D) : Data(MoveTemp(D)) {}

    void DoWork() { BuildNavMesh(Data); }   // worker thread; no UObjects

    FORCEINLINE TStatId GetStatId() const
    {
        RETURN_QUICK_DECLARE_CYCLE_STAT(FBuildNavTask, STATGROUP_ThreadPoolAsyncTasks);
    }
};

// Launch to GThreadPool:
(new FAutoDeleteAsyncTask<FBuildNavTask>(MoveTemp(NavData)))->StartBackgroundTask();

// Or force-synchronous (useful in tests):
(new FAutoDeleteAsyncTask<FBuildNavTask>(MoveTemp(NavData)))->StartSynchronousTask();
```

### FAsyncTask (awaitable)

`FAsyncTask<TTask>` (line 583) adds `IsDone()`, `EnsureCompletion()`, and `Cancel()`.
You manage the lifetime (do not delete until the task is done):

```cpp
FAsyncTask<FBuildNavTask>* MyTask = new FAsyncTask<FBuildNavTask>(MoveTemp(NavData));
MyTask->StartBackgroundTask();

// Later (e.g. next frame, from game thread):
if (MyTask->IsDone())
{
    // safe to read results (store them in shared data the task populates)
    delete MyTask;
    MyTask = nullptr;
}
// Or: block until done:
MyTask->EnsureCompletion();
delete MyTask;
```

Never delete `FAsyncTask` before calling `EnsureCompletion()`.

## The UE Tasks System (UE::Tasks)

Declared in `Runtime/Core/Public/Tasks/Task.h` and `Tasks/Pipe.h`.
Namespace: `UE::Tasks`.

Introduced in UE 5.0, the Tasks System improves on `TGraphTask` with a cleaner API,
first-class dependency graphs, and pipes. It uses the same scheduler backend as the task
graph (verified: official Tasks System doc — "Tasks System and TaskGraph both use the same
backend").

### Launch

```cpp
// Fire-and-forget:
Launch(UE_SOURCE_LOCATION, []{ DoWork(); });

// Capture a result:
TTask<FMyResult> Task = Launch(UE_SOURCE_LOCATION,
    []{ return ComputeResult(); }, ETaskPriority::High);

// Retrieve (blocks):
FMyResult R = Task.GetResult();

// Check without blocking:
bool bDone = Task.IsCompleted();
```

`FTask` is an alias for `TTask<void>`. Tasks are movable reference-counted handles.
Release a held reference with `Task = {}`.

### Prerequisites (dependency graph)

```cpp
FTask A = Launch(UE_SOURCE_LOCATION, []{ StepA(); });
FTask B = Launch(UE_SOURCE_LOCATION, []{ StepB(); }, A);  // B waits for A

// Multiple prerequisites:
FTask C = Launch(UE_SOURCE_LOCATION, []{ StepC(); }, Prerequisites(A, B));
```

`Prerequisites(...)` is a variadic helper in `UE::Tasks`. Prerequisites do not block
worker threads — when A finishes, B is scheduled automatically.

### Nested tasks

A parent task is not considered complete until all nested tasks are done:

```cpp
FTask Parent = Launch(UE_SOURCE_LOCATION, []
{
    FTask Child = Launch(UE_SOURCE_LOCATION, []{ ChildWork(); });
    AddNested(Child);   // parent waits for child implicitly
});
```

`AddNested` must be called from inside an executing task.

### Pipes (serialized access)

`FPipe` (verified: `Tasks/Pipe.h`:28) enforces sequential (non-concurrent) execution of
tasks that access a shared resource:

```cpp
FPipe Pipe{ TEXT("MySharedResourcePipe") };

// These two tasks never run concurrently:
FTask T1 = Pipe.Launch(TEXT("Read"), [this]{ return Resource.Read(); });
FTask T2 = Pipe.Launch(TEXT("Write"), [this]{ Resource.Write(NewData); });
```

Pipes are lightweight — you can have thousands. The pipe must outlive its last queued task.

### Task events

`FTaskEvent` is an unsignaled task used for synchronization:

```cpp
FTaskEvent Gate{ UE_SOURCE_LOCATION };
FTask Worker = Launch(UE_SOURCE_LOCATION, []{ DoWork(); }, Gate);  // Gate as prerequisite
// ... later:
Gate.Trigger();   // releases Worker to run
```

### Oversubscription (UE 5.5+)

Busy-waiting was deprecated in UE 5.5. Calls to `Wait()` now use **oversubscription**
(standby threads) instead of executing random unrelated tasks on the waiting thread. No
code change required — the benefit is automatic. Do not call any removed busy-wait APIs
in 5.7 code.

## Thread-safety summary

| Item | Thread-safe? |
|---|---|
| `FTimerManager` | Game thread only |
| `Async` / `AsyncTask` | Safe to call from any thread |
| `UE::Tasks::Launch` | Safe to call from any thread |
| `FTSTicker::AddTicker` | Thread-safe (fires on game thread) |
| `UObject` / `AActor` access | Game thread only |
| `TWeakObjectPtr::Get()` | Game thread only (GC can run concurrently) |
