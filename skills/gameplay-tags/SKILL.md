---
name: gameplay-tags
description: Use Gameplay Tags in Unreal — hierarchical FName-based tags (FGameplayTag),
  FGameplayTagContainer, native C++ tag declaration (UE_DECLARE/DEFINE_GAMEPLAY_TAG), requesting
  tags, and matching/querying. Use when modeling states/categories/labels (states, damage types,
  ability identifiers, input states), replacing enums/booleans/strings with data-driven tags, or
  working with systems (GAS, AI, UI) that key off tags.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Gameplay Tags

Gameplay Tags are hierarchical, interned `FName` labels like `State.Stunned` or
`Ability.Attack.Melee`. They replace scattered enums/booleans/strings with a single, extensible,
designer-editable taxonomy that many engine systems (GAS, AI, animation, UI) already understand.

## When to use this skill

- Modeling states/categories/flags ("is stunned", "fire damage", "ability = dash").
- Replacing brittle enums/bools/string IDs with extensible, queryable labels.
- Interfacing with tag-driven systems (GAS, behavior trees, anim, UI).
- Granting/blocking behavior based on a set of active tags.

## Mental model

- A tag is a dot-separated hierarchy: `Ability.Attack.Melee` is a child of `Ability.Attack`.
- Tags are **interned** — comparison is fast (like `FName`).
- Tags are registered centrally (config and/or native C++) so they're discoverable and typo-safe.
- A `FGameplayTagContainer` holds a set of tags (e.g. "tags this actor currently has").

Enable: the `GameplayTags` module is part of the engine; add `"GameplayTags"` to your Build.cs
dependencies to use the C++ API.

## Defining tags

Two ways (you can mix):

**1. Native C++ tags** (compile-time safe, no string lookups):
```cpp
// Tags.h
#include "NativeGameplayTags.h"
UE_DECLARE_GAMEPLAY_TAG_EXTERN(TAG_State_Stunned);

// Tags.cpp
UE_DEFINE_GAMEPLAY_TAG(TAG_State_Stunned, "State.Stunned");
// or with a default comment/source: UE_DEFINE_GAMEPLAY_TAG_COMMENT(...)
```
Use directly: `if (Container.HasTag(TAG_State_Stunned)) { ... }`.

**2. Config/editor tags** — added in Project Settings → GameplayTags (written to
`Config/DefaultGameplayTags.ini`). Request at runtime by name:
```cpp
FGameplayTag T = FGameplayTag::RequestGameplayTag(FName("State.Stunned"));
```
Prefer **native tags** for tags your C++ references; use config tags for purely data/designer ones.

## Using containers and matching

```cpp
FGameplayTagContainer Active;            // e.g. an actor's current states
Active.AddTag(TAG_State_Stunned);

Active.HasTag(TAG_State_Stunned);                 // exact or child match
Active.HasTagExact(TAG_State_Stunned);            // exact only
Active.HasAny(SomeOtherContainer);
Active.HasAll(RequiredContainer);

// Single-tag matching (hierarchy-aware):
SomeTag.MatchesTag(ParentTag);                    // SomeTag is ParentTag or a child
SomeTag.MatchesTagExact(OtherTag);
```

Hierarchy matters: `HasTag(Ability.Attack)` is true if the container holds
`Ability.Attack.Melee`. Use the `*Exact` variants when you don't want child matching.

## Tag queries (data-driven conditions)

`FGameplayTagQuery` expresses conditions like "has A and B but not C" as data (editable in the
editor) — useful for ability activation requirements, AI conditions, and gating:
```cpp
if (Query.Matches(Active)) { /* allowed */ }
```

## Exposing tags to Blueprints / editor

```cpp
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="State")
FGameplayTag DamageType;                 // editor shows a tag picker

UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="State")
FGameplayTagContainer GrantedTags;
```

`FGameplayTag`/`FGameplayTagContainer` are `BlueprintType` and render as tag pickers in Details.

## When to use tags vs. enums

- Fixed, small, mutually-exclusive set you switch on in C++ → an `enum class` is fine.
- Open-ended, hierarchical, designer-extensible, or shared across systems → **gameplay tags**.
- "An object has a *set* of states/labels at once" → tag **container**.

## Gotchas

- **Typos in `RequestGameplayTag`** for an unregistered tag warn/return invalid — prefer native tags.
- **`HasTag` vs `HasTagExact`** — forgetting hierarchy matching causes false negatives/positives.
- **Forgot `"GameplayTags"` in Build.cs** → unresolved externals.
- **Registering tags too late** — native tags register at module load; config tags load from ini.
- **Comparing `ToString()`** instead of the tag — always compare tags/containers, not strings.

## References & source material

Engine source (UE 5.7, `Runtime/GameplayTags/`):
- `Classes/GameplayTagContainer.h` — `FGameplayTag`, `FGameplayTagContainer`, matching.
- `Classes/GameplayTagsManager.h` — registration/lookup; `Classes/GameplayTagsSettings.h` — config.
- `Public/NativeGameplayTags.h` — `UE_DECLARE_GAMEPLAY_TAG_EXTERN`/`UE_DEFINE_GAMEPLAY_TAG`.
- `Classes/GameplayTagAssetInterface.h` — `IGameplayTagAssetInterface`.

Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>
