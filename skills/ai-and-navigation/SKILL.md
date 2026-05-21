---
name: ai-and-navigation
description: Build AI in Unreal — AIController-driven pawns, Behavior Trees and Blackboards (tasks,
  decorators, services), the navigation system and NavMesh (MoveTo pathfinding), the Environment
  Query System (EQS), and AI Perception (sight/hearing). Use when creating enemy/NPC behavior,
  pathfinding/movement to targets, decision-making logic, environment queries for cover/positions,
  or sensing the player.
metadata:
  engine-version: "5.7"
  category: systems
---

# AI & navigation

Unreal AI = an **AIController** possessing a pawn, deciding what to do (usually via a **Behavior
Tree** reading a **Blackboard**), and moving via the **navigation system** (NavMesh pathfinding),
optionally sensing the world with **Perception** and querying it with **EQS**.

## When to use this skill

- Enemy/NPC behavior (patrol, chase, attack, flee).
- Moving an AI to a location/actor with pathfinding.
- Decision logic and state for AI.
- Finding good positions (cover, flanking) or sensing the player.

## Pieces

| Piece | Role |
|---|---|
| `AAIController` | possesses an AI pawn; runs the brain; issues movement |
| `UBehaviorTree` + `UBlackboardData` | decision tree + its working memory (keys) |
| Navigation System / NavMesh | pathfinding over walkable space |
| EQS (`UEnvQuery`) | scores the environment to pick locations/actors |
| `UAIPerceptionComponent` | sight/hearing/damage senses |

Enable: AI uses the `AIModule` and `NavigationSystem` (engine modules) and the AI/Behavior Tree
features (Gameplay subsystems). For navmesh, add a **NavMeshBoundsVolume** to the level so a
`RecastNavMesh` is generated.

## AIController + possession

```cpp
UCLASS()
class MYGAME_API AMyAIController : public AAIController
{
    GENERATED_BODY()
public:
    virtual void OnPossess(APawn* InPawn) override;     // start the brain here
protected:
    UPROPERTY(EditDefaultsOnly) TObjectPtr<UBehaviorTree> BehaviorTree;
};

void AMyAIController::OnPossess(APawn* InPawn)
{
    Super::OnPossess(InPawn);
    if (BehaviorTree) RunBehaviorTree(BehaviorTree);    // sets up blackboard + BT
}
```
Set the pawn's `AIControllerClass` and `AutoPossessAI = PlacedInWorldOrSpawned` so the controller
takes over.

## Behavior Trees & Blackboard

- The **Blackboard** holds typed keys (e.g. `TargetActor`, `MoveToLocation`, `bCanSeePlayer`) that
  the tree reads/writes — the AI's working memory.
- The **Behavior Tree** runs left-to-right/top-down: **Composites** (Selector/Sequence) structure
  flow; **Tasks** (`UBTTaskNode`) do work (MoveTo, Wait, custom); **Decorators** gate branches
  (conditions); **Services** tick on a branch to update the blackboard (e.g. refresh the target).
- Write custom C++ tasks/services by subclassing `UBTTaskNode` / `UBTService` and reading/writing
  the blackboard via the owning controller.

Set keys from C++:
```cpp
if (UBlackboardComponent* BB = GetBlackboardComponent())
    BB->SetValueAsObject(TEXT("TargetActor"), Player);
```

## Navigation & movement

```cpp
// From the AIController:
MoveToActor(TargetActor, /*AcceptanceRadius*/ 50.f);
MoveToLocation(Destination, 50.f);
```
- Movement follows the **NavMesh**; ensure a NavMeshBoundsVolume covers walkable areas (rebuild/see
  it with the `P` viewport key in editor).
- Pawn must have movement (e.g. `UCharacterMovementComponent`, `character-and-movement`); the nav
  system computes the path, the movement component follows it.
- `OnMoveCompleted` tells you when the move finished/failed.
- **Nav modifiers**/areas adjust cost (avoid lava, prefer roads); **Detour Crowd** avoids agents.

## EQS (Environment Query System)

EQS runs a query (generators + tests) to **score and pick** points/actors — e.g. "best cover from
the player", "nearest reachable flank". Run an EQS query from a behavior tree task or C++ and use
the result as a MoveTo target. Use it for spatial decisions instead of hand-rolled math.

## Perception

`UAIPerceptionComponent` with **AI senses** (Sight, Hearing, Damage) reports stimuli
(`OnPerceptionUpdated`/`OnTargetPerceptionUpdated`). Configure sight radius/angle, affiliation, and
forget time. Drive the blackboard (`bCanSeePlayer`, `TargetActor`) from perception events.

## StateTree (modern alternative)

**StateTree** is a newer state-machine + selector hybrid usable for AI and general logic; consider
it as an alternative/complement to Behavior Trees for some projects.

## Gotchas

- **No NavMeshBoundsVolume / unbuilt navmesh** → `MoveTo` fails silently; verify nav (`P` in editor).
- **AutoPossessAI not set** → the controller never possesses; no brain runs.
- **Pawn without a movement component** → can't follow paths.
- **Logic in Tick instead of BT/services** → harder to maintain; use services to update the blackboard.
- **Querying perception every frame manually** instead of reacting to perception events → cost.
- **Hardcoding positions** instead of EQS → brittle AI placement.

## References & source material

Engine source (UE 5.7):
- `Runtime/AIModule/Classes/AIController.h` — `AAIController`, `RunBehaviorTree`, `MoveTo*`.
- `Runtime/AIModule/Classes/BehaviorTree/BehaviorTree.h`, `BlackboardComponent.h`, `BTTaskNode.h`.
- `Runtime/NavigationSystem/Public/NavigationSystem.h` — `UNavigationSystemV1`.
- EQS: `Runtime/AIModule/Classes/EnvironmentQuery/` ; Perception: `Runtime/AIModule/Classes/Perception/`.

Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>

Related: `character-and-movement`, `gameplay-tags`, `gameplay-framework`.
