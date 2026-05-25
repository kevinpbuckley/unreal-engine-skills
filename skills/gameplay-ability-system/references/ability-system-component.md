# Ability System Component (ASC)

> Deep-dive reference for `UAbilitySystemComponent`. Grounded in UE 5.7 source at
> `Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/Public/AbilitySystemComponent.h`.
> Return to [../SKILL.md](../SKILL.md) for the entry-level overview.

## What the ASC does

`UAbilitySystemComponent` (`UGameplayTasksComponent` subclass) is the central hub. It owns:

- **Granted ability specs** (`FGameplayAbilitySpec` list, replicated via `FGameplayAbilitySpecContainer`).
- **Active Gameplay Effects** (`FActiveGameplayEffectsContainer`) — duration/infinite effects currently applied.
- **Attribute sets** — `UAttributeSet` subobjects discovered on the same actor.
- **Owned tags** — a replicated `FGameplayTagCountContainer` updated by active effects and explicit add/remove.

## Implementing IAbilitySystemInterface

Any actor that participates in GAS must implement `IAbilitySystemInterface` (`AbilitySystemInterface.h:25`)
so that other systems can find its ASC via `UAbilitySystemBlueprintLibrary::GetAbilitySystemComponent`:

```cpp
// Header
class AMyCharacter : public ACharacter, public IAbilitySystemInterface
{
    GENERATED_BODY()
public:
    virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override;

    UPROPERTY(VisibleDefaultsOnly, BlueprintReadOnly, Category="Abilities")
    TObjectPtr<UAbilitySystemComponent> AbilitySystemComponent;
};

// Source
UAbilitySystemComponent* AMyCharacter::GetAbilitySystemComponent() const
{
    return AbilitySystemComponent;
}
```

For the PlayerState-hosted pattern, `GetAbilitySystemComponent` delegates to the PlayerState;
cache the pointer on possession to avoid repeated casts.

## InitAbilityActorInfo

Tells the ASC which actor is the **owner** (holds data/state, e.g. PlayerState) and which is the
**avatar** (acts in the world, e.g. Pawn). Must be called on both server and client.

```cpp
// AMyCharacter::PossessedBy — server
void AMyCharacter::PossessedBy(AController* NewController)
{
    Super::PossessedBy(NewController);
    if (AMyPlayerState* PS = GetPlayerState<AMyPlayerState>())
    {
        PS->GetAbilitySystemComponent()->InitAbilityActorInfo(PS, this);
    }
}

// AMyCharacter::OnRep_PlayerState — client
void AMyCharacter::OnRep_PlayerState()
{
    Super::OnRep_PlayerState();
    if (AMyPlayerState* PS = GetPlayerState<AMyPlayerState>())
    {
        PS->GetAbilitySystemComponent()->InitAbilityActorInfo(PS, this);
    }
}
```

`InitAbilityActorInfo` signature (`AbilitySystemComponent.h:1521`):
```
virtual void InitAbilityActorInfo(AActor* InOwnerActor, AActor* InAvatarActor);
```

## Registering attribute sets

Create the `UAttributeSet` as a `UPROPERTY` subobject on the same actor as the ASC (or on the
actor that owns the ASC). The ASC auto-discovers `UAttributeSet` subobjects during
`InitAbilityActorInfo`. Alternatively, call `ASC->AddAttributeSetSubobject(Set)` at runtime on the
server, though this is less common.

```cpp
// In AMyPlayerState constructor
AbilitySystemComponent = CreateDefaultSubobject<UAbilitySystemComponent>(TEXT("ASC"));
AbilitySystemComponent->SetIsReplicated(true);
AbilitySystemComponent->SetReplicationMode(EGameplayEffectReplicationMode::Mixed);

AttributeSet = CreateDefaultSubobject<UMyAttributeSet>(TEXT("AttributeSet"));
```

## Replication mode

Set via `ASC->SetReplicationMode(Mode)` before the first replication frame. Defined in
`AbilitySystemComponent.h:80`:

| Mode | Use when |
|---|---|
| `Full` | Single-player or small co-op with few ASCs; all GE data replicated to all |
| `Mixed` | Player-owned ASCs in multiplayer; full data to owner, minimal to simulated proxies |
| `Minimal` | AI-owned ASCs; only minimal info (cue tags, owned tags) replicated to all |

`Mixed` requires the ASC's owning actor to be a `APlayerState` (or similarly long-lived actor) for
full data to reach the owner correctly.

## Granting and removing abilities

Server-only. Clients cannot grant or revoke abilities.

```cpp
// Grant — server
FGameplayAbilitySpec Spec(UGA_FireBolt::StaticClass(), /*Level=*/1, /*InputID=*/INDEX_NONE, this);
FGameplayAbilitySpecHandle Handle = AbilitySystemComponent->GiveAbility(Spec);

// Remove options
AbilitySystemComponent->ClearAbility(Handle);            // immediate, even if active
AbilitySystemComponent->SetRemoveAbilityOnEnd(Handle);   // remove when ability finishes
AbilitySystemComponent->ClearAllAbilities();             // remove everything
```

`GiveAbility` signature (`AbilitySystemComponent.h:947`):
```
FGameplayAbilitySpecHandle GiveAbility(const FGameplayAbilitySpec& AbilitySpec);
```

## Activation

```cpp
// By class (finds first matching spec)
bool bActivated = ASC->TryActivateAbilityByClass(UGA_FireBolt::StaticClass());

// By spec handle (precise)
bool bActivated = ASC->TryActivateAbility(Handle);

// By Gameplay Event (does not go through normal CanActivate path)
FGameplayEventData Payload;
Payload.EventTag = FGameplayTag::RequestGameplayTag("Event.FireBolt.Launched");
ASC->HandleGameplayEvent(Payload.EventTag, &Payload);
```

## Gameplay tag queries on the ASC

```cpp
// Check if the owner has a tag (from active effects, granted, or explicit)
bool bHasTag = ASC->HasMatchingGameplayTag(FireTag);
bool bHasAll = ASC->HasAllMatchingGameplayTags(RequiredContainer);
bool bHasAny = ASC->HasAnyMatchingGameplayTags(AnyContainer);

// Get all owned tags
FGameplayTagContainer OwnedTags;
ASC->GetOwnedGameplayTags(OwnedTags);
```

## Blocking and cancelling abilities

The ASC exposes `CancelAbility(Handle)` and `CancelAllAbilities()` for external cancellation.
Within an ability, tag containers on the `UGameplayAbility` class handle blocking/cancellation
automatically as other abilities activate.

## Removing active Gameplay Effects

```cpp
// Remove by handle (returned from Apply*)
ASC->RemoveActiveGameplayEffect(ActiveHandle);

// Remove all effects with a given tag
ASC->RemoveActiveGameplayEffectsWithTags(TagContainer);

// Remove all effects from a specific source
ASC->RemoveActiveEffects(FGameplayEffectQuery::MakeQuery_MatchAllSourceTags(SourceTag));
```
