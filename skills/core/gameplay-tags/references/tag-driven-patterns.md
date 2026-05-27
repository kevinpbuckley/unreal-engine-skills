# Tag-driven gameplay patterns — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers common patterns for driving gameplay
with tags: tag-based state machines, effect/ability gating, GAS integration points,
animation layer selection, config/ini organisation, and the `IGameplayTagAssetInterface`
pattern. Grounded in UE 5.7 source and the official
[Gameplay Tags](https://dev.epicgames.com/documentation/unreal-engine/using-gameplay-tags-in-unreal-engine)
documentation.

## Tag-based state tracking

Rather than a dedicated `EState` enum and manual transitions, an actor carries a
`FGameplayTagContainer` of active state tags and adds/removes them as events occur:

```cpp
// In a UActorComponent or directly on the actor:
UPROPERTY(BlueprintReadOnly, Category="State")
FGameplayTagContainer ActiveStates;

void ApplyStun()
{
    ActiveStates.AddTag(TAG_State_Stunned);
    OnStateChanged.Broadcast(ActiveStates);
}

void ClearStun()
{
    ActiveStates.RemoveTag(TAG_State_Stunned);
    OnStateChanged.Broadcast(ActiveStates);
}

bool IsStunned() const
{
    return ActiveStates.HasTag(TAG_State_Stunned);
}
```

Advantages over enums:
- Multiple states can be active simultaneously.
- New states are added without modifying switch statements or enums.
- External systems (UI, AI) query `IGameplayTagAssetInterface` without coupling.

## Effect gating (non-GAS)

A lightweight alternative to full GAS: an `FGameplayTagQuery` UPROPERTY on an effect
data asset describes when the effect applies. At runtime, evaluate against the target's
active tags:

```cpp
USTRUCT(BlueprintType)
struct FStatusEffect
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere)
    FGameplayTagQuery ApplicationRequirements;   // e.g. "has State.Wet, not State.Immune"

    UPROPERTY(EditAnywhere)
    FGameplayTagQuery BlockedBy;                 // e.g. "has State.FireResistant"
};

bool CanApplyEffect(const FStatusEffect& Effect, const FGameplayTagContainer& TargetTags) const
{
    return Effect.ApplicationRequirements.Matches(TargetTags)
        && !Effect.BlockedBy.Matches(TargetTags);
}
```

Designers edit `ApplicationRequirements` via the query Details widget without code
changes.

## GAS integration points

When using the `gameplay-ability-system`, tags are the primary currency for activation
gating, cancellation, blocking, and effect querying. Key integration points in GAS:

| GAS field | Type | Effect |
|---|---|---|
| `ActivationRequiredTags` | `FGameplayTagContainer` | Ability only activates if ASC has all these |
| `ActivationBlockedTags` | `FGameplayTagContainer` | Ability blocked if ASC has any of these |
| `CancelAbilitiesWithTag` | `FGameplayTagContainer` | Cancels running abilities that have these tags |
| `BlockAbilitiesWithTag` | `FGameplayTagContainer` | Blocks activation of abilities with these tags |
| `AbilityTags` | `FGameplayTagContainer` | Tags this ability is identified by |
| `GrantedTags` (on GE) | `FGameplayTagContainer` | Tags the effect grants to the ASC while active |
| `ApplicationRequiredSourceTags` | `FGameplayTagContainer` | GE only applies if source ASC has these |
| `ApplicationRequiredTargetTags` | `FGameplayTagContainer` | GE only applies if target ASC has these |
| `FGameplayEffectQuery` | struct | Query-based filtering of active GEs |
| Gameplay Cue tags | `FGameplayTag` under `GameplayCue.` | Trigger cosmetic VFX/SFX |

GAS manages a dedicated `FGameplayTagCountContainer` on the `UAbilitySystemComponent` that
counts how many sources grant each tag, so a tag persists as long as at least one
granting effect is active. This is distinct from a plain `FGameplayTagContainer`.

## IGameplayTagAssetInterface pattern

Implement `IGameplayTagAssetInterface` on any class that owns tags so that generic code
can query tags without knowing the concrete type:

```cpp
// GenericTagCheck.h
bool HasRequiredTags(AActor* Actor, const FGameplayTagContainer& Required)
{
    IGameplayTagAssetInterface* TagInterface = Cast<IGameplayTagAssetInterface>(Actor);
    if (!TagInterface) return false;

    FGameplayTagContainer OwnedTags;
    TagInterface->GetOwnedGameplayTags(OwnedTags);
    return OwnedTags.HasAll(Required);
}
```

The three default interface methods (`HasMatchingGameplayTag`, `HasAllMatchingGameplayTags`,
`HasAnyMatchingGameplayTags`) call `GetOwnedGameplayTags` internally, so overriding just
`GetOwnedGameplayTags` is sufficient for most classes. Override the others only when the
tags for one query path differ from those for another (e.g., a character that exposes
different tag views to different systems).

## Animation layer / montage selection

A common pattern in character code: choose an animation montage or layer based on a tag
rather than an enum index, allowing designers to swap behaviors in data:

```cpp
USTRUCT(BlueprintType)
struct FTaggedMontage
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere)
    FGameplayTag MoveTag;    // e.g. "Ability.Attack.Heavy"

    UPROPERTY(EditAnywhere)
    TObjectPtr<UAnimMontage> Montage;
};

UAnimMontage* FindMontageForTag(const TArray<FTaggedMontage>& Table,
                                const FGameplayTag& SearchTag)
{
    for (const FTaggedMontage& Entry : Table)
    {
        if (SearchTag.MatchesTag(Entry.MoveTag))
        {
            return Entry.Montage;
        }
    }
    return nullptr;
}
```

`MatchesTag` here means a more-specific search tag (e.g., `Ability.Attack.Heavy.Overhead`)
will match a table entry tagged `Ability.Attack.Heavy`.

## Config and ini organisation

Tag sources in `Config/DefaultGameplayTags.ini` accumulate tags for every system in the
project. On large projects, split by domain:

```
Config/
  DefaultGameplayTags.ini       -- core tags used everywhere
  Tags/
    Abilities.ini               -- ability tags (owned by abilities team)
    States.ini                  -- state/status tags
    UI.ini                      -- UI event tags
    Damage.ini                  -- damage type tags
```

Each file under `Config/Tags/` is auto-discovered when `ImportTagsFromConfig` is enabled
(`UGameplayTagsSettings`, `GameplayTagsSettings.h`:108). Teams work in separate files,
reducing merge conflicts.

**Restricted tags** — mark a tag subtree as restricted in Project Settings so only listed
owners can add children. Useful for preventing accidental changes to core hierarchy nodes
(e.g., `State.*` or `GameplayCue.*`).

## Tag redirects

When a tag is renamed, add a redirect so saved assets and replicated data are
automatically fixed up:

```ini
; Config/DefaultGameplayTags.ini
[/Script/GameplayTags.GameplayTagsList]
+GameplayTagRedirects=(OldTagName="OldName.Foo",NewTagName="NewName.Bar")
```

`FGameplayTagRedirectors` in the tag manager applies redirects at load time; the
`WarnOnInvalidTags` setting (`GameplayTagsSettings.h`:113) logs warnings when a
non-redirected unknown tag is encountered during deserialization.
