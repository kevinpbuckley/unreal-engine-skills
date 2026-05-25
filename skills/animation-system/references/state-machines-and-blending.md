# State machines, sync groups & blending — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers AnimGraph state machines, sync groups,
inertialization, layered bone blending, and blend spaces. Grounded in UE 5.7
(`Runtime/Engine/Classes/Animation/AnimNode_StateMachine.h`,
`Runtime/Engine/Classes/Animation/AnimStateMachineTypes.h`,
`Runtime/AnimGraphRuntime/Public/AnimNodes/AnimNode_LayeredBoneBlend.h`).

## State machine structure

An AnimGraph state machine (`FAnimNode_StateMachine`, `AnimNode_StateMachine.h`:122) is a
graph of **states** and **transitions**. Each state holds its own sub-graph (a blend space,
a sequence player, or another state machine). Transitions carry a **rule** (a Boolean
expression or a time condition) evaluated each frame.

From C++, query the active state (useful for debugging or post-processing):

```cpp
// Get the state machine node from the AnimBP's generated class
// (Typically done in NativeUpdateAnimation or post-evaluate)
FAnimNode_StateMachine* SM = GetStateMachineInstanceFromName(FName("Locomotion"));
if (SM)
{
    FName CurrentState = SM->GetCurrentStateName();   // AnimNode_StateMachine.h:178
    float Weight = SM->GetStateWeight(0);             // index of "Idle" state:258
}
```

Drive transitions through `UPROPERTY` variables — never manipulate the state machine node
directly to force transitions (there is no public API for this; drive the rule expression).

## Transition rules best practices

- Keep rule expressions simple: read a `float Speed > 150.f` or a `bool bIsAiming`.
- Set **Blend Time** on transitions to avoid pops. Use **Automatic Rule Based on Sequence
  Player in State** for cyclic locomotion states so transitions trigger as the cycle
  approaches its end.
- Use **Transition Interrupt** settings to allow higher-priority states (hurt, death) to
  cut in without waiting for the current transition to finish.

## Sync groups

Sync groups keep locomotion cycles that play simultaneously (walk/run blend) locked to the
same phase, preventing foot-slide when crossing blend boundaries. Assign the same sync group
name to the sequence player nodes that should be synchronized; the "leader" (highest weight)
drives the phase for all followers.

```
Blend Space (Walk–Run blending)
  └─ Sequence Player "Walk"  [Sync Group: "LocomotionSync", Leader Priority: 0]
  └─ Sequence Player "Run"   [Sync Group: "LocomotionSync", Leader Priority: 1]
```

Sync groups are configured on the sequence player nodes in the AnimBP editor. No C++ API is
needed unless writing custom anim nodes.

## Inertialization

**Inertialization** (`AnimNode_Inertialization`,
`Runtime/Engine/Classes/Animation/AnimNode_Inertialization.h`) replaces traditional
cross-fades for many transitions. Instead of maintaining two full pose evaluations during a
blend, it records the velocity of the outgoing pose and extrapolates it to zero over the
blend duration. Cost is significantly lower for large-scale crowds.

Place an `Inertialization` node after the state machine in the AnimGraph. Enable transitions
to use **Inertialization** in the transition rule (set **Blend Logic** to "Inertialization").

The node is controlled entirely from the AnimBP editor; no C++ API is required for typical
use.

## Layered bone blending

`FAnimNode_LayeredBoneBlend` (`AnimNode_LayeredBoneBlend.h`) blends up to N pose inputs
over a base pose, with per-bone blend weights defined by a **Blend Mask**:

Common uses:
- **Upper-body montage over lower-body locomotion** — blend mask covers the spine and above
  at weight 1.0, legs at 0.0.
- **Additive aim offset** — `ELayeredBoneBlendMode::BranchFilter` lets you add rotation
  offsets to specific bones.

```
[Locomotion SM] ─┐ (base pose)
[Slot "UpperBody"] ─┤ (layer 0, blend mask: spine→)
[FAnimNode_LayeredBoneBlend] → Output
```

The blend mask is an asset-level setting on the `UBlendProfile`; assign it to the node's
`BlendMasks` array in the editor. No runtime C++ API is typically needed.

## Blend spaces and aim offsets

- `UBlendSpace` (2D) — two axes (e.g. horizontal speed × vertical speed, or speed ×
  direction). Samples are placed on a grid; runtime input interpolates between neighbors.
- `UBlendSpace1D` — single axis (e.g. speed 0–600).
- `UAimOffsetBlendSpace` — additive blend space intended for yaw/pitch aim offsets.
  Evaluated as additive, layered on top of a base pose.

Feed blend spaces from the C++ update:

```cpp
// In NativeThreadSafeUpdateAnimation
Speed     = Velocity.Size2D();
Direction = UKismetAnimationLibrary::CalculateDirection(Velocity, ActorRotation);
```

The AnimGraph's **Blend Space Player** node reads `Speed` and `Direction` directly as pin
inputs when you wire them from the variables.

## Pose caching

Use **Save Cached Pose** / **Use Cached Pose** nodes to evaluate an expensive sub-graph once
and reuse the result in multiple branches (e.g. the same locomotion result fed to both a
layered blend and a physics blend). This avoids evaluating the same graph twice.

## Performance guidelines

| Technique | Cost | Notes |
|---|---|---|
| State machine with simple rules | Low | Preferred baseline |
| Blend space | Low | Pre-sampled grid; very cheap |
| Inertialization | Low | Cheaper than cross-fades for many characters |
| Layered bone blend | Medium | One extra pose evaluation per layer |
| Cross-fade (traditional blend) | Medium | Two full sub-graphs in flight |
| Control Rig IK solve | Medium–High | Per-bone FK/IK; batch on dedicated thread |

For large numbers of background characters, use the **Animation Sharing** plugin or the
**Animation Budget Allocator** to throttle update frequency dynamically.

## Related

- `AnimNode_StateMachine.h`: `FAnimNode_StateMachine`:122, `GetCurrentStateName`:178,
  `GetStateWeight`:258.
- `AnimStateMachineTypes.h`: `UAnimStateMachineTypes`:412.
- `AnimNode_LayeredBoneBlend.h`: `FAnimNode_LayeredBoneBlend`:21, `BlendMode`:36.
- Official doc: [State Machines](https://dev.epicgames.com/documentation/unreal-engine/state-machines-in-unreal-engine)
- Official doc: [Sync Groups](https://dev.epicgames.com/documentation/unreal-engine/animation-sync-groups-in-unreal-engine)
- Official doc: [Blend Spaces](https://dev.epicgames.com/documentation/unreal-engine/blend-spaces-in-unreal-engine)
- Official doc: [Using Layered Animations](https://dev.epicgames.com/documentation/unreal-engine/using-layered-animations-in-unreal-engine)
