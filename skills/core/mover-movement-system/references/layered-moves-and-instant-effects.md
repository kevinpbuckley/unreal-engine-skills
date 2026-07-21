# Mover: layered moves & instant movement effects

Deep dive on temporary/procedural motion in the Mover plugin. Paths are
relative to `Engine/Plugins/Experimental/Mover/Source/Mover/Public/` (UE 5.7).

## Layered moves — concept

`FLayeredMoveBase` (`LayeredMove.h:72`) = a struct that generates an
`FProposedMove` alongside the active movement mode for some duration. They are
stored in the sync state (`FLayeredMoveGroup`, `LayeredMove.h:169`), replicate
to other clients, and are rewound/replayed during rollbacks — which is why they
must be queued (`UMoverComponent::QueueLayeredMove`, `MoverComponent.h:288`)
rather than applied immediately, and why they're cloned on queueing (configure
fully *before* queueing).

Key fields on every layered move:

| Field | Line | Meaning |
|-------|------|---------|
| `MixMode` | `LayeredMove.h:81` | `EMoveMixMode` (`MoveLibrary/MovementUtilsTypes.h:17`): `AdditiveVelocity`, `OverrideVelocity`, `OverrideAll`, `OverrideAllExceptVerticalVelocity` |
| `Priority` | `:85` | conflict winner among overriding moves (higher wins) |
| `DurationMs` | `:92` | `> 0` timed; `0` exactly one tick; `< 0` until `IsFinished()`/cancel |
| `FinishVelocitySettings` | `:100` | what velocity remains when the move ends: keep, set, or clamp (`ELayeredMoveFinishVelocityMode`, `:19`) |

Mixing is performed by the component's `UMovementMixer`
(`MoverComponent.h:225`; default `UDefaultMovementMixer`,
`MoveLibrary/MovementMixer.h`). Additive moves sum onto the mode's proposal;
override moves replace it (per the mix mode), ties broken by `Priority`. The
final proposed move can be inspected/adjusted via
`BindProcessGeneratedMovement` (`MoverComponent.h:146`).

A layered move may set `FProposedMove::PreferredMode` — applied **only at the
move's start**, not continuously (`LayeredMove.h:59-68`). E.g.
`FLayeredMove_JumpTo` switches the actor to Falling when it begins.

## Built-in layered moves

`DefaultMovementSet/LayeredMoves/`:

| Type | Header:line | Purpose |
|------|-------------|---------|
| `FLayeredMove_LinearVelocity` | `BasicLayeredMoves.h:28` | constant/curve-scaled velocity for a duration — dashes, conveyance, knockback |
| `FLayeredMove_JumpImpulseOverDuration` | `:78` | upward velocity applied across a window |
| `FLayeredMove_JumpTo` | `:118` | parabolic jump to a target location |
| `FLayeredMove_MoveTo` | `:184` | move to a static location over time |
| `FLayeredMove_MoveToDynamic` | `:247` | `MoveTo` tracking a moving target/actor |
| `FLayeredMove_RadialImpulse` | `:284` | explosion-style radial push |
| `FLayeredMove_AnimRootMotion` | `AnimRootMotionLayeredMove.h` | drives movement from a montage's root motion (the Mover path for root-motion abilities) |
| `FLayeredMove_MultiJump` | `MultiJumpLayeredMove.h` | double/N-jump support |
| Launch move | `LaunchMove.h` | launch helper used by physics transitions |

Query & cancel:

```cpp
const FLayeredMove_LinearVelocity* ActiveDash =
    MoverComp->FindActiveLayeredMoveByType<FLayeredMove_LinearVelocity>();  // MoverComponent.h:598

MoverComp->CancelFeaturesWithTag(Tag_Movement_Dash);   // MoverComponent.h:312
// (cancels layered moves & modifiers whose HasGameplayTag matches)
```

## Custom layered move (classic struct flavor)

Override the struct virtuals; **`Clone`, `GetScriptStruct`, and `NetSerialize`
are mandatory** for correct replication/rollback:

```cpp
USTRUCT(BlueprintType)
struct FLayeredMove_HomingDash : public FLayeredMoveBase
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = Mover)
    TWeakObjectPtr<AActor> Target;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = Mover)
    float Speed = 1500.f;

    FLayeredMove_HomingDash()
    {
        DurationMs = 400.f;
        MixMode    = EMoveMixMode::OverrideVelocity;
    }

    virtual bool GenerateMove(const FMoverTickStartData& StartState,
        const FMoverTimeStep& TimeStep, const UMoverComponent* MoverComp,
        UMoverBlackboard* SimBlackboard, FProposedMove& OutProposedMove) override
    {
        const FMoverDefaultSyncState* Sync =
            StartState.SyncState.SyncStateCollection.FindDataByType<FMoverDefaultSyncState>();
        if (!Sync || !Target.IsValid()) { return false; }

        const FVector ToTarget =
            (Target->GetActorLocation() - Sync->GetLocation_WorldSpace()).GetSafeNormal();
        OutProposedMove.MixMode        = MixMode;
        OutProposedMove.LinearVelocity = ToTarget * Speed;
        return true;
    }

    virtual FLayeredMoveBase* Clone() const override
    {
        return new FLayeredMove_HomingDash(*this);
    }
    virtual UScriptStruct* GetScriptStruct() const override
    {
        return FLayeredMove_HomingDash::StaticStruct();
    }
    virtual void NetSerialize(FArchive& Ar) override
    {
        Super::NetSerialize(Ar);
        Ar << Speed;
        // Serialize everything GenerateMove depends on; object refs need care
    }
};
```

Optional hooks: `OnStart`/`OnEnd` (blackboard setup/cleanup), `IsFinished`
(custom end conditions when `DurationMs < 0`), `HasGameplayTag` (enables
tag-based queries/cancellation). `_Async` variants exist for async simulations
(no `MoverComp` access — blackboard only).

From Blueprint: build the struct and call **Queue Layered Move**
(`K2_QueueLayeredMove`, `MoverComponent.h:284` — a `CustomStructureParam`
wildcard node that accepts any `FLayeredMoveBase` subtype).

## Instanced layered moves (5.7: ULayeredMoveLogic)

`LayeredMoveBase.h` introduces a split design intended to supersede the struct
flavor for BP-friendly moves:

- **`ULayeredMoveLogic`** (`LayeredMoveBase.h:120`) — a stateless, Blueprintable
  class holding the behavior (`OnStart`/`GenerateMove`/`IsFinished`/`OnEnd`
  BlueprintNativeEvents) plus defaults (`MixMode`, `Priority`,
  `DefaultDurationMs`, `InstancedDataStructType`).
- **`FLayeredMoveInstancedData`** (`:49`) — the per-activation replicated state.
  Subclass it for custom per-activation fields; the logic reads/writes it via
  `AccessExecutionMoveData<T>()` (C++) or Get/Set Active Move Data (BP).
- **`FLayeredMoveActivationParams`** (`:35`) — optional startup parameter block.

Usage:

```cpp
MoverComp->RegisterMove<UMyDashLogic>();                    // MoverComponent.h:231
MoverComp->QueueLayeredMoveActivation(UMyDashLogic::StaticClass());   // :277
// or with params:
FMyDashActivationParams Params; Params.DurationMs = 300.0;
MoverComp->QueueLayeredMoveActivationWithContext(Params, TSubclassOf<UMyDashLogic>()); // :256
```

One logic instance serves all simultaneous activations; only the instanced data
replicates. Prefer this flavor for new Blueprint-authored moves; the struct
flavor remains fully supported and is what the built-ins use.

## Instant movement effects

`FInstantMovementEffect` (`InstantMovementEffect.h:51`) applies a **one-tick
direct state change** via `ApplyMovementEffect`, then is removed. Use for
anything that would otherwise be a direct transform/velocity write.

Built-ins (`DefaultMovementSet/InstantMovementEffects/BasicInstantMovementEffects.h`):

| Type | Line | Purpose |
|------|------|---------|
| `FTeleportEffect` | 15 | relocate the actor (rollback-safe `SetActorLocation`) |
| `FAsyncTeleportEffect` | 50 | teleport for async/physics sims |
| `FJumpImpulseEffect` | 67 | instantaneous upward velocity (what `UCharacterMoverComponent::Jump` queues) |
| `FApplyVelocityEffect` | 96 | add/overwrite velocity, optionally forcing a mode (the `LaunchCharacter` analog) |

Plus `PhysicsMover/InstantMovementEffects/ApplyVelocityPhysicsMovementEffect.h`
for the physics backend.

Custom effect:

```cpp
USTRUCT(BlueprintType)
struct FSwapToModeAndStopEffect : public FInstantMovementEffect
{
    GENERATED_BODY()

    FName ModeName = DefaultModeNames::Falling;

    virtual bool ApplyMovementEffect(FApplyMovementEffectParams& Params,
                                     FMoverSyncState& OutputState) override
    {
        FMoverDefaultSyncState& Sync =
            OutputState.SyncStateCollection.FindOrAddMutableDataByType<FMoverDefaultSyncState>();
        Sync.SetTransforms_WorldSpace(Sync.GetLocation_WorldSpace(),
            Sync.GetOrientation_WorldSpace(), FVector::ZeroVector, FVector::ZeroVector);
        OutputState.MovementMode = ModeName;
        return true;
    }
    virtual FInstantMovementEffect* Clone() const override
    {
        return new FSwapToModeAndStopEffect(*this);
    }
    virtual UScriptStruct* GetScriptStruct() const override
    {
        return FSwapToModeAndStopEffect::StaticStruct();
    }
};
```

Queue with `QueueInstantMovementEffect` (`MoverComponent.h:336`); it applies at
the end of the current frame or start of the next subtick. In BP: **Queue
Instant Movement Effect**.

### Scheduled effects (networked physics)

`ScheduleInstantMovementEffect` (`MoverComponent.h:342`) delays application by
`EventSchedulingMinDelaySeconds` (tunable via `UNetworkPhysicsSettingsComponent`)
so all networked endpoints execute the effect on the **same simulation frame**
— important for the physics backend where clients run ahead of the server.
Fire-and-forget `QueueInstantMovementEffect` remains correct for the default
Network Prediction backend.

## Choosing the right tool

| Need | Use |
|------|-----|
| Sustained motion for a duration (dash, pull, wind) | layered move |
| One-shot state change (teleport, launch, stop) | instant movement effect |
| Change how the sim behaves without proposing motion (crouch, slow zone) | movement modifier |
| Persistent locomotion behavior (swim, glide, wall-run) | movement mode |
| Montage root motion | `FLayeredMove_AnimRootMotion` |

## References

- `LayeredMove.h`, `LayeredMoveBase.h`, `LayeredMoveGroup.h`,
  `InstantMovementEffect.h`, `MovementModifier.h`.
- `DefaultMovementSet/LayeredMoves/BasicLayeredMoves.h` — read these
  implementations before writing your own.
- `MoveLibrary/MovementMixer.h` — mixing rules.
- `MoverComponent.h` — queue/find/cancel API surface.
