# Control Rig graph — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the RigVM graph, `FRigUnit` C++ authoring,
`URigHierarchy` element types, solve events, and the Modular Rig system. Grounded in UE 5.7
(`Engine/Plugins/Animation/ControlRig/Source/ControlRig/Public/`).

---

## The RigVM graph and URigVMHost

`UControlRig` inherits from `URigVMHost`, which owns the virtual machine that evaluates
the node graph at runtime. The VM compiles graph nodes into a flat bytecode that runs with
no per-node allocation overhead. The key lifecycle:

1. **Construction event** — runs once when the rig is initialized; sets up the default
   hierarchy pose and initializes any data.
2. **Forward Solve event** — runs every frame via `UControlRig::Execute(FName("Update"))`;
   reads input data, runs IK/FK solvers, writes final bone transforms.
3. **Backwards Solve event** — runs in the editor when an animator moves controls in
   Sequencer; maps control transforms back to the output pose for baking.

At runtime, `FAnimNode_ControlRig::Evaluate_AnyThread` calls `Execute` on the rig instance,
then copies the solved hierarchy pose back to the anim graph's `FCompactPose`.

---

## URigHierarchy — element types

`URigHierarchy` (`RigHierarchy.h`:167) is the data model for all rig elements. Every
element is identified by an `FRigElementKey` (an `FName` + `ERigElementType` pair).

| Element type | Purpose |
|---|---|
| **Bone** | Mirrors the skeleton's bone hierarchy; primary output written to the mesh |
| **Control** | Named, animatable control point (float, vector, transform, etc.); exposed in Sequencer |
| **Null** | A transform-only node with no mesh counterpart; used as pivot or parent |
| **Curve** | A float channel, driven by morph targets or procedural logic |
| **Physics** | A physics simulation body (UE 5.3+) |

Access transforms from C++:

```cpp
// Read a bone's current global transform
URigHierarchy* Hier = ControlRig->GetHierarchy();
FRigElementKey BoneKey(FName("foot_l"), ERigElementType::Bone);
FTransform T = Hier->GetGlobalTransform(BoneKey);   // RigHierarchy.h:2234

// Write a bone's local transform (non-initial, affects children)
Hier->SetLocalTransform(BoneKey, NewLocal);          // RigHierarchy.h:2186
```

`GetLocalTransform` / `SetLocalTransform` operate in the element's parent space.
`GetGlobalTransform` / `SetGlobalTransform` operate in rig (component) space.
Pass `bInitial = true` to read/write the reference pose.

---

## Authoring a custom FRigUnit

`FRigUnit` (`Units/RigUnit.h`:59) is the base struct for every graph node. Custom nodes
subclass it:

```cpp
// MyIKUnit.h  (ControlRig module dependency required in build.cs)
#pragma once
#include "Units/RigUnit.h"
#include "MyIKUnit.generated.h"

USTRUCT(meta=(DisplayName="My Foot IK", Category="IK", NodeColor="0.2 0.5 0.2",
             ExecuteContext="FControlRigExecuteContext"))
struct FRigUnit_MyFootIK : public FRigUnit
{
    GENERATED_BODY()

    RIGVM_METHOD()
    virtual void Execute() override;

    UPROPERTY(meta=(Input))
    FVector GoalLocation = FVector::ZeroVector;

    UPROPERTY(meta=(Input))
    FName BoneName = NAME_None;

    UPROPERTY(meta=(Output))
    FTransform OutTransform;
};
```

```cpp
// MyIKUnit.cpp
#include "MyIKUnit.h"
#include "Units/RigUnitContext.h"

void FRigUnit_MyFootIK::Execute()
{
    // Access the hierarchy through the context, not directly
    URigHierarchy* Hier = ExecuteContext.Hierarchy;
    if (!Hier) { return; }

    FRigElementKey Key(BoneName, ERigElementType::Bone);
    OutTransform = Hier->GetGlobalTransform(Key);
    OutTransform.SetTranslation(GoalLocation);
    Hier->SetGlobalTransform(Key, OutTransform);
}
```

Key rules for `FRigUnit`:
- `RIGVM_METHOD()` marks the method the VM calls each evaluation.
- `meta=(Input)` / `meta=(Output)` on UPROPERTY members determine pin direction.
- `meta=(ExecuteContext="FControlRigExecuteContext")` on the USTRUCT is required.
- Access the hierarchy only through `ExecuteContext.Hierarchy`, never store a raw pointer
  across frames (the hierarchy may move during compilation).
- The unit struct must be in a module that depends on `ControlRig`.

**Version note:** In UE 5.2, `FRigUnitContext` was replaced by `FControlRigExecuteContext`
and the `RIGVM_METHOD()` macro superseded `IMPLEMENT_RIGUNIT_AUTOMATION_TEST`. See the
official upgrade guide for the full diff.

---

## Solve events and the Backwards Solve

The graph is not just for forward simulation. The **Backwards Solve** event runs in
Sequencer's animation editor and does the reverse mapping: when an animator drags a
control gizmo, the rig maps the new control transform back to bone space so the skeleton
follows. Design your rig graph with this in mind:

- Forward Solve: read inputs (variables, curves) → compute IK → write bones.
- Backwards Solve: read bone transforms from the incoming pose → compute control
  values that match → write controls (animatable).

Verify both events in the rig graph; a rig without a working Backwards Solve cannot
be keyframed in Sequencer.

---

## Modular Control Rig (UE 5.5+)

`UModularRig` (`ModularRig.h`) composes named module instances (`FRigModuleInstance`) into
one character rig. Each module is a standalone `UControlRig` (arm rig, leg rig, spine rig)
wired together through connector rules (`RigConnectionRules.h`).

An agent assembling a rig programmatically can use `UModularRigController` to add, remove,
and reconnect modules without opening the editor. The deprecated `GetRigModuleNameSpace()`
(5.6+) is replaced by `GetRigModulePrefix()` on `UControlRig`.

---

## ControlRigComponent vs AnimBP node

| Approach | When to use |
|---|---|
| `FAnimNode_ControlRig` in AnimBP | Character with a full animation pipeline; rig is one step in the AnimGraph |
| `UControlRigComponent` on actor | Props, vehicles, non-character objects; rig runs independently of AnimBP |
| `UControlRig::FindControlRigs()` | Querying rigs already running on an outer object (Sequencer, editor) |

`UControlRigComponent` (`ControlRigComponent.h`:175) exposes `FControlRigComponentMappedElement`
to bind arbitrary scene components or socket transforms as rig inputs or outputs.

---

## Performance guidance

- **LOD threshold** — set `LODThreshold` on `FAnimNode_ControlRig` to disable the rig
  above a character LOD level. At high LOD, skip IK entirely.
- **Evaluate on worker threads** — `FAnimNode_ControlRig::Evaluate_AnyThread` runs off
  the game thread by default; keep graph nodes thread-safe (no UObject access outside
  the hierarchy).
- **Graph complexity** — minimize iterative IK nodes; prefer analytic solvers (Two Bone,
  Limb IK) over FABRIK/FBIK for characters appearing in large numbers.
- **Cache element indices** — use `FRigElementKey` + `URigHierarchy::GetIndex()` and
  cache the result to avoid name lookups every frame.

---

## Source references (UE 5.7)

All paths under `Engine/Plugins/Animation/ControlRig/Source/ControlRig/Public/`:
- `ControlRig.h`:60 — `UControlRig` class.
- `ControlRig.h`:201 — `GetHierarchy()`.
- `ControlRig.h`:275 — `Execute(const FName&)`.
- `ControlRig.h`:317 — `SetControlValue<T>()`.
- `ControlRig.h`:324 — `GetControlValue()`.
- `ControlRig.h`:427 — `OnPreConstruction_AnyThread()`, `OnPostConstruction_AnyThread()`.
- `AnimNode_ControlRig.h`:20 — `FAnimNode_ControlRig`.
- `AnimNode_ControlRig.h`:38 — `Evaluate_AnyThread()`.
- `ControlRigComponent.h`:175 — `UControlRigComponent`.
- `ModularRig.h` — `UModularRig`, `FRigModuleInstance`, `FModuleInstanceHandle`.
- `Units/RigUnit.h`:59 — `FRigUnit`.
- `Rigs/RigHierarchy.h`:167 — `URigHierarchy`.
- `Rigs/RigHierarchy.h`:2138 — `GetLocalTransform()`.
- `Rigs/RigHierarchy.h`:2186 — `SetLocalTransform()`.
- `Rigs/RigHierarchy.h`:2234 — `GetGlobalTransform()`.
- `Rigs/RigHierarchyElements.h` — `FRigBaseElement`, `FRigControlElement`, `FRigElementKey`.
