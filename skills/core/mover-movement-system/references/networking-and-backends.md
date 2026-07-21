# Mover: networking, backends & custom state data

How Mover actors simulate, replicate, and roll back — and how to extend the
replicated state. Paths are relative to
`Engine/Plugins/Experimental/Mover/Source/Mover/Public/` (UE 5.7).

## The backend liaison model

`UMoverComponent` contains *what* to simulate; a **backend liaison** decides
*when and under which netcode*. The liaison is an actor component implementing
`IMoverBackendLiaisonInterface` (`Backends/MoverBackendLiaison.h:24`),
instantiated automatically from `UMoverComponent::BackendClass`
(`MoverComponent.h:185`, default `UMoverNetworkPredictionLiaisonComponent`,
set in `MoverComponent.cpp:77`). It calls back into the component:
`ProduceInput` → `SimulationTick` → `FinalizeFrame`, plus `RestoreFrame` for
rollbacks (`MoverComponent.h:160-181`).

| Backend | Class | Character component | Modes | Notes |
|---------|-------|--------------------|-------|-------|
| Network Prediction (default) | `UMoverNetworkPredictionLiaisonComponent` (`Backends/MoverNetworkPredictionLiaison.h:28`) | `UCharacterMoverComponent` | `UWalkingMode` etc. | kinematic; client prediction + server authority + rollback via the Network Prediction plugin |
| Chaos networked physics | `UMoverNetworkPhysicsLiaisonComponentBase` (`Backends/MoverNetworkPhysicsLiaisonBase.h:188`) | `UPhysicsCharacterMoverComponent` (`PhysicsMover/PhysicsCharacterMoverComponent.h:15`) | `PhysicsDrivenWalkingMode` etc. (`PhysicsMover/Modes/`) | movement solved in the physics thread; interacts properly with simulated rigid bodies; uses Chaos physics resimulation |
| Standalone | `UMoverStandaloneLiaisonComponent` (`Backends/MoverStandaloneLiaison.h:98`) | either | any | no networking; lowest overhead for single-player / offline actors |
| Pathed physics | `MoverPathedPhysicsLiaison.h` | `PathedPhysicsMoverComponent` | `PathedMovementMode` | 5.7 mover-based movers for platforms/doors following paths |

Notes:

- The old `UMoverNetworkPhysicsLiaisonComponent`
  (`Backends/MoverNetworkPhysicsLiaison.h:26`) is marked DEPRECATED — derive
  from / use the `...Base` class path in 5.7.
- The physics backend requires Chaos networked-physics prediction to be enabled
  (project settings / `np2`-`p.net` CVar family) and a fixed physics tick;
  consult the Mover plugin README and `PhysicsMover/PhysicsMoverManager.h`.
- `IsAsync()` liaisons run `SimulationTick` off the game thread — all modes,
  transitions, and layered moves involved must have `bSupportsAsync = true` and
  avoid touching UObjects/world state outside the provided params.

## Simulation data model

Everything the simulation needs is in three snapshot structs
(`MoverSimulationTypes.h`):

- **Input cmd** — `FMoverInputCmdContext` (`:152`): a `FMoverDataCollection` of
  `FMoverDataStructBase` entries. Authored on the owning client each frame,
  sent to the server, replayed during resim.
- **Sync state** — `FMoverSyncState` (`:191`): mode name + layered moves +
  modifiers + state collection (always contains `FMoverDefaultSyncState`).
  Replicated; compared for reconciliation.
- **Aux state** — `FMoverAuxStateContext` (`:320`): rarely-changing auxiliary
  input to the sim (reserved for slow-changing data; often empty).

The flow per network role:

- **Autonomous proxy (owning client)**: produce input → predict simulation →
  send input to server → compare incoming authoritative state
  (`ShouldReconcile`, `MoverSimulationTypes.h:253`) → on mismatch, roll back
  (`RestoreFrame`) and resimulate all frames since, replaying stored inputs.
- **Authority (server)**: simulate authoritatively from received (or locally
  produced) inputs.
- **Simulated proxy (other clients)**: interpolate/extrapolate replicated sync
  states; `bSyncInputsForSimProxy` (`MoverComponent.h:841`) optionally ships
  inputs too (useful for anim graphs reading intent).

Reacting to rollbacks: `OnPostSimulationRollback` (`MoverComponent.h:111`)
fires with the timestep rolled back to and the expunged one — use it to reset
FX/audio/cosmetics that were predicted wrongly. `FMoverTimeStep`
(`MoverTypes.h:86`) carries `bIsResimulating`; gate one-shot cosmetic effects
on it inside sim-adjacent delegates (`OnPreSimulationTick`, `OnPostMovement`).

### Smoothing

With fixed-tick simulation, render frames fall between sim frames.
`SmoothingMode` (`MoverComponent.h:829`, `EMoverSmoothingMode`) defaults to
`VisualComponentOffset`: the **primary visual component** (typically the mesh —
`SetPrimaryVisualComponent`, `MoverComponent.h:466`) is offset smoothly while
the root collision snaps at sim rate. Corrections on simulated proxies are
absorbed the same way.

## Custom replicated movement state (the FSavedMove replacement)

To predict game-specific state (stamina drain while sprinting, charge level,
wall-run normal), add your own struct to the collections:

```cpp
USTRUCT(BlueprintType)
struct FMyMovementFlags : public FMoverDataStructBase   // MoverTypes.h:113
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadWrite, Category = Mover)
    bool bWantsToSprint = false;

    virtual FMoverDataStructBase* Clone() const override
    {
        return new FMyMovementFlags(*this);
    }
    virtual UScriptStruct* GetScriptStruct() const override { return StaticStruct(); }

    virtual bool NetSerialize(FArchive& Ar, UPackageMap* Map, bool& bOutSuccess) override
    {
        Ar.SerializeBits(&bWantsToSprint, 1);
        bOutSuccess = true;
        return true;
    }
    virtual bool ShouldReconcile(const FMoverDataStructBase& AuthorityState) const override
    {
        return bWantsToSprint !=
            static_cast<const FMyMovementFlags&>(AuthorityState).bWantsToSprint;
    }
    virtual void Interpolate(const FMoverDataStructBase& From,
                             const FMoverDataStructBase& To, float Pct) override
    {
        *this = static_cast<const FMyMovementFlags&>(To);  // snap for bools
    }
};
```

- **As input**: write it in `ProduceInput` —
  `InputCmdResult.InputCollection.FindOrAddMutableDataByType<FMyMovementFlags>()`.
  Custom modes read it from `StartState.InputCmd.InputCollection`.
- **As sync state**: add the type to
  `UMoverComponent::PersistentSyncStateDataTypes` (`MoverComponent.h:200`,
  `FMoverDataPersistence`, `MoverTypes.h:352`) so every frame carries it
  (optionally copied forward from the prior frame). Modes then read from the
  start state and write to `OutputState.SyncState.SyncStateCollection`.

Override contract (`MoverTypes.h:113-168`): `Clone` + `GetScriptStruct`
always; `NetSerialize` + `ShouldReconcile` + `Interpolate` for anything
replicated; `Merge`/`Decay` additionally for **physics-backend input** structs.
An overly sensitive `ShouldReconcile` causes correction storms — compare with
tolerances, and only on fields the server actually simulates.

## Network Prediction backend specifics

- The NP plugin (`Engine/Plugins/Runtime/NetworkPrediction/`) manages frame
  buffers, input sending rates, and interpolation. Its fixed/independent tick
  settings come from NP's own config (`NetworkPredictionSettings`), not Mover.
- Mover registers its NP model via the liaison
  (`Backends/MoverNetworkPredictionLiaison.h`); you rarely touch NP types
  directly, but `np2.*` console variables and the NP Insights trace are the
  main debugging tools.
- Simulation is deterministic per-frame from (input, state) — keep all
  randomness out of modes/layered moves, or seed it from replicated state.

## Physics backend specifics

- Use `UPhysicsCharacterMoverComponent` + `PhysicsDriven*` modes
  (`PhysicsMover/Modes/`), which solve movement inside the Chaos physics
  thread; the updated component must simulate physics.
- Instant effects should go through `ScheduleInstantMovementEffect`
  (`MoverComponent.h:342`) so all endpoints apply them on the same physics
  frame (delay via `UNetworkPhysicsSettingsComponent`).
- Stance/jump equivalents live in `PhysicsMover/MovementModifiers/` and
  `PhysicsMover/Transitions/`.
- 5.7's ChaosMover plugin (`Engine/Plugins/Experimental/ChaosMover/`) hosts the
  async simulation core these liaisons build on.

## Debugging

- `UMoverDebugComponent` (`Debug/MoverDebugComponent.h`) — trajectory history,
  floor/basing debug draw; add it to the pawn.
- Console: the `Mover.*` CVar family (e.g. debug drawing, state logging
  toggles) and `LogMover` log category (`MoverLog.h`).
- Gameplay Insights / Chaos Visual Debugger integration ships in the
  `MoverCVDData` module — record CVD captures to inspect physics-backend sim
  state per frame.
- Rollback issues: bind `OnPostSimulationRollback` and log the frame span;
  frequent rollbacks usually mean a `ShouldReconcile` tolerance too tight, or
  non-determinism (game-thread reads, `FMath::RandRange`, wall-clock time) in a
  mode/layered move.

## CMC vs Mover networking at a glance

| | CMC | Mover |
|---|-----|-------|
| Model | client move RPCs (`ServerMove`) + server corrections (`ClientAdjustPosition`) | generalized rollback: replicated input/sync structs, resimulation |
| Custom predicted state | subclass `FSavedMove_Character`, compressed flags | add `FMoverDataStructBase` types to input/sync collections |
| Physics interaction | kinematic capsule, limited push/impulse handling | optional fully physics-driven backend |
| Smoothing | mesh smoothing in CMC (`NetworkSmoothingMode`) | `EMoverSmoothingMode::VisualComponentOffset` |
| Determinism requirement | loose (server replays inputs through same code) | strict — resim must reproduce identical results |

## References

- `Backends/*.h` — liaison interface and implementations.
- `MoverSimulationTypes.h`, `MoverTypes.h` — data model & reconcile contract.
- `PhysicsMover/` — physics-driven movement set.
- `Debug/MoverDebugComponent.h` — debugging aid.
- Official docs: Mover features & concepts —
  <https://dev.epicgames.com/documentation/unreal-engine/mover-features-and-concepts-in-unreal-engine>
- Network Prediction plugin docs (background for the default backend) —
  `Engine/Plugins/Runtime/NetworkPrediction/`.
