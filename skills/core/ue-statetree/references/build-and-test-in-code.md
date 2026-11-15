# Building and testing a StateTree in code (UE 5.9)

A StateTree can be built, compiled and run inside an automation test with no asset, no world and
no actor. A 48-hour UE 5.9 game-jam project (2026-11) tested its whole game flow this way: ten
winning runs, a losing run, resumes from three save points and a loop-regression case, all as
`Automation RunTests` in a headless editor. The same shape as the shipping tree, so a failure in the
test is a failure in the game.

## Requirements

- Editor-only: `UStateTreeEditorData`, `UStateTreeState::AddTask/AddTransition`, `FStateTreeCompiler`
  live in `StateTreeEditorModule`. Add it (and `PropertyBindingUtils`) to `PrivateDependencyModuleNames`
  only when `Target.bBuildEditor`, and wrap the test file in `#if WITH_EDITOR` /
  `#if WITH_DEV_AUTOMATION_TESTS`. Tests that only touch your runtime nodes or subsystem can stay
  outside the editor guard.
- A schema that allows your nodes and needs no context (a custom `UStateTreeSchema` returning
  `false` from `IsExternalItemAllowed`), so the owner can be any `UObject`, such as the subsystem
  the nodes drive.

## Build and compile

```cpp
#if WITH_EDITOR
#include "StateTree.h"
#include "StateTreeCompiler.h"
#include "StateTreeCompilerLog.h"
#include "StateTreeEditorData.h"
#include "StateTreeExecutionContext.h"
#include "StateTreeInstanceData.h"
#include "StateTreeState.h"

UStateTreeEditorData& NewTree(TStrongObjectPtr<UStateTree>& OutTree)
{
    UStateTree* Tree = NewObject<UStateTree>(GetTransientPackage());
    OutTree.Reset(Tree);                                   // keep it alive across GC in a latent test
    UStateTreeEditorData* Editor = NewObject<UStateTreeEditorData>(Tree);
    Tree->EditorData = Editor;
    Editor->Schema = NewObject<UMyFlowStateTreeSchema>(Editor);
    return *Editor;
}

bool CompileTree(FAutomationTestBase& Test, UStateTree& Tree)
{
    FStateTreeCompilerLog Log;
    FStateTreeCompiler Compiler(Log);
    const bool bOk = Compiler.Compile(Tree);
    if (!bOk)
    {
        for (const FStateTreeCompilerLogMessage& Message : Log.GetMessages())
        {
            Test.AddError(FString::Printf(TEXT("StateTree compile: %s"), *LexToString(Message)));
        }
    }
    return bOk;
}

// shape
UStateTreeState& Root  = Editor.AddSubTree(TEXT("Flow"));
UStateTreeState& Start = Root.AddChildState(TEXT("Start"));
UStateTreeState& Loop  = Root.AddChildState(TEXT("Investigate"));
Start.AddTask<FMyStartRunTask>().GetInstanceData().Seed = Seed;
FStateTreeTransition& T = Start.AddTransition(EStateTreeTransitionTrigger::OnStateCompleted,
                                              EStateTreeTransitionType::GotoState, &Loop);
T.AddConditionWithOuter<FMyBeatIsCondition>(&Start).GetInstanceData().bAnyReel = true;
Loop.AddTask<FMyWaitForActionTask>();
Loop.AddTransition(EStateTreeTransitionTrigger::OnStateCompleted, EStateTreeTransitionType::GotoState, &Loop);
Win.AddEnterCondition<FMyResultCondition>().GetInstanceData().Outcome = EMyOutcome::Win;
Win.AddTransition(EStateTreeTransitionTrigger::OnStateCompleted, EStateTreeTransitionType::Succeeded);
#endif
```

`AddConditionWithOuter` takes the owning state in 5.8+ (the overload without it is deprecated).

## Run and record

```cpp
FStateTreeInstanceData InstanceData;
FStateTreeExecutionContext Exec(*Owner, *Tree, InstanceData, FOnCollectStateTreeExternalData(),
                                EStateTreeRecordTransitions::Yes);
check(Exec.IsValid());
EStateTreeRunStatus Status = Exec.Start();
while (Status == EStateTreeRunStatus::Running && Ticks++ < MaxTicks)
{
    const TArray<FName> Active = Exec.GetActiveStateNames();
    if (Active.Num() > 0 && Active.Last() == TEXT("Investigate")) { PlayOneAction(*Owner); }
    Status = Exec.Tick(0.1f);
}
for (const FRecordedStateTreeTransitionResult& R : Exec.GetRecordedTransitions())
{
    if (R.States.Num() > 0)
    {
        if (const FCompactStateTreeState* S = Exec.GetStateFromHandle(R.States.Last().State))
        {
            ++EnteredCount.FindOrAdd(S->Name);   // includes states a single tick passed through
        }
    }
}
Exec.Stop();
```

- Recorded transitions name every state entered, including ones a single tick passes through;
  `GetActiveStateNames()` after the tick misses those.
- Drive the player from the test (one action per tick when the leaf is a waiting state), never from
  timers.

## What to assert (each one caught a real bug in the jam)

- The tree ends with the expected status (Succeeded for a win, Failed for a loss) within a tick budget.
- **Enter counts:** each one-shot state is entered once; a persistent task (HUD, bench) gets exactly
  one `EnterState` and one `ExitState` for a whole looping phase. Count them with test-only
  subclasses of your tasks (`USTRUCT(meta = (Hidden))`, override `EnterState`/`ExitState`, bump a
  static counter, call the base).
- **Once-only content:** a beat's opener plays once per run however often its state is re-entered.
- **Resume:** apply a save to a fresh subsystem and run the tree; earlier states are never visited
  and no opener replays.
- **Loop regression:** keep a test for the first-draft shape that misbehaved (a state looping to
  itself on an opener task re-entered it 31 times in 6 ticks) and assert the guard holds.

## Engine source (UE 5.9)

- `Engine/Plugins/Runtime/StateTree/Source/StateTreeEditorModule/Public/StateTreeCompiler.h`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeEditorModule/Public/StateTreeCompilerLog.h`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeEditorModule/Public/StateTreeEditorData.h` — `AddSubTree`, `Schema`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeEditorModule/Public/StateTreeState.h` — `AddChildState`, `AddTask`, `AddTransition`, `AddEnterCondition`, `AddConditionWithOuter`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeExecutionContext.h` — `Start`, `Tick`, `Stop`, `GetActiveStateNames`, `GetRecordedTransitions`, `GetStateFromHandle`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeInstanceData.h` — `FStateTreeInstanceData`
