# Mover: movement modes, transitions & modifiers

Deep dive for authoring custom `UBaseMovementMode`s, declarative mode
transitions, and movement modifiers. Paths are relative to
`Engine/Plugins/Experimental/Mover/Source/Mover/Public/` (UE 5.7).

## Anatomy of a movement mode

`UBaseMovementMode` (`MovementMode.h:39`) is `Abstract, Within = MoverComponent,
Blueprintable, EditInlineNew, DefaultToInstanced`. Each simulation tick the
active mode runs two phases, both `BlueprintNativeEvent`s:

1. **`GenerateMove`** (`MovementMode.h:59`) — *pure planning*. Read the input
   cmd + starting sync state, output an `FProposedMove`
   (`MoveLibrary/MovementUtilsTypes.h`): `LinearVelocity`,
   `AngularVelocityDegrees`, `DirectionIntent`/`bHasDirIntent`,
   optional `PreferredMode`, and a `MixMode`. Do **not** move anything here —
   the result is mixed with layered-move proposals before execution.
2. **`SimulationTick`** (`MovementMode.h:62`) — *execution*. Receives
   `FSimulationTickParams` (`MoverSimulationTypes.h:413`) containing the mixed
   `ProposedMove`, the components (`MovingComps`), blackboard, start state and
   timestep. Sweep the updated component, resolve hits, and write the resulting
   transform/velocity into `OutputState.SyncState`.

Lifecycle hooks: `OnRegistered(ModeName)`/`OnUnregistered` (added to/removed
from a MoverComponent — resolve shared settings here), `Activate`/`Deactivate`
(mode became current / stopped being current). BP events: `OnActivated`,
`OnDeactivated`, `OnRegistered`, `OnUnregistered`.

Key properties (`MovementMode.h`):

| Property | Line | Purpose |
|----------|------|---------|
| `SharedSettingsClasses` | 104 | settings classes this mode needs; MoverComponent auto-instances them into its `SharedSettings` array |
| `Transitions` | 108 | mode-owned transition checks, evaluated in order |
| `GameplayTags` | 112 | tags reported through `UMoverComponent::HasGameplayTag` while active (e.g. `Mover_IsOnGround`) |
| `bSupportsAsync` | 119 | opt-in to async (off-game-thread) simulation |

## Canonical custom mode (modeled on UFlyingMode)

The engine's `UFlyingMode` (`DefaultMovementSet/Modes/FlyingMode.cpp`) is the
cleanest template. Pattern:

```cpp
UCLASS(Blueprintable, BlueprintType)
class UGlidingMode : public UBaseMovementMode
{
    GENERATED_BODY()
public:
    UGlidingMode()
    {
        // Reuse the common settings block (max speed, accel, turning...)
        SharedSettingsClasses.Add(UCommonLegacyMovementSettings::StaticClass());
        GameplayTags.AddTag(Mover_IsInAir);
    }

    virtual void OnRegistered(const FName ModeName) override
    {
        Super::OnRegistered(ModeName);
        CommonLegacySettings = GetMoverComponent()->FindSharedSettings<UCommonLegacyMovementSettings>();
        check(CommonLegacySettings);
    }
    virtual void OnUnregistered() override
    {
        CommonLegacySettings = nullptr;
        Super::OnUnregistered();
    }

    virtual void GenerateMove_Implementation(const FMoverTickStartData& StartState,
        const FMoverTimeStep& TimeStep, FProposedMove& OutProposedMove) const override
    {
        const FCharacterDefaultInputs* Inputs =
            StartState.InputCmd.InputCollection.FindDataByType<FCharacterDefaultInputs>();
        const FMoverDefaultSyncState* SyncState =
            StartState.SyncState.SyncStateCollection.FindDataByType<FMoverDefaultSyncState>();
        check(SyncState);

        FFreeMoveParams Params;   // MoveLibrary/AirMovementUtils.h
        Params.MoveInputType    = Inputs ? Inputs->GetMoveInputType() : EMoveInputType::None;
        Params.MoveInput        = Inputs ? Inputs->GetMoveInput_WorldSpace() : FVector::ZeroVector;
        Params.PriorVelocity    = SyncState->GetVelocity_WorldSpace();
        Params.PriorOrientation = SyncState->GetOrientation_WorldSpace();
        Params.MaxSpeed     = CommonLegacySettings->MaxSpeed;
        Params.Acceleration = CommonLegacySettings->Acceleration * 0.4f; // glide feel
        Params.Deceleration = CommonLegacySettings->Deceleration;
        Params.TurningRate  = CommonLegacySettings->TurningRate;
        Params.DeltaSeconds = TimeStep.StepMs * 0.001f;

        OutProposedMove = UAirMovementUtils::ComputeControlledFreeMove(Params);
        // Constant gentle sink instead of full gravity:
        OutProposedMove.LinearVelocity.Z = -150.f;
    }

    virtual void SimulationTick_Implementation(const FSimulationTickParams& Params,
        FMoverTickEndData& OutputState) override
    {
        const float DeltaSeconds = Params.TimeStep.StepMs * 0.001f;
        const FMoverDefaultSyncState* StartSync =
            Params.StartState.SyncState.SyncStateCollection.FindDataByType<FMoverDefaultSyncState>();
        FMoverDefaultSyncState& OutSync =
            OutputState.SyncState.SyncStateCollection.FindOrAddMutableDataByType<FMoverDefaultSyncState>();

        FMovementRecord MoveRecord;
        MoveRecord.SetDeltaSeconds(DeltaSeconds);

        const FVector MoveDelta = Params.ProposedMove.LinearVelocity * DeltaSeconds;
        const FQuat TargetOrient = UMovementUtils::ApplyAngularVelocityToQuat(
            StartSync->GetOrientation_WorldSpace().Quaternion(),
            Params.ProposedMove.AngularVelocityDegrees, DeltaSeconds);

        FHitResult Hit(1.f);
        UMovementUtils::TrySafeMoveUpdatedComponent(Params.MovingComps, MoveDelta,
            TargetOrient, /*bSweep*/ true, Hit, ETeleportType::None, MoveRecord);
        if (Hit.IsValidBlockingHit())
        {
            FMoverOnImpactParams ImpactParams(TEXT("Gliding"), Hit, MoveDelta);
            GetMoverComponent()->HandleImpact(ImpactParams);
            UMovementUtils::TryMoveToSlideAlongSurface(Params.MovingComps, MoveDelta,
                1.f - Hit.Time, TargetOrient, Hit.Normal, Hit, true, MoveRecord);
        }

        // Landed? hand the rest of the tick to the ground mode.
        FFloorCheckResult Floor;
        UFloorQueryUtils::FindFloor(Params.MovingComps,
            CommonLegacySettings->FloorSweepDistance,
            CommonLegacySettings->MaxWalkSlopeCosine,
            CommonLegacySettings->bUseFlatBaseForFloorChecks,
            Params.MovingComps.UpdatedComponent->GetComponentLocation(), Floor);
        if (Floor.IsWalkableFloor())
        {
            OutputState.MovementEndState.NextModeName = CommonLegacySettings->GroundMovementModeName;
            OutputState.MovementEndState.RemainingMs  = 0.f; // or leftover ms for a mid-tick handoff
        }

        const FVector FinalLocation = Params.MovingComps.UpdatedComponent->GetComponentLocation();
        OutSync.SetTransforms_WorldSpace(FinalLocation,
            Params.MovingComps.UpdatedComponent->GetComponentRotation(),
            MoveRecord.GetRelevantVelocity(),
            Params.ProposedMove.AngularVelocityDegrees);
    }

protected:
    UPROPERTY(Transient)
    TObjectPtr<const UCommonLegacyMovementSettings> CommonLegacySettings;
};
```

Register with `MoverComp->AddMovementModeFromClass(TEXT("Gliding"),
UGlidingMode::StaticClass())` or in the editor `MovementModes` map, then enter
via `QueueNextMode(TEXT("Gliding"))`.

### Mid-tick mode switches & substepping

`FMovementModeTickEndState` (`MoverSimulationTypes.h:46`): setting
`NextModeName` plus a non-zero `RemainingMs` lets the *next* mode consume the
remainder of this tick (that's how Walking hands off to Falling the moment the
floor disappears). Setting `bEndedWithNoChanges` enables idle optimizations.

### Utility libraries (do the collision math for you)

All in `MoveLibrary/`:

- `UMovementUtils` (`MovementUtils.h:136`) — `TrySafeMoveUpdatedComponent`,
  `TryMoveToSlideAlongSurface`, penetration resolution, velocity/orientation
  math, `ComputeControlledVelocity`-style helpers.
- `UGroundMovementUtils` (`GroundMovementUtils.h`) — step-up/step-down, walkable
  surface handling.
- `UAirMovementUtils` (`AirMovementUtils.h`) — `ComputeControlledFreeMove`,
  falling with air control.
- `UFloorQueryUtils` (`FloorQueryUtils.h:109`) — `FindFloor`,
  `ComputeFloorDist`; results cached on the blackboard under
  `CommonBlackboard::LastFloorResult`.
- `UWaterMovementUtils`, `UBasedMovementUtils` (dynamic bases),
  `UPlanarConstraintUtils` (plane locking), `UMovementMixer`/`MovementMixer.h`.

### Blackboard

`UMoverBlackboard` (`MoveLibrary/MoverBlackboard.h`) is a name→value cache for
passing data between decoupled systems (floor results, time-since-supported).
Obtain with `GetSimBlackboard_Mutable()`; invalidate keys your mode makes stale
(e.g. flying invalidates `CommonBlackboard::LastFloorResult`). 5.7 adds a
rollback-aware variant (`MoveLibrary/RollbackBlackboard.h`) whose entries
rewind with corrections.

### Turn generators

Legacy modes delegate rotation to an optional **turn generator** object
implementing `TurnGeneratorInterface` (`MoveLibrary/ModularMovement.h`), set via
`UWalkingMode::SetTurnGeneratorClass` (`Modes/WalkingMode.h`). Default is linear
interpolation at `TurningRate`; supply your own for e.g. snappy 8-way turns.

## Transitions

`UBaseMovementModeTransition` (`MovementModeTransition.h:38`) evaluates every
tick and returns an `FTransitionEvalResult` (`:18`) — `NextMode = NAME_None`
means no transition. `Trigger` (`:68`) fires when the transition is taken (play
FX, write blackboard state).

```cpp
UCLASS(Blueprintable)
class UGlideStartTransition : public UBaseMovementModeTransition
{
    GENERATED_BODY()
public:
    virtual FTransitionEvalResult Evaluate_Implementation(const FSimulationTickParams& Params) const override
    {
        const FCharacterDefaultInputs* Inputs =
            Params.StartState.InputCmd.InputCollection.FindDataByType<FCharacterDefaultInputs>();
        if (Inputs && Inputs->bIsJumpJustPressed &&
            Params.StartState.SyncState.MovementMode == DefaultModeNames::Falling)
        {
            return FTransitionEvalResult(TEXT("Gliding"));
        }
        return FTransitionEvalResult::NoTransition;
    }
};
```

Evaluation order: the **active mode's own `Transitions` array first**
(`MovementMode.h:108`), then the MoverComponent's global `Transitions`
(`MoverComponent.h:194-196`); each list stops at the first success.
Options: `bAllowModeReentry` (re-enter the current mode),
`bFirstSubStepOnly` (skip when evaluating substeps after a mid-tick mode
change), `bSupportsAsync`. Physics examples: `PhysicsMover/Transitions/
PhysicsJumpCheck.h`, `PhysicsLaunchCheck.h`.

`OnMovementTransitionTriggered` broadcasts on the component
(`MoverComponent.h:127`).

## Movement modifiers

`FMovementModifierBase` (`MovementModifier.h:103`) is for **stateful,
replicated adjustments that don't propose motion themselves** — they tweak the
actor/settings around the simulation. Contrast: layered moves *generate*
movement; modifiers *alter conditions* (capsule size, max speed, gravity
scale).

Lifecycle virtuals: `OnStart`, `OnEnd`, `OnPreMovement` (before each substep),
`OnPostMovement` (after each substep), `IsFinished` (default: `DurationMs`,
same `>0 / 0 / <0` semantics as layered moves). Like layered moves they must
override `Clone`, `GetScriptStruct`, and `NetSerialize` any state used in
comparisons, and can expose gameplay tags via `HasGameplayTag`.

Queue/cancel via handle:

```cpp
TSharedPtr<FMySlowModifier> Slow = MakeShared<FMySlowModifier>();
Slow->DurationMs = -1.f;                       // until cancelled
FMovementModifierHandle Handle = MoverComp->QueueMovementModifier(Slow);  // MoverComponent.h:300
// later:
MoverComp->CancelModifierFromHandle(Handle);   // MoverComponent.h:306
MoverComp->IsModifierActiveOrQueued(Handle);   // :612
```

### FStanceModifier (crouch, the built-in example)

`DefaultMovementSet/MovementModifiers/StanceModifier.h:30` implements crouch:
resizes the capsule (assumes the updated component *is* a capsule), applies
movement-settings changes on start, reverts on end, and reports the
`Mover_IsCrouching` tag. `UCharacterMoverComponent::Crouch/UnCrouch`
(`CharacterMoverComponent.h:95-99`) queue/cancel it and broadcast
`OnStanceChanged` when `bHandleStanceChanges` is enabled. `EStanceMode::Prone`
exists but is not implemented in 5.7. Note the modifier reads "standing" values
from the actor CDO when reverting — non-default capsule sizes set at runtime
will not survive a crouch cycle.

## References

- `MovementMode.h`, `MovementModeTransition.h`, `MovementModifier.h`,
  `MoverSimulationTypes.h` — base types.
- `DefaultMovementSet/Modes/*.h` + `Private/DefaultMovementSet/Modes/*.cpp` —
  Walking/Falling/Flying/Swimming/NavWalking implementations to copy from.
- `DefaultMovementSet/MovementModifiers/StanceModifier.h` — modifier example.
- `MoveLibrary/` — movement math utilities.
- MoverExamples plugin: `CharacterVariants/Ziplining/` shows a complete custom
  mode + transitions feature (`ZipliningMode.h`, `ZipliningTransitions.h`).
