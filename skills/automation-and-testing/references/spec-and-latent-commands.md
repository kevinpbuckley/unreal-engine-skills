# Spec tests & latent commands — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `BeforeEach`/`AfterEach` scoping,
parameterized tests, async execution, latent completion, the `Redefine` mechanism,
and the lower-level `ADD_LATENT_AUTOMATION_COMMAND` API. Grounded in UE 5.7
(`Runtime/Core/Public/Misc/AutomationTest.h`).

## How `Define()` works

When the framework first encounters a spec, it calls `Define()` once to collect all
`Describe`, `It`, `BeforeEach`, and `AfterEach` blocks. No test code runs at that
point. After `Define()` finishes, each `It` becomes an independent test whose
execution chain is: all inherited `BeforeEach` blocks (outer scope first, inner
last) → the `It` block → all inherited `AfterEach` blocks (inner first, outer last).
Running `It` tests in isolation is safe by design.

## `BeforeEach` and `AfterEach` scoping rules

Setup/teardown hooks respect `Describe` scope: a `BeforeEach` defined inside a
`Describe` runs only for `It` blocks in that same scope or a nested one. Outer
`BeforeEach` blocks always run before inner ones; inner `AfterEach` blocks run before
outer ones.

```cpp
void FMySpec::Define()
{
    // outer setup — runs for ALL It blocks in the spec
    BeforeEach([this]() { Counter = 0; });

    Describe("with a positive seed", [this]()
    {
        // inner setup — runs only for It blocks inside this Describe
        BeforeEach([this]() { Counter = 1; });

        It("should be 1", [this]()
        {
            TestEqual(TEXT("Counter"), Counter, 1); // outer then inner ran
        });
    });

    It("should be 0", [this]()
    {
        TestEqual(TEXT("Counter"), Counter, 0); // only outer ran
    });
}
```

Multiple `BeforeEach` / `AfterEach` calls at the same scope level run in definition
order.

## Parameterized tests

Generate `It` calls in a loop inside `Define` to drive one test body with many inputs.
Each iteration produces a separately named, independently executable test:

```cpp
void FMathSpec::Define()
{
    const TArray<TTuple<int32, int32, int32>> Cases =
    {
        {1, 2, 3}, {0, 0, 0}, {-1, 1, 0}
    };

    Describe("addition", [this, Cases]()
    {
        for (const auto& [A, B, Expected] : Cases)
        {
            It(FString::Printf(TEXT("should compute %d + %d = %d"), A, B, Expected),
               [this, A, B, Expected]()
            {
                TestEqual(TEXT("Sum"), A + B, Expected);
            });
        }
    });
}
```

Capture loop variables by value (not reference) to avoid dangling captures.

## Async execution

Pass an `EAsyncExecution` value to run a block on a specific thread/pool:

```cpp
It("should process on thread pool", EAsyncExecution::ThreadPool, [this]()
{
    // runs on a thread-pool thread; assertions are still routed to the test
    TestTrue(TEXT("Data valid"), MySystem->IsValid());
});

BeforeEach(EAsyncExecution::TaskGraph, [this]()
{
    // set up on the task graph
});
```

Blocks still execute in guaranteed sequential order regardless of which thread runs
each one. Async execution is combinable with latent completion.

## Latent completion

`LatentIt`, `LatentBeforeEach`, and `LatentAfterEach` accept a `const FDoneDelegate&`
parameter. The framework will not advance to the next block until the delegate is
invoked:

```cpp
LatentIt("should complete an async query", [this](const FDoneDelegate& Done)
{
    MyService->QueryAsync([this, Done](const TArray<FItem>& Items)
    {
        TestEqual(TEXT("Item count"), Items.Num(), 3);
        Done.Execute();  // signal completion
    });
});
```

A timeout can be supplied as the second argument (default is 30 s). If the done
delegate is not executed within the timeout, the test fails. Latent blocks can also
specify `EAsyncExecution`.

## `Redefine`

Calling `Redefine()` on a spec instance re-runs the `Define()` pass, regenerating the
full test list. This is useful when `Define()` reads from external data that can
change at runtime (for example, a configuration file that specifies test cases). Wire
a file-change listener to call `Redefine()` so parameterized tests stay up to date
without restarting the editor.

## Disabling blocks

Every `Describe`, `It`, `BeforeEach`, and `AfterEach` has a disabled variant with an
`x` prefix (`xDescribe`, `xIt`, `xBeforeEach`, `xAfterEach`). Disabling a `Describe`
disables everything inside it. This is cleaner than commenting out code during
iteration.

## Lower-level latent commands (`ADD_LATENT_AUTOMATION_COMMAND`)

For simple/complex automation tests (not specs), multi-frame work is queued with
`ADD_LATENT_AUTOMATION_COMMAND`. Each command's `Update()` is called once per frame;
returning `false` defers to the next frame, and `true` signals completion:

```cpp
// Define a command (one-shot parameter variant):
DEFINE_LATENT_AUTOMATION_COMMAND_ONE_PARAMETER(FWaitFramesCommand, int32, FrameCount);

bool FWaitFramesCommand::Update()
{
    if (--FrameCount > 0) return false;   // not done yet
    return true;
}

// Use it inside RunTest:
bool FMyTest::RunTest(const FString&)
{
    ADD_LATENT_AUTOMATION_COMMAND(FWaitFramesCommand(5));
    // subsequent latent commands are queued; they run after the above finishes
    return true;
}
```

Key macros (all in `AutomationTest.h`):
- `DEFINE_LATENT_AUTOMATION_COMMAND(Name)` — no parameters.
- `DEFINE_LATENT_AUTOMATION_COMMAND_ONE_PARAMETER(Name, Type, Param)` — one parameter.
- `ADD_LATENT_AUTOMATION_COMMAND(Constructor)` — enqueues an instance.
- `UE_RETURN_ON_ERROR(Condition, Message)` — record error and early-out from `RunTest`.

## Source citations (UE 5.7)

`Runtime/Core/Public/Misc/AutomationTest.h`:
- `FAutomationSpecBase`:2885 — spec base class.
- `Describe`:2743, `xDescribe`:2737 — scope definition.
- `BeforeEach`:2807, `AfterEach`:2812 — setup/teardown.
- `It`:2775, `LatentIt` (overload at :3373, :3382, :3391).
- `IAutomationLatentCommand`:524 — latent command base.
- `DEFINE_LATENT_AUTOMATION_COMMAND`:3779.
- `ADD_LATENT_AUTOMATION_COMMAND`:4070.
- `UE_RETURN_ON_ERROR`:80.
