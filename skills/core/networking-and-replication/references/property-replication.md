# Property replication — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the complete property replication workflow,
the `DOREPLIFETIME` macro family, RepNotify parameter overloads, the `NotReplicated` specifier,
and object-reference replication. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Public/Net/UnrealNetwork.h`).

## How property replication works

The server compares each actor's current replicated property values against the last-sent shadow
state for each connection. When a value changes, the updated bytes are sent in the next net update
bunch. Clients apply the received value and optionally call the associated `OnRep_` function.

Three requirements must all be met for a property to replicate:
1. The actor has `bReplicates = true`.
2. The property is tagged `UPROPERTY(Replicated)` or `UPROPERTY(ReplicatedUsing=OnRep_X)`.
3. The property is registered in `GetLifetimeReplicatedProps` with a `DOREPLIFETIME*` macro.

Missing any of the three results in silent non-replication.

## The `UPROPERTY` specifiers

| Specifier | Effect |
|---|---|
| `Replicated` | Property replicates server → clients when it changes |
| `ReplicatedUsing=OnRep_X` | Same, plus calls `OnRep_X()` on clients after the value is applied |
| `NotReplicated` | Marks a field inside a replicated struct to *not* replicate |

`OnRep_X` must be declared `UFUNCTION()`. The function can optionally take the previous value
as a parameter (by value or const-ref, same type as the property) — the replication system fills
it automatically:

```cpp
UPROPERTY(ReplicatedUsing=OnRep_Shield)
float Shield = 100.f;

UFUNCTION()
void OnRep_Shield(float PreviousShield);   // PreviousShield = value before server update
```

Without the parameter, the signature is `void OnRep_Shield()`. Both forms are valid. The
parameter form lets you compare old vs new and drive delta-based effects (e.g. play a flash if
the change is large enough).

**Server-side:** `OnRep_X` does **not** fire automatically on the server. If the server needs
the same side-effect (e.g. updating a cached value), call `OnRep_Shield()` explicitly after
writing `Shield`.

## GetLifetimeReplicatedProps

```cpp
// MyActor.cpp
#include "Net/UnrealNetwork.h"

void AMyActor::GetLifetimeReplicatedProps(
    TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);      // always call Super

    DOREPLIFETIME(AMyActor, Shield);                          // no condition
    DOREPLIFETIME_CONDITION(AMyActor, Ammo, COND_OwnerOnly);  // owner only
    DOREPLIFETIME_CONDITION_NOTIFY(AMyActor, Score,           // condition + notify
        COND_None, REPNOTIFY_Always);                         // always fire OnRep
}
```

`DOREPLIFETIME(C, V)` expands to `DOREPLIFETIME_WITH_PARAMS(C, V, FDoRepLifetimeParams())`
(`UnrealNetwork.h`:259). The default `FDoRepLifetimeParams` has `Condition = COND_None`,
`RepNotifyCondition = REPNOTIFY_OnChanged`, `bIsPushBased = false`.

## DOREPLIFETIME macro family

| Macro | Description | Note |
|---|---|---|
| `DOREPLIFETIME(C,V)` | No condition | Runtime property lookup |
| `DOREPLIFETIME_CONDITION(C,V,cond)` | With `COND_*` condition | Runtime lookup |
| `DOREPLIFETIME_CONDITION_NOTIFY(C,V,cond,rncond)` | Condition + RepNotify condition | Runtime |
| `DOREPLIFETIME_WITH_PARAMS(C,V,params)` | Full `FDoRepLifetimeParams` control | Runtime |
| `DOREPLIFETIME_WITH_PARAMS_FAST(C,V,params)` | Compile-time index; **no static arrays** | Fast path |
| `DOREPLIFETIME_WITH_PARAMS_FAST_STATIC_ARRAY(C,V,params)` | Compile-time + C-array support | Fast path |

`_FAST` variants build the `FRepPropertyDescriptor` at compile time using generated
`ENetFields_Private` enum values, eliminating the runtime `FindFieldChecked` call
(`UnrealNetwork.h`:231–248). Prefer `_FAST` in perf-sensitive classes.

### Disabling an inherited replicated property

When overriding a class that replicates a property you want to suppress:

```cpp
void AMyChild::GetLifetimeReplicatedProps(
    TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);
    DISABLE_REPLICATED_PROPERTY(AParentClass, SomeParentProp);
}
```

Or reset its condition: `RESET_REPLIFETIME_CONDITION(AParentClass, Prop, COND_Never)`.

## RepNotify conditions

`REPNOTIFY_OnChanged` (default): `OnRep_X` fires only when the received value differs from
the local copy.
`REPNOTIFY_Always`: fires every time the property is received, even when unchanged. Useful when
the RepNotify has a side-effect that should always run (e.g. replaying a one-shot animation).

```cpp
DOREPLIFETIME_CONDITION_NOTIFY(AMyActor, HitCounter, COND_None, REPNOTIFY_Always);
```

## Replicating object references

A `UPROPERTY(Replicated) AActor*` (or any `UObject*`) is transmitted as a network GUID assigned
by the server. The replication system handles serialization automatically. The referenced object
must be network-addressable — either a replicated actor or a stably-named object (one that exists
on both server and client with the same name, e.g. loaded from a level package or a default
subobject created in a C++ constructor).

## Source references (UE 5.7)

- `Runtime/Engine/Public/Net/UnrealNetwork.h` — `DOREPLIFETIME` :259, `DOREPLIFETIME_WITH_PARAMS`
  :250, `DOREPLIFETIME_WITH_PARAMS_FAST` :231, `DOREPLIFETIME_CONDITION` :277,
  `DOREPLIFETIME_CONDITION_NOTIFY` :286, `DISABLE_REPLICATED_PROPERTY` :407,
  `RESET_REPLIFETIME_CONDITION` :455, `FDoRepLifetimeParams` :134.
- `Runtime/CoreUObject/Public/UObject/CoreNet.h` — `FLifetimeProperty` :299,
  `ELifetimeRepNotifyCondition` (via `CoreNetTypes.h`) :42.
