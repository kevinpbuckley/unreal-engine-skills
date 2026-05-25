# EQS deep dive

Deep dive for [../SKILL.md](../SKILL.md). Covers EQS generators, tests, contexts, run modes,
the C++ `FEnvQueryRequest` pattern, and the EQS Testing Pawn. Grounded in UE 5.7
(`Engine/Source/Runtime/AIModule/Classes/EnvironmentQuery/`).

## What EQS produces

An EQS query produces a list of **items** (locations or actors), each assigned a score
derived from one or more **tests**. The items are ranked and the caller receives the highest-
scoring item (or the full ranked list depending on run mode). The score takes into account
both test scoring and test filtering — items that fail a filter are discarded regardless of
score.

## Anatomy of a query

A `UEnvQuery` asset contains one or more **options**. Each option pairs a **generator** with
a list of **tests** applied to every item the generator produces. The first option whose
items survive all filter tests wins (options are tried in order).

### Generators

Generators produce the candidate items to test. Common built-in generators:

| Generator | Produces |
|---|---|
| `ActorsOfClass` | All actors of a given class visible in the world |
| `OnCircle` | Points arranged on a ring around a context |
| `Grid` | Points on a uniform grid around a context |
| `PathingGrid` | Like Grid but only on nav-reachable points |
| `CurrentLocation` | A single point — the querier's own location |

Headers live in `EnvironmentQuery/Generators/`. Create a custom generator by subclassing
`UEnvQueryGenerator` and overriding `GenerateItems`.

### Contexts

Contexts define **reference points** used by generators and tests. Built-ins:
- `UEnvQueryContext_Querier` — the actor that launched the query (usually the AI pawn).
- `UEnvQueryContext_Item` — each generated item (used in tests that measure item-relative
  values).

Custom contexts subclass `UEnvQueryContext` (`EnvironmentQuery/EnvQueryContext.h`) and
override `ProvideContext` to supply a location or actor array.

### Tests

Tests filter and score items. Each test has a `Purpose` (`EEnvTestPurpose`):
- `Filter Only` — discard items that fail; no score contribution.
- `Score Only` — score items; do not discard failures.
- `Filter and Score` (default) — both filter and score.

Common built-in tests: `Distance`, `Dot`, `Pathfinding` (can reach via nav mesh),
`LineOfSight`, `Overlap` (sphere/box overlap check), `Project` (project onto nav mesh).

Test headers live in `EnvironmentQuery/Tests/`. Custom tests subclass `UEnvQueryTest` and
override `RunTest`.

## Run modes

`EEnvQueryRunMode::Type` (in `EnvQueryTypes.h`):

| Mode | Returns |
|---|---|
| `SingleResult` | The single highest-scoring item. Fastest. |
| `RandomBest5Pct` | A random item from the top 5% of scores. Adds variety. |
| `RandomBest25Pct` | A random item from the top 25% of scores. |
| `AllMatching` | All items that pass filters, ordered by score. |

## C++ query pattern

```cpp
// In AIController or BT task:
// CoverQuery is a UPROPERTY(EditDefaultsOnly) TObjectPtr<UEnvQuery>

void AMyAIController::RequestCoverPosition()
{
    FEnvQueryRequest Request(CoverQuery, GetPawn()); // EnvQueryManager.h:80
    // Optional: override named parameters
    Request.SetFloatParam(TEXT("MinDistFromEnemy"), 500.f);

    // Execute async (preferred):
    Request.Execute(EEnvQueryRunMode::SingleResult, this,
        &AMyAIController::OnCoverQueryFinished);     // EnvQueryManager.h:97
}

void AMyAIController::OnCoverQueryFinished(TSharedPtr<FEnvQueryResult> Result)
{
    if (!Result.IsValid() || !Result->IsSuccessful())
        return;

    FVector BestPoint = Result->GetItemAsLocation(0);
    GetBlackboardComponent()->SetValueAsVector(TEXT("MoveToLocation"), BestPoint);
    MoveToLocation(BestPoint, 50.f);
}
```

For **synchronous** queries (use sparingly — blocks the game thread):
```cpp
TSharedPtr<FEnvQueryResult> Result =
    UEnvQueryManager::GetCurrent(GetWorld())
        ->RunInstantQuery(Request, EEnvQueryRunMode::SingleResult); // EnvQueryManager.h:238
```

To get the `UEnvQueryManager`:
```cpp
UEnvQueryManager* EQSManager = UEnvQueryManager::GetCurrent(GetWorld());
```
`UEnvQueryManager` is declared at `EnvQueryManager.h`:207.

## Running EQS from a Behavior Tree task

The built-in `UBTTask_RunEQSQuery` task handles this automatically — assign a `UEnvQuery`
asset, choose a `BlackboardKey` to write the result to, and select the run mode. For custom
logic (e.g. acting on the full ranked list), write a custom `UBTTaskNode` that calls
`FEnvQueryRequest::Execute` and returns `InProgress`, then calls `FinishLatentTask` from
the query callback.

## Blueprint-friendly API

`UEnvQueryManager::RunEQSQuery` (static, line 279) is a `BlueprintCallable` function that
returns a `UEnvQueryInstanceBlueprintWrapper`, which exposes a `GetResultsAsLocations`
function and a `OnQueryFinishedEvent` delegate for Blueprint binding.

## EQS Testing Pawn

`AEQSTestingPawn` (`EnvironmentQuery/EQSTestingPawn.h`) is a special pawn you drop into the
editor. While not in PIE, it runs the assigned query every time you select it and draws the
scored items as colored spheres in the viewport. Use this to iterate on query parameters
without entering PIE.

Enable the EQS testing pawn via Project Settings → AI → Enable EQS Editor.

## Enabling EQS

EQS requires explicit opt-in:
1. Project Settings → AI → Enable EQS (Editor) — enables the editor assets and Testing Pawn.
2. Project Settings → AI → EQS Manager → Max Simultaneous Queries — tune based on agent count.

## Performance notes

- Queries are async and spread over frames by default; the `UEnvQueryManager` budgets query
  steps per tick using the MaxAllowedTestingTime setting.
- `PathingGrid` generators are the most expensive (nav mesh queries per item); use a coarser
  grid or smaller radius when performance matters.
- Prefer `SingleResult` mode unless you need to inspect multiple items — it short-circuits
  scoring once the best candidate is found.
- Cancel pending queries using the `FEnvQueryRequest` handle (store the return value of
  `Execute` as an `int32` query ID and call `UEnvQueryManager::AbortQuery`).

## Version notes

EQS is stable across UE4 and UE5. The `FEnvQueryRequest` templated `Execute` API
(EnvQueryManager.h:96-106) has been present since UE 4.14. `EEnvQueryRunMode` values are
unchanged across UE5.
