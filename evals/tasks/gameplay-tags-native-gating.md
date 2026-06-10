---
skill: gameplay-tags
title: Native tags + tag-gated ability check
---

## Prompt

In an Unreal Engine 5.7 C++ project module named `EvalScratch`, add a character state
system using Gameplay Tags: declare native tags `State.Stunned`, `State.Immune`, and
`Ability.Dash` shared across the module; give the character a tag container exposed to
designers; and implement `bool CanDash() const` that returns false while the character
is stunned and not immune. Other systems must be able to query the character's tags
without casting to its concrete class.

## Acceptance criteria

- Tags are declared with `UE_DECLARE_GAMEPLAY_TAG_EXTERN` in a header and defined with
  `UE_DEFINE_GAMEPLAY_TAG`/`UE_DEFINE_GAMEPLAY_TAG_COMMENT` in a `.cpp` (never in a header).
- `"GameplayTags"` added to `PublicDependencyModuleNames` in `EvalScratch.Build.cs`.
- The container is a `UPROPERTY(EditAnywhere, ...)` `FGameplayTagContainer`, not an array
  of FName/FString.
- `CanDash()` uses container queries (`HasTag`/`HasTagExact`), not `ToString()` comparison.
- The class implements `IGameplayTagAssetInterface::GetOwnedGameplayTags` for castless queries.
- No runtime tag creation; no `RequestGameplayTag` with a typo-prone literal where a native
  tag variable exists.

## Common baseline failures

String-comparing tag names, defining tags in headers (static_assert failure), missing
Build.cs dependency (unresolved externals), inventing an `AddGameplayTag` API on the actor,
or skipping `IGameplayTagAssetInterface` and hard-casting instead.
