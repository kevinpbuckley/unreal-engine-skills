---
name: control-rig-and-ik
description: Procedural animation and inverse kinematics in Unreal Engine — Control Rig
  (RigVM-based graph that manipulates a bone/control hierarchy), IK Rig (solver definitions
  with Full-Body IK, Limb IK, Set Transform), the IK Retargeter (transfers animation
  between skeletons of different proportions), and lightweight AnimGraph IK nodes
  (Two Bone IK, FABRIK, CCDIK). Use when implementing foot placement on terrain, hand/weapon
  IK, look-at, procedural pose fixups, runtime retargeting, or sharing an animation library
  across characters with different skeletons. Covers UControlRig, URigHierarchy, FRigUnit,
  UIKRigDefinition, UIKRetargeter, FAnimNode_ControlRig, FAnimNode_IKRig,
  FAnimNode_RetargetPoseFromMesh, FIKRigGoal, UControlRigComponent, UIKRigComponent.
metadata:
  engine-version: "5.7"
  category: animation
---

# Control Rig & IK

When baked clips are insufficient — feet must land on uneven terrain, hands must grip a
moving weapon, or animation must transfer between different skeletons — reach for Unreal's
procedural animation suite: **Control Rig**, the **IK Rig**, and the **IK Retargeter**.
Both systems are plugins that extend the core animation system (`animation-system`).

## When to use this skill

- Foot/leg placement on uneven terrain, stairs, or slopes (foot IK, pelvis adjustment).
- Hand/weapon IK, two-handed grips, look-at or aim offsets.
- Procedural secondary motion, runtime pose corrections, or physics-driven adjustments.
- Retargeting an animation library from one character skeleton to another at import time
  (offline) or at runtime via `FAnimNode_RetargetPoseFromMesh`.
- Authoring a Control Rig asset for Sequencer cinematics or building a custom rig in C++.

## The tools — pick by problem

| Tool | Core type | Use for |
|---|---|---|
| **Control Rig** | `UControlRig` / `URigHierarchy` | Custom IK, procedural animation, in-editor keyframing, sequencer |
| **IK Rig** | `UIKRigDefinition` | Solver setup (FBIK, Limb IK) used standalone or as retarget source/target |
| **IK Retargeter** | `UIKRetargeter` | Transfers animation between two IK Rigs; offline export or live runtime |
| **AnimGraph IK nodes** | `FAnimNode_IKRig`, `FAnimNode_RetargetPoseFromMesh` | AnimBP integration of IK Rig and retargeter |
| **Simple limb IK** | Built-in AnimBP nodes | Two Bone IK, FABRIK, CCDIK — single-limb needs without a full Control Rig |

Enable plugins: **Control Rig** and **IK Rig** (both ship with UE; disabled by default).

---

## Control Rig

### Mental model

A Control Rig asset (`UControlRig`) contains a **RigVM graph** that runs node-based logic
over a **`URigHierarchy`** — a tree of typed elements (bones, controls, nulls, curves).
The graph executes on two events: **Forward Solve** (runtime pose evaluation) and
**Backwards Solve** / **Construction** (for editor keyframing and rig setup).

`FRigUnit` is the base struct for every rig graph node. Custom C++ rig units subclass it.
`UControlRig` subclasses `URigVMHost` and exposes `GetHierarchy()` to read/write bone and
control transforms at runtime.

### Placing Control Rig in an AnimGraph

The AnimGraph node `FAnimNode_ControlRig` (`AnimNode_ControlRig.h`:20) integrates a
`UControlRig` into an Animation Blueprint. It accepts a source pose, drives the rig's
Forward Solve each frame, and outputs the modified pose.

Key node properties:
- **Control Rig Class** — the `TSubclassOf<UControlRig>` that the node instantiates.
- **Transfer Input Pose** — lets the rig read the incoming animated pose (required for
  overlay/fixup rigs; disable for fully procedural rigs).
- **Alpha** / **LOD Threshold** — blend strength and max LOD to run the rig.

Expose rig variables as pins on the node (mark them instance-editable in the rig graph),
then wire AnimBP logic (traces, curve reads) into those pins each frame.

### Runtime access via UControlRigComponent

For actors that need Control Rig outside an AnimBP (e.g., a prop driven by game code),
attach a `UControlRigComponent` (`ControlRigComponent.h`:175). It hosts the rig, maps
scene components to rig elements, and ticks the solve each frame independently.

```cpp
// Attach component and assign rig class in the constructor or BeginPlay
UControlRigComponent* CRC = NewObject<UControlRigComponent>(this);
CRC->SetControlRigClass(UMyFootIKRig::StaticClass());
CRC->RegisterComponent();
```

Access the running instance with `CRC->GetControlRig()` and call
`ControlRig->SetControlValue(...)` / `ControlRig->GetControlValue(...)` to drive controls
from game code. `GetHierarchy()` returns the live `URigHierarchy` for direct bone queries.

### Modular Control Rig (UE 5.5+)

`UModularRig` (`ModularRig.h`) composes multiple rig modules into one character rig.
Each `FRigModuleInstance` is a named slot in the modular hierarchy. An agent assembling a
character rig should prefer modular rigs when the character has swappable limb rigs.

### Sequencer integration

Animators keyframe Control Rig controls directly in Sequencer via a Control Rig track
added to a skeletal mesh actor. The rig's **Backwards Solve** event maps keyframed
control transforms back to bones. From C++, retrieve the running rig via
`UControlRig::FindControlRigs(Outer, UControlRig::StaticClass())`.

---

## IK Rig + solvers

### Mental model

An **IK Rig** (`UIKRigDefinition`, `IKRigDefinition.h`:186) is an asset bound to a
skeleton that holds:
- **Goals** (`UIKRigEffectorGoal`) — named effector points with position/rotation targets.
- **Solvers** — ordered stack of `FIKRigSolverBase` subclasses that pull bones toward
  goals. Each solver runs in sequence; results cascade.
- **Retarget chains** (`FBoneChain`) and a **pelvis bone** — used by the retargeter.

Available solvers in `Plugins/Animation/IKRig/Source/IKRig/Public/Rig/Solvers/`:
| Solver | When to use |
|---|---|
| **Full Body IK** (`IKRigFullBodyIK.h`) | Multi-effector, physics-based solver; best for whole-body foot+hand placement |
| **Limb IK** (`IKRigLimbSolver.h`) | Two-bone analytic IK; fast, great for a single arm or leg |
| **Set Transform** | Pins a bone to a goal with no IK solve; useful for pelvis/root offsets |

### Driving IK goals at runtime via UIKRigComponent

Attach a `UIKRigComponent` (`IKRigComponent.h`:14) to the character actor. It implements
`IIKGoalCreatorInterface`, so `FAnimNode_IKRig` automatically discovers and reads its goals.

```cpp
// Drive the left foot goal from game code
UIKRigComponent* IKComp = GetComponentByClass<UIKRigComponent>();
if (IKComp)
{
    // Position in component space of the skeletal mesh; alpha 1 = fully IK-driven
    IKComp->SetIKRigGoalPositionAndRotation(
        FName("LeftFootGoal"),
        LeftFootHitLocation,   // from line trace
        LeftFootHitNormal.Rotation().Quaternion(),
        1.0f,  // position alpha
        1.0f   // rotation alpha
    );
}
```

`FIKRigGoal` (`IKRigDataTypes.h`) carries the goal name, position, rotation, alphas, and
the space enum (`EIKRigGoalSpace`: Component, Additive, or World).

### AnimGraph: FAnimNode_IKRig

Add the **IK Rig** AnimGraph node, assign the `UIKRigDefinition` asset, and wire goal
transforms from pins or from a `UIKRigComponent` on the actor. The node runs the IK solve
on top of the incoming base pose each frame.

```
[Base Pose] → [IK Rig node (RigDefinitionAsset=MyFootIKRig, Goals=...)] → [Output Pose]
```

Place the IK Rig node **after** the state machine / locomotion blend so it modifies an
already-computed base pose.

---

## IK Retargeter

### Mental model

An **IK Retargeter** (`UIKRetargeter`, `IKRetargeter.h`:59) links a *source* `UIKRigDefinition`
to a *target* `UIKRigDefinition`. It matches named **retarget chains** (spine, arm-left,
leg-right…) by fuzzy name and transfers motion proportionally, compensating for different
bone lengths and proportions.

Workflow:
1. Create an IK Rig for the source skeleton; define retarget chains and set the pelvis.
2. Create an IK Rig for the target skeleton; define matching chains.
3. Create an IK Retargeter asset linking source→target.
4. Edit the **Retarget Pose** to align T-pose vs A-pose discrepancies.
5. Either export baked Animation Sequences for the target, or use runtime retargeting.

### Runtime retargeting: FAnimNode_RetargetPoseFromMesh

`FAnimNode_RetargetPoseFromMesh` (`AnimNode_RetargetPoseFromMesh.h`:27) retargets the pose
of a *source* skeletal mesh component onto the current character in real time. The source
mesh component must tick before the target's AnimBP.

```cpp
// Expose on the AnimBP's AnimGraph node (set from game code or a property)
// RetargetFrom = ERetargetSourceMode::CustomSkeletalMeshComponent
// SourceMeshComponent = (set to the source character's USkeletalMeshComponent)
// IKRetargeterAsset = MyRetargeter
```

Key properties: `LODThreshold` (disable retarget above this LOD), `LODThresholdForIK`
(skip IK but keep FK retarget at high LODs for perf), `CustomRetargetProfile` (override
settings at runtime without changing the asset).

See [references/ik-retargeter.md](references/ik-retargeter.md) for the retarget chain
setup, retarget pose workflow, and the Retarget Operation Stack.

---

## Foot placement pattern (common)

A robust foot IK pattern using IK Rig:

1. In the AnimInstance's `NativeUpdateAnimation`, line-trace downward from each foot bone
   (world space). Store hit location, hit normal, and a ground-clearance flag.
2. Pass results into the AnimBP thread as UPROPERTY members.
3. Add a **UIKRigComponent** with a foot IK setup (Limb IK or FBIK, one goal per foot,
   one Set Transform for the pelvis).
4. Each tick, call `SetIKRigGoalPositionAndRotation` for each foot goal and the pelvis.
5. In the AnimGraph, the **IK Rig** node at the end of the graph reads those goal values
   and solves the legs and pelvis in the correct space.

For pelvis adjustment (keep both feet planted): use a **Set Transform** solver on the
pelvis goal, lowering it by the maximum foot-sink distance so legs can reach both feet.

---

## Simple AnimGraph IK (no Control Rig asset required)

Built-in AnimGraph skeletal control nodes for single-limb needs:

| Node | Use |
|---|---|
| **Two Bone IK** | Analytic two-bone solve; use for a single arm/leg reaching a target |
| **FABRIK** | Forward-and-backward IK; chains of arbitrary length (tails, tentacles) |
| **CCDIK** | Cyclic-coordinate descent; chains with angle constraints |

These nodes require no external assets. Set the effector target location each frame from
the AnimBP (typically from a socket or a line-trace result). Place them after the base pose
blend, before output.

---

## Gotchas & edge cases

- **Node order** — Control Rig / IK nodes must appear *after* the base pose they modify.
  Putting IK before the state machine produces zero-pose artifacts.
- **Invalid goal position** — a goal at `FVector::ZeroVector` in world space snaps limbs
  to the character origin. Always validate trace results before passing them as goals.
- **Wrong goal space** — `EIKRigGoalSpace::Component` vs `World` vs `Additive` must match
  how you computed the target. Additive offsets relative to the current bone; Component is
  relative to the skeletal mesh component; World is absolute.
- **Retarget chain mismatch** — unmatched chain names silently fall back to FK-only
  retargeting; confirm chains are matched in the IK Retargeter editor's Hierarchy panel.
- **Retarget pose discrepancy (T vs A pose)** — the single most common source of broken
  retargeting; edit the retarget pose for each skeleton to match the source pose.
- **FBIK on many characters** — Full Body IK is iterative and CPU-heavy; budget using LOD
  thresholds (`LODThresholdForIK` on `FAnimNode_RetargetPoseFromMesh`; `LODThreshold` on
  `FAnimNode_IKRig` and `FAnimNode_ControlRig`).
- **Root motion + IK fighting** — validate locomotion + IK together; IK on an unconstrained
  root can cause visible sliding if the root motion is also changing pelvis height.
- **ModularRig path deprecation** — `GetRigModuleNameSpace()` was deprecated in 5.6;
  use `GetRigModulePrefix()` instead.

## Version notes

- `UModularRig` and the modular rig system landed in UE 5.5; before that, only
  monolithic `UControlRig` existed.
- The IK Retarget Operation Stack (Op Stack) replaced the older per-chain FK/IK settings
  in UE 5.5; the `UIKRetargeter::GetRetargetOps()` accessor reflects this.
- `FAnimNode_RetargetPoseFromMesh` serialization changed in 5.5 (see `WithSerializer`
  trait); `bUseAttachedParent_DEPRECATED` is the old field, removed from active use.
- `FRigUnit` C++ unit upgrade guide for 5.2 API changes: see the official doc link below.

---

## References & source material

Engine source (UE 5.7 — all paths under `Engine/Plugins/Animation/`):
- `ControlRig/Source/ControlRig/Public/ControlRig.h`:60 — `UControlRig` class declaration.
- `ControlRig/Source/ControlRig/Public/ControlRig.h`:201 — `GetHierarchy()`.
- `ControlRig/Source/ControlRig/Public/ControlRig.h`:275 — `Execute(const FName&)`.
- `ControlRig/Source/ControlRig/Public/ControlRig.h`:317 — `SetControlValue<T>()`.
- `ControlRig/Source/ControlRig/Public/AnimNode_ControlRig.h`:20 — `FAnimNode_ControlRig`.
- `ControlRig/Source/ControlRig/Public/ControlRigComponent.h`:175 — `UControlRigComponent`.
- `ControlRig/Source/ControlRig/Public/ModularRig.h` — `UModularRig`, `FRigModuleInstance`.
- `ControlRig/Source/ControlRig/Public/Units/RigUnit.h`:59 — `FRigUnit` base struct.
- `ControlRig/Source/ControlRig/Public/Rigs/RigHierarchy.h`:167 — `URigHierarchy`.
- `ControlRig/Source/ControlRig/Public/Rigs/RigHierarchy.h`:2138 — `GetLocalTransform()`.
- `ControlRig/Source/ControlRig/Public/Rigs/RigHierarchy.h`:2186 — `SetLocalTransform()`.
- `ControlRig/Source/ControlRig/Public/Rigs/RigHierarchy.h`:2234 — `GetGlobalTransform()`.
- `IKRig/Source/IKRig/Public/Rig/IKRigDefinition.h`:134 — `FBoneChain`.
- `IKRig/Source/IKRig/Public/Rig/IKRigDefinition.h`:165 — `FRetargetDefinition`.
- `IKRig/Source/IKRig/Public/Rig/IKRigDefinition.h`:186 — `UIKRigDefinition`.
- `IKRig/Source/IKRig/Public/Rig/Solvers/IKRigFullBodyIK.h`:15 — `FIKRigFBIKGoalSettings` (FBIK solver settings).
- `IKRig/Source/IKRig/Public/Rig/Solvers/IKRigLimbSolver.h`:34 — `FIKRigLimbSolver`.
- `IKRig/Source/IKRig/Public/Retargeter/IKRetargeter.h`:21 — `FIKRetargetPose`.
- `IKRig/Source/IKRig/Public/Retargeter/IKRetargeter.h`:59 — `UIKRetargeter`.
- `IKRig/Source/IKRig/Public/AnimNodes/AnimNode_IKRig.h`:22 — `FAnimNode_IKRig`.
- `IKRig/Source/IKRig/Public/AnimNodes/AnimNode_RetargetPoseFromMesh.h`:27 — `FAnimNode_RetargetPoseFromMesh`.
- `IKRig/Source/IKRig/Public/ActorComponents/IKRigComponent.h`:14 — `UIKRigComponent`.
- `IKRig/Source/IKRig/Public/Rig/IKRigDataTypes.h` — `FIKRigGoal`, `EIKRigGoalSpace`.

Official docs (UE 5.7, confirmed live):
- Control Rig overview — <https://dev.epicgames.com/documentation/unreal-engine/control-rig-in-unreal-engine>
- Control Rig in Animation Blueprints — <https://dev.epicgames.com/documentation/unreal-engine/control-rig-in-animation-blueprints-in-unreal-engine>
- IK Rig editor — <https://dev.epicgames.com/documentation/unreal-engine/ik-rig-in-unreal-engine>
- IK Rig Retargeting — <https://dev.epicgames.com/documentation/unreal-engine/ik-rig-animation-retargeting-in-unreal-engine>

Deep-dive references in this skill:
- [references/control-rig-graph.md](references/control-rig-graph.md) — RigVM graph
  concepts, FRigUnit authoring, hierarchy element types, solve events.
- [references/ik-retargeter.md](references/ik-retargeter.md) — retarget chain setup,
  retarget pose workflow, Op Stack, runtime retargeting with FAnimNode_RetargetPoseFromMesh.
- [references/animgraph-ik-nodes.md](references/animgraph-ik-nodes.md) — Two Bone IK,
  FABRIK, CCDIK, Leg/Foot IK node details and performance guidance.

Related skills: `animation-system`, `sequencer-and-cinematics`.
