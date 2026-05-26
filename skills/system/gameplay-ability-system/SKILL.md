---
name: gameplay-ability-system
description: Build abilities, attributes, and effects with Unreal's Gameplay Ability System (GAS)
  — UAbilitySystemComponent (ASC), UGameplayAbility with ActivateAbility/CommitAbility/EndAbility,
  UAttributeSet with FGameplayAttributeData and ATTRIBUTE_ACCESSORS macro, UGameplayEffect with
  Instant/HasDuration/Infinite policies and GE Components, FGameplayAbilitySpec for granting,
  UAbilityTask for async steps (WaitDelay, PlayMontageAndWait, WaitGameplayEvent), GameplayCues for
  networked VFX/SFX, instancing policies (InstancedPerActor/InstancedPerExecution), net execution
  policies (LocalPredicted/ServerOnly), and replication modes (Full/Mixed/Minimal). Use when
  implementing abilities with cooldowns/costs/tags, health/stamina/mana attributes, buffs/debuffs/
  damage via Gameplay Effects, ability tasks for async gameplay, Gameplay Cues for cosmetic feedback,
  or networked server-authoritative ability activation with client prediction. GAS requires the
  GameplayAbilities plugin and AbilitySystemGlobals initialization.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Gameplay Ability System (GAS)

GAS is Epic's framework for abilities, attributes, and effects with networking built in. It is
powerful but heavyweight — adopt it for games with many interacting abilities/stats; for a couple
of simple actions, plain components may be simpler.

## When to use this skill

- Implementing player or enemy abilities with cooldowns, costs, and tag gating.
- Attributes (health/stamina/mana/armor) modified by buffs, debuffs, and damage.
- Networked, server-authoritative ability activation with client prediction.
- Gameplay Cues for cosmetic effects that replicate without bespoke RPCs.
- Async ability logic: waiting for animation, input, events, or delays inside an ability.

## Setup

1. Enable the **Gameplay Abilities** plugin (`.uplugin` → Plugins, or add `GameplayAbilitiesPlugin`
   to your `.uproject`).
2. Add `"GameplayAbilities"`, `"GameplayTags"`, `"GameplayTasks"` to your module's `Build.cs`
   `PublicDependencyModuleNames` (see `module-and-build-system`).
3. Call `UAbilitySystemGlobals::Get().InitGlobalData()` exactly once at startup — typically in
   `UAssetManager::StartInitialLoading` or your game module's startup function. This is required
   for target data and montage prediction; omitting it causes silent failures.

## Core pieces

| Type | Role |
|---|---|
| `UAbilitySystemComponent` (ASC) | Hub: holds granted abilities, active effects, attribute sets, owned tags |
| `UAttributeSet` | Declares attributes (`FGameplayAttributeData`) and overrides change callbacks |
| `UGameplayAbility` | A granted, activatable ability with cost, cooldown, and async logic |
| `UGameplayEffect` (GE) | Data-driven attribute/tag change: Instant, HasDuration, or Infinite |
| `FGameplayAbilitySpec` | A granted ability instance (class, level, input ID, source object) |
| `UAbilityTask` | Async step inside an ability (wait for event, montage, delay, target data) |
| Gameplay Cues | Cosmetic feedback (VFX/SFX) keyed by `GameplayCue.*` tags, network-efficient |

## Where the ASC lives

The ASC can sit on the Pawn or on a separate object (commonly `APlayerState`):

- **Multiplayer player characters:** ASC on the **PlayerState** so it survives respawn. The Pawn
  implements `IAbilitySystemInterface::GetAbilitySystemComponent()` returning the PlayerState's ASC.
  Call `ASC->InitAbilityActorInfo(OwnerActor, AvatarPawn)` on the server in `PossessedBy` and on
  the client in `OnRep_PlayerState` (or `BeginPlay` for listen-server pawns).
- **AI / simple actors:** ASC directly on the Pawn; call `InitAbilityActorInfo(this, this)`.

```cpp
// Example: Pawn that delegates to PlayerState's ASC
class AMyCharacter : public ACharacter, public IAbilitySystemInterface
{
    GENERATED_BODY()
public:
    virtual UAbilitySystemComponent* GetAbilitySystemComponent() const override
    {
        if (AMyPlayerState* PS = GetPlayerState<AMyPlayerState>())
            return PS->GetAbilitySystemComponent();
        return nullptr;
    }
};
```

GAS does not support a single Actor having multiple ASCs (ambiguous queries). Multiple Actors can
share one ASC (e.g. equipment routing to the character's ASC).

## Attributes

Attributes are `FGameplayAttributeData` properties in a `UAttributeSet` subclass. Use the
`ATTRIBUTE_ACCESSORS` macro pattern (documented in `AttributeSet.h:420`) to generate the four
helpers: a static `FGameplayAttribute` getter, a float current-value getter, a setter that routes
through the ASC, and a base-value initter.

```cpp
// MyAttributeSet.h
#pragma once
#include "AttributeSet.h"
#include "AbilitySystemComponent.h"
#include "MyAttributeSet.generated.h"

// Generates Get<Name>Attribute(), Get<Name>(), Set<Name>(), Init<Name>()
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
    // ReplicatedUsing is required for clients to see attribute changes
    UPROPERTY(BlueprintReadOnly, Category="Attributes", ReplicatedUsing=OnRep_Health)
    FGameplayAttributeData Health;
    ATTRIBUTE_ACCESSORS(UMyAttributeSet, Health)

    UPROPERTY(BlueprintReadOnly, Category="Attributes", ReplicatedUsing=OnRep_MaxHealth)
    FGameplayAttributeData MaxHealth;
    ATTRIBUTE_ACCESSORS(UMyAttributeSet, MaxHealth)

    UFUNCTION() void OnRep_Health(const FGameplayAttributeData& OldHealth);
    UFUNCTION() void OnRep_MaxHealth(const FGameplayAttributeData& OldMaxHealth);

    // Clamp here; do not trigger game logic (use PostGameplayEffectExecute for that)
    virtual void PreAttributeChange(const FGameplayAttribute& Attr, float& NewValue) override;
    // React to confirmed changes (death, UI updates, etc.)
    virtual void PostGameplayEffectExecute(const FGameplayEffectModCallbackData& Data) override;
};
```

Register the attribute set by creating it as a subobject on the ASC's owning actor:
```cpp
// In the owning actor's constructor
AttributeSet = CreateDefaultSubobject<UMyAttributeSet>(TEXT("AttributeSet"));
```
The ASC auto-discovers `UAttributeSet` subobjects on the same actor. Never write attribute
`FGameplayAttributeData` fields directly at runtime — always apply a `UGameplayEffect` so that
prediction, replication, and aggregation work correctly.

See [references/attributes-and-effects.md](references/attributes-and-effects.md) for `PreAttributeChange`
vs `PostGameplayEffectExecute` usage, clamping patterns, and meta-attribute (damage) patterns.

## Abilities

```cpp
// GA_Dash.h
UCLASS()
class MYGAME_API UGA_Dash : public UGameplayAbility
{
    GENERATED_BODY()
public:
    UGA_Dash();

    // Primary override: do ability work here. Must call CommitAbility then EndAbility.
    virtual void ActivateAbility(const FGameplayAbilitySpecHandle Handle,
        const FGameplayAbilityActorInfo* ActorInfo,
        const FGameplayAbilityActivationInfo ActivationInfo,
        const FGameplayEventData* TriggerEventData) override;

    virtual bool CanActivateAbility(const FGameplayAbilitySpecHandle Handle,
        const FGameplayAbilityActorInfo* ActorInfo,
        const FGameplayTagContainer* SourceTags = nullptr,
        const FGameplayTagContainer* TargetTags = nullptr,
        FGameplayTagContainer* OptionalRelevantTags = nullptr) const override;
};
```

Key ability lifecycle: `CanActivateAbility` (read-only check) → `CommitAbility` (consume cost +
cooldown) → ability logic (launch tasks) → `EndAbility`. Failing to call `EndAbility` leaves the
ability in an active state indefinitely, blocking further uses and any abilities it blocks.

**Grant on server:**
```cpp
// Server only — GiveAbility is authority-only
FGameplayAbilitySpecHandle Handle = ASC->GiveAbility(
    FGameplayAbilitySpec(UGA_Dash::StaticClass(), /*Level=*/1, /*InputID=*/INDEX_NONE));
```

**Activate:**
```cpp
ASC->TryActivateAbilityByClass(UGA_Dash::StaticClass());
// or by handle:
ASC->TryActivateAbility(Handle);
```

Cost and cooldown are themselves `UGameplayEffect` assets referenced by `CostGameplayEffectClass`
and `CooldownGameplayEffectClass` on the ability. Set these in Blueprint subclasses.

See [references/gameplay-abilities.md](references/gameplay-abilities.md) for instancing policies,
net execution policies, tag gating, `FGameplayAbilitySpec` fields, and event-triggered activation.

## Gameplay Effects

GEs are usually data-only Blueprint assets (subclass `UGameplayEffect`). Choose a duration policy
(`EGameplayEffectDurationType`: `Instant`, `HasDuration`, `Infinite`), add Modifiers (attribute +
operation + magnitude), and optionally add GE Components (grants/requires/removes tags, immunity,
stacking). Apply from C++:

```cpp
// Apply a damage GE from one ASC to another
FGameplayEffectContextHandle Ctx = SourceASC->MakeEffectContext();
Ctx.AddSourceObject(this);
FGameplayEffectSpecHandle Spec = SourceASC->MakeOutgoingSpec(
    DamageEffectClass, /*Level=*/1.f, Ctx);
if (Spec.IsValid())
{
    SourceASC->ApplyGameplayEffectSpecToTarget(*Spec.Data.Get(), TargetASC);
}
```

`UGameplayEffect` became component-based in 5.3 (`UGameplayEffectComponent` subclasses). The
legacy monolithic properties still work but new behavior is authored via GE Components. See
[references/attributes-and-effects.md](references/attributes-and-effects.md) for GE Components,
execution calculations, and stacking.

## Ability Tasks

Tasks handle async steps inside an ability. Use `NewAbilityTask<T>` (not `NewObject`) and call
`ReadyForActivation()` to start it. Always override `OnDestroy` to unregister callbacks.

```cpp
// Inside ActivateAbility — wait for a montage notify then end
void UGA_Dash::ActivateAbility(...)
{
    if (!CommitAbility(Handle, ActorInfo, ActivationInfo)) { EndAbility(...); return; }

    UAbilityTask_PlayMontageAndWait* Task =
        UAbilityTask_PlayMontageAndWait::CreatePlayMontageAndWaitProxy(
            this, NAME_None, DashMontage);
    Task->OnCompleted.AddDynamic(this, &UGA_Dash::OnMontageCompleted);
    Task->OnCancelled.AddDynamic(this, &UGA_Dash::OnMontageCancelled);
    Task->ReadyForActivation();
}

void UGA_Dash::OnMontageCompleted()
{
    EndAbility(CurrentSpecHandle, CurrentActorInfo, CurrentActivationInfo,
               /*bReplicateEndAbility=*/true, /*bWasCancelled=*/false);
}
```

Common built-in tasks: `UAbilityTask_WaitDelay`, `UAbilityTask_PlayMontageAndWait`,
`UAbilityTask_WaitGameplayEvent`, `UAbilityTask_WaitTargetData`,
`UAbilityTask_WaitAttributeChange`. All live under
`Abilities/Tasks/` in the plugin's Public folder.

See [references/ability-tasks-and-cues.md](references/ability-tasks-and-cues.md) for custom task
authoring, `NewAbilityTask`, output delegate patterns, and Gameplay Cues.

## Gameplay Cues

Cues are cosmetic effects (particles, sounds, decals) driven by `GameplayCue.*` tags. They do not
need bespoke RPCs — the ASC handles replication automatically.

```cpp
// Fire a one-shot cue (e.g. impact spark)
ASC->ExecuteGameplayCue(FGameplayTag::RequestGameplayTag("GameplayCue.Impact.Spark"), Ctx);

// Add a persistent cue (e.g. burning aura) and remove it later
ASC->AddGameplayCue(FGameplayTag::RequestGameplayTag("GameplayCue.Status.Burning"), Ctx);
ASC->RemoveGameplayCue(FGameplayTag::RequestGameplayTag("GameplayCue.Status.Burning"));
```

Cue handlers are `UGameplayCueNotify_Static` (one-shot, `OnExecute`) or
`UGameplayCueNotify_Actor` (spawns an actor, `OnActive`/`WhileActive`/`OnRemove`). Must be tagged
`GameplayCue.*` and registered with the GameplayCue manager (auto-scanned from configured paths).

## Networking model

- The **server is authoritative**. Grant/remove abilities server-only; effects apply server-side.
- Set replication mode on the ASC: `Full` (single-player or small peer-to-peer), `Mixed`
  (player-owned ASC in multiplayer), `Minimal` (AI-owned ASC).
- Abilities with `LocalPredicted` net execution policy run immediately on the predicting client
  and are confirmed or rolled back by the server. Use Gameplay Cues for cosmetic output — they
  replicate without blocking server authority.
- Replicated attributes require `ReplicatedUsing=OnRep_<Name>` and `DOREPLIFETIME_CONDITION` in
  `GetLifetimeReplicatedProps` (handled automatically by the ASC for attribute sets it owns, but
  you must implement `GetLifetimeReplicatedProps` on the attribute set).

## Gotchas

- **`InitGlobalData()` not called** — montage and target-data prediction break silently.
- **Writing attribute fields directly** at runtime — bypasses replication, prediction, and
  aggregation. Always go through Gameplay Effects.
- **ASC on Pawn for a respawning multiplayer player** — state resets on death; put it on
  `APlayerState`.
- **Missing module deps** (`GameplayAbilities`/`GameplayTags`/`GameplayTasks`) — link errors.
- **`EndAbility` not called** — the ability stays "active" forever, blocking further uses.
- **`NonInstanced` removed in 5.5** — `UE_DEPRECATED_FORGAME(5.5, ...)` in 5.7; use
  `InstancedPerActor` as the default.
- **Wrong replication mode** — `Mixed` required for player-owned ASCs in multiplayer;
  `Minimal`-mode ASCs won't replicate GE data to simulated proxies.
- **Cue tags not prefixed `GameplayCue.`** — the manager won't find or route them.
- **Forgot to call `CommitAbility`** — cost/cooldown not consumed; server may reject prediction.

## Version notes

- `NonInstanced` policy deprecated in 5.5; `InstancedPerActor` is the recommended default.
- `UGameplayEffect` became component-based in 5.3 (`EGameplayEffectVersion::Modular53`). Legacy
  monolithic GE data still works but new functionality is via `UGameplayEffectComponent` subclasses.
- `GetAbilitySystemComponentFromActorInfo_Checked()` deprecated in 5.5; use
  `GetAbilitySystemComponentFromActorInfo_Ensured()`.

## References & source material

Engine source (UE 5.7, `Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/Public/`):
- `AbilitySystemComponent.h` — `UAbilitySystemComponent`: `GiveAbility`:947,
  `TryActivateAbility`:1038, `TryActivateAbilityByClass`:1030, `InitAbilityActorInfo`:1521,
  `MakeOutgoingSpec`:362, `MakeEffectContext`:366, `ApplyGameplayEffectSpecToTarget`:329,
  `SetReplicationMode`:258, `ExecuteGameplayCue`:881, `AddGameplayCue`:885, `RemoveGameplayCue`:892,
  `EGameplayEffectReplicationMode` enum:80.
- `AttributeSet.h` — `UAttributeSet`:186, `FGameplayAttributeData`:21,
  `PreAttributeChange`:221, `PostGameplayEffectExecute`:207, `ATTRIBUTE_ACCESSORS` pattern:420,
  `GAMEPLAYATTRIBUTE_PROPERTY_GETTER`:429, `GAMEPLAYATTRIBUTE_VALUE_GETTER`:436.
- `Abilities/GameplayAbility.h` — `UGameplayAbility`:110, `ActivateAbility`:597,
  `CommitAbility`:355, `EndAbility`:627, `CanActivateAbility`:282, `CancelAbility`:318,
  `EGameplayAbilityInstancingPolicy`:36, `EGameplayAbilityNetExecutionPolicy`:58
  (in `Abilities/GameplayAbilityTypes.h`).
- `GameplayAbilitySpec.h` — `FGameplayAbilitySpec`:167 (class, level, InputID, handle).
- `GameplayEffect.h` — `UGameplayEffect`, `EGameplayEffectDurationType`:663
  (Instant/Infinite/HasDuration), `EGameplayEffectVersion`:94 (Modular53).
- `AbilitySystemInterface.h` — `IAbilitySystemInterface::GetAbilitySystemComponent()`:30.
- `AbilitySystemGlobals.h` — `UAbilitySystemGlobals::InitGlobalData()`:69.
- `Abilities/Tasks/AbilityTask.h` — `UAbilityTask`:90, `NewAbilityTask<T>`:136.
- `GameplayCueNotify_Static.h` — `UGameplayCueNotify_Static`:19.
- `GameplayCueNotify_Actor.h` — `AGameplayCueNotify_Actor` (actor-spawning cue notify):20.

Related skills: `gameplay-tags` (GAS is tag-driven throughout), `networking-and-replication`,
`animation-system` (montage tasks).

Official docs (UE 5.7):
- Gameplay Ability System — <https://dev.epicgames.com/documentation/unreal-engine/gameplay-ability-system-for-unreal-engine>
- ASC and Attributes — <https://dev.epicgames.com/documentation/unreal-engine/gameplay-ability-system-component-and-gameplay-attributes-in-unreal-engine>
- Gameplay Ability — <https://dev.epicgames.com/documentation/unreal-engine/using-gameplay-abilities-in-unreal-engine>
- Gameplay Attributes and Attribute Sets — <https://dev.epicgames.com/documentation/unreal-engine/gameplay-attributes-and-attribute-sets-for-the-gameplay-ability-system-in-unreal-engine>
- Gameplay Effects — <https://dev.epicgames.com/documentation/unreal-engine/gameplay-effects-for-the-gameplay-ability-system-in-unreal-engine>
- Ability Tasks — <https://dev.epicgames.com/documentation/unreal-engine/gameplay-ability-tasks-in-unreal-engine>
- GAS Overview — <https://dev.epicgames.com/documentation/unreal-engine/understanding-the-unreal-engine-gameplay-ability-system>

Deep-dive references in this skill:
- [references/ability-system-component.md](references/ability-system-component.md) — ASC setup,
  `InitAbilityActorInfo`, `IAbilitySystemInterface`, attribute set registration, replication modes.
- [references/gameplay-abilities.md](references/gameplay-abilities.md) — ability lifecycle,
  instancing policies, net execution policies, tag gating, `FGameplayAbilitySpec`, Gameplay Events.
- [references/attributes-and-effects.md](references/attributes-and-effects.md) — `FGameplayAttributeData`,
  attribute callbacks, GE Components, modifiers, execution calculations, stacking, meta-attributes.
- [references/ability-tasks-and-cues.md](references/ability-tasks-and-cues.md) — built-in tasks,
  custom task authoring, output delegates, Gameplay Cue types and routing.
