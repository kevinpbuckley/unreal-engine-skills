# Replication conditions and Push Model — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers all `COND_*` values, the Push Model opt-in,
`DOREPLIFETIME_WITH_PARAMS_FAST`, dynamic/custom conditions, and the Iris replication system.
Grounded in UE 5.7
(`Runtime/CoreUObject/Public/UObject/CoreNetTypes.h`,
`Runtime/Engine/Public/Net/UnrealNetwork.h`,
`Runtime/Net/Core/Public/Net/Core/PushModel/PushModel.h`).

## ELifetimeCondition — all COND_* values

Defined in `Runtime/CoreUObject/Public/UObject/CoreNetTypes.h`:19.

| Value | Replicates to… |
|---|---|
| `COND_None` | All connections, anytime it changes (default) |
| `COND_InitialOnly` | Only in the initial bunch (connection open); never again |
| `COND_OwnerOnly` | Only the actor's owning connection |
| `COND_SkipOwner` | Every connection *except* the owner |
| `COND_SimulatedOnly` | Connections where the actor is a `SimulatedProxy` |
| `COND_AutonomousOnly` | Connections where the actor is an `AutonomousProxy` |
| `COND_SimulatedOrPhysics` | Simulated proxies or `bRepPhysics` actors |
| `COND_InitialOrOwner` | Initial bunch *or* the owning connection |
| `COND_Custom` | No fixed rule; toggle with `DOREPLIFETIME_ACTIVE_OVERRIDE` |
| `COND_ReplayOrOwner` | Replay connection or the owning connection |
| `COND_ReplayOnly` | Replay connection only |
| `COND_SimulatedOnlyNoReplay` | Simulated proxies, excluding replay |
| `COND_SimulatedOrPhysicsNoReplay` | Simulated/physics, excluding replay |
| `COND_SkipReplay` | All connections except replay |
| `COND_Dynamic` | Runtime-overridable per actor (defaults to always until overridden) |
| `COND_Never` | Never replicates — used to disable inherited props |

`COND_NetGroup` exists but is reserved for subobject group registration, not property conditions.

### Choosing a condition

- Use `COND_OwnerOnly` for private data (ammo, cooldowns, inventory) that only the owning player
  needs.
- Use `COND_SkipOwner` for data relevant to observers but not the local player
  (e.g. position of another player on a minimap).
- Use `COND_InitialOnly` for data that never changes after spawn (initial character class, seed).
- Use `COND_AutonomousOnly` for data used only by the controlled copy for client prediction.

## DOREPLIFETIME_WITH_PARAMS — advanced control

```cpp
#include "Net/UnrealNetwork.h"

void AMyActor::GetLifetimeReplicatedProps(
    TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);

    FDoRepLifetimeParams Params;
    Params.Condition        = COND_OwnerOnly;
    Params.RepNotifyCondition = REPNOTIFY_Always;
    Params.bIsPushBased     = true;
    DOREPLIFETIME_WITH_PARAMS_FAST(AMyActor, SecretData, Params);
}
```

`FDoRepLifetimeParams` (`UnrealNetwork.h`:134) bundles `Condition`, `RepNotifyCondition`,
`bIsPushBased`, and (for Iris) `CreateAndRegisterReplicationFragmentFunction`.

`DOREPLIFETIME_WITH_PARAMS_FAST` builds the `FRepPropertyDescriptor` at compile time
(`UnrealNetwork.h`:231), eliminating the runtime property lookup — prefer it in high-scale actors.
Limitation: does not support C-style static arrays; use
`DOREPLIFETIME_WITH_PARAMS_FAST_STATIC_ARRAY` for those.

## Custom conditions (COND_Custom + PreReplication)

`COND_Custom` lets you toggle replication per actor (not per connection) using a boolean from any
arbitrary runtime state:

```cpp
// GetLifetimeReplicatedProps:
DOREPLIFETIME_CONDITION(AMyActor, SecureData, COND_Custom);

// Called by the replication system before each replication attempt:
void AMyActor::PreReplication(IRepChangedPropertyTracker& Tracker)
{
    Super::PreReplication(Tracker);
    // Only replicate SecureData when the actor is in a secure zone
    DOREPLIFETIME_ACTIVE_OVERRIDE(AMyActor, SecureData, bIsInSecureZone);
}
```

`DOREPLIFETIME_ACTIVE_OVERRIDE_FAST` is the compile-time version (no static arrays).
Custom conditions are evaluated *per actor*, not per connection — avoid per-connection logic here.
They incur extra cost vs. static conditions; use only when static `COND_*` values are
insufficient.

## Push Model

### What it is

By default, UE compares every replicated property on every replicated actor each time the actor
is considered for replication. Push Model inverts this: the gameplay code *explicitly marks* a
property dirty, and the replication system skips comparison for unmarked properties.

Gain: eliminates redundant property comparisons on actors with infrequently changing state.
Cost: you must call `MARK_PROPERTY_DIRTY_FROM_NAME` whenever you write to a push-model property;
forgetting a write site silently skips replication.

Push Model is controlled by the `WITH_PUSH_MODEL` compile flag
(`PushModelMacros.h`:5). When `WITH_PUSH_MODEL = 0`, all `MARK_PROPERTY_DIRTY_*` macros are
no-ops — so you can adopt the pattern without risk in shipping builds that haven't enabled it.

### Enabling Push Model

In `DefaultEngine.ini`:
```ini
[SystemSettings]
net.IsPushModelEnabled=1
```

Or enable `WITH_PUSH_MODEL` in your `Build.cs` target; check `PushModelMacros.h` for the
preprocessor guard.

### Opt-in per property

```cpp
// GetLifetimeReplicatedProps:
FDoRepLifetimeParams Params;
Params.bIsPushBased = true;
DOREPLIFETIME_WITH_PARAMS_FAST(AMyActor, MyHealth, Params);
```

### Marking dirty

```cpp
void AMyActor::SetHealth(float NewHealth)
{
    MyHealth = NewHealth;
    // Mark dirty so the replication system compares and sends this property:
    MARK_PROPERTY_DIRTY_FROM_NAME(AMyActor, MyHealth, this);
}
```

For a C-style static array element: `MARK_PROPERTY_DIRTY_FROM_NAME_STATIC_ARRAY_INDEX`.
For the whole array: `MARK_PROPERTY_DIRTY_FROM_NAME_STATIC_ARRAY`.

**Critical warning** (`PushModel.h`): never hold mutable references to push-model properties
outside a short scope. If external code modifies the value through a reference without calling
`MARK_PROPERTY_DIRTY`, the change is silently skipped until the property is next marked dirty.

Push Model only tracks top-level properties. Mutating a field inside a replicated struct requires
marking the *struct* property dirty, not the field.

### Convenience macro

```cpp
// Assigns only if different, then marks dirty — avoids redundant dirty marks:
COMPARE_ASSIGN_AND_MARK_PROPERTY_DIRTY(AMyActor, MyHealth, NewHealth, this);
```

Defined in `PushModel.h`:466. Best for scalar types; avoid for large structs (memcmp cost).

## Iris replication system (UE 5.7)

Iris is the new default replication system in 5.7. It coexists with the existing `DOREPLIFETIME`
+ RPC model:
- Existing `DOREPLIFETIME*` macros, `OnRep_X` callbacks, and RPCs continue to work.
- `OnReplicationStarted` is deprecated in 5.7; override `OnReplicationStartedForIris` instead
  (`Actor.h`:3479).
- Push Model with Iris: use `DOREPLIFETIME_WITH_PARAMS_FAST` + `bIsPushBased = true`. Iris
  provides the `FIrisMarkPropertyDirty` delegate hook for internal coordination
  (`PushModel.h`:414).
- The `COND_NetGroup` value is Iris-specific (subobject group filtering) and cannot be used on
  properties.

For migration details see the
[Iris Replication System](https://dev.epicgames.com/documentation/unreal-engine/iris-replication-system-in-unreal-engine)
docs.

## Source references (UE 5.7)

- `Runtime/CoreUObject/Public/UObject/CoreNetTypes.h`:19–38 — `ELifetimeCondition` enum.
- `Runtime/Engine/Public/Net/UnrealNetwork.h`:134,231,250,259,277,286,295,311 —
  `FDoRepLifetimeParams`, `DOREPLIFETIME*` macros, `DOREPLIFETIME_ACTIVE_OVERRIDE`.
- `Runtime/Net/Core/Public/Net/Core/PushModel/PushModel.h`:454,460,466 —
  `MARK_PROPERTY_DIRTY_FROM_NAME`, `COMPARE_ASSIGN_AND_MARK_PROPERTY_DIRTY`.
- `Runtime/Net/Core/Public/Net/Core/PushModel/PushModelMacros.h`:5 — `WITH_PUSH_MODEL`.
- `Runtime/Engine/Classes/GameFramework/Actor.h`:3479 — `OnReplicationStartedForIris`.
