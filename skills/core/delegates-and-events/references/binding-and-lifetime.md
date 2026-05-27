# Binding forms and lifetime safety — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers every single-cast and multicast
binding form, what lifetime guarantee each provides, payload variable syntax,
`FDelegateHandle` management, and `EndPlay` cleanup patterns. Grounded in UE 5.7
(`Engine/Source/Runtime/Core/Public/Delegates/DelegateSignatureImpl.inl`).

## Binding form reference table

All `Bind*` forms are for single-cast (`TDelegate`); all `Add*` forms are for
multicast (`TMulticastDelegate`). Source: `DelegateSignatureImpl.inl`.

| Form | Object type | Weak ref? | Safe if object dies? | Lines |
|---|---|---|---|---|
| `BindStatic` / `AddStatic` | global/static fn | — | yes (no object) | — |
| `BindUObject` / `AddUObject` | `UObject` subclass | yes (`TWeakObjectPtr`) | skipped if GC'd | 276 / 969 |
| `BindSP` / `AddSP` | `TSharedRef`/`TSharedPtr` | yes (`TWeakPtr`) | skipped if expired | 179 / 864 |
| `BindWeakLambda` / `AddWeakLambda` | `UObject` subclass | yes (weak UObject) | lambda not called | 151 / 828 |
| `BindSPLambda` / `AddSPLambda` | shared-ptr object | yes (weak SP) | lambda not called | 136 / 815 |
| `BindLambda` / `AddLambda` | any (functor) | **no** | **crash if capture dead** | 126 / 802 |
| `BindRaw` / `AddRaw` | any raw ptr | **no** | **crash if object dead** | 163 / 843 |
| `BindUFunction` / `AddUFunction` | `UObject` by FName | yes | skipped if GC'd | 259 / 950 |

All weak-ref forms call `ExecuteIfBound`-style logic internally — the binding is
silently skipped rather than crashing when the referent no longer exists.

## Choosing between `AddUObject` and `AddWeakLambda`

Both are safe for `UObject` targets. Use `AddUObject` when you have a named member
function; use `AddWeakLambda` when you need a closure (capturing multiple locals or
remapping parameters):

```cpp
// Named member — prefer AddUObject (cleaner, no capture boilerplate)
FDelegateHandle H1 = OnScore.AddUObject(this, &AScoreHud::HandleScoreChanged);

// Closure with remapped logic — use AddWeakLambda
FDelegateHandle H2 = OnScore.AddWeakLambda(this, [this, GoalScore](int32 Score)
{
    if (Score >= GoalScore) { NotifyVictory(); }
});
```

## `AddLambda` / `BindLambda` — safe usage patterns

A bare lambda has no lifetime tracking. Safe patterns:

1. **Lambda captures nothing** — no object can die, always safe.
2. **Lambda captures only value types** — copies are always valid.
3. **Lambda captures a `TWeakObjectPtr`** and checks it inside:

```cpp
TWeakObjectPtr<AMyActor> WeakSelf = this;
FDelegateHandle H = OnEvent.AddLambda([WeakSelf]()
{
    if (AMyActor* Self = WeakSelf.Get()) { Self->React(); }
});
```

4. **Store the handle and remove in `EndPlay`** — mandatory when `this` is captured.

```cpp
// BeginPlay:
LambdaHandle = SomeGlobal->OnEvent.AddLambda([this](){ Use(); });

// EndPlay:
if (SomeGlobal) { SomeGlobal->OnEvent.Remove(LambdaHandle); }
```

## `AddRaw` — when it's appropriate

`AddRaw` is the fastest form (no indirection), but has no safety net. Appropriate
only for objects with a lifetime guaranteed to exceed the delegate's — e.g., engine
singletons, subsystems, or stack-allocated objects in tight inner loops. In all other
cases prefer `AddUObject` or `AddWeakLambda`.

## Payload variable syntax

Up to four extra args appended to `Bind*`/`Add*` calls; forwarded after the delegate's
declared params when the delegate fires. Non-dynamic delegates only.

```cpp
DECLARE_DELEGATE_OneParam(FOnProcess, float /*DeltaTime*/);

FOnProcess D;
int32 Priority = 3;
FName Tag = TEXT("Combat");
// Target method signature: void Process(float DeltaTime, int32 P, FName T)
D.BindUObject(this, &AMyActor::Process, Priority, Tag);
```

Payload args are type-erased and stored inside the binding; they are value-copied at
bind time (use `TSharedPtr` or `TWeakObjectPtr` for reference semantics).

## `FDelegateHandle` patterns

```cpp
// Store in a UPROPERTY or member (not a local) so it survives past the binding scope
UPROPERTY()                          // not needed for FDelegateHandle but shows intent
FDelegateHandle ScoreHandle;

// Binding
ScoreHandle = Scoreboard->OnScoreChanged.AddUObject(this, &AMyHud::HandleScore);

// Manual removal (e.g. when switching modes)
if (Scoreboard) { Scoreboard->OnScoreChanged.Remove(ScoreHandle); }
ScoreHandle.Reset();  // sentinel: IsValid() returns false

// Check if still valid
if (ScoreHandle.IsValid()) { /* still bound */ }
```

`FDelegateHandle::IsValid()` tells you whether the handle was ever assigned — it does
not confirm the binding is still in the invocation list. If the delegate owner has
been destroyed, the handle is stale but not automatically reset. Always null-check
the delegate owner before calling `Remove`.

## `EndPlay` cleanup pattern

```cpp
void AMyActor::EndPlay(const EEndPlayReason::Type Reason)
{
    Super::EndPlay(Reason);

    // Remove UObject bindings — auto-compacted at next broadcast anyway,
    // but explicit removal avoids a transient dangling entry
    if (IsValid(OtherActor))
    {
        OtherActor->OnEvent.RemoveAll(this);
    }

    // Lambda handle — MUST be explicit; no auto-cleanup
    if (IsValid(GlobalSystem))
    {
        GlobalSystem->OnTick.Remove(LambdaHandle);
    }
    LambdaHandle.Reset();
}
```

`RemoveAll(this)` removes every binding whose user-object is `this` — convenient
for actors that bind to many events on one source.

## Multicast: invocation list during broadcast

When `Broadcast()` is in progress, the invocation list is locked (`InvocationListLockCount > 0`
in `MulticastDelegateBase.h`). Adding or removing bindings during a broadcast is
deferred: removals mark the entry compactable and it is removed at the next
compaction opportunity; additions are queued. This is safe but means a handler added
inside a broadcast will not fire in the same broadcast call.
