# AI Perception and StateTree — deep dive

Deep dive for [../SKILL.md](../SKILL.md). Covers all AI Perception senses, forget behavior,
the stimuli source component, debugging, and StateTree for AI: task authoring, schema,
`UStateTreeAIComponent`, and the BT-vs-StateTree decision guide. Grounded in UE 5.7
(`Engine/Source/Runtime/AIModule/Classes/Perception/` and
`Engine/Plugins/Runtime/StateTree/` + `Engine/Plugins/Runtime/GameplayStateTree/`).

## AI Perception — all senses

The perception system uses **sense configs** (subclasses of `UAISenseConfig`) to define what
the AI can detect and with what parameters. Each config maps to a `UAISense` implementation.

### Sight (`UAISenseConfig_Sight`)

Declared at `Perception/AISenseConfig_Sight.h`:18. Key properties:

| Property | Effect |
|---|---|
| `SightRadius` | Max distance to detect a target not yet seen. |
| `LoseSightRadius` | Max distance before a previously-seen target is lost. Must be ≥ `SightRadius`. |
| `PeripheralVisionAngleDegrees` | Half-angle of the vision cone from the forward vector. |
| `DetectionByAffiliation` | Which affiliations (enemies, neutrals, friendlies) trigger sight. |
| `AutoSuccessRangeFromLastSeenLocation` | If > 0, targets already seen are auto-succeeded within this range of their last seen position. |
| `PointOfViewBackwardOffset` | Moves the cone origin backward — adds close-range peripheral awareness. |
| `NearClippingRadius` | Blind spot at the pawn's very feet (use with backward offset). |

`PeripheralVisionAngleDegrees` can be changed at runtime:
```cpp
UAISenseConfig_Sight* Cfg = Cast<UAISenseConfig_Sight>(
    PerceptionComp->GetSenseConfig(UAISense_Sight::StaticClass()));
if (Cfg) { Cfg->PeripheralVisionAngleDegrees = 90.f;
           PerceptionComp->RequestStimuliListenerUpdate(); } // line 326
```

For targets to be seen, they (or their owning actor) must have `UAIPerceptionStimuliSourceComponent`
registered for `UAISense_Sight`, OR they implement `IAISightTargetInterface`
(`Perception/AISightTargetInterface.h`) to provide a custom can-be-seen test.

### Hearing (`UAISenseConfig_Hearing`)

Senses `UAISense_Hearing` (`Perception/AISense_Hearing.h`). Hearing stimuli are generated
by calling `UAISense_Hearing::ReportNoiseEvent` (static) or `UAISenseBlueprintListener`:
```cpp
UAISense_Hearing::ReportNoiseEvent(
    GetWorld(), SoundLocation, /*Loudness*/ 1.0f, NoiseInstigator,
    /*MaxRange*/ 0.f,         // 0 = use hearing config's range
    /*Tag*/ NAME_None);
```

`MaxAge` on the config controls how long the stimulus is remembered before it is forgotten.

### Damage (`UAISenseConfig_Damage`)

Automatically receives stimuli when `UAISense_Damage::ReportDamageEvent` is called — or when
`AISense_Damage` intercepts UE's standard damage flow (configurable). Useful for AI that
reacts to being hit even when the attacker is outside sight range.

### Prediction, Team, Touch

- **Prediction** (`UAISenseConfig_Prediction`) — requests a predicted future location for a
  target. Used for lead-aim or interception logic.
- **Team** (`UAISenseConfig_Team`) — notifies the AI when a teammate is within a configurable
  radius broadcast by gameplay code.
- **Touch** (`UAISenseConfig_Touch`) — senses physical contact (pawn bumps into something or
  vice versa).

## Forget behavior

Stimuli age over time. When a stimulus exceeds `MaxAge` on its sense config without being
refreshed, it is forgotten. Set `MaxAge = 0` to never forget.

To reset all known percepts immediately:
```cpp
PerceptionComp->ForgetAll(); // AIPerceptionComponent.h:346
```

To forget a specific actor:
```cpp
PerceptionComp->ForgetActor(Actor);
```

Enable automatic forget in Project Settings → Engine → AI System: set **Forget Stale Actors**
to true. The system then purges actors whose last stimulus is older than the configured age.

## Querying currently perceived actors

```cpp
TArray<AActor*> VisibleActors;
PerceptionComp->GetCurrentlyPerceivedActors(
    UAISense_Sight::StaticClass(), VisibleActors);   // AIPerceptionComponent.h:372

TArray<AActor*> KnownActors;
PerceptionComp->GetKnownPerceivedActors(nullptr, KnownActors); // all senses
```

`GetCurrentlyPerceivedActors` returns only actors with an *active* (not expired) stimulus.
`GetKnownPerceivedActors` returns everything still in memory (not yet forgotten).

## UAIPerceptionStimuliSourceComponent

Add this component to actors the AI should be able to sense:
```cpp
// In the target actor's constructor:
StimuliSource = CreateDefaultSubobject<UAIPerceptionStimuliSourceComponent>(
    TEXT("StimuliSource"));
StimuliSource->bAutoRegisterAsSource = true;
StimuliSource->RegisterForSense(TSubclassOf<UAISense>(UAISense_Sight::StaticClass()));
```

Declared at `Perception/AIPerceptionStimuliSourceComponent.h`. Without this (or an
`IAISightTargetInterface` implementation), a `UAISense_Sight` will never detect the actor.

## Affiliation (team-based sensing)

Affiliation (enemy / neutral / friendly) maps through `IGenericTeamAgentInterface`
(`GenericTeamAgentInterface.h`). Implement on both the AI controller and the target actor.
The sense config's `DetectionByAffiliation` flags gate which team relationships trigger the
sense. In Blueprint-only projects (where C++ team assignment is impractical), set
`DetectNeutrals = true` and filter by tag in the perception callback.

## Debugging AI Perception

In PIE, press `'` (apostrophe) to open the AI Debugger, then press **Numpad 4** to show
Perception. Each active sense is drawn as a sphere or cone around the AI. The overlay shows
age and source for each known stimulus.

Use `VisLog` integration: `UAIPerceptionComponent` writes stimuli events to the Visual Logger
(`Gameplay Debugger` skill) if `ENABLE_VISUAL_LOG` is defined.

---

## StateTree for AI

StateTree (`Plugins/Runtime/StateTree`, `Plugins/Runtime/GameplayStateTree`) is a
hierarchical state machine where states contain tasks and transitions, and selector states
mirror BT composites. It is data-oriented: task state lives in typed structs, not UObjects.

### Concepts

| Concept | Analog in BT | Notes |
|---|---|---|
| **State** | Branch/composite | Can contain tasks and sub-states |
| **Selector State** | Selector/Sequence composite | Iterates child states; enters the first whose conditions pass |
| **Task** | Task node | C++ struct implementing `FStateTreeTaskBase` |
| **Evaluator** | Service | Runs periodically on the active branch to supply data |
| **Condition** | Decorator | Guards state transitions |
| **Transition** | Decorator abort | Explicit when/event-based state change |

### UStateTreeAIComponent

Declared at
`Plugins/Runtime/GameplayStateTree/Source/GameplayStateTreeModule/Public/Components/StateTreeAIComponent.h`:15.
Subclasses `UStateTreeComponent`, which is a `UBrainComponent` — the same interface that
`UBehaviorTreeComponent` implements. Adding it to an `AAIController` replaces the BT brain
with a StateTree brain.

Setup in `AMyAIController` constructor:
```cpp
StateTreeComp = CreateDefaultSubobject<UStateTreeAIComponent>(TEXT("StateTreeComp"));
```

Assign a `UStateTree` asset:
```cpp
UPROPERTY(EditDefaultsOnly, Category="AI")
TObjectPtr<UStateTree> StateTreeAsset;

// In OnPossess:
StateTreeComp->SetStateTree(StateTreeAsset);
StateTreeComp->StartLogic();   // UBrainComponent::StartLogic — StateTreeComponent.h:54
```

### Authoring C++ StateTree tasks

StateTree tasks are plain C++ structs that implement `FStateTreeTaskBase` from
`StateTreeModule/Public/StateTreeTaskBase.h` (or `FStateTreeAITask` from the GameplayStateTree
module for tasks needing AI-specific context):

```cpp
USTRUCT()
struct FMyChaseTask : public FStateTreeTaskBase
{
    GENERATED_BODY()

    // Instance data (bound to the StateTree's schema-provided context):
    UPROPERTY(EditAnywhere, Category=Parameter)
    float AcceptanceRadius = 50.f;

    EStateTreeRunStatus EnterState(FStateTreeExecutionContext& Context,
        const FStateTreeTransitionResult& Transition) const;

    EStateTreeRunStatus Tick(FStateTreeExecutionContext& Context,
        const float DeltaTime) const;
};
```

`EStateTreeRunStatus` mirrors BT's `EBTNodeResult`: return `Running` (continue ticking),
`Succeeded`, or `Failed`. No `NodeMemory` pointer — instance data lives in the struct fields
(each state instance gets its own copy).

### Schema

A `UStateTree` asset has a **schema** that defines what external objects are accessible in
tasks and evaluators (e.g. the `AAIController`, `APawn`, `UBlackboardComponent`). The schema
validates that a task's context bindings are satisfied at edit time.

`UStateTreeAIComponentSchema` (declared in
`Plugins/Runtime/GameplayStateTree/Source/GameplayStateTreeModule/Public/Components/StateTreeAIComponentSchema.h`)
provides
`AAIController` and owned `APawn` to tasks automatically.

### Sending events to StateTree

StateTree transitions can be triggered by gameplay events:
```cpp
FStateTreeEvent Event;
Event.Tag = FGameplayTag::RequestGameplayTag(TEXT("AI.Event.TargetLost"));
StateTreeComp->SendStateTreeEvent(Event); // UStateTreeComponent API
```

### BT vs StateTree — decision guide

| Situation | Prefer |
|---|---|
| Existing large BT codebase | Keep BT; migrate incrementally |
| New project targeting UE 5.4+ | StateTree |
| Shared logic between AI and non-AI objects (e.g. doors, pickups) | StateTree (general schema) |
| Many simple AI with shared tree assets | BT (non-instanced nodes; memory-efficient) |
| Complex explicit state transitions with events | StateTree |
| Tight integration with Mass Entity (city-scale AI) | StateTree + MassEntity |

The two systems can coexist: some controllers use BT, others use StateTree. There is no
engine-level restriction.

## Version notes

- `UStateTreeAIComponent` was finalized in UE 5.4. In UE 5.3, use `UStateTreeComponent`
  with a manually-set `UStateTreeAIComponentSchema`.
- StateTree task structs do not need `UCLASS` — they use `USTRUCT`. This is intentional:
  the struct-based model avoids UObject overhead for large agent counts.
- `OnTargetPerceptionInfoUpdated` (richer `FActorPerceptionUpdateInfo` struct) was added in
  UE 5.1. Prefer it over `OnTargetPerceptionUpdated` for new code.
