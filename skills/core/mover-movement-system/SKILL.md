---
name: mover-movement-system
description: Implement actor movement with Unreal's experimental Mover plugin
  (UE 5.7) — the modular, rollback-networked successor to
  CharacterMovementComponent. Covers UMoverComponent / UCharacterMoverComponent
  setup, producing input via IMoverInputProducerInterface and
  FCharacterDefaultInputs, movement modes and transitions, layered moves,
  instant movement effects, movement modifiers (stance/crouch), shared settings
  (UCommonLegacyMovementSettings), sync state queries, and backend selection
  (Network Prediction, Chaos networked physics, standalone). Use when adopting
  or evaluating Mover, creating a Mover-based pawn, authoring a custom movement
  mode or layered move, migrating from CMC, wiring Enhanced Input into
  ProduceInput, or debugging Mover prediction/rollback behavior.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Mover movement system

**Mover** is Epic's experimental replacement for `UCharacterMovementComponent`
(CMC). It moves any actor — not just capsule-based characters — through a
**data-driven, deterministic simulation** with rollback networking. Movement
logic lives in modular objects (movement modes, layered moves, transitions,
modifiers) instead of a hard-coded enum + `switch`, and all state flows through
replicated snapshot structs instead of direct component mutation.

Status in 5.7: **Experimental** (`Engine/Plugins/Experimental/Mover/`). APIs
still change between minor versions. CMC remains fully supported; choose Mover
for new projects that want its modular architecture, rollback netcode, or
physics-driven movement — see the `character-and-movement` skill for CMC.

## When to use this skill

- Building a player/AI pawn on `UMoverComponent` / `UCharacterMoverComponent`.
- Authoring a custom movement mode (glide, wall-run, grapple) or transition.
- Applying temporary motion: dashes, launches, knockbacks, teleports.
- Migrating a CMC character to Mover, or deciding whether to.
- Debugging "my Mover actor won't move / snaps back / ignores SetActorLocation".

## Mental model (the part that prevents most mistakes)

Each simulation frame, the backend drives this loop:

```
ProduceInput  →  SimulationTick  →  FinalizeFrame
(author an        (modes + layered     (apply new state to
 input cmd)        moves propose &      the actor's components)
                   execute movement)
```

- **`FMoverInputCmdContext`** — what the player/AI *wants* this frame. A
  `FMoverDataCollection` of typed structs; the default set is
  `FCharacterDefaultInputs` (`MoverDataModelTypes.h:34`).
- **`FMoverSyncState`** (`MoverSimulationTypes.h:191`) — the authoritative,
  replicated, rollback-able state: current mode name, active layered
  moves/modifiers, and a data collection holding `FMoverDefaultSyncState`
  (`MoverDataModelTypes.h:148` — location, orientation, velocity, movement base).
- The active **movement mode** and any **layered moves** each generate an
  `FProposedMove` (`MoveLibrary/MovementUtilsTypes.h`); a **movement mixer**
  combines them by `EMoveMixMode` and priority; the mode's `SimulationTick`
  executes the result against collision.

Three rules follow:

1. **Never mutate movement state directly.** No `SetActorLocation`, no velocity
   setters. Queue things instead: `QueueNextMode`, `QueueLayeredMove`,
   `QueueInstantMovementEffect`, `QueueMovementModifier`. Mover warns when an
   external system moves the actor (`bWarnOnExternalMovement`,
   `MoverComponent.h:833`).
2. **All gameplay influence enters through the input cmd or queued objects**, so
   the simulation can replay them identically during a network rollback.
3. **`ProduceInput` runs only on the locally-controlled instance** and is *not*
   re-run during resimulation — author intent there, don't simulate there.

## Enabling Mover

1. Enable the **Mover** plugin (Experimental). Optionally **MoverExamples**
   (sample pawns, modes, zipline/vault content) and **MoverTests**.
   Physics-driven movement lives partly in the separate **ChaosMover** plugin.
2. C++ module dependency:

```csharp
// MyGame.Build.cs
PublicDependencyModuleNames.AddRange(new string[] { "Mover" });
// Add "NetworkPrediction" too if you touch the NP backend/liaison types directly.
```

## Minimal Mover pawn (C++)

`UCharacterMoverComponent` (`DefaultMovementSet/CharacterMoverComponent.h:27`)
extends `UMoverComponent` with character defaults: Walking/Falling/Flying modes
pre-registered, `StartingMovementMode = Falling`, jump + stance (crouch)
handling. The plain `UMoverComponent` starts with **no** modes.

```cpp
// MyMoverPawn.h
#include "GameFramework/Pawn.h"
#include "MoverSimulationTypes.h"   // IMoverInputProducerInterface
#include "MyMoverPawn.generated.h"

UCLASS()
class MYGAME_API AMyMoverPawn : public APawn, public IMoverInputProducerInterface
{
    GENERATED_BODY()
public:
    AMyMoverPawn();

protected:
    // Entry point the MoverComponent calls each sim frame on the controlling instance
    virtual void ProduceInput_Implementation(int32 SimTimeMs,
                                             FMoverInputCmdContext& InputCmdResult) override;

    UPROPERTY(VisibleAnywhere, Category = Movement)
    TObjectPtr<class UCharacterMoverComponent> MoverComp;

    UPROPERTY(VisibleAnywhere, Category = Components)
    TObjectPtr<class UCapsuleComponent> Capsule;

    // Cached from Enhanced Input bindings (IA_Move / IA_Jump)
    FVector CachedMoveIntent = FVector::ZeroVector;
    bool bJumpJustPressed = false;
    bool bJumpHeld = false;
};

// MyMoverPawn.cpp
#include "Components/CapsuleComponent.h"
#include "DefaultMovementSet/CharacterMoverComponent.h"
#include "MoverDataModelTypes.h"

AMyMoverPawn::AMyMoverPawn()
{
    Capsule = CreateDefaultSubobject<UCapsuleComponent>(TEXT("Capsule"));
    Capsule->InitCapsuleSize(34.f, 88.f);
    SetRootComponent(Capsule);   // Mover moves the root ("updated") component

    MoverComp = CreateDefaultSubobject<UCharacterMoverComponent>(TEXT("MoverComponent"));
}

void AMyMoverPawn::ProduceInput_Implementation(int32 SimTimeMs,
                                               FMoverInputCmdContext& InputCmdResult)
{
    FCharacterDefaultInputs& Inputs =
        InputCmdResult.InputCollection.FindOrAddMutableDataByType<FCharacterDefaultInputs>();

    FRotator ControlRot = FRotator::ZeroRotator;
    if (const AController* C = GetController())
    {
        ControlRot = C->GetControlRotation();
    }
    Inputs.ControlRotation = ControlRot;

    // Camera-relative directional intent, per-axis magnitude in [-1, 1]
    const FVector WorldIntent =
        FRotator(0.f, ControlRot.Yaw, 0.f).RotateVector(CachedMoveIntent);
    Inputs.SetMoveInput(EMoveInputType::DirectionalIntent, WorldIntent);

    // Face movement direction (leave zero for "no orientation change")
    Inputs.OrientationIntent = WorldIntent.GetSafeNormal();

    Inputs.bIsJumpJustPressed = bJumpJustPressed;
    Inputs.bIsJumpPressed     = bJumpHeld;
    Inputs.SuggestedMovementMode = NAME_None;

    bJumpJustPressed = false;   // edge-triggered; consume it
}
```

Wiring notes:

- If the **owning actor** implements `IMoverInputProducerInterface`, the
  MoverComponent auto-registers it as its `InputProducer` at BeginPlay
  (`MoverComponent.cpp:295-304`). Actor components implementing the interface
  are also gathered when `bGatherInputFromAllInputProducerComponents` is true
  (`MoverComponent.h:211`).
- `ProduceInput` is a `BlueprintNativeEvent` — override
  `ProduceInput_Implementation` in C++ or the *Produce Input* event in BP.
- Bind Enhanced Input actions normally in `SetupPlayerInputComponent`; the
  handlers just cache values that `ProduceInput` reads. See
  `MoverExamplesCharacter.h/.cpp` for the full reference implementation.
- `EMoveInputType::Velocity` requests an exact velocity instead of directional
  intent (used by AI/nav movement). For AI pathfinding, add a
  `UNavMoverComponent` (`DefaultMovementSet/NavMoverComponent.h`) and feed its
  consumed nav data into the input cmd, as `AMoverExamplesCharacter` does.

## Movement modes

Modes are instanced `UBaseMovementMode` objects (`MovementMode.h:39`) keyed by
`FName` in `UMoverComponent::MovementModes` (`MoverComponent.h:188`). Default
names live in `DefaultModeNames` (`MoverSimulationTypes.h:21-27`):

| Name | Default class | Notes |
|------|---------------|-------|
| `Walking` | `UWalkingMode` (`DefaultMovementSet/Modes/WalkingMode.h:34`) | ground movement, floor checks, based movement |
| `Falling` | `UFallingMode` (`Modes/FallingMode.h`) | airborne + gravity; default starting mode of `UCharacterMoverComponent` |
| `Flying` | `UFlyingMode` (`Modes/FlyingMode.h`) | free 3D movement |
| `Swimming` | `USwimmingMode` (`Modes/SwimmingMode.h`) | requires Water plugin volumes; not registered by default |
| — | `UNavWalkingMode`, `Async*Mode`, `PhysicsDriven*Mode` | nav-mesh walking, async-sim and physics-backend variants |

Changing modes:

```cpp
// From game code (applies at the start of the next sim frame):
MoverComp->QueueNextMode(DefaultModeNames::Flying);          // MoverComponent.h:358

// From input (the default character modes honor this):
Inputs.SuggestedMovementMode = DefaultModeNames::Flying;     // MoverDataModelTypes.h:66

// Add/remove modes at runtime:
MoverComp->AddMovementModeFromClass(TEXT("Gliding"), UMyGlidingMode::StaticClass());
MoverComp->RemoveMovementMode(TEXT("Gliding"));
```

React to changes via the `OnMovementModeChanged` delegate
(`MoverComponent.h:115`). Mode-owned `Transitions` and component-level
`Transitions` (`MoverComponent.h:196`) evaluate every tick and can switch modes
declaratively — a `UBaseMovementModeTransition` returns the target mode name
from `Evaluate` (`MovementModeTransition.h:65`).

Custom mode skeleton (full walkthrough in
[references/modes-transitions-and-modifiers.md](references/modes-transitions-and-modifiers.md)):

```cpp
UCLASS()
class UMyGlidingMode : public UBaseMovementMode
{
    GENERATED_BODY()
public:
    // Phase 1: propose velocity/orientation from input + current state
    virtual void GenerateMove_Implementation(const FMoverTickStartData& StartState,
        const FMoverTimeStep& TimeStep, FProposedMove& OutProposedMove) const override;

    // Phase 2: execute the mixed proposed move against the world
    virtual void SimulationTick_Implementation(const FSimulationTickParams& Params,
        FMoverTickEndData& OutputState) override;
};
```

Modes are `Within = MoverComponent` — create them via the `MovementModes` map
(editor), `AddMovementModeFromClass`, or `CreateDefaultSubobject` on a
MoverComponent subclass; never `NewObject` with a random outer.

## Layered moves (temporary motion: dash, launch, knockback)

Layered moves (`FLayeredMoveBase`, `LayeredMove.h:72`) run *on top of* the
current mode for a duration, each generating a proposed move mixed by
`MixMode` (`EMoveMixMode`: additive / override velocity / override all) and
`Priority`. They replicate and participate in rollback.

```cpp
#include "DefaultMovementSet/LayeredMoves/BasicLayeredMoves.h"

TSharedPtr<FLayeredMove_LinearVelocity> Dash = MakeShared<FLayeredMove_LinearVelocity>();
Dash->Velocity   = GetActorForwardVector() * 1200.f;
Dash->DurationMs = 250.f;                       // 0 = single tick, <0 = until removed
Dash->MixMode    = EMoveMixMode::OverrideVelocity;
MoverComp->QueueLayeredMove(Dash);              // MoverComponent.h:288
```

Built-ins in `DefaultMovementSet/LayeredMoves/BasicLayeredMoves.h`:
`FLayeredMove_LinearVelocity:28`, `FLayeredMove_JumpImpulseOverDuration:78`,
`FLayeredMove_JumpTo:118`, `FLayeredMove_MoveTo:184`,
`FLayeredMove_MoveToDynamic:247`, `FLayeredMove_RadialImpulse:284`; plus
`FLayeredMove_AnimRootMotion` (`LayeredMoves/AnimRootMotionLayeredMove.h`) for
montage root motion and `MultiJumpLayeredMove.h`. Cancel by gameplay tag with
`CancelFeaturesWithTag` (`MoverComponent.h:312`).

5.7 also adds an instanced flavor — stateless `ULayeredMoveLogic` classes with
replicated `FLayeredMoveInstancedData` (`LayeredMoveBase.h`), registered via
`RegisterMove` and activated with `QueueLayeredMoveActivation`
(`MoverComponent.h:277`). Details and custom-move authoring in
[references/layered-moves-and-instant-effects.md](references/layered-moves-and-instant-effects.md).

## Instant movement effects (one-tick state changes)

`FInstantMovementEffect` subtypes (`InstantMovementEffect.h:51`) mutate the
movement state for exactly one tick — the rollback-safe replacement for
"just set the actor's location/velocity":

```cpp
#include "DefaultMovementSet/InstantMovementEffects/BasicInstantMovementEffects.h"

// Teleport (instead of SetActorLocation):
TSharedPtr<FTeleportEffect> Teleport = MakeShared<FTeleportEffect>();
Teleport->TargetLocation = Destination;
MoverComp->QueueInstantMovementEffect(Teleport);   // MoverComponent.h:336

// Launch (instead of LaunchCharacter / direct velocity write):
TSharedPtr<FApplyVelocityEffect> Launch = MakeShared<FApplyVelocityEffect>();
Launch->VelocityToApply = FVector(0, 0, 800);
MoverComp->QueueInstantMovementEffect(Launch);
```

Built-ins: `FTeleportEffect:15`, `FJumpImpulseEffect:67`,
`FApplyVelocityEffect:96` (in `BasicInstantMovementEffects.h`). For networked
physics simulations, `ScheduleInstantMovementEffect` (`MoverComponent.h:342`)
delays application so every endpoint applies it on the same frame.

## Jumping, crouching, state queries

`UCharacterMoverComponent` provides the classic character surface:

```cpp
MoverComp->Jump();          // CharacterMoverComponent.h:87 (queues a jump impulse effect)
MoverComp->CanActorJump();  // :83
MoverComp->Crouch();        // :95 — applies an FStanceModifier (capsule resize + tag)
MoverComp->UnCrouch();      // :99
MoverComp->IsOnGround(); MoverComp->IsFalling(); MoverComp->IsAirborne();
MoverComp->IsCrouching(); MoverComp->IsSwimming(); MoverComp->IsSlopeSliding();
```

The default character inputs also drive jumping (`bIsJumpJustPressed`) when
`bHandleJump` is set (`CharacterMoverComponent.h:125`). Crouching is a
**movement modifier** (`FStanceModifier`,
`DefaultMovementSet/MovementModifiers/StanceModifier.h:30`) — see the modes
reference for modifier authoring.

General queries on any `UMoverComponent`:

```cpp
FVector Vel   = MoverComp->GetVelocity();           // MoverComponent.h:470
FVector Wish  = MoverComp->GetMovementIntent();     // :474
FName   Mode  = MoverComp->GetMovementModeName();   // :492

// Full state snapshot:
const FMoverDefaultSyncState* State =
    MoverComp->GetSyncState().SyncStateCollection.FindDataByType<FMoverDefaultSyncState>();

// State tags (MoverTypes.h:15-23): Mover_IsOnGround, Mover_IsInAir, Mover_IsFalling...
bool bGrounded = MoverComp->HasGameplayTag(Mover_IsOnGround, true);  // MoverComponent.h:633

// Floor under the actor:
FHitResult Floor;
if (MoverComp->TryGetFloorCheckHitResult(Floor)) { /* ... */ }       // :530
```

Prediction sampling for anim/motion matching: `GetPredictedTrajectory`
(`MoverComponent.h:488`).

## Tuning speeds & shared settings

The legacy-style modes read a **shared settings object**,
`UCommonLegacyMovementSettings`
(`DefaultMovementSet/Settings/CommonLegacyMovementSettings.h`): `MaxSpeed:58`,
`Acceleration:109`, `Deceleration:105`, `TurningRate:113`, `MaxStepHeight:54`,
`MaxWalkSlopeCosine:40`, `JumpUpwardsSpeed:128`, ground/air/swim mode-name
mappings, friction and braking. Edit it under the Mover component's **Shared
Settings** array (auto-populated from each mode's `SharedSettingsClasses`), or
at runtime:

```cpp
if (UCommonLegacyMovementSettings* Settings =
        MoverComp->FindSharedSettings_Mutable<UCommonLegacyMovementSettings>())
{
    Settings->MaxSpeed = 400.f;   // e.g. walk toggle
}
```

## Networking backends (overview)

The MoverComponent doesn't tick itself; a **backend liaison**
(`Backends/MoverBackendLiaison.h:24`, chosen by `BackendClass`,
`MoverComponent.h:185`) drives ProduceInput/SimulationTick/FinalizeFrame:

| Backend | Class | Use for |
|---------|-------|---------|
| Network Prediction (default) | `UMoverNetworkPredictionLiaisonComponent` (`Backends/MoverNetworkPredictionLiaison.h:28`) | kinematic characters with client prediction + rollback |
| Chaos networked physics | `UMoverNetworkPhysicsLiaisonComponentBase` (`Backends/MoverNetworkPhysicsLiaisonBase.h:188`) | physics-driven movement (`UPhysicsCharacterMoverComponent` + `PhysicsDriven*` modes) |
| Standalone | `UMoverStandaloneLiaisonComponent` (`Backends/MoverStandaloneLiaison.h:98`) | single-player / no networking, lowest overhead |

Rollbacks re-simulate forward from a corrected state; `OnPostSimulationRollback`
(`MoverComponent.h:111`) fires so gameplay/VFX can react. Custom replicated
movement state = your own `FMoverDataStructBase` (`MoverTypes.h:113`) added to
the input/sync collections (the Mover analog of CMC's `FSavedMove` flags). Full
detail — backend setup, custom state data, smoothing, reconciliation — in
[references/networking-and-backends.md](references/networking-and-backends.md).

## CMC → Mover migration cheat sheet

| CMC | Mover |
|-----|-------|
| `MaxWalkSpeed` | `UCommonLegacyMovementSettings::MaxSpeed` |
| `JumpZVelocity` | `UCommonLegacyMovementSettings::JumpUpwardsSpeed` |
| `SetMovementMode(MOVE_Flying)` | `QueueNextMode("Flying")` or input `SuggestedMovementMode` |
| `PhysCustom` + `CustomMovementMode` | custom `UBaseMovementMode` registered under its own name |
| `LaunchCharacter` | `FApplyVelocityEffect` / `FLayeredMove_LinearVelocity` |
| `SetActorLocation` / teleport | `FTeleportEffect` |
| Root motion montage | `FLayeredMove_AnimRootMotion` |
| `FSavedMove_Character` custom flags | custom `FMoverDataStructBase` in the input cmd collection |
| `bOrientRotationToMovement` | author `OrientationIntent` in `ProduceInput` (see pawn example) |
| `IsMovingOnGround()` | `IsOnGround()` / `Mover_IsOnGround` tag |
| `GetCharacterMovement()->Velocity = V` | not allowed — queue an instant effect or layered move |

## Gotchas

- **Moving the actor externally** (`SetActorLocation`, physics pushes on a
  kinematic backend) fights the simulation — Mover logs a warning and the next
  finalize snaps the actor back. Use `FTeleportEffect`, or set
  `bAcceptExternalMovement` (`MoverComponent.h:837`) if an external system
  (e.g. a cutscene) must own the transform temporarily.
- **`UMoverComponent` alone does nothing** — it has no movement modes and a
  `NAME_None` starting mode. Use `UCharacterMoverComponent` or register modes
  and set `StartingMovementMode` yourself (validation will flag this).
- **Mode names are FNames** — `QueueNextMode` with a name missing from
  `MovementModes` logs and is ignored. Reuse `DefaultModeNames` constants.
- **`DurationMs` semantics** on layered moves: `> 0` timed, `0` exactly one
  tick, `< 0` runs until removed/`IsFinished` — a common source of
  "my dash never ends".
- **`PreferredMode` of a layered move applies only when the move starts**, not
  continuously (`LayeredMove.h:59-68` comment). Mid-move mode changes need an
  instant effect or `QueueNextMode`.
- **Don't cache `GetSyncState()` references across frames** — it's
  double-buffered per tick.
- **Async simulation**: modes/transitions with `bSupportsAsync` may run off the
  game thread (`MovementMode.h:119`) — no actor/world access in
  `GenerateMove`/`SimulationTick` there; cache via the sim blackboard
  (`GetSimBlackboard`, `MoverComponent.h:534`).
- **ProduceInput edge flags**: clear "just pressed" booleans after authoring a
  frame, or a single press repeats on every subsequent frame.
- **5.6+ renames**: `OnActivate`/`OnDeactivate`/`OnGenerateMove`/
  `OnSimulationTick` are dead (`MovementMode.h:134-141`); override
  `Activate`/`Deactivate` and the `_Implementation` variants instead. Expect
  further churn while Experimental — pin exact signatures against your engine's
  headers.
- **Swimming needs the Water plugin** and a registered `Swimming` mode;
  `UCharacterMoverComponent` does not register one by default.

## Version notes

- Mover ships as Experimental in 5.3+ and remains Experimental in 5.7; Epic
  states CMC stays supported for the foreseeable future.
- 5.7 adds the instanced layered-move system (`ULayeredMoveLogic`), the
  rollback-aware blackboard, and pathed physics movement
  (`PhysicsMover/PathedMovement/`).
- Line numbers in plugin headers drift across releases; header paths and
  class/function names are stable.

## References & source material

Plugin source (UE 5.7, `Engine/Plugins/Experimental/Mover/Source/Mover/Public/`):
- `MoverComponent.h` — `UMoverComponent:81`, `OnMovementModeChanged:115`,
  `ProduceInput:160`, `SimulationTick:181`, `BackendClass:185`,
  `MovementModes:188`, `StartingMovementMode:192`, `Transitions:196`,
  `InputProducer:207`, `QueueLayeredMove:288`, `QueueMovementModifier:300`,
  `CancelFeaturesWithTag:312`, `QueueInstantMovementEffect:336`,
  `QueueNextMode:358`, `SetGravityOverride:375`, `GetVelocity:470`,
  `GetPredictedTrajectory:488`, `GetMovementModeName:492`, `GetSyncState:513`,
  `TryGetFloorCheckHitResult:530`, `GetSimBlackboard:534`, `HasGameplayTag:633`,
  `bWarnOnExternalMovement:833`, `bAcceptExternalMovement:837`.
- `MovementMode.h` — `UBaseMovementMode:39`, `GenerateMove:59`,
  `SimulationTick:62`, `SharedSettingsClasses:104`, `Transitions:108`,
  `GameplayTags:112`, `bSupportsAsync:119`.
- `MovementModeTransition.h` — `FTransitionEvalResult:18`,
  `UBaseMovementModeTransition:38`, `Evaluate:65`, `Trigger:68`.
- `MoverSimulationTypes.h` — `DefaultModeNames:21`, `CommonBlackboard:30`,
  `FMoverInputCmdContext:152`, `FMoverSyncState:191`, `FMoverTickStartData:357`,
  `FSimulationTickParams:413`, `IMoverInputProducerInterface:448`.
- `MoverDataModelTypes.h` — `EMoveInputType:17`, `FCharacterDefaultInputs:34`,
  `FMoverDefaultSyncState:148`, `UMoverDataModelBlueprintLibrary:271`.
- `MoverTypes.h` — state gameplay tags `:15-23`, `FMoverTimeStep:86`,
  `FMoverDataStructBase:113`, `FMoverDataCollection:188`,
  `FMoverDataPersistence:352`.
- `LayeredMove.h` — `FLayeredMoveBase:72`, `FLayeredMoveGroup:169`;
  `LayeredMoveBase.h` — `ULayeredMoveLogic:120`.
- `InstantMovementEffect.h` — `FInstantMovementEffect:51`.
- `DefaultMovementSet/CharacterMoverComponent.h` — `UCharacterMoverComponent:27`,
  `Jump:87`, `Crouch:95`.
- `DefaultMovementSet/Settings/CommonLegacyMovementSettings.h` —
  `UCommonLegacyMovementSettings:13`.
- `DefaultMovementSet/LayeredMoves/BasicLayeredMoves.h`,
  `DefaultMovementSet/InstantMovementEffects/BasicInstantMovementEffects.h`.
- `Backends/MoverBackendLiaison.h:24`, `Backends/MoverNetworkPredictionLiaison.h:28`,
  `Backends/MoverNetworkPhysicsLiaisonBase.h:188`,
  `Backends/MoverStandaloneLiaison.h:98`.

Example source (UE 5.7):
- `Engine/Plugins/Experimental/MoverExamples/Source/MoverExamples/Public/MoverExamplesCharacter.h`
  — reference input-producing pawn (Enhanced Input → `FCharacterDefaultInputs`).

Official docs (UE 5.7):
- Mover overview — <https://dev.epicgames.com/documentation/unreal-engine/mover-in-unreal-engine>
- Mover features & concepts — <https://dev.epicgames.com/documentation/unreal-engine/mover-features-and-concepts-in-unreal-engine>
- Comparing Mover and CMC — <https://dev.epicgames.com/documentation/unreal-engine/comparing-mover-and-character-movement-component-in-unreal-engine>

Deep-dive references in this skill:
- [references/modes-transitions-and-modifiers.md](references/modes-transitions-and-modifiers.md)
  — authoring custom movement modes, transitions, movement modifiers, turn
  generators, shared settings.
- [references/layered-moves-and-instant-effects.md](references/layered-moves-and-instant-effects.md)
  — built-in catalog, custom layered moves & instant effects, mixing rules,
  the 5.7 instanced layered-move system.
- [references/networking-and-backends.md](references/networking-and-backends.md)
  — backend liaisons, rollback flow, custom sync/input state data, smoothing,
  physics-driven movement.

Related skill: `character-and-movement` covers `ACharacter` +
`UCharacterMovementComponent`, including when to prefer CMC over Mover.
