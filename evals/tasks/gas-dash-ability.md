---
skill: gameplay-ability-system
title: GAS dash ability with cooldown and stamina cost
---

## Prompt

In an Unreal Engine 5.7 C++ project module named `EvalScratch` (with the
GameplayAbilities plugin enabled), set up the Gameplay Ability System on a character:
an attribute set with `Stamina`/`MaxStamina`, an ASC on the character, and a Dash
ability that costs 25 stamina, has a 4-second cooldown, and plays a montage while
dashing. Grant the ability on possession (server only).

## Acceptance criteria

- Build.cs adds `GameplayAbilities`, `GameplayTags`, `GameplayTasks`.
- Attribute set subclasses `UAttributeSet`, uses `FGameplayAttributeData` with the
  `ATTRIBUTE_ACCESSORS` macro, and clamps in `PostGameplayEffectExecute` (or
  `PreAttributeChange`) rather than in the ability.
- Character implements `IAbilitySystemInterface::GetAbilitySystemComponent`.
- Cost and cooldown are `UGameplayEffect`s referenced by the ability's
  `GetCostGameplayEffect`/`GetCooldownGameplayEffect` classes (CostGameplayEffectClass /
  CooldownGameplayEffectClass), not hand-rolled timers and float subtraction.
- Ability calls `CommitAbility` before applying gameplay logic and `EndAbility` on all
  exit paths; montage uses `UAbilityTask_PlayMontageAndWait` with delegates bound for
  completion/interruption.
- Abilities granted via `GiveAbility(FGameplayAbilitySpec(...))` on the server
  (authority-checked), typically in `PossessedBy`.

## Common baseline failures

Hand-rolled cooldown timers instead of cooldown GEs, mutating attributes directly
(`SetStamina(GetStamina()-25)`) without a cost GE, missing `IAbilitySystemInterface`,
granting abilities on clients, or forgetting `CommitAbility` so cost/cooldown never apply.
