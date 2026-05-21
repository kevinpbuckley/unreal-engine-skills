---
name: control-rig-and-ik
description: Add procedural animation and inverse kinematics in Unreal — Control Rig (in-engine
  rigging/animation graphs), the IK Rig (full-body IK solvers), and the IK Retargeter (transfer
  animation between skeletons of different proportions), plus simple AnimGraph IK nodes. Use when
  implementing foot placement, hand/weapon IK, look-at, procedural adjustments, or retargeting
  animations from one character to another.
metadata:
  engine-version: "5.7"
  category: animation
---

# Control Rig & IK

When baked clips aren't enough — feet need to match the ground, hands need to hold a moving
weapon, or animations must move from one skeleton to a differently-proportioned one — use
procedural animation: **Control Rig**, **IK Rig**, and the **IK Retargeter**. These are plugins
layered on the core animation system (`animation-system`).

## When to use this skill

- Foot placement on uneven terrain / stairs (foot IK).
- Hand/weapon IK, two-handed grips, look-at / aim offsets.
- Procedural secondary motion or runtime pose fixups.
- Retargeting animations between characters with different skeletons/proportions.

## The tools (pick by problem)

| Tool | What it is | Use for |
|---|---|---|
| **Control Rig** | a node graph that manipulates a rig hierarchy (controls → bones) | procedural animation, custom IK, in-editor keyframing, gameplay rig logic |
| **IK Rig** | a solver setup (e.g. Full Body IK) on a skeleton | runtime IK and as retarget source/target |
| **IK Retargeter** | maps/transfers animation between two IK Rigs | reusing animations across skeletons |
| AnimGraph IK nodes | built-in nodes (Two Bone IK, FABRIK, CCDIK, Leg/Foot IK) | quick limb IK without a full Control Rig |

Enable the relevant plugins: **Control Rig**, **IK Rig**.

## Control Rig

A `UControlRig` runs a RigVM graph over a hierarchy of bones/controls. Run it:
- **In the AnimGraph** via a Control Rig node — for runtime procedural adjustments (foot IK,
  spine lean) applied after the base pose.
- **In Sequencer** — animators keyframe the rig controls directly for cinematics
  (`sequencer-and-cinematics`).

Typical runtime use: a Control Rig node near the end of the AnimGraph reads inputs you set in the
AnimInstance (ground trace results, look target) and solves IK on top of the animated pose.

## IK Rig + Retargeter (animation reuse)

- An **IK Rig** (`UIKRigDefinition`) defines retarget chains (spine, arms, legs) and solvers on a
  skeleton.
- An **IK Retargeter** (`UIKRetargeter`) connects a *source* IK Rig to a *target* IK Rig and
  transfers motion, compensating for different bone lengths/proportions.
- Use it to run, say, Manny/Quinn (UE5 mannequin) animations on a custom character, or share an
  animation library across many characters. You can retarget assets in the editor (creating new
  sequences) or retarget at runtime.

## Foot placement pattern (common)

1. In the AnimInstance, line-trace down from each foot to find ground height/normal.
2. Pass the results into the AnimGraph as variables.
3. A Control Rig node (or Leg/Foot IK + Two Bone IK nodes) offsets the feet to the ground and tilts
   them to the surface; adjust the pelvis to keep both feet planted.

## Simple AnimGraph IK (no full Control Rig)

For a single limb (e.g. hand to a weapon socket), a **Two Bone IK** node with an effector target
is enough. **FABRIK**/**CCDIK** handle chains (tails, tentacles). Use these before reaching for a
full Control Rig when the need is localized.

## Gotchas

- **Order in the AnimGraph matters** — IK/Control Rig must come *after* the base pose it modifies.
- **IK without a valid effector target** snaps limbs to the origin; always feed valid targets.
- **Retargeting between mismatched rigs** (bad chain mapping) yields broken poses — set up chains
  carefully and test.
- **Heavy Control Rig graphs on many characters** cost CPU; budget and LOD them.
- **Mixing root motion with IK** can fight; validate locomotion + IK together.
- These are evolving 5.x systems — confirm node/API names against the 5.7 plugin source.

## References & source material

Engine source (UE 5.7):
- `Engine/Plugins/Animation/ControlRig/Source/ControlRig/Public/ControlRig.h` — `UControlRig`.
- `Engine/Plugins/Animation/IKRig/Source/IKRig/Public/Rig/IKRigDefinition.h` — `UIKRigDefinition`.
- `Engine/Plugins/Animation/IKRig/Source/IKRig/Public/Retargeter/IKRetargeter.h` — `UIKRetargeter`.

Official docs (UE 5.7): Animating Characters and Objects —
<https://dev.epicgames.com/documentation/unreal-engine/animating-characters-and-objects-in-unreal-engine>

Related: `animation-system`, `sequencer-and-cinematics`.
