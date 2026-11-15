---
name: ue-statetree
description: >
  Build general-purpose StateTree logic in UE 5.9 - game flow, UI and cutscene sequencing,
  interactables, not only AI - on UStateTreeComponent (GameplayStateTree) or a custom
  UStateTreeSchema. Covers C++ tasks, conditions and evaluators (FStateTreeTaskCommonBase,
  instance data, Input/Output/Parameter binding categories), transitions and events,
  completion and the 5.9 state-selection rules (CompletedTransitionStatesCreateNewStates),
  delegate-driven tasks with weak execution contexts and FinishTask, linked and sub-trees,
  starting the tree late, building and testing a tree in code with FStateTreeCompiler, and
  editor-Python traps. Use for state machine / flow graph / hierarchical FSM work with
  StateTree, and on "set_state_tree crashes the editor", "Null assigned to TNotNull",
  "bConsideredForCompletion undeclared identifier" in a Game or Shipping target, a widget
  torn down every loop, a tree that never starts, or StateTree transitions written from
  Python.
metadata:
  engine-version: "5.9"
  category: systems
  aliases: "state tree, StateTree, hierarchical state machine, FSM, game flow, flow graph, UStateTreeComponent, StateTreeComponent, state_tree_ref"
---

# StateTree beyond AI (UE 5.9)

StateTree is a general hierarchical state machine: states hold **tasks** (do work, report
Running / Succeeded / Failed), **enter conditions** gate selection, **transitions** move between
states on completion, tick, events or delegates, and **evaluators / global tasks** feed data.
`ue-ai-and-navigation` covers the AI use (`UStateTreeAIComponent` on an AIController). This
skill covers the rest: a tree that sequences a game's flow, screens and cutscenes, written as
in a 48-hour UE 5.9 game-jam project (2026-11) whose whole game flow (title, intro, three
chapters, a final choice, two endings) ran on one `UStateTreeComponent`.

## When to use this skill

- A game-flow / screen-flow / cutscene-sequencing state machine on an actor.
- Writing C++ StateTree tasks or conditions that wrap your own subsystem.
- A tree that behaves oddly on loops: tasks re-entered, widgets rebuilt, openers replayed.
- Editing StateTree assets or `StateTreeComponent` references from editor Python.
- A StateTree-using module that compiles in the editor and fails the Game / Shipping / web target.

## Mental model

1. **Nodes are structs, data lives in instance data.** A task struct is `const` at run time;
   everything that changes lives in its `FInstanceDataType` struct, fetched with
   `Context.GetInstanceData(*this)`. Never store run state in the node struct.
2. **The schema decides what a tree may contain** and what context it gets.
   `UStateTreeComponentSchema` (GameplayStateTree) gives an Actor context; a custom
   `UStateTreeSchema` can allow only your nodes and no context. Deriving nodes from the
   `*CommonBase` structs makes them legal under both.
3. **The subsystem holds the truth, the tree sequences.** Keep game state in a subsystem or
   component; nodes read and drive it. Then the tree can be restarted, resumed from a save, or
   replaced without losing state.
4. **Completion is a transition trigger.** A state completes when its tasks considered for
   completion finish; `OnStateCompleted` / `OnStateSucceeded` / `OnStateFailed` transitions fire
   then. A task that never completes and is excluded from completion runs "in the background"
   (a widget, a music bed).
5. **Completed states are re-created.** With the default selection rules
   (`EStateTreeStateSelectionRules::Default` includes `CompletedTransitionStatesCreateNewStates`;
   `None` is labelled "Previous (UE 5.6) rules"), a completed state that a transition selects again
   is new: its tasks get `ExitState` then `EnterState` (change type Changed).
   `bShouldStateChangeOnReselect = false` does not prevent this; it only covers the Sustained case.

## Setup

- Plugins: `StateTree` and `GameplayStateTree` (component and component schema); the jam also
  enabled `PropertyBindingUtils`. Restart the editor after enabling them.
- `Build.cs`: runtime modules `"StateTreeModule"`, `"GameplayStateTreeModule"` (plus
  `"GameplayTags"` when you send or match events by tag).
  `"StateTreeEditorModule"` (and `"PropertyBindingUtils"`) only for editor targets, and only if you
  build or compile trees in code (tests).
- The runtime modules start no threads and cooked and ran in a Wasm (browser) build. (jam)

## C++ patterns

### A task with parameters and outputs

```cpp
#include "StateTreeTaskBase.h"
#include "StateTreeExecutionContext.h"

USTRUCT()
struct FMyShowScreenTaskInstanceData
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, Category = "Parameter")   // set in the asset or bound
    TSoftClassPtr<UUserWidget> WidgetClass;

    UPROPERTY(EditAnywhere, Category = "Input")       // must be bound
    int32 ZOrder = 10;

    UPROPERTY(VisibleAnywhere, Category = "Output")   // other nodes can bind to it
    TObjectPtr<UUserWidget> Widget = nullptr;
};

USTRUCT(meta = (DisplayName = "Show Screen", Category = "MyGame"))
struct FMyShowScreenTask : public FStateTreeTaskCommonBase
{
    GENERATED_BODY()
    using FInstanceDataType = FMyShowScreenTaskInstanceData;

    FMyShowScreenTask()
    {
        bShouldCallTick = false;                    // event-driven, no Tick
        bShouldCopyBoundPropertiesOnTick = false;
        bShouldStateChangeOnReselect = false;       // keep the widget on a sustained reselect
#if WITH_EDITORONLY_DATA
        bConsideredForCompletion = false;           // runs in the background; others end the state
        bCanEditConsideredForCompletion = false;
#endif
    }

    virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
    virtual EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
    virtual void ExitState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult& Transition) const override;
};

EStateTreeRunStatus FMyShowScreenTask::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult&) const
{
    FInstanceDataType& Data = Context.GetInstanceData(*this);
    UWorld* World = Context.GetWorld();
    // ... create Data.Widget, add to viewport. A missing class must not stall the flow: log and keep running.
    return EStateTreeRunStatus::Running;
}
```

- Instance-data `UPROPERTY` categories are the binding contract: `Parameter` (set or optionally
  bound), `Input` (must be bound), `Output` (bindable by later nodes), `Context` (auto-bound from
  the schema). Read by `UE::StateTree::GetUsageFromMetaData`.
- **Give every node an instance data type**, even an empty `USTRUCT()`: in 5.9 a node without one
  failed compilation ("missing instance value"). (jam)
- **`bConsideredForCompletion` is `WITH_EDITORONLY_DATA`.** It feeds the completion mask baked into
  the asset at compile time. Set it unguarded and the editor builds, but the Game, Shipping and Wasm
  targets fail with `error C2065: 'bConsideredForCompletion': undeclared identifier`. Guard it, and
  build a non-editor target early. (jam; same declaration in 5.8)

### A task that completes from a delegate

```cpp
EStateTreeRunStatus FMyWaitForActionTask::EnterState(FStateTreeExecutionContext& Context, const FStateTreeTransitionResult&) const
{
    FInstanceDataType& Data = Context.GetInstanceData(*this);
    UMyFlowSubsystem* Flow = ResolveFlow(Context);
    if (!Flow) { return EStateTreeRunStatus::Failed; }
    if (Flow->HasAlreadyHappened()) { return EStateTreeRunStatus::Succeeded; }   // never wait for a past event

    const FStateTreeWeakExecutionContext Weak = Context.MakeWeakExecutionContext();
    Data.Handle = Flow->OnActionNative.AddLambda([Weak]()
    {
        const FStateTreeStrongExecutionContext Strong = Weak.MakeStrongExecutionContext();
        if (FInstanceDataType* Ptr = Strong.GetInstanceDataPtr<FInstanceDataType>())
        {
            Strong.FinishTask(EStateTreeFinishTaskType::Succeeded);
        }
    });
    Data.Flow = Flow;
    return EStateTreeRunStatus::Running;
}
// ExitState: Data.Flow->OnActionNative.Remove(Data.Handle);
```

- Capture a `FStateTreeWeakExecutionContext`, never the context or instance-data reference: the
  state may have exited before the delegate fires.
- **Check the condition on enter as well.** An event that fired before the task entered (while a
  cutscene played, for example) is never broadcast again; in the jam a run hung on a screen until
  the wait finished at once when the state it waited for already held.
- One action may fire several delegates: let the first one finish the task and ignore the rest.

### Condition

```cpp
USTRUCT(meta = (DisplayName = "Beat Is", Category = "MyGame"))
struct FMyBeatIsCondition : public FStateTreeConditionCommonBase
{
    GENERATED_BODY()
    using FInstanceDataType = FMyBeatIsConditionInstanceData;
    virtual const UStruct* GetInstanceDataType() const override { return FInstanceDataType::StaticStruct(); }
    virtual bool TestCondition(FStateTreeExecutionContext& Context) const override;

    UPROPERTY(EditAnywhere, Category = "Parameter")
    bool bInvert = false;
};
```

Evaluators derive from `FStateTreeEvaluatorCommonBase` (`TreeStart`, `Tick`, `TreeStop`).
Editor descriptions: override `GetDescription(...)` inside `#if WITH_EDITOR`.

### Custom schema (trees without an actor, tests, C++ drivers)

```cpp
UCLASS(meta = (DisplayName = "My Flow"))
class UMyFlowStateTreeSchema : public UStateTreeSchema
{
    GENERATED_BODY()
    virtual bool IsStructAllowed(const UScriptStruct* InScriptStruct) const override;  // allow the *CommonBase families
    virtual bool IsClassAllowed(const UClass* InClass) const override;                  // allow the Blueprint node bases
    virtual bool IsExternalItemAllowed(const UStruct& InStruct) const override { return false; }
};
```

Run it with `FStateTreeExecutionContext Exec(*Owner, *Tree, InstanceData)` then `Exec.Start()` and
`Exec.Tick(DeltaTime)`; the owner can be any `UObject` (a subsystem).

## Tree shape for game flow

```
Flow
  Start           Start Run (resumes a loaded save)
                    [Beat Is Chapter] -> Play ; [Beat Is Ending] -> Ending ; else -> Intro
  Intro           Enter Beat(Intro, LS_Intro)              -> Chapters
  Chapters        Show Screen(WBP_HUD)                     (parent: up once for all children)
    Chapter1      Enter Beat(Chapter1)                     -> Play
    Play          Wait For Player Action
                    [Final Choice Made] -> Ending ; [Beat Is Chapter2, opener pending] -> Chapter2 ; else -> Play
  Ending
    Win    enter [Result Win]   Enter Beat(Ending, LS_Win)  -> Succeeded
    Lose   enter [Result Lose]  Enter Beat(Ending, LS_Lose) -> Failed
```

- **Widgets on parents, loops in children.** Under the 5.9 rules a looping child that completes is
  re-created every time; a widget task on that same state would be torn down and rebuilt after every
  player action (open tabs, selection and a drag in progress lost). On the parent it stays up.
- **One-shot content must be idempotent.** A state with "Enter Beat" looping to itself entered the
  beat 31 times in 6 ticks in a test. Record "opener played" in the subsystem and make the task a
  no-op the second time; gate the transitions into opener states with "only if pending".
- **Route resumes in the first state.** A loaded save can be mid-flow; transitions cannot go
  backwards, so `Start` routes to the right state.
- Movement between beats goes through the subsystem's public API so every listener sees each step.

## Starting, holding and replacing the tree

- `UStateTreeComponent::SetStartLogicAutomatically(false)` (call before `BeginPlay`, for example in
  the game mode's `StartPlay` before `Super::StartPlay`) holds the tree behind a title screen;
  later `SetStartLogicAutomatically(true)` then `StartLogic()`.
- `SetStateTree` / `SetStateTreeReference` are ignored while the logic runs.
- `StateTreeRef` is protected and has no public getter in 5.9; read it by reflection
  (`FindFProperty<FStructProperty>(UStateTreeComponent::StaticClass(), TEXT("StateTreeRef"))`) if
  you must check that a placed component has a tree. The jam logged a warning and assigned a
  fallback tree from code when a placed component's reference was empty.
- Events: `SendStateTreeEvent(FStateTreeEvent)` (tag, optional payload, origin) for `OnEvent`
  transitions; `GetStateTreeRunStatus()` and `OnStateTreeRunStatusChanged` for the end state.
- Linked trees: a state of type `Linked` (a subtree in the same asset) or `LinkedAsset` (another
  asset); `AddLinkedStateTreeOverrides(Tag, Ref)` swaps a linked asset at run time.

## Editor Python: what works and what kills the editor

- **Never call `StateTreeComponent.set_state_tree()` on a Blueprint component template** (a
  template reached through `SubobjectDataSubsystem`): the editor fatals with
  `Null assigned to TNotNull`. Write the
  reference property instead, on the template **and** on placed instances (a placed copy kept
  `None` after a Blueprint recompile): (jam)

  ```python
  ref = comp.get_editor_property("state_tree_ref")
  ref.import_text('(StateTree="/Game/Flow/ST_Flow.ST_Flow",Parameters=(Value=None),PropertyOverrides=)')
  comp.set_editor_property("state_tree_ref", ref)
  ```

- **Transitions** (`FStateTreeTransition`, editor-only data on `UStateTreeState`) have no
  script-callable "add transition"; the C++ `AddTransition` is not a `UFUNCTION`. The jam wrote them
  with `StateTreeTransition.import_text` (a fresh transition ID per transition, the target state's
  `ID`, `LinkType=GotoState`); writing the result into the state's `transitions` array is the
  remaining step:

  ```python
  t = unreal.StateTreeTransition()
  t.import_text('(Trigger=OnStateCompleted,State=(Name="Investigate",ID=%s,LinkType=GotoState),ID=%s)'
                % (target_state.get_editor_property("id").to_string(),
                   unreal.GuidLibrary.new_guid().to_string()))   # not unreal.Guid(): that is all zeros
  ts = list(state.get_editor_property("transitions")); ts.append(t)
  state.set_editor_property("transitions", ts)                  # write a new list back
  ```

  Then mark the asset modified and compile it. Transition conditions were added with a third-party
  tool in the jam; the engine route is untested (see *Unverified*).
- `UStateTree::EditorData` is a bare `UPROPERTY()` under `WITH_EDITORONLY_DATA`, so
  `tree.get_editor_property("editor_data")` fails. `UStateTreeEditorData::GetEditorData(StateTree)`
  is `BlueprintCallable`; Epic's 5.9 StateTreeToolset reaches the data through it.
- **Epic's StateTreeToolset (5.9, experimental)** wraps the editing API as AI tools: `compile`,
  `get_editor_data`, `get_root_states`, `get_all_states`, `get_children`, `get_tasks`,
  `get_transitions`, `add_child_state`, `add_task`, `add_enter_condition`, `add_global_task`,
  `add_evaluator`, `set_node_instance_data`, ... It cannot create a StateTree asset with a schema
  (`UStateTreeFactory::SetSchemaClass` is not a `UFUNCTION`) and has no transition writer.

## Testing a tree in code

Editor-only tests can build a tree with `UStateTreeEditorData`, compile it with `FStateTreeCompiler`
and run it with `FStateTreeExecutionContext` and `EStateTreeRecordTransitions::Yes`, without any
asset or world. The jam's suite ran a full game ten times per seed this way. Pattern, helpers and
what to assert: [references/build-and-test-in-code.md](references/build-and-test-in-code.md).

## Gotchas

- Run state in the node struct instead of instance data: shared by every instance, and the node is
  `const` at run time anyway.
- A task that waits for an event that already happened waits forever. Check on enter.
- Expecting `bShouldStateChangeOnReselect = false` to keep a looping state alive: completed states
  are re-created in 5.9 regardless. Move the persistent task to a parent.
- An editor-only member (`bConsideredForCompletion`) set unguarded: editor builds, game targets fail.
- `SetStateTree` while running: ignored. Hold the logic, set, then start.
- A widget task on a missing class should log and keep running; a missing UI must not stall the flow.
- `set_state_tree()` on a Blueprint template from Python: editor crash. Use `import_text`.

## Unverified

- The array write-back above (`set_editor_property("transitions", ...)`): the jam notes record the
  `import_text` form only. In a headless 5.9 editor that `import_text` call returned `True` and the
  transition exported back with the trigger, target and IDs set, `unreal.GuidLibrary.new_guid()`
  returned a non-zero guid and `unreal.Guid()` all zeros; writing the array into a real state and
  compiling was not run.
- Adding transition conditions from Python with engine API only (`UStateTreeState` has
  `AddEnterCondition` as a `UFUNCTION`, transitions have no equivalent; the jam used a third-party
  plugin).
- `unreal.StateTreeEditorData.get_editor_data(tree)` from a plain script: the function exists in
  5.9 Python (checked in a headless editor) and Epic's toolset calls it; it was not called on a tree.
- Whether `set_state_tree()` is also fatal on a placed (non-template) component in the editor world.

## References & source material

Engine source (UE 5.9):

- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeTaskBase.h` — `FStateTreeTaskCommonBase`, flags, editor-only `bConsideredForCompletion`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeConditionBase.h` — `FStateTreeConditionCommonBase::TestCondition`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeEvaluatorBase.h` — `TreeStart`, `Tick`, `TreeStop`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeNodeBase.h` — `GetInstanceDataType`, `GetDescription`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeExecutionContext.h` — `GetInstanceData`, `MakeWeakExecutionContext`, `SendEvent`, `TNotNull` owner
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeAsyncExecutionContext.h` — weak / strong contexts, `FinishTask`, `GetInstanceDataPtr`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeTypes.h` — `EStateTreeStateSelectionRules`, `EStateTreeTransitionTrigger`, `EStateTreeStateType`, `EStateTreePropertyUsage`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeSchema.h` — `IsStructAllowed`, `IsClassAllowed`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeReference.h` — `FStateTreeReference` (`StateTree`, `Parameters`, `PropertyOverrides`)
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTreeEvents.h` — `FStateTreeEvent`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeModule/Public/StateTree.h` — `EditorData` (editor-only, not script-visible)
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeEditorModule/Public/StateTreeState.h` — `FStateTreeTransition`, `UStateTreeState::Transitions`, `AddTransition` (C++ only)
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeEditorModule/Public/StateTreeEditorData.h` — `GetEditorData`
- `Engine/Plugins/Runtime/StateTree/Source/StateTreeEditorModule/Public/StateTreeCompiler.h` — `FStateTreeCompiler`
- `Engine/Plugins/Runtime/GameplayStateTree/Source/GameplayStateTreeModule/Public/Components/StateTreeComponent.h` — `SetStateTree`, `SetStateTreeReference`, `SetStartLogicAutomatically`, `SendStateTreeEvent`, `StateTreeRef`
- `Engine/Plugins/Runtime/GameplayStateTree/Source/GameplayStateTreeModule/Public/Components/StateTreeComponentSchema.h` — the component schema

Epic's 5.9 StateTreeToolset (Python): `Engine/Plugins/Experimental/Toolsets/StateTreeToolset/Content/Python/state_tree_toolset/state_tree.py`.

Related skills: `ue-ai-and-navigation` (StateTree for AI), `ue-subsystems` (where flow state lives),
`ue-automation-and-testing`, `ue-sequencer-and-cinematics` (sequences the flow plays).
