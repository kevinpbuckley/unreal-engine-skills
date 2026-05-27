# FTimerManager — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `FTimerManager` internals, delegate
variants, the `FTimerManagerTimerParameters` struct, pausing, time-dilation interaction,
and the global vs. world timer manager distinction. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Public/TimerManager.h` and
`Engine/Source/Runtime/Engine/Classes/Engine/TimerHandle.h`) and the official
[Gameplay Timers](https://dev.epicgames.com/documentation/unreal-engine/gameplay-timers-in-unreal-engine)
doc.

## How FTimerManager works

One `FTimerManager` per `UWorld`. Actors access it through `GetWorldTimerManager()` (which
delegates to `UWorld::GetTimerManager()`). A separate global instance lives on
`UGameInstance` and is the fallback when no world is active.

`FTimerManager::Tick(float DeltaTime)` is called by `UWorld::Tick` every frame. It
maintains three internal collections — `ActiveTimerHeap`, `PausedTimerSet`, and
`PendingTimerSet` — backed by a `TSparseArray<FTimerData>` (verified: `TimerManager.h`
lines 450-456). New timers go into `PendingTimerSet` first; they are moved to the active
heap after the current tick completes, so a timer set inside a timer callback is safe.

`FTimerData` holds the rate, expire time, loop flag, and the unified delegate. The handle
is a 64-bit opaque integer: 24 bits index into `Timers`, 40 bits serial number (verified:
`TimerHandle.h` lines 51-57). The serial number ensures a recycled slot is never confused
with a previous timer.

## SetTimer overloads

All `SetTimer` overloads resolve to `InternalSetTimer`, which accepts an
`FTimerUnifiedDelegate`. The delegate is a `TVariant` over three forms (verified:
`TimerManager.h` lines 22-24):

| Overload | Delegate form |
|---|---|
| `UserClass* Obj, MethodPtr` | `FTimerDelegate::CreateUObject(Obj, Method)` |
| `FTimerDelegate const&` | generic delegate (binds to any callable via `CreateRaw`/`CreateWeakLambda`/etc.) |
| `FTimerDynamicDelegate const&` | dynamic (Blueprint-callable) delegate |
| `TFunction<void()>&&` | lambda / callable — stored as `FTimerFunction` |

The object-method form (`UserClass*` + `MethodPtr`) uses `CreateUObject` internally. When
the bound `UObject` is destroyed the engine zeroes the delegate's object pointer, so the
timer becomes "invalid" and will not fire (verified: official Gameplay Timers doc, "Timers
will be canceled automatically if the Object … is destroyed").

**Important:** this auto-invalidation applies only to `UObject`-bound delegates. A
`TFunction` lambda that captures a raw pointer does **not** auto-invalidate — manual
cleanup in `EndPlay` is required.

## FTimerManagerTimerParameters

A newer, preferred form of `SetTimer` accepts `FTimerManagerTimerParameters` for richer
control (verified: `TimerManager.h` line 122):

```cpp
FTimerManagerTimerParameters Params;
Params.bLoop            = true;
Params.bMaxOncePerFrame = true;   // fire at most once per frame even if overdue
Params.FirstDelay       = 1.f;    // first fire delay; -1 uses the rate

GetWorldTimerManager().SetTimer(Handle, this, &AMyActor::OnTick, 0.5f, Params);
```

`bMaxOncePerFrame` prevents the timer from firing multiple times in a single large frame
(relevant for timers with very short rates under hitched frames).

## Time dilation and pausing

Timers run on `FTimerManager::InternalTime`, which advances by `DeltaTime` as supplied by
`UWorld::Tick`. Because `UWorld::Tick` already applies time dilation when computing
`DeltaTime`, timers automatically slow down / speed up with global or per-actor time
dilation — no extra code needed.

Calling `UGameplayStatics::SetGamePaused(true)` stops world ticking; `DeltaTime` becomes
zero and timers effectively freeze. The `PauseTimer`/`UnPauseTimer` API lets you freeze an
individual timer independently of world pause.

When a timer is paused, `ExpireTime` is rebased to represent remaining time rather than an
absolute clock value (verified: `TimerManager.h` lines 96-99). On `UnPauseTimer`, the
remaining time is added back to `InternalTime` to restore the absolute expire time.

## Accessing elapsed / remaining time

```cpp
// Fractions of the interval:
float Elapsed   = GetWorldTimerManager().GetTimerElapsed(Handle);   // -1 if invalid
float Remaining = GetWorldTimerManager().GetTimerRemaining(Handle); // -1 if invalid
float Rate      = GetWorldTimerManager().GetTimerRate(Handle);       // -1 if invalid

// Relationship: Elapsed + Remaining == Rate (when active)
```

All three return `-1.f` for invalid handles. Use `TimerExists(Handle)` or
`IsTimerActive(Handle)` to guard before querying.

## ClearAllTimersForObject

```cpp
// Clear every timer bound to a particular object pointer:
GetWorldTimerManager().ClearAllTimersForObject(this);
```

`FTimerManager` maintains a `TMap<const void*, TSet<FTimerHandle>> ObjectToTimers`
(verified: `TimerManager.h` line 458) for `O(1)` lookup of all timers belonging to a
given object. `ClearAllTimersForObject` is useful in a component's `OnUnregister` or an
actor's `EndPlay` when the actor owns many timers.

## Debugging

In non-shipping builds (`UE_ENABLE_TRACKING_TIMER_SOURCES`), `FTimerManager` records the
source code location that created each timer (verified: `TimerManager.h` line 26). Call
`GetWorldTimerManager().ListTimers()` from the console or a command handler to dump active
timers to the log.

## Version notes

The `FTimerManager` API has been stable across UE5. `FTimerManagerTimerParameters` was
added in UE 5.0; it is the preferred form for new code that needs `FirstDelay` or
`bMaxOncePerFrame`. Line numbers in citations drift across patch releases; re-grep
`TimerManager.h` if a line number looks off.
