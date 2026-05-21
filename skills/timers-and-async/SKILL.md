---
name: timers-and-async
description: Schedule and defer work in Unreal — FTimerManager timers (SetTimer, looping, delays,
  FTimerHandle), next-tick scheduling, and running work off the game thread with Async/AsyncTask
  while staying thread-safe. Use when you need a delay, a repeating tick alternative, debounced or
  deferred logic, or to move heavy work off the game thread and marshal results back. Prefer this
  over per-frame Tick for periodic logic.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Timers & async work

Most "do this later / every N seconds" needs should use a **timer**, not `Tick`. For heavy CPU
work, move it off the game thread with `Async`, then marshal results back — but never touch
UObjects/actors off the game thread.

## When to use this skill

- A delay ("respawn in 3s"), or repeating logic ("regen every 0.5s").
- A cheaper alternative to per-frame ticking for periodic work.
- Debounce/defer to next tick.
- Offloading expensive computation (pathfinding prep, parsing, procedural gen) off the game thread.

## Timers (FTimerManager)

Get the manager from an actor or the world:

```cpp
FTimerHandle Handle;

// Repeating every 0.5s, first call after 0.5s:
GetWorldTimerManager().SetTimer(Handle, this, &AMyActor::Regen, 0.5f, /*bLoop*/ true);

// One-shot after 3s:
GetWorldTimerManager().SetTimer(Handle, this, &AMyActor::Respawn, 3.f, false);

// Lambda variant:
GetWorldTimerManager().SetTimer(Handle, [this]{ DoThing(); }, 1.f, false);

// Next frame:
GetWorldTimerManager().SetTimerForNextTick(this, &AMyActor::AfterSpawn);
```

Manage timers:
```cpp
GetWorldTimerManager().ClearTimer(Handle);            // stop it
GetWorldTimerManager().IsTimerActive(Handle);
GetWorldTimerManager().GetTimerRemaining(Handle);
GetWorldTimerManager().PauseTimer(Handle) / UnPauseTimer(Handle);
```

Outside an actor: `GetWorld()->GetTimerManager()`. Each `UWorld` has its own timer manager;
timers stop when the world is torn down.

Rules:
- **Keep the `FTimerHandle`** if you need to cancel/query; store it as a member.
- Timers fire on the **game thread** — safe to touch actors/UObjects.
- Looping timers respect time dilation/pause (world time), unlike a naive accumulator.
- Clear timers in `EndPlay` if their handler captures `this` and could outlive the actor.

## Latent / delays in Blueprints

Blueprint "Delay" and async nodes are latent actions. From C++, prefer timers; if you need a
Blueprint-exposed async node, implement a `UBlueprintAsyncActionBase` (see `umg-and-slate` /
asset-loading patterns) rather than a raw `FPendingLatentAction`.

## Async work off the game thread

```cpp
#include "Async/Async.h"

// Run heavy work on a worker thread, then return to the game thread for UObject access:
Async(EAsyncExecution::ThreadPool, [Payload]()
{
    const FResult R = DoHeavyWork(Payload);          // NO UObject/actor access here
    AsyncTask(ENamedThreads::GameThread, [R]()
    {
        // Back on the game thread — safe to touch gameplay objects:
        ApplyResult(R);
    });
});
```

- `Async(EAsyncExecution::ThreadPool/Thread/TaskGraph, Lambda)` — start background work.
- `AsyncTask(ENamedThreads::GameThread, Lambda)` — hop back to the game thread.
- Capture **copies** of plain data; capture a `TWeakObjectPtr` for any UObject and re-check
  validity on the game thread before use.

### Thread-safety rules (critical)
- **Never** call into UObjects/actors/components, spawn, or touch the world off the game thread.
- Don't capture raw `this`/`UObject*` for use on another thread — use `TWeakObjectPtr` and
  validate after marshaling back.
- Protect shared non-UObject state with `FCriticalSection`/`FScopeLock` if multiple threads touch it.

## Async asset loading

For loading assets without a hitch, use soft references + the streamable manager (see
`asset-management`): `UAssetManager::GetStreamableManager().RequestAsyncLoad(SoftPath, Callback)`.
Don't sync-load large assets on the game thread during gameplay.

## Choosing timer vs tick vs async

- Periodic gameplay logic at a fixed cadence → **timer**.
- Something that genuinely must update every frame (smooth interpolation) → **Tick** (enabled).
- One-frame defer → **SetTimerForNextTick**.
- CPU-heavy, frame-spiking computation → **Async** off-thread, marshal back.

## Gotchas

- **Lost `FTimerHandle`** → can't cancel a looping timer; it runs until the world dies.
- **Handler outlives the actor** → captured `this` dangles; clear timers in `EndPlay`.
- **UObject access off-thread** → crashes/races; always marshal back to the game thread.
- **Using a wall-clock accumulator** instead of world time ignores pause/dilation.
- **Sync-loading assets** mid-gameplay → hitches; load async ahead of time.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Public/TimerManager.h` — `FTimerManager`, `FTimerHandle`, `SetTimer*`.
- `Runtime/Core/Public/Async/Async.h` — `Async`, `AsyncTask`, `EAsyncExecution`.
- `Runtime/Core/Public/Async/TaskGraphInterfaces.h` — `ENamedThreads`, task graph.
- `Runtime/Core/Public/HAL/CriticalSection.h` — `FCriticalSection`/`FScopeLock`.

Official docs (UE 5.7): Programming with C++ —
<https://dev.epicgames.com/documentation/unreal-engine/programming-with-cplusplus-in-unreal-engine>
