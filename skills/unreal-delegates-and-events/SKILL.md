---
name: unreal-delegates-and-events
description: Wire up callbacks and events in Unreal C++ with delegates — single-cast
  (DECLARE_DELEGATE), multicast (DECLARE_MULTICAST_DELEGATE), and dynamic delegates
  (DECLARE_DYNAMIC_MULTICAST_DELEGATE, BlueprintAssignable) — plus binding (BindUObject,
  AddDynamic, BindLambda), broadcasting, and safe unbinding. Use when implementing the
  observer pattern, exposing C++ events to Blueprints, decoupling systems, or fixing
  delegate binding/lifetime crashes.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Delegates & events

Delegates are Unreal's type-safe function-pointer/observer system. Choose the right *kind* up
front — the three families bind and broadcast differently and only one is Blueprint-compatible.

## When to use this skill

- One object needs to notify others when something happens (observer pattern).
- Exposing a C++ event that designers can subscribe to in Blueprints.
- Decoupling systems (emit an event instead of calling a known class).
- Crashes/no-ops from binding to destroyed objects or wrong delegate macros.

## The three families

| Family | Macro prefix | Bind multiple? | Blueprint? | Use for |
|---|---|---|---|---|
| Single-cast | `DECLARE_DELEGATE*` | no (one binding) | no | a single required callback (e.g. a completion handler) |
| Multicast | `DECLARE_MULTICAST_DELEGATE*` | yes | no | C++-only events with many listeners |
| Dynamic multicast | `DECLARE_DYNAMIC_MULTICAST_DELEGATE*` | yes | **yes** (`BlueprintAssignable`) | events Blueprints can bind to |

Suffixes encode the signature: `_OneParam`, `_TwoParams`, `_RetVal`, etc. Dynamic delegate
params must be **named** in the macro.

## Declaring

```cpp
// C++-only multicast event with one param
DECLARE_MULTICAST_DELEGATE_OneParam(FOnHealthChanged, float /*NewHealth*/);

// Dynamic multicast (Blueprint-assignable) — params are named
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnDiedSignature, AActor*, Killer);

// Single-cast with return value
DECLARE_DELEGATE_RetVal_OneParam(bool, FCanInteract, AActor* /*Instigator*/);
```

Expose them as members:

```cpp
UCLASS()
class MYGAME_API UHealthComponent : public UActorComponent
{
    GENERATED_BODY()
public:
    // C++-only: no UPROPERTY, bind from C++
    FOnHealthChanged OnHealthChanged;

    // Blueprint-assignable: needs UPROPERTY(BlueprintAssignable)
    UPROPERTY(BlueprintAssignable, Category="Health")
    FOnDiedSignature OnDied;
};
```

## Binding

C++-only delegates — bind to a UObject method, lambda, or raw/SP object:

```cpp
Health->OnHealthChanged.AddUObject(this, &AMyHud::HandleHealthChanged);
FDelegateHandle H = Health->OnHealthChanged.AddLambda([](float V){ /* ... */ });
// single-cast:
CanInteract.BindUObject(this, &AThing::CheckInteract);
```

Dynamic delegates — bind only to a `UFUNCTION`, via `AddDynamic`/`RemoveDynamic`:

```cpp
// HandleDied must be a UFUNCTION()
Health->OnDied.AddDynamic(this, &AMyHud::HandleDied);

UFUNCTION()
void HandleDied(AActor* Killer);
```

## Broadcasting / executing

```cpp
OnHealthChanged.Broadcast(NewHealth);     // multicast (incl. dynamic)
if (CanInteract.IsBound()) { bool b = CanInteract.Execute(Instigator); }
CanInteract.ExecuteIfBound(Instigator);   // single-cast safe call
```

- Multicast: `Broadcast(...)`, returns nothing.
- Single-cast: `Execute(...)` (asserts if unbound) or `ExecuteIfBound(...)` (safe).

## Unbinding & lifetime

- `AddUObject`/`AddDynamic` track the object; bindings auto-clear when the bound UObject is
  destroyed — prefer these for safety.
- `AddLambda`/`AddRaw` do **not** track lifetime. Keep the `FDelegateHandle` and call
  `Delegate.Remove(Handle)` before the captured object dies, or you'll crash.
- `RemoveDynamic(this, &Class::Func)` to detach a dynamic binding.
- `Clear()` removes all bindings; `RemoveAll(this)` removes all for one object.

## Choosing

- Need Blueprints to subscribe → **dynamic multicast** + `BlueprintAssignable`.
- C++-only, many listeners → **multicast**.
- Exactly one handler, possibly with a return value → **single-cast**.
- Need a stored callable (not an event) → `TFunction<Ret(Args)>` / `TUniqueFunction`.

## Gotchas

- **`AddDynamic` target isn't a `UFUNCTION`** → compile/registration error. Dynamic requires it.
- **`AddLambda` capturing `this`** without removing the binding before destruction → crash on broadcast.
- **Wrong family for Blueprints** — only dynamic multicast is `BlueprintAssignable`.
- **Param count/type mismatch** with the `_NParams` suffix → won't compile.
- **Broadcasting during iteration** that modifies listeners — be careful re-entrantly adding/removing.

## References & source material

Engine source (UE 5.7):
- `Runtime/Core/Public/Delegates/Delegate.h` — the `DECLARE_*` macros and delegate types.
- `Runtime/Core/Public/Delegates/DelegateCombinations.h` — all the param/retval combinations.
- `Runtime/Core/Public/Templates/Function.h` — `TFunction`/`TUniqueFunction`.

Official docs (UE 5.7): Programming with C++ —
<https://dev.epicgames.com/documentation/unreal-engine/programming-with-cplusplus-in-unreal-engine>
