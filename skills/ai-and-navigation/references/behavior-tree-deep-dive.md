# Behavior Tree deep dive

Deep dive for [../SKILL.md](../SKILL.md). Covers the BT execution model, node instancing,
task node memory, composite abort modes, decorator conditions, and service tick intervals.
Grounded in UE 5.7 (`Engine/Source/Runtime/AIModule/Classes/BehaviorTree/`).

## Execution model

The Behavior Tree ticks one active task at a time. Each tick, the tree re-evaluates
decorators from the root down to find which branch to enter. Execution flows left to right
within a composite, and the result of a completed task (Succeeded / Failed) propagates back
up to the composite parent.

**`EBTExecutionMode`** passed to `UBehaviorTreeComponent::StartTree`:
- `Looped` (default) — restarts from the root automatically after the tree finishes.
- `SingleRun` — stops when the tree returns a result once.

`UBehaviorTreeComponent::StartTree` and `RestartTree` are at `BehaviorTreeComponent.h`:137 /
146. `StopTree` accepts `EBTStopMode::Safe` (finishes the running task first) or `Forced`
(aborts immediately).

## Composites

| Composite | Behavior |
|---|---|
| **Selector** | Tries children left to right; succeeds when any child succeeds; fails only if all children fail. |
| **Sequence** | Runs children left to right; fails when any child fails; succeeds only if all succeed. |
| **SimpleParallel** | Runs a main task and a background sub-tree in parallel; completion policy configurable. |

Decorators on a composite gate the entire branch — if the decorator's condition is false, the
composite is skipped as if it returned its fail result.

## Node instancing model

By default, BT nodes are **not instanced** — a single `UObject` is shared across every
`UBehaviorTreeComponent` that uses the same tree asset. This is highly memory-efficient but
means you **must not** store per-AI runtime state in node member variables during `ExecuteTask`
or `TickTask` unless the node is explicitly instanced.

Store per-AI data in **NodeMemory** instead:
```cpp
struct FMyTaskMemory
{
    float ElapsedTime = 0.f;
    TWeakObjectPtr<AActor> CachedTarget;
};

uint16 UBTTask_MyTask::GetInstanceMemorySize() const
{
    return sizeof(FMyTaskMemory);
}

EBTNodeResult::Type UBTTask_MyTask::ExecuteTask(
    UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory)
{
    FMyTaskMemory* Mem = CastInstanceNodeMemory<FMyTaskMemory>(NodeMemory);
    Mem->ElapsedTime = 0.f;
    Mem->CachedTarget = OwnerComp.GetAIOwner()->GetBlackboardComponent()
        ->GetValueAsObject(TEXT("TargetActor"));
    // Set bNotifyTick = true via INIT_TASK_NODE_NOTIFY_FLAGS() in constructor to get TickTask.
    return EBTNodeResult::InProgress;
}
```

To allow state in node members (rare), add `bCreateNodeInstance = true` to the node's
constructor. Instanced nodes carry a small per-AI memory cost.

`GetInstanceMemorySize` and `CastInstanceNodeMemory` are declared in `BTNode.h`.

## Task lifecycle

1. `ExecuteTask` — called when the task becomes active. Return `Succeeded`/`Failed` for
   synchronous completion, or `InProgress` to keep the task running.
2. `TickTask` — called each tick if `bNotifyTick` is set (use `INIT_TASK_NODE_NOTIFY_FLAGS()`
   macro from `BTTaskNode.h` in the constructor to auto-detect overrides).
3. `FinishLatentTask(OwnerComp, Result)` — call from any context (timer, delegate) to
   conclude an in-progress task. `BTTaskNode.h`:80.
4. `AbortTask` — called when a decorator abort interrupts this task. Return `Aborted` for
   immediate cleanup or `InProgress` if cleanup is asynchronous; then call
   `FinishLatentAbort`.
5. `OnTaskFinished` — called after the task finishes (result known); used for cleanup.
   Enable with `bNotifyTaskFinished` / `INIT_TASK_NODE_NOTIFY_FLAGS()`.

## Decorators and abort modes

Decorators override `CalculateRawConditionValue(OwnerComp, NodeMemory) const` to return a
`bool`. Set `FlowAbortMode` (property in `BTDecorator.h`:98) to control re-evaluation:

| `EBTFlowAbortMode` | Meaning |
|---|---|
| `None` | Evaluated once when the branch is entered; not re-evaluated during execution. |
| `Self` | Re-evaluate while this branch is running; abort the branch if condition changes. |
| `LowerPriority` | Re-evaluate while a *lower priority* branch is running; if condition becomes true, abort that branch and run this one. |
| `Both` | Combination of Self and LowerPriority. |

Use `EBTDecoratorAbortRequest::ConditionResultChanged` (in `BTDecorator.h`) to request
re-evaluation only when the condition changes, reducing overhead.

## Services

Services (`UBTService`, `BTService.h`:34) run on a branch tick interval:
- `Interval` and `RandomDeviation` properties (lines 52-57) control how often `TickNode` is
  called. Set them in the constructor.
- `OnBecomeRelevant` — fired when the branch becomes active.
- `OnCeaseRelevant` — fired when the branch deactivates.
- `OnSearchStart` — called synchronously during the tree search (must be instant).

Example service pattern:
```cpp
UCLASS()
class UBTService_UpdateTarget : public UBTService
{
    GENERATED_BODY()
    UBTService_UpdateTarget() { Interval = 0.25f; RandomDeviation = 0.05f; }
protected:
    virtual void TickNode(UBehaviorTreeComponent& OwnerComp,
        uint8* NodeMemory, float DeltaSeconds) override
    {
        // Find nearest hostile, write to Blackboard.
        APawn* Enemy = FindNearestEnemy(OwnerComp.GetAIOwner()->GetPawn());
        if (UBlackboardComponent* BB = OwnerComp.GetBlackboardComponent())
            BB->SetValueAsObject(TEXT("TargetActor"), Enemy);
    }
};
```

## Blackboard observers (C++)

Register a callback that fires whenever a specific key changes:
```cpp
FBlackboard::FKey KeyID = BB->GetKeyID(TEXT("bCanSeePlayer")); // BlackboardComponent.h:58
FDelegateHandle Handle = BB->RegisterObserver(KeyID, this,
    FOnBlackboardChangeNotification::CreateUObject(
        this, &AMyCtrl::OnCanSeePlayerChanged));               // BlackboardComponent.h:73
// Unregister in EndPlay:
BB->UnregisterObserver(KeyID, Handle);
```

## BT asset setup checklist

1. Create a `UBlackboardData` asset and define all keys with their types.
2. Create a `UBehaviorTree` asset; assign the Blackboard asset in its Details.
3. Assign the `UBehaviorTree` to the `AIController` via an `EditDefaultsOnly` UPROPERTY.
4. Call `RunBehaviorTree(BehaviorTree)` in `OnPossess`.
5. Custom C++ nodes compile against `AIModule`; add it to `PublicDependencyModuleNames`.
6. Non-instanced nodes must not write to `this` during execution — use `NodeMemory`.

## Version notes

The BT execution model has been stable across UE4 and UE5. `EBTRestartMode` (for
`RestartTree`) was introduced in UE 5.1 with `ForceReevaluateRootNode` as default. Line
numbers in `BTTaskNode.h`/`BTDecorator.h` may drift between patch releases; the class names
and function signatures are stable.
