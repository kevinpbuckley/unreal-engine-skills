---
name: delegates-and-events
description: Wire up callbacks and events in Unreal C++ using delegates — single-cast
  (DECLARE_DELEGATE, DECLARE_DELEGATE_RetVal, payload variables), multicast
  (DECLARE_MULTICAST_DELEGATE, DECLARE_TS_MULTICAST_DELEGATE), and dynamic
  (DECLARE_DYNAMIC_MULTICAST_DELEGATE, BlueprintAssignable, AddDynamic, RemoveDynamic).
  Covers all binding forms (BindUObject, AddUObject, BindLambda, AddWeakLambda,
  BindRaw, AddSP), execution (Execute, ExecuteIfBound, Broadcast), FDelegateHandle
  lifetime management, safe unbinding, and DECLARE_EVENT. Use when implementing the
  observer pattern, exposing C++ events to Blueprints, decoupling game systems,
  binding overlap/hit/ability callbacks, or debugging delegate crashes and silent no-ops.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Delegates & events

Delegates are Unreal's type-safe function-pointer/observer system. There are three
families — pick the right one before writing any binding code, because they differ in
Blueprint visibility, binding API, and serialization capability.

## When to use this skill

- One object needs to notify others when something happens (observer pattern).
- Exposing a C++ event that Blueprints can subscribe to (`BlueprintAssignable`).
- Decoupling systems: broadcast an event instead of calling a known class directly.
- Binding to overlap/hit/ability completion callbacks that require `UFUNCTION`.
- Crashes or silent no-ops from bad binding types, destroyed objects, or wrong macros.

## The three families

| Family | Macro prefix | Listeners | Blueprint? | Return value? |
|---|---|---|---|---|
| Single-cast | `DECLARE_DELEGATE*` | exactly one | no | yes (`_RetVal`) |
| Multicast | `DECLARE_MULTICAST_DELEGATE*` | many | no | no |
| Dynamic multicast | `DECLARE_DYNAMIC_MULTICAST_DELEGATE*` | many | **yes** | no |

**The decisive rule:** if Blueprints need to subscribe, use dynamic multicast. For
C++-only events with many listeners use multicast. For a single required callback
(possibly with a return value) use single-cast. For a stored callable that isn't an
event at all, use `TFunction<Ret(Args...)>`.

Suffixes encode the signature: `_OneParam`, `_TwoParams`, `_RetVal_OneParam`, etc.
The delegate system supports up to **9 parameters** and up to **4 payload variables**
(non-dynamic only). Dynamic delegate params must be **named** in the macro.

## Declaring

```cpp
// C++-only multicast — no Blueprint access
DECLARE_MULTICAST_DELEGATE_OneParam(FOnHealthChanged, float /*NewHealth*/);

// Dynamic multicast — Blueprint-assignable, params must be named
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnDiedSignature, AActor*, Killer);

// Single-cast with return value — only one binding, can return bool
DECLARE_DELEGATE_RetVal_OneParam(bool, FCanInteract, AActor* /*Instigator*/);
```

Declare at global scope, namespace, or class scope — **not** inside a function body.

Expose as class members with the correct UPROPERTY specifier:

```cpp
UCLASS()
class MYGAME_API UHealthComponent : public UActorComponent
{
    GENERATED_BODY()
public:
    // C++-only: no UPROPERTY needed; bind from C++ with AddUObject/AddLambda
    FOnHealthChanged OnHealthChanged;

    // Blueprint-assignable: MUST be UPROPERTY(BlueprintAssignable)
    UPROPERTY(BlueprintAssignable, Category="Health")
    FOnDiedSignature OnDied;
};
```

## Binding

### C++-only delegates (single-cast and multicast)

```cpp
// Single-cast: bind to a UObject member function (weak ref — safe if object dies)
Delegate.BindUObject(this, &AMyClass::MyMethod);

// Single-cast: bind a lambda with no lifetime guard (unbind manually before capture dies)
Delegate.BindLambda([](float V){ /* no object captured — always safe */ });

// Single-cast: bind a lambda guarded by a UObject weak ref (safe — skipped if dead)
Delegate.BindWeakLambda(this, [this](float V){ Use(V); });

// Multicast: bind to a UObject member (weak ref — auto-skipped on GC)
FDelegateHandle H2 = Multi.AddUObject(this, &AMyHud::HandleHealthChanged);

// Multicast: bind a lambda guarded by a UObject weak ref
FDelegateHandle H3 = Multi.AddWeakLambda(this, [this](float V){ Use(V); });

// Multicast: bare lambda — no lifetime guard; MUST remove before capture dies
FDelegateHandle H4 = Multi.AddLambda([](float V){ /* no this captured */ });
```

### Dynamic delegates — `AddDynamic` / `BindDynamic`

Dynamic delegates only accept `UFUNCTION`-marked methods. Use the macro wrappers
which auto-generate the function name string at compile time:

```cpp
// The handler MUST be a UFUNCTION() with the exact parameter signature
UFUNCTION()
void HandleDied(AActor* Killer);

// In BeginPlay or equivalent — AddDynamic wraps AddDynamic() macro internally
Health->OnDied.AddDynamic(this, &AMyHud::HandleDied);
```

## Executing and broadcasting

```cpp
// Multicast and dynamic multicast — Broadcast() to all bound listeners
OnHealthChanged.Broadcast(NewHealth);

// Single-cast — always check before calling Execute
if (CanInteract.IsBound())
{
    bool bOk = CanInteract.Execute(Instigator);
}
// Or use the safe form (no-op if unbound; cannot return a value)
CanInteract.ExecuteIfBound(Instigator);
```

- `Broadcast` is always safe to call even with zero bindings.
- `Execute` asserts if unbound — use only when you guarantee a binding exists.
- Multicast delegates cannot have return values; remove `_RetVal` from the macro.

## Payload variables

Non-dynamic delegates can bake extra arguments into the binding at bind time.
These extra arguments are appended after the delegate's declared parameters:

```cpp
DECLARE_DELEGATE_OneParam(FOnTick, float /*DeltaTime*/);

FOnTick D;
int32 MyId = 7;
// MyMethod signature: void MyMethod(float DeltaTime, int32 Id)
D.BindUObject(this, &AMyActor::MyMethod, MyId);
D.Execute(DeltaSeconds);  // calls MyMethod(DeltaSeconds, 7)
```

Payloads work with `Bind*`/`Add*` — up to four additional variables.

## Unbinding and lifetime

```cpp
// Multicast: remove one binding by handle
Multi.Remove(Handle);

// Multicast: remove all bindings for one object
Multi.RemoveAll(this);

// Dynamic multicast: remove a specific binding
Health->OnDied.RemoveDynamic(this, &AMyHud::HandleDied);

// Single-cast: unbind
Delegate.Unbind();

// Multicast: remove everything
Multi.Clear();
```

**Lifetime rules by binding type:**

| Binding | Tracks lifetime? | Action on dead object |
|---|---|---|
| `AddUObject` / `BindUObject` | yes (weak UObject ptr) | binding skipped, auto-compacted |
| `AddDynamic` / `BindDynamic` | yes (weak UObject ptr) | binding skipped |
| `AddWeakLambda` / `BindWeakLambda` | yes (weak UObject ptr) | lambda not called |
| `AddSP` / `BindSP` | yes (weak shared ptr) | binding skipped |
| `AddLambda` / `BindLambda` | **no** | crash if capture is dead |
| `AddRaw` / `BindRaw` | **no** | crash if object is dead |

For `AddLambda` and `AddRaw`, store the returned `FDelegateHandle` and call
`Remove(Handle)` in `EndPlay` or the destructor — before any captured object dies.

## DECLARE_EVENT (legacy)

`DECLARE_EVENT(OwnerType, EventName)` creates a `TMulticastDelegate` subclass whose
`Broadcast` is only accessible to `OwnerType` (friend). It is marked deprecated in
the source comment (`DelegateCombinations.h:32`) — prefer plain `DECLARE_MULTICAST_DELEGATE`
with a private broadcast method for the same encapsulation pattern.

## Thread-safe multicast

`DECLARE_TS_MULTICAST_DELEGATE*` produces a `TMulticastDelegate` parameterized with
`FDefaultTSDelegateUserPolicy` — the invocation list is guarded by a read-write lock.
Use it when bindings are added/removed or broadcast from multiple threads. The
per-binding callbacks themselves are not thread-safe; synchronize their bodies
separately. (`DelegateCombinations.h:26`)

## Decision guide

| Need | Solution |
|---|---|
| Blueprints subscribe | `DECLARE_DYNAMIC_MULTICAST_DELEGATE*` + `UPROPERTY(BlueprintAssignable)` |
| C++-only, many listeners | `DECLARE_MULTICAST_DELEGATE*` |
| One handler, possible return value | `DECLARE_DELEGATE*` or `DECLARE_DELEGATE_RetVal*` |
| Stored callable (not an event) | `TFunction<Ret(Args...)>` or `TUniqueFunction` |
| Cross-thread broadcasting | `DECLARE_TS_MULTICAST_DELEGATE*` |

## Gotchas

- **`AddDynamic` target is not a `UFUNCTION`** — compile or registration error; the
  bound function must be `UFUNCTION()` with the exact declared signature.
- **`AddLambda` / `AddRaw` capturing `this` without removing before destruction** —
  the broadcast will crash. Store the handle and call `Remove(Handle)` in `EndPlay`.
- **`Execute` on an unbound single-cast delegate** — asserts. Always `IsBound()` first
  or use `ExecuteIfBound`.
- **Dynamic multicast, not multicast, for Blueprints** — `DECLARE_MULTICAST_DELEGATE`
  is never `BlueprintAssignable`; only `DECLARE_DYNAMIC_MULTICAST_DELEGATE` is.
- **Param count/type mismatch with the `_NParams` suffix** — will not compile.
- **Dynamic param names not provided** — dynamic macros require a name for each param;
  omitting them is a compile error.
- **Modifying the invocation list during `Broadcast`** — adding/removing from inside a
  handler is deferred until broadcast completes; the delegate handles this safely.
- **`DECLARE_EVENT` for new code** — the source marks it deprecated; use plain
  multicast with a friend access pattern instead.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/Core/Public/Delegates/`):
- `Delegates/DelegateCombinations.h` — all `DECLARE_*` macros: single-cast:20,
  multicast:23, TS multicast:26, event:32, dynamic:35, dynamic multicast:38.
- `Delegates/Delegate.h` — `TDelegate`/`TMulticastDelegate` concepts, binding table,
  payload variable documentation; `FUNC_DECLARE_DELEGATE`:208,
  `FUNC_DECLARE_MULTICAST_DELEGATE`:212, `FUNC_DECLARE_EVENT`:224,
  `FUNC_DECLARE_DYNAMIC_DELEGATE`:235, `FUNC_DECLARE_DYNAMIC_MULTICAST_DELEGATE`:296.
- `Delegates/DelegateSignatureImpl.inl` — `TDelegateRegistration`/`TDelegate`:315,
  `BindLambda`:126, `BindWeakLambda`:151, `BindUObject`:276; `TMulticastDelegateRegistration`:728,
  `AddLambda`:802, `AddWeakLambda`:828, `AddUObject`:969, `Remove`:1003,
  `TMulticastDelegate::Broadcast`:1074, `TBaseDynamicDelegate`:1093,
  `TBaseDynamicMulticastDelegate`:1165.
- `Delegates/MulticastDelegateBase.h` — `TMulticastDelegateBase`, `Clear`:79,
  `IsBound`:91, `RemoveAll`:135.
- `Delegates/IDelegateInstance.h` — `FDelegateHandle`:14 (the handle type returned
  by `Add*`; stores a `uint64` ID for O(N) lookup/removal).
- `Templates/Function.h` — `TFunction<Ret(Args...)>` / `TUniqueFunction` for stored
  callables that are not event delegates.

Official docs (UE 5.7):
- Delegates (single-cast) —
  <https://dev.epicgames.com/documentation/unreal-engine/delegates-and-lambda-functions-in-unreal-engine>
- Multicast Delegates —
  <https://dev.epicgames.com/documentation/unreal-engine/multicast-delegates-in-unreal-engine>
- Dynamic Delegates —
  <https://dev.epicgames.com/documentation/unreal-engine/dynamic-delegates-in-unreal-engine>

Deep-dive references in this skill:
- [references/delegate-types-matrix.md](references/delegate-types-matrix.md) — full
  macro-to-type mapping, param/payload limits, TS variant, event pattern.
- [references/binding-and-lifetime.md](references/binding-and-lifetime.md) — every
  binding form, safety guarantees, payload syntax, `FDelegateHandle` patterns.
- [references/dynamic-and-blueprint.md](references/dynamic-and-blueprint.md) — dynamic
  delegate mechanics, `AddDynamic`/`RemoveDynamic`, Blueprint event dispatcher wiring,
  `UDELEGATE` specifier, serialization notes.
