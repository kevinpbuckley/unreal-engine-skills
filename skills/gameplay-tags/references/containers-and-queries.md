# Containers and Queries — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the dual-array container design,
every matching function with hierarchy semantics, `FGameplayTagQuery` internals, the
query expression builder API, net serialization, and performance guidance. Grounded in
UE 5.7 (`Engine/Source/Runtime/GameplayTags/Classes/GameplayTagContainer.h`).

## FGameplayTagContainer internals

`FGameplayTagContainer` (`GameplayTagContainer.h`:250) stores two parallel `TArray<FGameplayTag>`
members (both `UPROPERTY`):

| Member | Contains | Serialized |
|---|---|---|
| `GameplayTags` (`:625`) | Explicit tags — the ones you `AddTag` | Yes (`VisibleAnywhere, SaveGame`) |
| `ParentTags` (`:629`) | Implicit parent tags expanded from `GameplayTags` | No (`Transient`) |

`ParentTags` is populated by `FillParentTags()` (`:604`) after any mutation. It exists
purely for fast `HasTag`/`HasAny`/`HasAll` queries — those check both arrays rather
than walking the tag tree at query time (`:311`, `:345`, `:390`).

Because `ParentTags` is `Transient`, it is not saved to disk and must be rebuilt on
load. `PostScriptConstruct()` (`:547`) does this automatically for Blueprint-constructed
containers; `Serialize` handles it for C++ UObject serialization.

## Full matching API

### Container → Tag

| Function | Hierarchy? | Notes |
|---|---|---|
| `HasTag(Tag)` | Yes | True if `Tag` is in `GameplayTags` OR `ParentTags` |
| `HasTagExact(Tag)` | No | True only if `Tag` is in `GameplayTags` |

### Container → Container

| Function | Hierarchy? | Empty input returns |
|---|---|---|
| `HasAny(Other)` | Yes (source tag matched against both arrays) | `false` |
| `HasAnyExact(Other)` | No | `false` |
| `HasAll(Other)` | Yes | `true` (vacuous truth) |
| `HasAllExact(Other)` | No | `true` (vacuous truth) |

`HasAll` returning `true` for an empty `Other` is intentional and consistent with set
theory — "no tags are missing". Guard with `!Other.IsEmpty()` when you want the check
to be meaningful.

### Single tag → Tag/Container

| Function | Hierarchy? | Direction |
|---|---|---|
| `Tag.MatchesTag(Other)` | Yes | `Tag` is `Other` or a child of `Other` |
| `Tag.MatchesTagExact(Other)` | No | Exact `FName` equality |
| `Tag.MatchesAny(Container)` | Yes | `Tag` matches (or is child of) any in container |
| `Tag.MatchesAnyExact(Container)` | No | Exact match against any in container |

Hierarchy direction: `"A.B".MatchesTag("A")` → `true`; `"A".MatchesTag("A.B")` → `false`.

### Filtering

```cpp
// Returns subset of this container matching any in OtherContainer (hierarchy-aware):
FGameplayTagContainer Filtered = MyContainer.Filter(OtherContainer);

// Exact-match filter:
FGameplayTagContainer FilteredExact = MyContainer.FilterExact(OtherContainer);
```

### Query

```cpp
bool bMatches = Container.MatchesQuery(SomeQuery);  // delegates to FGameplayTagQuery::Matches
```

## FGameplayTagQuery internals

`FGameplayTagQuery` (`GameplayTagContainer.h`:738) stores three private fields:

- `TagDictionary` — deduplicated list of `FGameplayTag` values referenced by the query.
- `QueryTokenStream` — a `TArray<uint8>` bytecode stream encoding the expression tree.
- `UserDescription` / `AutoDescription` — human-readable strings for the editor.

The bytecode is evaluated at runtime by `FQueryEvaluator` (friend class) without
allocating. This makes `Matches` (`:804`) very fast for common cases.

### Building queries in C++

Fluid builder syntax using `FGameplayTagQueryExpression`:

```cpp
// "Has Damage.Fire but not State.Immune"
FGameplayTagQuery Q = FGameplayTagQuery::BuildQuery(
    FGameplayTagQueryExpression()
    .AllExprMatch()
    .AddExpr(FGameplayTagQueryExpression().AnyTagsMatch().AddTag(TAG_Damage_Fire))
    .AddExpr(FGameplayTagQueryExpression().NoTagsMatch() .AddTag(TAG_State_Immune))
);
```

Available expression types (`EGameplayTagQueryExprType`, `:692`):

| Type | Tests |
|---|---|
| `AnyTagsMatch` | At least one tag from the query is in the container (hierarchy) |
| `AllTagsMatch` | All tags in the query are in the container (hierarchy) |
| `NoTagsMatch` | None of the tags are in the container (hierarchy) |
| `AnyTagsExactMatch` | At least one tag — exact match only |
| `AllTagsExactMatch` | All tags — exact match only |
| `AnyExprMatch` | At least one sub-expression returns true |
| `AllExprMatch` | All sub-expressions return true |
| `NoExprMatch` | No sub-expression returns true |

Factory shortcuts for one-level queries (`GameplayTagContainer.h`:855):

```cpp
FGameplayTagQuery::MakeQuery_MatchAnyTags(Container)
FGameplayTagQuery::MakeQuery_MatchAllTags(Container)
FGameplayTagQuery::MakeQuery_MatchNoTags(Container)
FGameplayTagQuery::MakeQuery_ExactMatchAnyTags(Container)
FGameplayTagQuery::MakeQuery_ExactMatchAllTags(Container)
FGameplayTagQuery::MakeQuery_MatchTag(SingleTag)
```

### Replacing tags in a cached query

`ReplaceTagsFast` and `ReplaceTagFast` (`:788`, `:796`) swap tags in an existing query
without rebuilding the expression tree. Use this to avoid reallocating the byte stream
when you repeat the same logical condition against different tag sets:

```cpp
// Build once, reuse with different tags:
FGameplayTagQuery Q = FGameplayTagQuery::MakeQuery_MatchTag(InitialTag);
// Later, update the tag without rebuilding:
Q.ReplaceTagFast(NewTag);
```

## Net serialization

Both `FGameplayTag` and `FGameplayTagContainer` implement `NetSerialize`. The default
(slow) path sends the full `FName`. Enabling **Fast Replication** in Project Settings
(`UGameplayTagsSettings::FastReplication`, `GameplayTagsSettings.h`:129) sends a 16-bit
net index instead, which is much cheaper for containers with many tags. Fast replication
requires that the tag dictionary is identical on client and server.

**Dynamic replication** (`bDynamicReplication`, `:133`) sends indices per-connection and
tolerates tag mismatches between client and server at slightly higher per-connection cost.

`FGameplayTagNetIndex` is `uint16`; `INVALID_TAGNETINDEX` is `MAX_uint16`
(`GameplayTagContainer.h`:36-37).

## Performance guidance

- **Cache `FGameplayTag` values** from `RequestGameplayTag` — each call does a map lookup
  in `UGameplayTagsManager`. Native tags (`FNativeGameplayTag`) cache the value at
  construction and provide zero-cost access via `operator FGameplayTag()`.
- **Container queries are O(n)** in the number of explicit tags. Containers are typically
  small (< 20 tags), so this is fine; avoid containers with hundreds of tags.
- **`HasTag` is faster than iterating** — it uses the cached `ParentTags` array; never
  iterate the container manually to simulate `HasTag`.
- **`FGameplayTagQuery::Matches` is allocation-free** — the byte stream evaluator runs
  in-place. Prefer queries over hand-rolled boolean logic for readability and
  editor-authoring.
- **Avoid `ToString()` comparisons** — `FName` equality is an integer compare;
  string conversion defeats that.
