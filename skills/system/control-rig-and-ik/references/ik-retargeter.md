# IK Retargeter — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers IK Rig retarget chain setup, the retarget
pose workflow, the Retarget Operation Stack, and runtime retargeting with
`FAnimNode_RetargetPoseFromMesh`. Grounded in UE 5.7
(`Engine/Plugins/Animation/IKRig/Source/IKRig/Public/`).

---

## Retarget chain concept

The IK Retargeter transfers animation chain-by-chain, not bone-by-bone. A **retarget chain**
(`FBoneChain`, `IKRigDefinition.h`:134) spans from a start bone to an end bone and carries
an optional IK Goal. The retargeter matches chains between source and target by fuzzy name
(e.g., `ArmLeft` matches `left_arm`).

Chains are stored in `FRetargetDefinition` (`IKRigDefinition.h`:165), which also holds the
**pelvis bone** name. The pelvis controls how root motion height transfers proportionally.

On `UIKRigDefinition` (`IKRigDefinition.h`:186), the relevant accessors are:
- `GetRetargetChains()` — read-only access to all `FBoneChain` entries.
- `GetPelvis()` — the name of the designated pelvis/root bone.
- `GetRetargetChainByName(FName)` — look up a chain by name.

Do not mutate these directly; use `UIKRigController` (editor-only) or Python scripting for
asset construction.

---

## Setting up retarget chains (workflow)

For each of the two skeletons (source and target):

1. Open the IK Rig asset and add chains via **IK Retargeting > Add New Chain**.
2. Assign **Start Bone** and **End Bone** for each limb (arm, leg, spine, head, etc.).
3. Designate the **Pelvis** bone by right-clicking it in the Hierarchy panel.
4. Optionally add an IK Goal to a chain for contact-accurate retargeting (foot/hand
   planting during retarget). This requires a Solver on the IK Rig.

In the IK Retargeter asset, match source and target chains by name. The auto-matching
resolves most standard humanoid setups; manually override mismatches in the Hierarchy panel.

Common chain name conventions the auto-match recognizes: `Arm`, `Leg`, `Spine`, `Head`,
`Neck`, `Tail`, `Thumb`, `Index`, `Middle`, `Ring`, `Pinky` (prefix `Left`/`Right` for
symmetrical chains, or use `_l`/`_r` suffixes — fuzzy matching handles both).

---

## Retarget pose editing

A **retarget pose** (`FIKRetargetPose`, `IKRetargeter.h`:21) stores per-bone delta
rotations (local space) and a root translation offset. Its purpose is to align the
reference pose of the source and target before retargeting begins — most commonly correcting
T-pose vs A-pose differences.

The retarget pose is accessed per-side (source or target) via:
`UIKRetargeter::GetCurrentRetargetPose(ERetargetSourceOrTarget)`.

Editing workflow in the editor:
1. Toggle to **Edit Retarget Pose** mode in the toolbar.
2. Select bones in the viewport or Hierarchy panel and rotate them to match the other
   skeleton's bind pose.
3. Use **Auto Align > Direction** for a fast starting point, then manually refine.
4. Toggle back to **Running Retarget** to preview against a source animation.

For non-default poses, create a new named pose rather than modifying **Default Pose**
so the original can always be restored.

---

## Retarget Operation Stack

The Op Stack (visible as the "Op Stack" panel in the IK Retargeter editor) replaces older
per-chain FK/IK checkboxes (pre-5.5). Operations run sequentially on the retargeted pose.

Available operations (in `IKRetargetOps.h` and `IKRetargetSettings.h`):
- **FK** — copies FK bone rotations from source chain to target chain, scaled by proportion.
- **IK** — runs the IK solver to pin the end-effector at the source's world position;
  requires an IK Goal on the chain.
- **Speed Plant** — clamps foot goals during low-speed locomotion to prevent foot sliding.
- **Stride Warping** — scales stride length when target character proportions differ.
- **Blend to Source** — blends the retargeted pose back toward the source pose by alpha.

Each operation supports:
- A per-operation LOD threshold — operations above the threshold are skipped.
- Debug draw — visualize chain assignments in-game via the operation's settings.

To query or iterate operations at runtime:

```cpp
// Get all operations of a type from the retargeter asset
UIKRetargeter* Retargeter = ...;
// FIKRetargetOpBase* Op = Retargeter->GetRetargetOpByName(FName("SpeedPlant"));
// Or use GetFirstRetargetOpOfType<T>() / GetAllRetargetOpsOfType<T>()
```

`UIKRetargeter::GetRetargetOps()` returns the raw `TArray<FInstancedStruct>`.

---

## Runtime retargeting: FAnimNode_RetargetPoseFromMesh

`FAnimNode_RetargetPoseFromMesh` (`AnimNode_RetargetPoseFromMesh.h`:27) evaluates the
IK Retargeter at runtime each frame, streaming the source character's pose onto the target.

### Setup requirements

- The source `USkeletalMeshComponent` must **tick before** the target's AnimBP. Ensure
  tick order or use `AddTickPrerequisiteComponent`.
- Set `RetargetFrom = ERetargetSourceMode::CustomSkeletalMeshComponent` and assign
  `SourceMeshComponent` (as a pin, driven from game code).
- Set `IKRetargeterAsset` to the pre-built `UIKRetargeter` asset.

### Performance properties

| Property | Effect |
|---|---|
| `LODThreshold` | Disables the entire node above this LOD |
| `LODThresholdForIK` | Skips only the IK pass; FK retarget still runs |
| `bSuppressWarnings` | Silences missing-chain warnings (useful in shipping builds) |

Example: for a crowd background character, set `LODThresholdForIK = 1` so FBIK only runs
at LOD 0 while FK retarget continues at LOD 1+.

### Retarget profile override

`FRetargetProfile` (`IKRetargetProfile.h`) carries per-chain settings that override the
asset. Assign a `CustomRetargetProfile` pin on the node to alter settings at runtime (e.g.,
disable IK in a specific gameplay state) without modifying the shared asset.

---

## Asset retargeting (offline)

In the IK Retargeter editor, select source animations in the **Asset Browser** and click
**Export Selected Animations**. This bakes new `UAnimSequence` assets bound to the target
skeleton, with no runtime cost. Use this for hero characters that ship with their own
animation set; use runtime retargeting for NPCs or crowds that share a source library.

---

## Source references (UE 5.7)

All paths under `Engine/Plugins/Animation/IKRig/Source/IKRig/Public/`:
- `Rig/IKRigDefinition.h`:134 — `FBoneChain`.
- `Rig/IKRigDefinition.h`:165 — `FRetargetDefinition`.
- `Rig/IKRigDefinition.h`:186 — `UIKRigDefinition`, `GetRetargetChains()`, `GetPelvis()`.
- `Retargeter/IKRetargeter.h`:21 — `FIKRetargetPose`.
- `Retargeter/IKRetargeter.h`:59 — `UIKRetargeter`, `GetIKRig()`, `GetRetargetOps()`.
- `Retargeter/IKRetargetSettings.h` — `FRetargetProfile`, per-op LOD settings.
- `AnimNodes/AnimNode_RetargetPoseFromMesh.h`:27 — `FAnimNode_RetargetPoseFromMesh`.
- `AnimNodes/AnimNode_RetargetPoseFromMesh.h`:37 — `ERetargetSourceMode`.

Official docs (UE 5.7):
- IK Rig Retargeting — <https://dev.epicgames.com/documentation/unreal-engine/ik-rig-animation-retargeting-in-unreal-engine>
