# FTSTicker & latent actions — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `FTSTicker` API, `FTSTickerObjectBase`,
timer-skew semantics, use cases, and an overview of latent actions
(`FPendingLatentAction`, `UBlueprintAsyncActionBase`). Grounded in UE 5.7:
`Runtime/Core/Public/Containers/Ticker.h`.

## FTSTicker

Declared at `Runtime/Core/Public/Containers/Ticker.h`:26. The class is **thread-safe**
for `AddTicker`/`RemoveTicker`, but all callbacks fire on the ticking thread (the game
thread for `FTSTicker::GetCoreTicker()`).

### API

```cpp
// Singleton for game/engine ticking:
FTSTicker& Ticker = FTSTicker::GetCoreTicker();

// Add a repeating ticker (delay = seconds between fires; 0 = every frame):
FTSTicker::FDelegateHandle Handle =
    Ticker.AddTicker(
        TEXT("PollLobbyTicker"),    // debug name
        5.0f,                       // repeat every 5 s
        [this](float DeltaTime) -> bool
        {
            PollLobby();
            return true;            // true = reschedule; false = one-shot
        });

// Remove (thread-safe; blocks if callback is currently executing):
FTSTicker::RemoveTicker(Handle);
```

`FDelegateHandle` is a `TWeakPtr<FElement>` — it becomes invalid once the ticker is
removed or the ticker object is destroyed. Always store it as a member so `RemoveTicker`
can be called from a destructor or shutdown path.

### Timer-skew semantics

`FTSTicker` guarantees a delegate fires **no more often** than `InDelay` seconds, but
does not guarantee exactly `InDelay` seconds (verified: `Ticker.h` lines 70-77,
"reschedule has timer skew"). After each invocation the next fire time is set to
`now + InDelay`, not `lastFireTime + InDelay`. This means that under heavy load a ticker
at 0.1 s may not fire exactly 10 times per second, but it will never fire faster than
that interval.

For exact-cadence repeating work with time-dilation respect, prefer `FTimerManager`. Use
`FTSTicker` when ticking a non-world object that should run regardless of which world is
active or when there is no world at all.

### FTSTickerObjectBase convenience class

Subclass instead of managing handles manually:

```cpp
class FMySubsystem : public FTSTickerObjectBase
{
public:
    FMySubsystem()
        : FTSTickerObjectBase(0.1f)   // tick every 0.1 s
    {}

    virtual bool Tick(float DeltaTime) override
    {
        UpdateSubsystem(DeltaTime);
        return true;  // keep ticking
    }
};
```

`FTSTickerObjectBase` registers the ticker in its constructor and unregisters in its
destructor (verified: `Ticker.h`:147-150). No manual handle bookkeeping needed.

### When not to use FTSTicker

- Inside actors/components: use `FTimerManager` — it respects world pausing and time
  dilation and is cleaned up automatically when the world tears down.
- For one-time next-frame deferral: use `SetTimerForNextTick` (game-thread actors) or
  `ExecuteOnGameThread(DebugName, Functor)` from off-thread (wrapper around
  `FTSTicker::GetCoreTicker().AddTicker` with `return false` — verified `Ticker.h`:168).

### FTicker (removed)

`FTicker` was the UE4 / early UE5 equivalent. It was **not** thread-safe. It was removed
in UE5 (confirmed absent from the UE 5.7 source tree). All `FTicker` call sites must be
ported to `FTSTicker`.

## Latent actions (overview)

A **latent action** is a Blueprint node with a white "then" pin that does not fire
immediately — it yields and resumes later. Examples: `Delay`, `MoveToLocation`, HTTP
request callbacks.

### Implementation path

Latent actions are registered with `UWorld::GetLatentActionManager()`. The minimal
implementation:

```cpp
class FMyLatentAction : public FPendingLatentAction
{
public:
    float Remaining;
    FName ExecutionFunction;
    int32 OutputLink;
    FWeakObjectPtr CallbackTarget;

    FMyLatentAction(float Delay, const FLatentActionInfo& Info)
        : Remaining(Delay)
        , ExecutionFunction(Info.ExecutionFunction)
        , OutputLink(Info.Linkage)
        , CallbackTarget(Info.CallbackTarget)
    {}

    virtual void UpdateOperation(FLatentResponse& Response) override
    {
        Remaining -= Response.ElapsedTime();
        if (Remaining <= 0.f)
        {
            Response.FinishAndTriggerIf(true, ExecutionFunction, OutputLink, CallbackTarget);
        }
    }
};

// Call site (from a BlueprintCallable latent function):
if (UWorld* World = GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::LogAndReturnNull))
{
    World->GetLatentActionManager().AddNewAction(
        LatentInfo.CallbackTarget, LatentInfo.UUID,
        new FMyLatentAction(DelaySeconds, LatentInfo));
}
```

### Preferred alternative: UBlueprintAsyncActionBase

For most custom async Blueprint nodes in 5.7, prefer subclassing
`UBlueprintAsyncActionBase`. It handles the delegate pins, execution context, and garbage
collection automatically, and works with Blueprint's async graph evaluation without manual
latent action plumbing.

```cpp
UCLASS()
class MYGAME_API UMyAsyncAction : public UBlueprintAsyncActionBase
{
    GENERATED_BODY()
public:
    UPROPERTY(BlueprintAssignable) FMyDelegate OnComplete;
    UPROPERTY(BlueprintAssignable) FMyDelegate OnFailed;

    UFUNCTION(BlueprintCallable, meta=(BlueprintInternalUseOnly="true", WorldContext="WorldContextObject"))
    static UMyAsyncAction* DoAsync(UObject* WorldContextObject, float Delay);

    virtual void Activate() override;
};
```

`UBlueprintAsyncActionBase` is declared in
`Engine/Classes/Engine/BlueprintAsyncActionBase.h`. The `meta=(BlueprintInternalUseOnly="true")`
specifier hides the function from the Blueprint palette while the async node remains
accessible through the async action machinery.

## Version notes

- `FPendingLatentAction` and `ULatentActionManager` are stable across UE5.
- `UBlueprintAsyncActionBase` is the preferred path for new async nodes since UE 4.17.
- `FTSTickerObjectBase` and the `FTSTicker` thread-safety guarantees are UE5 additions.
