---
name: ai-and-navigation
description: Build AI in Unreal — AIController-driven pawns, Behavior Trees and Blackboards
  (tasks, decorators, services), the navigation system and NavMesh (MoveTo pathfinding,
  NavMeshBoundsVolume, NavAreas, avoidance), the Environment Query System (EQS generators,
  tests, C++ FEnvQueryRequest), AI Perception (sight/hearing/damage senses, ConfigureSense,
  OnTargetPerceptionUpdated), and StateTree (UStateTreeAIComponent). Use when creating
  enemy/NPC behavior, pathfinding/movement to targets, decision-making logic, environment
  queries for cover/flanking/positions, sensing the player, or replacing Behavior Trees
  with StateTree.
metadata:
  engine-version: "5.7"
  category: systems
---

# AI & navigation

Unreal AI = an **AIController** possessing a pawn, deciding what to do (usually via a
**Behavior Tree** reading a **Blackboard**), moving via the **navigation system** (NavMesh
pathfinding), optionally sensing the world with **AI Perception**, and querying it with
**EQS**. **StateTree** offers a modern alternative or complement to Behavior Trees.

## When to use this skill

- Enemy/NPC behavior: patrol, chase, attack, flee, investigate.
- Moving an AI to a location or actor with real pathfinding.
- Decision logic and working memory (Behavior Tree + Blackboard).
- Finding good positions — cover, flanking, best attack point — via EQS.
- Sensing the player (sight, hearing, damage) and reacting to stimuli.
- Replacing or complementing Behavior Trees with StateTree for hierarchical state machines.

## System map

| System | Key types | Module / Plugin |
|---|---|---|
| AI controller | `AAIController`, `UBrainComponent` | `AIModule` |
| Behavior Tree | `UBehaviorTree`, `UBTTaskNode`, `UBTDecorator`, `UBTService` | `AIModule` |
| Blackboard | `UBlackboardComponent`, `UBlackboardData` | `AIModule` |
| Navigation | `UNavigationSystemV1`, `ARecastNavMesh`, `ANavMeshBoundsVolume` | `NavigationSystem` |
| Path following | `UPathFollowingComponent` | `AIModule` |
| EQS | `UEnvQueryManager`, `FEnvQueryRequest`, `UEnvQuery` | `AIModule` |
| AI Perception | `UAIPerceptionComponent`, `UAISenseConfig_Sight/Hearing/Damage` | `AIModule` |
| StateTree (AI) | `UStateTreeAIComponent`, `UStateTree` | `GameplayStateTree` plugin |

Build dependencies: add `"AIModule"` and `"NavigationSystem"` to `PublicDependencyModuleNames`
in your `.Build.cs`. For StateTree add `"GameplayStateTree"` and `"StateTreeModule"`.

## AIController + possession

```cpp
// MyAIController.h
UCLASS()
class MYGAME_API AMyAIController : public AAIController
{
    GENERATED_BODY()
public:
    virtual void OnPossess(APawn* InPawn) override;
protected:
    UPROPERTY(EditDefaultsOnly, Category="AI")
    TObjectPtr<UBehaviorTree> BehaviorTree;
};

// MyAIController.cpp
void AMyAIController::OnPossess(APawn* InPawn)
{
    Super::OnPossess(InPawn);    // AController::OnPossess links the pawn
    if (BehaviorTree)
        RunBehaviorTree(BehaviorTree);  // initializes Blackboard then starts BT
}
```

On the pawn (or its Blueprint):
- `AIControllerClass = AMyAIController::StaticClass()`
- `AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned`

`RunBehaviorTree` is declared at `AIController.h`:261. It also sets
`bStartAILogicOnPossess` (line 101) which auto-starts the BT when possessed.
In server-only AI, the controller only exists on the server; guard client-side calls.

## Behavior Trees & Blackboard

The Blackboard (`UBlackboardData` asset + `UBlackboardComponent` runtime) is the AI's
working memory — typed key/value pairs (Object, Vector, Bool, Float, Int, Name, Enum).

```cpp
// Write a key from C++ (controller or task):
if (UBlackboardComponent* BB = GetBlackboardComponent())
{
    BB->SetValueAsObject(TEXT("TargetActor"), Player);    // BlackboardComponent.h:133
    BB->SetValueAsBool(TEXT("bCanSeePlayer"), true);      // line 148
    BB->SetValueAsVector(TEXT("LastKnownLocation"), Loc); // line 157
}
```

**Tree structure:**
- **Composites** — `Selector` (try children left to right, succeed on first success) /
  `Sequence` (run all children; fail on first failure) / `SimpleParallel`.
- **Tasks** (`UBTTaskNode`) — leaf nodes that do work (`ExecuteTask` → return
  `EBTNodeResult::Succeeded/Failed/InProgress`; call `FinishLatentTask` for async).
- **Decorators** (`UBTDecorator`) — conditions attached to a node or branch; override
  `CalculateRawConditionValue`; can abort running branches via `FlowAbortMode`.
- **Services** (`UBTService`) — tick periodically while their branch is active; use
  `TickNode` to poll and update the Blackboard (e.g. refresh `TargetActor`).

Custom task pattern:
```cpp
UCLASS()
class UBTTask_FindCover : public UBTTaskNode
{
    GENERATED_BODY()
    virtual EBTNodeResult::Type ExecuteTask(
        UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory) override;
};

EBTNodeResult::Type UBTTask_FindCover::ExecuteTask(
    UBehaviorTreeComponent& OwnerComp, uint8* NodeMemory)
{
    // Run an EQS query, set a Blackboard key, return Succeeded.
    // For async work: kick off query, return InProgress,
    // then call FinishLatentTask(OwnerComp, EBTNodeResult::Succeeded) in the callback.
    return EBTNodeResult::Succeeded;
}
```

See [references/behavior-tree-deep-dive.md](references/behavior-tree-deep-dive.md) for the
full instancing model, node memory, composite abort modes, and service intervals.

## Navigation & movement

```cpp
// Issue movement from the AIController:
MoveToActor(TargetActor, /*AcceptanceRadius*/ 50.f);      // AIController.h:171
MoveToLocation(Destination, 50.f);                         // AIController.h:186

// React to completion:
virtual void OnMoveCompleted(FAIRequestID RequestID,
    const FPathFollowingResult& Result) override;           // AIController.h:229
// Or bind the dynamic delegate:
ReceiveMoveCompleted.AddDynamic(this, &AMyCtrl::OnMoveDone); // AIController.h:239
```

**Setup checklist:**
1. Place a `NavMeshBoundsVolume` in the level — the `ARecastNavMesh` is auto-created inside it.
2. Press `P` in the viewport to visualize coverage. Rebuild nav if geometry changed.
3. The pawn needs a `UCharacterMovementComponent` (or equivalent); the nav system computes
   the path, the movement component follows it via `UPathFollowingComponent`.

**Modifying the mesh:** `UNavArea` subclasses set traversal cost; `UNavModifierComponent` /
`ANavModifierVolume` apply areas at runtime. Two avoidance methods: **RVO** (Reciprocal
Velocity Obstacles, lightweight, per-agent) and **Detour Crowd** (`UDetourCrowdAIController`,
shared path following with group-aware steering).

For open worlds with World Partition, use **Navigation Invokers** (`UNavigationInvokerComponent`)
so the nav mesh generates only around agents rather than over the whole level.

See [references/navigation-deep-dive.md](references/navigation-deep-dive.md) for nav areas,
query filters, avoidance, nav links, and World Partition nav.

## EQS (Environment Query System)

EQS runs a query (generators + tests) to **score and rank** candidate locations or actors,
then returns the best match. Common uses: "best cover from player", "nearest flanking
position", "closest visible health pickup".

**Run from C++:**
```cpp
// In an AIController or BT task:
FEnvQueryRequest Request(CoverQuery, this); // EnvQueryManager.h:77
Request.Execute(EEnvQueryRunMode::SingleResult, this,
    &AMyAIController::OnCoverQueryFinished); // EnvQueryManager.h:97-99

void AMyAIController::OnCoverQueryFinished(
    TSharedPtr<FEnvQueryResult> Result)
{
    if (Result.IsValid() && Result->IsSuccessful())
    {
        FVector BestLoc = Result->GetItemAsLocation(0);
        if (UBlackboardComponent* BB = GetBlackboardComponent())
            BB->SetValueAsVector(TEXT("MoveToLocation"), BestLoc);
    }
}
```

`FQueryFinishedSignature` is declared in `EnvQueryManager.h`. Enable EQS in Project Settings
→ AI → Enable EQS. The EQS Testing Pawn (`AEQSTestingPawn`) lets you visualize query results
in the editor viewport without running the game.

See [references/eqs-deep-dive.md](references/eqs-deep-dive.md) for generators, tests, custom
contexts, and the instanced C++ query pattern.

## AI Perception

`UAIPerceptionComponent` (on the AIController) acts as a stimuli listener. Add sense configs
in the constructor:

```cpp
// In AIController constructor:
PerceptionComp = CreateDefaultSubobject<UAIPerceptionComponent>(TEXT("PerceptionComp"));

auto SightConfig = CreateDefaultSubobject<UAISenseConfig_Sight>(TEXT("SightConfig"));
SightConfig->SightRadius = 2000.f;
SightConfig->LoseSightRadius = 2500.f;
SightConfig->PeripheralVisionAngleDegrees = 60.f;
SightConfig->DetectionByAffiliation.bDetectEnemies = true;
SightConfig->DetectionByAffiliation.bDetectNeutrals = true;
PerceptionComp->ConfigureSense(*SightConfig);    // AIPerceptionComponent.h:319
PerceptionComp->SetDominantSense(SightConfig->GetSenseImplementation());
```

Bind the update delegate in `BeginPlay`:
```cpp
PerceptionComp->OnTargetPerceptionUpdated.AddDynamic(
    this, &AMyAIController::OnTargetPerceptionUpdated); // AIPerceptionComponent.h:423

void AMyAIController::OnTargetPerceptionUpdated(AActor* Actor, FAIStimulus Stimulus)
{
    if (UBlackboardComponent* BB = GetBlackboardComponent())
    {
        BB->SetValueAsBool(TEXT("bCanSeePlayer"),
            Stimulus.WasSuccessfullySensed());
        if (Stimulus.WasSuccessfullySensed())
            BB->SetValueAsObject(TEXT("TargetActor"), Actor);
    }
}
```

For targets to be perceivable, add `UAIPerceptionStimuliSourceComponent` to them and
register the relevant senses. Affiliations (enemy/neutral/friendly) are set via
`IGenericTeamAgentInterface` — Blueprint-only projects detect neutrals then filter by tag.

See [references/perception-and-statetree.md](references/perception-and-statetree.md) for
all senses, forget behavior, `UAIPerceptionStimuliSourceComponent`, and debugging.

## StateTree (modern alternative to Behavior Trees)

StateTree (`Plugins/Runtime/StateTree`, `Plugins/Runtime/GameplayStateTree`) is a
hierarchical state machine that combines BT-style selectors with explicit state transitions.
It is the current direction for new Epic AI work (used in Lyra, City Sample).

For AI use, add `UStateTreeAIComponent` (subclass of `UStateTreeComponent`) to the
AIController instead of `RunBehaviorTree`:

```cpp
// In AIController constructor:
StateTreeComp = CreateDefaultSubobject<UStateTreeAIComponent>(TEXT("StateTreeComp"));
// Assign a UStateTree asset via UPROPERTY or in the Blueprint details panel.
```

`UStateTreeAIComponent` is declared in
`Plugins/Runtime/GameplayStateTree/Source/GameplayStateTreeModule/Public/Components/StateTreeAIComponent.h`
and derives from
`UBrainComponent`, so `StartLogic`/`StopLogic`/`RestartLogic` work the same way as with
`UBehaviorTreeComponent`.

StateTree tasks are C++ structs (not `UObject`s) implementing `FStateTreeTaskBase` — lighter
weight and data-oriented. State data lives in typed instance structs. For Behavior Tree
projects, StateTree can be adopted incrementally — the two systems coexist.

See [references/perception-and-statetree.md](references/perception-and-statetree.md) for
StateTree C++ task authoring, schema setup, and the BT-vs-StateTree decision guide.

## Gotchas

- **No `NavMeshBoundsVolume` or unbuilt navmesh** — `MoveTo` fails silently; check nav
  coverage with `P` in the editor, rebuild if geometry changed post-load.
- **`AutoPossessAI` not set** — the controller never possesses; no brain runs.
- **Pawn without a movement component** — the path is computed but the pawn cannot follow it.
- **`RunBehaviorTree` called before a valid `UBlackboardData` is set on the tree asset** —
  the BT initializes but blackboard keys resolve to defaults silently.
- **Custom BT task not instanced, modifying `this` in `ExecuteTask`** — non-instanced nodes
  are shared across all AI using the same tree; store runtime state in `NodeMemory` only
  (or mark the node `UCLASS(meta=(DisplayName="..."), Blueprintable)` with instancing).
- **Binding `OnPerceptionUpdated` vs `OnTargetPerceptionUpdated`** — the former delivers an
  array of all updated actors each tick; the latter fires per actor per stimulus. Prefer the
  latter for precise reaction logic.
- **EQS not enabled in Project Settings** — queries silently produce no results.
- **Using tick-polling instead of perception events** — costly and less reliable; always
  respond to `OnTargetPerceptionUpdated`.
- **Hardcoding positions** instead of EQS — brittle; EQS respects nav mesh reachability.
- **Forgetting `ReceiveMoveCompleted`** — if you call `StopMovement` before checking the
  result, the delegate fires immediately with `EPathFollowingResult::Aborted`.

## Version notes

- StateTree is available since UE 5.1 (early), production-stable in UE 5.3+. Use
  `UStateTreeAIComponent` (UE 5.4+) for AI-controller-hosted trees. Prior to 5.4 use
  `UStateTreeComponent` directly.
- `FEnvQueryRequest::Execute` template API is stable across UE5. The older
  `UEnvQueryManager::RunQuery` overloads also exist and behave the same.
- `OnTargetPerceptionInfoUpdated` (delivers `FActorPerceptionUpdateInfo`) was added in UE 5.1
  as a richer alternative to `OnTargetPerceptionUpdated`.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/`):
- `AIModule/Classes/AIController.h` — `AAIController`:90, `MoveToActor`:171,
  `MoveToLocation`:186, `OnMoveCompleted`:229, `ReceiveMoveCompleted`:239,
  `RunBehaviorTree`:261, `OnPossess`:346, `GetBlackboardComponent`:446.
- `AIModule/Classes/BehaviorTree/BehaviorTreeComponent.h` — `UBehaviorTreeComponent`:104,
  `StartTree`:137, `StopTree`:140, `RestartTree`:146.
- `AIModule/Classes/BehaviorTree/BTTaskNode.h` — `UBTTaskNode`:33, `ExecuteTask`:40,
  `AbortTask`:48, `FinishLatentTask`:80.
- `AIModule/Classes/BehaviorTree/BTDecorator.h` — `UBTDecorator`:37,
  `CalculateRawConditionValue`:121, `FlowAbortMode`:98.
- `AIModule/Classes/BehaviorTree/BTService.h` — `UBTService`:34, `Interval`:52.
- `AIModule/Classes/BehaviorTree/BlackboardComponent.h` — `UBlackboardComponent`:42,
  `SetValueAsObject`:133, `SetValueAsBool`:148, `SetValueAsVector`:157,
  `GetValueAsObject`:103, `RegisterObserver`:73.
- `AIModule/Classes/EnvironmentQuery/EnvQueryManager.h` — `FEnvQueryRequest`:70,
  `FEnvQueryRequest::Execute`:97, `UEnvQueryManager`:207, `RunQuery`:223,
  `RunInstantQuery`:238, `RunEQSQuery` (static):279.
- `AIModule/Classes/Perception/AIPerceptionComponent.h` — `UAIPerceptionComponent`:208,
  `SensesConfig`:219, `ConfigureSense`:319, `ForgetAll`:346,
  `GetCurrentlyPerceivedActors`:372, `OnPerceptionUpdated`:396,
  `OnTargetPerceptionUpdated`:423.
- `AIModule/Classes/Perception/AISenseConfig_Sight.h` — `UAISenseConfig_Sight`:18,
  `SightRadius`:28, `LoseSightRadius`:32, `PeripheralVisionAngleDegrees`:36.
- `AIModule/Classes/Navigation/PathFollowingComponent.h` — `UPathFollowingComponent`:216,
  `RequestMove`:248.
- `NavigationSystem/Public/NavigationSystem.h` — `UNavigationSystemV1`:295,
  `GetNavigationSystem`:488, `FindPathToLocationSynchronously`:521,
  `FindPathToActorSynchronously`:527.
- `NavigationSystem/Public/NavMesh/RecastNavMesh.h` — `ARecastNavMesh`:573.

Plugins (UE 5.7, under `Engine/Plugins/Runtime/`):
- `StateTree/Source/StateTreeModule/Public/StateTree.h` — `UStateTree` asset.
- `GameplayStateTree/Source/GameplayStateTreeModule/Public/Components/StateTreeAIComponent.h`
  — `UStateTreeAIComponent`:15.
- `GameplayStateTree/Source/GameplayStateTreeModule/Public/Components/StateTreeComponent.h`
  — `UStateTreeComponent`:39, `StartLogic`:54, `StopLogic`:56.

Official docs (UE 5.7):
- Artificial Intelligence — <https://dev.epicgames.com/documentation/unreal-engine/artificial-intelligence-in-unreal-engine>
- Behavior Trees — <https://dev.epicgames.com/documentation/unreal-engine/behavior-trees-in-unreal-engine>
- Navigation System — <https://dev.epicgames.com/documentation/unreal-engine/navigation-system-in-unreal-engine>
- Environment Query System — <https://dev.epicgames.com/documentation/unreal-engine/environment-query-system-in-unreal-engine>
- AI Perception — <https://dev.epicgames.com/documentation/unreal-engine/ai-perception-in-unreal-engine>
- StateTree — <https://dev.epicgames.com/documentation/unreal-engine/state-tree-in-unreal-engine>
- AI Debugging — <https://dev.epicgames.com/documentation/unreal-engine/ai-debugging-in-unreal-engine>

Deep-dive references in this skill:
- [references/behavior-tree-deep-dive.md](references/behavior-tree-deep-dive.md) — BT
  composites, node instancing model, task memory, decorator abort modes, service intervals.
- [references/navigation-deep-dive.md](references/navigation-deep-dive.md) — nav areas,
  query filters, avoidance (RVO/Detour Crowd), nav links, NavInvokers, World Partition nav.
- [references/eqs-deep-dive.md](references/eqs-deep-dive.md) — generators, tests, contexts,
  run modes, C++ query pattern, EQS Testing Pawn.
- [references/perception-and-statetree.md](references/perception-and-statetree.md) — all
  senses, forget behavior, stimuli source, StateTree task authoring, BT vs StateTree guide.

Related skills: `character-and-movement`, `gameplay-tags`, `gameplay-framework`.
