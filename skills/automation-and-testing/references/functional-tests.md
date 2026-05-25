# Functional tests — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `AFunctionalTest` lifecycle,
C++ and Blueprint child-class authoring, Ground Truth Data, and common patterns.
Grounded in UE 5.7
(`Developer/FunctionalTesting/Classes/FunctionalTest.h`).

## `AFunctionalTest` lifecycle

The **Functional Testing Manager** (`AFunctionalTestingManager`) drives actors placed
in a dedicated test map through this sequence:

1. **`PrepareTest()`** — called once. Start any asynchronous setup here (stream a
   sublevel, connect to a server, build navmesh). The test will not advance until
   `IsReady_Implementation()` returns `true`.
2. **`IsReady_Implementation()`** — called each tick after `PrepareTest`. Return
   `false` while waiting for async setup. The `PreparationTimeLimit` property caps
   how long the test waits (0 = no limit).
3. **`StartTest()` / `OnTestStart` delegate** — main test body begins. Always call
   `FinishTest` at the end (or after any async completion).
4. **`FinishTest(EFunctionalTestResult, Message)`** — signals the manager. Valid
   results are `Succeeded`, `Failed`, `Error`, or `Default` (let assertions decide).
5. **`OnTestFinished` delegate** — cleanup pass. Restore the level to a clean state
   so the next test starts fresh.
6. **`CleanUp()`** — called after all cycles complete (if `WantsToRunAgain()` is used
   for multi-cycle tests).

`TimeLimit` (0 = none) bounds the time between `StartTest` and `FinishTest`. If it
expires, the result is set to `TimesUpResult` (default `Failed`). Always set a
reasonable timeout in CI maps.

## C++ child class pattern

```cpp
// UCLASS derives from AFunctionalTest;
// placed in a test map and driven by the manager automatically

UCLASS()
class MYGAME_API AAbilityFunctionalTest : public AFunctionalTest
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, Category="Test Setup")
    TSubclassOf<AMyCharacter> CharacterClass;

    TObjectPtr<AMyCharacter> TestChar;

protected:
    virtual void PrepareTest() override
    {
        Super::PrepareTest();
        FActorSpawnParameters Params;
        Params.SpawnCollisionHandlingOverride =
            ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
        TestChar = GetWorld()->SpawnActor<AMyCharacter>(
            CharacterClass, FVector::ZeroVector, FRotator::ZeroRotator, Params);
        AddActorToDestroyOnTestEnd(TestChar);   // auto-cleanup
    }

    virtual bool IsReady_Implementation() override
    {
        return IsValid(TestChar);   // wait until spawn completes
    }

    virtual void StartTest() override
    {
        Super::StartTest();
        AssertIsValid(TestChar, TEXT("Character was spawned"));
        TestChar->ActivateAbility(TEXT("Sprint"));
        AssertTrue(TestChar->IsSprinting(), TEXT("Sprint is active"));
        FinishTest(EFunctionalTestResult::Succeeded, TEXT("OK"));
    }
};
```

- `AddActorToDestroyOnTestEnd(Actor)` (registered via `AutoDestroyActors` property
  in the base class) ensures spawned actors are removed after the test.
- `LogStep(ELogVerbosity::Log, Message)` writes to `LogFunctionalTest` and is
  collected in the test report.
- Use `AssertTrue` / `AssertFalse` / `AssertIsValid` / `AssertEqual_Float` (the
  `AFunctionalTest` assert family) — these call `FinishTest(Failed)` internally on
  failure. Do **not** mix in `FAutomationTestBase::TestTrue`, which has no reference
  to the functional test's state.

## Assertion API (`AFunctionalTest`)

| Function | Notes |
|---|---|
| `AssertTrue(Condition, Message)` | fails and stops test on false |
| `AssertFalse(Condition, Message)` | fails and stops test on true |
| `AssertIsValid(Object, Message)` | fails if object is null/invalid |
| `AssertValue_Int(Actual, Op, Expected, What)` | integer comparison with `EComparisonMethod` |
| `AssertValue_Float(Actual, Op, Expected, What)` | float comparison |
| `AssertEqual_Float(Actual, Expected, What, Tolerance)` | float equality with tolerance |
| `AssertEqual_Transform(Actual, Expected, What, Tol)` | component-wise transform equality |
| `AddError(Message)` | record error without stopping |

`EComparisonMethod` values: `Equal_To`, `Not_Equal_To`, `Greater_Than`, `Less_Than`,
`Greater_Than_Or_Equal_To`, `Less_Than_Or_Equal_To`.

## Blueprint functional test

In a Blueprint child of `AFunctionalTest`:
1. Override `PrepareTest` (if setup is needed) and `IsReady` (BlueprintImplementable).
2. Bind to the `OnTestStart` event in the class's graph.
3. In the `OnTestStart` graph: do gameplay actions → call `Finish Test` node.
4. Bind to `OnTestFinished` to restore the level.

For simple Blueprint-only tests with no async setup, skip `PrepareTest`/`IsReady`
and just use `OnTestStart` + `Finish Test`.

## Ground Truth Data

`UGroundTruthData` (in the Functional Testing Editor plugin) stores a UObject as the
"correct" result of a test. On first run (when no truth exists) it saves the result;
on subsequent runs it compares. Reset by toggling `ResetGroundTruth` in the editor.
Use this for tests whose expected values are difficult to hand-author (physics
endpoints, render outputs, large data structures).

## Test maps and discovery

Place test maps in `Content/Tests/` and add the path to
`AutomationTestSettings.DefaultTestMaps` in `DefaultEditor.ini` so the Functional
Testing Manager discovers them. The Functional Testing Editor plugin must be enabled
for functional tests to appear in the Automation tab.

## Source citations (UE 5.7)

`Developer/FunctionalTesting/Classes/FunctionalTest.h`:
- `AFunctionalTest`:249 — base class declaration.
- `PrepareTest`:779 — virtual setup function.
- `IsReady` / `IsReady_Implementation`:814–816 — ready-check.
- `FinishTest`:678 — `(EFunctionalTestResult, FString)`.
- `AddError`:659 — non-fatal error record.
- `TimeLimit` / `PreparationTimeLimit`:358–362 — timeout properties.
- `AutoDestroyActors`:391 — list managed by `AddActorToDestroyOnTestEnd`.
- `EFunctionalTestResult`:195 — `Default`, `Invalid`, `Error`, `Running`, `Failed`,
  `Succeeded`.

`Developer/FunctionalTesting/Classes/FunctionalTest.h` also declares
`UAutomationPerformaceHelper`:99 for per-test frame-time and GPU-budget recording.
