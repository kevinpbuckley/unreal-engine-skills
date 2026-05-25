# AnimGraph IK nodes — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the built-in AnimGraph skeletal control
IK nodes (Two Bone IK, FABRIK, CCDIK), the IK Rig AnimGraph node (`FAnimNode_IKRig`),
performance guidance, and the `UIKRigComponent` goal-feeding pattern. Grounded in UE 5.7
(`Engine/Plugins/Animation/IKRig/Source/IKRig/Public/` and
`Engine/Source/Runtime/AnimGraphRuntime/`).

---

## Built-in skeletal control IK nodes

These nodes live in the AnimBP AnimGraph with no external asset dependency. They are ideal
for localized, single-limb IK needs and are less expensive than a full IK Rig solve.

### Two Bone IK

Analytically solves a three-joint chain (root → mid → end) so the end bone reaches a
target location. Common uses: arm reaching a gun stock, leg reaching a step.

Key properties:
- **Effector Location** — the world-space (or component-space) target position. Feed from
  a socket transform or a line-trace result via a variable pin.
- **Joint Target Location** — a pole-vector hint that controls the bend direction of the
  middle joint (elbow/knee). Always set this; without it the joint bends arbitrarily.
- **Effector Location Space** / **Joint Target Location Space** — match the coordinate
  space of your input (bone, component, world, parent).
- **Allow Stretching** — allows the chain to overextend when the target is out of reach.

### FABRIK (Forward And Backward Reaching IK)

Iterative IK for chains of arbitrary length. Suitable for tails, tentacles, spine lean,
or any chain with more than three joints.

Key properties:
- **Effector Location** — world-space target.
- **Solver iterations** — more iterations = more accurate but more CPU cost. 10–20
  iterations covers most cases; reduce at high LOD.
- **Precision** — convergence threshold; the solver stops when the end bone is within
  this distance of the target.

FABRIK does not support rotation constraints between joints. For constrained chains
(robot arms, mechanical rigs), prefer CCDIK.

### CCDIK (Cyclic Coordinate Descent)

Iterative IK with per-joint rotation constraints. Works on chains from a designated root
bone to an end bone.

Key properties:
- **CCDIK Chain** — define start bone and end bone by name.
- **Effector Location** — target for the end of the chain.
- **Rotation Limit Per Joints** — an array of per-joint `FRotationLimit` structs with
  axis-locked min/max angles. Set limits for realistic joint behavior.
- **Enable Rotation Limit** — toggle constraints per joint.

CCDIK is heavier per iteration than FABRIK; use it only when joint constraints are needed.

---

## FAnimNode_IKRig (IK Rig AnimGraph node)

`FAnimNode_IKRig` (`AnimNode_IKRig.h`:22) integrates a full `UIKRigDefinition` solve into
the AnimGraph. Unlike the skeletal control nodes above, it supports multiple solvers (FBIK,
Limb IK, Set Transform) in a single evaluation pass and can read goals from multiple
`UIKRigComponent` instances on the actor automatically.

### Goal input modes

Goals (`FIKRigGoal`, `IKRigDataTypes.h`) can be fed three ways per goal:
- **Manual Input** — transform provided directly as pins on the AnimBP node (set
  `TransformSource = EIKRigGoalTransformSource::Manual`).
- **Bone** — goal tracks the world transform of a named bone from the input pose.
- **Actor Component** — any `UIKRigComponent` on the owning actor that implements
  `IIKGoalCreatorInterface` is auto-discovered; its goals populate the solver.

The Actor Component mode is the recommended pattern for gameplay-driven IK: game code
writes goal positions to a `UIKRigComponent`, and the AnimBP node picks them up with no
manual wiring.

### Goal space

`EIKRigGoalSpace` (`IKRigDataTypes.h`) controls how the goal transform is interpreted:
- **Component** — relative to the skeletal mesh component origin. Use when your trace
  result is already in component space.
- **World** — absolute world space. Use when the goal comes from a world-space trace hit.
- **Additive** — offset from the current bone position. Use for small procedural
  corrections on top of animation.

Mismatching goal space is the most common source of incorrect IK behavior. Confirm the
space enum matches how you computed your target transform.

### Alpha blending

`FAnimNode_IKRig` supports the same alpha modes as other AnimBP nodes:
- `AlphaInputType` + `Alpha` (float 0–1) for blend strength.
- `bAlphaBoolEnabled` for a boolean on/off.
- `AlphaCurveName` to drive alpha from an animation curve.

Use alpha blending to fade in foot IK when the character lands and fade it out when
jumping, rather than snapping.

### Initialization and reinitialization

The node calls `SetProcessorNeedsInitialized()` internally when the rig asset or goal
array changes. If you swap the rig definition asset at runtime via Blueprint, trigger this
to avoid stale processor state. Access the processor directly for debugging:
`FIKRigProcessor* Proc = AnimNode_IKRig.GetIKRigProcessor()`.

---

## UIKRigComponent goal-feeding pattern

```cpp
// MyCharacter.h
UPROPERTY(VisibleAnywhere)
TObjectPtr<UIKRigComponent> FootIKComp;

// MyCharacter.cpp  (BeginPlay)
FootIKComp = NewObject<UIKRigComponent>(this);
FootIKComp->RegisterComponent();

// MyCharacter.cpp  (Tick, after tracing)
FHitResult LeftHit, RightHit;
// ... perform line traces ...

FootIKComp->SetIKRigGoalPositionAndRotation(
    FName("LeftFoot"),
    LeftHit.ImpactPoint,
    LeftHit.ImpactNormal.ToOrientationQuat(),
    bLeftFootGrounded ? 1.0f : 0.0f,   // position alpha
    bLeftFootGrounded ? 1.0f : 0.0f    // rotation alpha
);

FootIKComp->SetIKRigGoalPositionAndRotation(
    FName("RightFoot"),
    RightHit.ImpactPoint,
    RightHit.ImpactNormal.ToOrientationQuat(),
    bRightFootGrounded ? 1.0f : 0.0f,
    bRightFootGrounded ? 1.0f : 0.0f
);
```

The AnimBP's `FAnimNode_IKRig` will discover `FootIKComp` via the `IIKGoalCreatorInterface`
and consume these goals automatically — no manual pin wiring needed.

---

## Performance tiers

From cheapest to most expensive:

1. **Two Bone IK** (single analytic solve, O(1)) — single limb.
2. **FABRIK / CCDIK** (iterative, cost scales with chain length × iterations).
3. **Limb IK solver in IK Rig** (analytic, similar to Two Bone IK but inside IK Rig).
4. **Full Body IK solver** (iterative PBIK, cost scales with bone count and effectors).

Practical guidance:
- Use Two Bone IK for hands and individual feet on background characters.
- Use Limb IK (via IK Rig) when you need the IK Rig retarget pipeline anyway.
- Reserve FBIK for the player character or other hero characters.
- Combine `LODThreshold` (node-level) and `LODThresholdForIK` (`FAnimNode_RetargetPoseFromMesh`)
  so expensive solvers auto-disable at distance.

---

## Source references (UE 5.7)

- `IKRig/Source/IKRig/Public/AnimNodes/AnimNode_IKRig.h`:22 — `FAnimNode_IKRig`.
- `IKRig/Source/IKRig/Public/AnimNodes/AnimNode_IKRig.h`:97 — `SetProcessorNeedsInitialized()`.
- `IKRig/Source/IKRig/Public/ActorComponents/IKRigComponent.h`:14 — `UIKRigComponent`.
- `IKRig/Source/IKRig/Public/Rig/IKRigDataTypes.h` — `FIKRigGoal`, `EIKRigGoalSpace`,
  `EIKRigGoalTransformSource`.
- `IKRig/Source/IKRig/Public/Rig/Solvers/IKRigFullBodyIK.h`:15 — `FIKRigFBIKGoalSettings`
  (StrengthAlpha, PullChainAlpha, PinRotation).
- `IKRig/Source/IKRig/Public/Rig/Solvers/IKRigLimbSolver.h`:34 — `FIKRigLimbSolver`.

Official docs (UE 5.7):
- IK Rig in Animation Blueprints — <https://dev.epicgames.com/documentation/unreal-engine/ik-rig-in-animation-blueprints-in-unreal-engine>
- IK Rig Solvers — <https://dev.epicgames.com/documentation/unreal-engine/ik-rig-solvers-in-unreal-engine>
