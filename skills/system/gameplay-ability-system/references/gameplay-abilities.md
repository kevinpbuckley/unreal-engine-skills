# Gameplay Abilities

> Deep-dive reference for `UGameplayAbility`. Grounded in UE 5.7 source at
> `Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/Public/Abilities/GameplayAbility.h`.
> Return to [../SKILL.md](../SKILL.md) for the entry-level overview.

## Lifecycle

The full lifecycle of a granted, activated ability:

1. **Granted** — `ASC->GiveAbility(FGameplayAbilitySpec(...))` on the server. The spec is replicated
   to clients. `OnGiveAbility` fires on the CDO (non-instanced) or the new instance (instanced).
2. **`CanActivateAbility`** — pure check; callable by UI without side effects. Returns false if tags
   block it, cost cannot be paid, or a custom check fails.
3. **`TryActivateAbility`** — calls `CanActivateAbility`, then `CallActivateAbility` which calls
   `ActivateAbility`. Handles prediction key creation for `LocalPredicted` abilities.
4. **`ActivateAbility`** — your override. Must eventually call `CommitAbility` (applies cost/cooldown)
   and `EndAbility`. `CommitAbility` may fail if resources run out after `CanActivateAbility` passed.
5. **`EndAbility`** — required cleanup. Destroys instanced-per-execution abilities, clears tasks,
   notifies the ASC the ability is done. A missed `EndAbility` blocks future activations permanently.

```cpp
void UGA_Spell::ActivateAbility(const FGameplayAbilitySpecHandle Handle,
    const FGameplayAbilityActorInfo* ActorInfo,
    const FGameplayAbilityActivationInfo ActivationInfo,
    const FGameplayEventData* TriggerEventData)
{
    // CommitAbility applies cost+cooldown GEs. Returns false if they cannot be paid.
    if (!CommitAbility(Handle, ActorInfo, ActivationInfo))
    {
        EndAbility(Handle, ActorInfo, ActivationInfo, /*bReplicateEnd=*/true, /*bCancelled=*/true);
        return;
    }
    // Launch async tasks, apply effects, play montages...
}
```

Key signatures (`GameplayAbility.h`):
- `ActivateAbility`:597 — `(Handle, ActorInfo, ActivationInfo, TriggerEventData)`
- `CommitAbility`:355 — returns bool; applies cost + cooldown
- `EndAbility`:627 — `(Handle, ActorInfo, ActivationInfo, bReplicateEnd, bWasCancelled)`
- `CanActivateAbility`:282
- `CancelAbility`:318

## FGameplayAbilitySpec

`FGameplayAbilitySpec` (`GameplayAbilitySpec.h:167`) describes a granted ability:

| Field | Purpose |
|---|---|
| `TSubclassOf<UGameplayAbility> Ability` | The ability class |
| `int32 Level` | Governs scalable float magnitudes in cost/cooldown GEs |
| `int32 InputID` | Associates with an input action index (optional) |
| `UObject* SourceObject` | Who granted it (for querying) |
| `FGameplayAbilitySpecHandle Handle` | Unique identifier for the grant |
| `bool InputPressed` | Current input state for input-driven activation |

Constructors: `FGameplayAbilitySpec(TSubclassOf<UGameplayAbility>, Level, InputID, SourceObject)`.

## Instancing policy

Configured via `InstancingPolicy` (`UPROPERTY(EditDefaultsOnly)`) on the ability CDO:

| Policy | When to use |
|---|---|
| `InstancedPerExecution` | Default; safest; allocates a new instance per activation. Supports Blueprint graphs, RPCs, state. Replicated instance per execution is not supported — use `InstancedPerActor` for replication. |
| `InstancedPerActor` | One instance per actor; reuses it across activations. Supports replication (replicated properties and RPCs work). Must manually reset state between activations. |
| `NonInstanced` | Deprecated in 5.5 (`UE_DEPRECATED_FORGAME(5.5, ...)`); avoid in 5.7. |

For multiplayer abilities that need replicated variables or RPCs inside the ability, use
`InstancedPerActor` with `ReplicationPolicy` set to replicate.

`EGameplayAbilityInstancingPolicy` defined in `Abilities/GameplayAbilityTypes.h:35`.

## Net execution policy

Configured via `NetExecutionPolicy` (`UPROPERTY(EditDefaultsOnly)`):

| Policy | Behavior |
|---|---|
| `LocalPredicted` | Runs immediately on predicting client; server validates and may roll back |
| `LocalOnly` | Runs on the local machine only (client in SP/listen-server, server on dedicated) |
| `ServerInitiated` | Server triggers, propagates to clients; client sees a delay |
| `ServerOnly` | Runs only on server; cosmetic output replicates normally |

`EGameplayAbilityNetExecutionPolicy` defined in `Abilities/GameplayAbilityTypes.h:57`.

## Tag gating

Ability tag containers control which abilities block or cancel each other. These are
`UPROPERTY(EditDefaultsOnly)` on the ability CDO, set in Blueprint:

| Property | Effect |
|---|---|
| `AbilityTags` | This ability's identity tags |
| `CancelAbilitiesWithTag` | Cancels currently executing abilities with matching tags |
| `BlockAbilitiesWithTag` | Prevents activation of abilities with matching tags while active |
| `ActivationOwnedTags` | Granted to the ASC owner while this ability is active |
| `ActivationRequiredTags` | Must be present on the owner for the ability to activate |
| `ActivationBlockedTags` | Must not be present on the owner for the ability to activate |
| `SourceRequiredTags` / `SourceBlockedTags` | Tag requirements on the source |
| `TargetRequiredTags` / `TargetBlockedTags` | Tag requirements on the target |

## Cost and cooldown

Cost and cooldown are `UGameplayEffect` assets referenced via:
- `CostGameplayEffectClass` — instantaneous GE that consumes mana/stamina/etc.
- `CooldownGameplayEffectClass` — HasDuration GE that grants a `Cooldown.<AbilityName>` tag
  blocking re-activation. Poll remaining cooldown with `GetCooldownTimeRemaining()`.

Set these in the Blueprint subclass of the ability (not in C++ for data-driven flexibility).
`CommitAbility` internally calls `CommitAbilityCost` and `CommitAbilityCooldown`.

## Gameplay Events

Abilities can be triggered by `FGameplayEventData` payloads without the normal `TryActivateAbility`
path. Useful for animation notify-driven attacks or external system triggers:

```cpp
// Send event to actor
FGameplayEventData Payload;
Payload.EventTag = FGameplayTag::RequestGameplayTag("Event.Melee.Hit");
Payload.Target = HitActor;
UAbilitySystemBlueprintLibrary::SendGameplayEventToActor(OwnerActor, Payload.EventTag, Payload);
```

In the ability, override `ActivateAbilityFromEvent` (Blueprint) or check `TriggerEventData` in
`ActivateAbility` if the ability's `TriggerData` container maps the tag to this ability.

## Checking and applying ability state from outside

```cpp
// Check if any ability of a class is active
bool bActive = ASC->IsAbilityActive(Handle);

// Get the ability instance (InstancedPerActor only)
UGameplayAbility* Instance = ASC->FindAbilityInstanceFromHandle(Handle);
```
