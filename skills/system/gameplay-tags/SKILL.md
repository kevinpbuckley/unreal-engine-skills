---
name: gameplay-tags
description: Use Gameplay Tags in Unreal C++ — hierarchical FName-based labels (FGameplayTag,
  FGameplayTagContainer), native tag declaration and definition (UE_DECLARE_GAMEPLAY_TAG_EXTERN /
  UE_DEFINE_GAMEPLAY_TAG / UE_DEFINE_GAMEPLAY_TAG_COMMENT / UE_DEFINE_GAMEPLAY_TAG_STATIC),
  tag registration via UGameplayTagsManager, runtime lookup with RequestGameplayTag,
  container operations (AddTag, RemoveTag, HasTag, HasTagExact, HasAny, HasAll),
  single-tag matching (MatchesTag, MatchesTagExact, MatchesAny), data-driven conditions
  with FGameplayTagQuery, the IGameplayTagAssetInterface, and config via
  DefaultGameplayTags.ini / DataTable sources. Use when modeling states, categories,
  damage types, ability identifiers, or any open-ended hierarchical label that multiple
  systems share; when replacing brittle enums or string comparisons; or when working
  with GAS, AI behavior trees, animation, or UI systems that gate behavior on tags.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Gameplay Tags

Gameplay Tags are hierarchical, interned `FName` labels — `State.Stunned`,
`Ability.Attack.Melee`, `Event.Reset` — registered centrally so every system speaks
the same vocabulary. They replace scattered enums/booleans/string IDs with a single,
extensible, designer-editable taxonomy.

## When to use this skill

- Modeling states/categories/flags ("is stunned", "fire damage type", "ability = dash").
- Replacing brittle enums/bools/string IDs with extensible, queryable labels.
- Interfacing with tag-driven systems (GAS, behavior trees, animation, UI).
- Granting, blocking, or querying behavior based on a set of active tags on an actor.
- Building data-driven activation conditions that designers can edit without recompiling.

## Mental model

- A tag is a dot-separated hierarchy: `Ability.Attack.Melee` is a **child** of `Ability.Attack`.
- Tags are **interned** — comparison is a fast `FName` equality check, not a string compare.
- Tags are registered once (at module load for native; at ini/DataTable load for config)
  before gameplay begins. You cannot create arbitrary runtime tags.
- `FGameplayTagContainer` stores a **set** of tags an actor currently has; it also
  caches parent tags for fast hierarchy-aware queries.
- `FGameplayTagQuery` encodes a logical expression (any/all/none of a tag set, composed
  recursively) as an opaque byte stream editable in the Details panel.

Module dependency: add `"GameplayTags"` to your `Build.cs` `PublicDependencyModuleNames`.

## Defining tags

Three approaches (you can mix):

**1. Native C++ tags** — compile-time safe, share across modules, register at module load:

```cpp
// MyTags.h  (any public header)
#pragma once
#include "NativeGameplayTags.h"

UE_DECLARE_GAMEPLAY_TAG_EXTERN(TAG_State_Stunned)
UE_DECLARE_GAMEPLAY_TAG_EXTERN(TAG_Damage_Fire)
```

```cpp
// MyTags.cpp
#include "MyTags.h"

// No comment variant (tag string must match your ini/design taxonomy):
UE_DEFINE_GAMEPLAY_TAG(TAG_State_Stunned,  "State.Stunned")

// With an editor-visible tooltip comment:
UE_DEFINE_GAMEPLAY_TAG_COMMENT(TAG_Damage_Fire, "Damage.Fire", "Applied by fire sources")
```

```cpp
// File-private tag (no header declaration needed):
UE_DEFINE_GAMEPLAY_TAG_STATIC(TAG_LocalOnly, "Debug.LocalOnly")
```

Use native tags for every tag your C++ references directly — no string lookup at call
sites and a compile error if you mistype the variable name.

**2. Config/editor tags** — added in Project Settings → GameplayTags (written to
`Config/DefaultGameplayTags.ini`) or to `Config/Tags/*.ini` for per-team organisation.
Request at runtime by name:

```cpp
// Prefer caching this result — RequestGameplayTag does a map lookup.
FGameplayTag FireTag = FGameplayTag::RequestGameplayTag(FName("Damage.Fire"));
// Pass false as second arg to suppress the ensure() if the tag might not exist.
FGameplayTag MaybeTag = FGameplayTag::RequestGameplayTag(FName("Debug.Foo"), false);
```

**3. DataTable tags** — a `UDataTable` with row type `FGameplayTagTableRow` listed in
Project Settings → Gameplay Tag Table List. Useful for importing bulk tag sets from CSV.

## Container operations

```cpp
FGameplayTagContainer ActiveTags;   // e.g. an actor's current states

ActiveTags.AddTag(TAG_State_Stunned);
ActiveTags.RemoveTag(TAG_State_Stunned);
ActiveTags.AppendTags(OtherContainer);  // union
ActiveTags.Reset();

// Hierarchy-aware queries (child satisfies parent check):
bool bStunned    = ActiveTags.HasTag(TAG_State_Stunned);   // exact or ancestor match
bool bExact      = ActiveTags.HasTagExact(TAG_State_Stunned);
bool bAny        = ActiveTags.HasAny(RequiredAny);
bool bAll        = ActiveTags.HasAll(RequiredAll);
bool bAnyExact   = ActiveTags.HasAnyExact(RequiredAny);
bool bAllExact   = ActiveTags.HasAllExact(RequiredAll);
```

Hierarchy matters: `HasTag(Ability.Attack)` returns `true` if the container holds
`Ability.Attack.Melee`. Prefer `*Exact` variants when you need strict equality.
`HasAll` with an **empty** container returns `true` (vacuous truth — no tags are
missing).

## Single-tag matching

```cpp
FGameplayTag Melee = TAG_Ability_Attack_Melee.GetTag();   // via FNativeGameplayTag
FGameplayTag Attack = FGameplayTag::RequestGameplayTag(FName("Ability.Attack"));

Melee.MatchesTag(Attack);         // true  — Melee is a child of Attack
Attack.MatchesTag(Melee);         // false — Attack is NOT a child of Melee
Melee.MatchesTagExact(Attack);    // false — not the same tag
Melee.MatchesAny(SomeContainer);  // true if container has Melee or any parent of Melee
```

## Tag queries (data-driven conditions)

`FGameplayTagQuery` composes conditions that designers can author in the Details panel
without recompiling. Build one in code when needed:

```cpp
// Match actors that have State.Stunned but NOT State.Immune:
FGameplayTagQuery Q = FGameplayTagQuery::BuildQuery(
    FGameplayTagQueryExpression()
    .AllExprMatch()
    .AddExpr(FGameplayTagQueryExpression().AnyTagsMatch().AddTag(TAG_State_Stunned))
    .AddExpr(FGameplayTagQueryExpression().NoTagsMatch() .AddTag(TAG_State_Immune))
);

if (Q.Matches(ActorTags)) { /* apply stun effect */ }
```

Shortcut factory functions for simple cases:
```cpp
FGameplayTagQuery QAny = FGameplayTagQuery::MakeQuery_MatchAnyTags(SomeContainer);
FGameplayTagQuery QAll = FGameplayTagQuery::MakeQuery_MatchAllTags(SomeContainer);
FGameplayTagQuery QNone= FGameplayTagQuery::MakeQuery_MatchNoTags(SomeContainer);
```

## IGameplayTagAssetInterface

Implement this interface on any actor or object that owns tags, so other systems can
retrieve tags without casting:

```cpp
// MyCharacter.h
#include "GameplayTagAssetInterface.h"

UCLASS()
class AMyCharacter : public ACharacter, public IGameplayTagAssetInterface
{
    GENERATED_BODY()
public:
    virtual void GetOwnedGameplayTags(FGameplayTagContainer& OutTags) const override
    {
        OutTags.AppendTags(ActiveTags);
    }

private:
    UPROPERTY(EditAnywhere, Category="Tags")
    FGameplayTagContainer ActiveTags;
};
```

`IGameplayTagAssetInterface` also provides default implementations of
`HasMatchingGameplayTag`, `HasAllMatchingGameplayTags`, and `HasAnyMatchingGameplayTags`
that call `GetOwnedGameplayTags` — override only if you need custom logic.

## Exposing tags to Blueprints and the editor

```cpp
// Tag picker in Details panel:
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Tags")
FGameplayTag DamageType;

// Container picker — holds multiple tags:
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Tags")
FGameplayTagContainer GrantedTags;

// Restrict the picker to a subtree with the meta specifier:
UPROPERTY(EditAnywhere, meta=(Categories="Damage"))
FGameplayTag SpecificDamageType;

// Query editor widget:
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Tags")
FGameplayTagQuery ActivationRequirements;
```

`FGameplayTag`, `FGameplayTagContainer`, and `FGameplayTagQuery` are all `BlueprintType`
and show custom editor widgets in Details panels.

## When to use tags vs. enums

| Situation | Recommendation |
|---|---|
| Fixed, small, mutually-exclusive set switched in C++ | `enum class` |
| Open-ended, hierarchical, designer-extensible labels | Gameplay tags |
| "An object has a *set* of states at once" | Tag container |
| Activation requirements editable without recompile | `FGameplayTagQuery` |

## Gotchas

- **Typo in `RequestGameplayTag`** for an unregistered tag → warns and returns invalid
  tag (the second arg controls whether it fires an `ensure`). Prefer native tags.
- **`HasTag` vs `HasTagExact`** — hierarchy expansion causes false positives when you
  want exact matches and false negatives when you forget it exists.
- **`HasAll` on empty container returns `true`** — intended (vacuous truth), but
  surprising; guard with `!Container.IsEmpty()` when needed.
- **Forgot `"GameplayTags"` in Build.cs** → unresolved external symbols.
- **Registering native tags too late** — `UE_DEFINE_GAMEPLAY_TAG` registers at module
  startup; never define inside a function or after the tag table is locked.
- **Comparing `Tag.ToString()`** instead of the tag struct — always compare
  `FGameplayTag` values directly or use matching functions.
- **`UE_DEFINE_GAMEPLAY_TAG` in a header** — the static_assert in the macro rejects
  this at compile time; define must be in a `.cpp` file.
- **`GetSingleTagContainer` deprecated in 5.4** — use `FGameplayTag::GetSingleTagContainer()`
  (member) or `FindTagNode` on the manager instead.

## Version notes

- `UE_DEFINE_GAMEPLAY_TAG_STATIC` (file-private tag) and the `UE_DEFINE_GAMEPLAY_TAG_COMMENT`
  (with developer tooltip) forms were both present in UE5.0+; stable in 5.7.
- `GetSingleTagContainer(FGameplayTag)` on `UGameplayTagsManager` was deprecated in 5.4;
  the member `FGameplayTag::GetSingleTagContainer()` is the replacement.
- `FGameplayTagQuery::MakeQuery_ExactMatchAnyTags` / `MakeQuery_ExactMatchAllTags` added
  to allow exact-match factory queries without building the expression tree manually.
- The `ClearInvalidTags` setting on `UGameplayTagsSettings` was deprecated in 5.5.

## Cross-references

- `gameplay-ability-system` — GAS uses tags heavily: ability activation requirements,
  blocking/cancelling tags, `FGameplayEffectQuery`, Gameplay Cue tags, and
  `FGameplayTagResponseTable`. The two skills are companion references.

## References & source material

Engine source (UE 5.7, `Engine/Source/Runtime/GameplayTags/`):
- `Classes/GameplayTagContainer.h` — `FGameplayTag`:44, `RequestGameplayTag`:60,
  `MatchesTag`:94, `MatchesTagExact`:103, `MatchesAny`:129, `GetSingleTagContainer`:147;
  `FGameplayTagContainer`:250, `HasTag`:304, `HasTagExact`:321, `HasAny`:338,
  `HasAnyExact`:361, `HasAll`:384, `HasAllExact`:407, `AddTag`:499, `RemoveTag`:525,
  `AppendTags`:477, `MatchesQuery`:469; `FGameplayTagQuery`:738, `Matches`:804,
  `BuildQuery`:816, `MakeQuery_MatchAnyTags`:855, `MakeQuery_MatchAllTags`:856,
  `MakeQuery_MatchNoTags`:857; `FGameplayTagQueryExpression`:866.
- `Classes/GameplayTagsManager.h` — `UGameplayTagsManager`:329, `Get()`:337,
  `RequestGameplayTag`:368, `RequestGameplayTagContainer`:358,
  `AddNativeGameplayTag`:396, `RequestGameplayTagParents`:426,
  `RequestGameplayTagChildren`:447, `DoneAddingNativeTags`:405.
- `Public/NativeGameplayTags.h` — `UE_DECLARE_GAMEPLAY_TAG_EXTERN`:31,
  `UE_DEFINE_GAMEPLAY_TAG_COMMENT`:36, `UE_DEFINE_GAMEPLAY_TAG`:41,
  `UE_DEFINE_GAMEPLAY_TAG_STATIC`:46; `FNativeGameplayTag`:58.
- `Classes/GameplayTagAssetInterface.h` — `IGameplayTagAssetInterface`:19,
  `GetOwnedGameplayTags`:28, `HasMatchingGameplayTag`:38,
  `HasAllMatchingGameplayTags`:48, `HasAnyMatchingGameplayTags`:58.
- `Classes/GameplayTagsSettings.h` — `UGameplayTagsSettings`:103, `FastReplication`:129,
  `GameplayTagTableList`:145.

Official docs (UE 5.7):
- Gameplay Tags — <https://dev.epicgames.com/documentation/unreal-engine/using-gameplay-tags-in-unreal-engine>
- Gameplay Systems — <https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>

Deep-dive references in this skill:
- [references/native-tags.md](references/native-tags.md) — native tag macros, module
  registration timing, multi-module sharing, and the `FNativeGameplayTag` lifetime.
- [references/containers-and-queries.md](references/containers-and-queries.md) — container
  internals (explicit vs. parent tag arrays), query expression tree, net serialization,
  and performance guidance.
- [references/tag-driven-patterns.md](references/tag-driven-patterns.md) — tag-driven
  gameplay patterns: state machines, effect gating, ability gating (GAS integration),
  animation, and config/ini organisation.
