# Delegate types — full matrix

Deep dive for [../SKILL.md](../SKILL.md). Covers every `DECLARE_*` macro family,
the underlying template types they produce, parameter and payload limits, the
thread-safe variant, and the deprecated `DECLARE_EVENT` pattern. Grounded in UE 5.7
(`Engine/Source/Runtime/Core/Public/Delegates/DelegateCombinations.h` and `Delegate.h`).

## Macro families and what they produce

Every `DECLARE_*` macro expands to a `typedef` or class definition. The underlying
template types are in `Delegate.h` and `DelegateSignatureImpl.inl`.

| Macro family | Underlying type | `Broadcast`? | `Execute`? | Blueprint? |
|---|---|---|---|---|
| `DECLARE_DELEGATE*` | `TDelegate<Ret(Params...)>` | no | yes | no |
| `DECLARE_MULTICAST_DELEGATE*` | `TMulticastDelegate<void(Params...)>` | yes | no | no |
| `DECLARE_TS_MULTICAST_DELEGATE*` | `TMulticastDelegate<void(Params...), FDefaultTSDelegateUserPolicy>` | yes | no | no |
| `DECLARE_DYNAMIC_DELEGATE*` | class derived from `TBaseDynamicDelegate<...>` | no | yes | single-bind only |
| `DECLARE_DYNAMIC_MULTICAST_DELEGATE*` | class derived from `TBaseDynamicMulticastDelegate<...>` | yes | no | yes |
| `DECLARE_EVENT` | class derived from `TMulticastDelegate<...>`, friend-gated | yes (owner only) | no | no |

Source: `DelegateCombinations.h` — base macros at lines 20 (`DECLARE_DELEGATE`),
23 (`DECLARE_MULTICAST_DELEGATE`), 26 (`DECLARE_TS_MULTICAST_DELEGATE`),
32 (`DECLARE_EVENT`), 35 (`DECLARE_DYNAMIC_DELEGATE`), 38 (`DECLARE_DYNAMIC_MULTICAST_DELEGATE`).

The `FUNC_DECLARE_*` helper macros in `Delegate.h` define the actual typedef/class bodies
(lines 208, 212, 216, 224, 235, 296).

## Parameter count suffixes

All families use the same naming pattern. Supported suffixes and their meanings:

| Suffix | Extra tokens in macro |
|---|---|
| *(none)* | 0 params |
| `_OneParam` | 1 param type (+ param name for dynamic) |
| `_TwoParams` | 2 param types |
| `_ThreeParams` | 3 param types |
| `_FourParams` | 4 |
| `_FiveParams` | 5 |
| `_SixParams` | 6 |
| `_SevenParams` | 7 |
| `_EightParams` | 8 |
| `_NineParams` | 9 |

The maximum is **9 parameters** (all families). `_RetVal` prefixes the suffix for
single-cast only: `DECLARE_DELEGATE_RetVal`, `DECLARE_DELEGATE_RetVal_OneParam`, etc.
Multicast and dynamic delegates cannot have return values (enforced by
`TMulticastDelegate`'s `static_assert` in `DelegateSignatureImpl.inl:1036`).

### Dynamic delegate — named params

Dynamic macros require a **name token after each type** because the reflection system
needs to expose the names to Blueprint:

```cpp
// Non-dynamic: type only
DECLARE_MULTICAST_DELEGATE_TwoParams(FOnDamage, float /*Damage*/, AActor* /*Causer*/);

// Dynamic: type AND name
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnDamageSignature,
    float, Damage,
    AActor*, Causer);
```

## Payload variables

Non-dynamic delegates only. Up to **4 extra variables** can be baked into the binding
at bind time and appended after the declared params when the delegate fires:

```cpp
DECLARE_DELEGATE_OneParam(FOnEffect, UParticleSystem*);

int32 TeamId = 1;
FString Tag  = TEXT("FireHit");
// Method: void Handle(UParticleSystem* FX, int32 Team, const FString& T)
D.BindUObject(this, &AMyActor::Handle, TeamId, Tag);
```

Dynamic delegates do not support payloads — use a lambda wrapper or add extra
`UFUNCTION` parameters if you need to pass context.

## `DECLARE_EVENT` — legacy encapsulation pattern

`DECLARE_EVENT(OwnerType, EventName)` generates:

```cpp
class EventName : public TMulticastDelegate<void()>
{
    friend class OwnerType;
};
```

Only `OwnerType` can call `Broadcast`. The comment in `DelegateCombinations.h:29`
marks it deprecated: "consider deprecated for new delegates, use normal multicast instead."
Preferred modern approach — declare a plain `DECLARE_MULTICAST_DELEGATE`, keep it
`private`, and expose a const registration accessor:

```cpp
class FMySystem
{
public:
    // Listeners call Add/Remove; cannot Broadcast
    TMulticastDelegateRegistration<void()>& OnInteresting()
    {
        return OnInterestingDelegate;
    }
private:
    TMulticastDelegate<void()> OnInterestingDelegate;
    // Only FMySystem calls Broadcast:
    void FireEvent() { OnInterestingDelegate.Broadcast(); }
};
```

The `TMulticastDelegateRegistration` accessor pattern (from `DelegateSignatureImpl.inl:724`)
deletes `Broadcast`, making it impossible for callers to fire the event accidentally.

## Thread-safe multicast

`DECLARE_TS_MULTICAST_DELEGATE*` uses `FDefaultTSDelegateUserPolicy`, which wraps the
invocation list in a read-write lock (`DelegateCombinations.h:26`). Use this when:
- Bindings are added/removed from a background thread while the game thread broadcasts.
- Multiple threads broadcast concurrently (uncommon but valid).

The individual handler bodies are not guarded — synchronize them with their own locks
or `AsyncTask` if they touch shared state.

## `FDelegateHandle`

`Add*` on multicast delegates returns an `FDelegateHandle` — a `uint64` ID that
uniquely identifies one binding (`IDelegateInstance.h:14`). Use it for precise removal:

```cpp
FDelegateHandle Handle = OnHealthChanged.AddUObject(this, &AHud::OnHealth);

// Later:
OnHealthChanged.Remove(Handle);  // O(N) search by ID
Handle.Reset();                  // mark handle as no longer valid
```

Handles from dynamic delegates are not used; `RemoveDynamic` takes the object and
function pointer instead (macro-generated function name string).
