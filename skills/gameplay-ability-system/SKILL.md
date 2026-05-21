---
name: gameplay-ability-system
description: Build abilities, attributes, and effects with Unreal's Gameplay Ability System (GAS)
  — UAbilitySystemComponent, UGameplayAbility, UAttributeSet, UGameplayEffect, FGameplayAbilitySpec,
  ability tasks, and gameplay cues. Use when implementing skills/spells/cooldowns, health/stamina/
  mana attributes, buffs/debuffs/damage, or networked ability activation. GAS is a large plugin —
  this is the architecture map and entry patterns; deep details go in references.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Gameplay Ability System (GAS)

GAS is Epic's framework for abilities, attributes, and effects with networking built in. It is
powerful but heavyweight — adopt it for games with many interacting abilities/stats; for a couple
of simple actions, plain components may be simpler. This skill maps the pieces and the wiring;
it does not attempt to cover all of GAS.

## When to use this skill

- Implementing player/enemy abilities with cooldowns, costs, and tags.
- Attributes (health/stamina/mana/armor) modified by buffs, debuffs, and damage.
- Networked, server-authoritative ability activation with client prediction.
- Deciding whether GAS is worth it for the project.

## Setup

1. Enable the **Gameplay Abilities** plugin. Add `"GameplayAbilities"`, `"GameplayTags"`,
   `"GameplayTasks"` to your module's dependencies (`module-and-build-system`).
2. Call `UAbilitySystemGlobals::Get().InitGlobalData()` once at startup (e.g. in your module's
   startup or `UAssetManager::StartInitialLoading`) — required for target data/montage prediction.

## The core pieces

| Type | Role |
|---|---|
| `UAbilitySystemComponent` (ASC) | the hub: holds abilities, active effects, attribute sets, owned tags |
| `UAttributeSet` | declares attributes (e.g. Health, Mana) as `FGameplayAttributeData` |
| `UGameplayAbility` | a granted, activatable ability (cost, cooldown, logic) |
| `UGameplayEffect` (GE) | data-driven change to attributes/tags (instant, duration, infinite) |
| `FGameplayAbilitySpec` | a granted ability instance (handle, level, input) |
| Ability Tasks (`UAbilityTask`) | async steps inside an ability (wait for event, montage, target) |
| Gameplay Cues | cosmetic feedback (VFX/SFX) keyed by `GameplayCue.*` tags |

## Where the ASC lives

- **Player characters (especially multiplayer):** ASC on the **PlayerState** (survives respawn),
  with the Pawn referencing it. Set `PlayerState->GetAbilitySystemComponent()` and call
  `InitAbilityActorInfo(OwnerPlayerState, AvatarPawn)` on possession/restart.
- **AI/simple actors:** ASC directly on the Pawn; `InitAbilityActorInfo(this, this)` in
  `PossessedBy` (server) and `OnRep_PlayerState`/`BeginPlay` (client).

Implement `IAbilitySystemInterface::GetAbilitySystemComponent()` on the owner so other systems
can find the ASC.

## Attributes

```cpp
// MyAttributeSet.h
#include "AttributeSet.h"
#include "AbilitySystemComponent.h"

#define ATTRIBUTE_ACCESSORS(ClassName, PropertyName) \
    GAMEPLAYATTRIBUTE_PROPERTY_GETTER(ClassName, PropertyName) \
    GAMEPLAYATTRIBUTE_VALUE_GETTER(PropertyName) \
    GAMEPLAYATTRIBUTE_VALUE_SETTER(PropertyName) \
    GAMEPLAYATTRIBUTE_VALUE_INITTER(PropertyName)

UCLASS()
class MYGAME_API UMyAttributeSet : public UAttributeSet
{
    GENERATED_BODY()
public:
    UPROPERTY(ReplicatedUsing=OnRep_Health) FGameplayAttributeData Health;
    ATTRIBUTE_ACCESSORS(UMyAttributeSet, Health)

    UFUNCTION() void OnRep_Health(const FGameplayAttributeData& Old);
    virtual void PreAttributeChange(const FGameplayAttribute& Attr, float& NewValue) override; // clamp
};
```
Modify attributes only through **Gameplay Effects**, not by writing the field directly — that's how
prediction, replication, and aggregation work.

## Abilities

```cpp
UCLASS()
class MYGAME_API UGA_Dash : public UGameplayAbility
{
    GENERATED_BODY()
public:
    virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle,
        const FGameplayAbilityActorInfo* ActorInfo,
        const FGameplayAbilitySpecHandle ActivationInfo, ...) override; // signature: read header
};
```
Grant (server): `ASC->GiveAbility(FGameplayAbilitySpec(UGA_Dash::StaticClass(), Level, InputID))`.
Activate: `ASC->TryActivateAbilityByClass(UGA_Dash::StaticClass())` or by tag. Cost/cooldown are
themselves Gameplay Effects referenced by the ability.

## Gameplay Effects

GEs are usually data-only Blueprint assets (subclass `UGameplayEffect`): pick a duration policy
(Instant/HasDuration/Infinite), add Modifiers (e.g. Add −20 to Health), and grant/require tags.
Apply from C++:
```cpp
FGameplayEffectContextHandle Ctx = ASC->MakeEffectContext();
FGameplayEffectSpecHandle Spec = ASC->MakeOutgoingSpec(DamageGE, Level, Ctx);
ASC->ApplyGameplayEffectSpecToTarget(*Spec.Data.Get(), TargetASC);
```

## Networking model (essential)

- The **server is authoritative**; abilities can be **locally predicted** for responsiveness.
- Attributes and active effects replicate via the ASC; set the ASC replication mode
  (`Full` for single-player/few players, `Mixed` for player-controlled in multiplayer,
  `Minimal` for AI) with `SetReplicationMode`.
- Use Gameplay Cues for cosmetic effects so they don't need bespoke RPCs.

## Gotchas

- **Forgot `InitGlobalData()`** → montage/target-data prediction breaks.
- **Writing attribute fields directly** instead of via GEs → no replication/prediction/clamping.
- **ASC on Pawn for a respawning multiplayer player** loses state on death; put it on PlayerState.
- **Missing module deps** (`GameplayAbilities`/`GameplayTags`/`GameplayTasks`) → link errors.
- **Wrong replication mode** → attribute/cue spam or missing updates.
- GAS APIs are version-sensitive — **read the 5.7 headers** for exact override signatures.

## References & source material

Engine source (UE 5.7, `Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/Public/`):
- `AbilitySystemComponent.h` — the ASC (grant/activate/apply, replication mode).
- `Abilities/GameplayAbility.h` — `UGameplayAbility` lifecycle/overrides.
- `AttributeSet.h` — `UAttributeSet`, `FGameplayAttributeData`, accessor macros.
- `GameplayEffect.h` — `UGameplayEffect`, specs, modifiers, duration policies.
- `AbilitySystemInterface.h` — `IAbilitySystemInterface`.

Related skills: `gameplay-tags` (GAS is tag-driven), `networking-and-replication`.
Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>
