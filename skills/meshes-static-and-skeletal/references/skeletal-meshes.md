# Skeletal meshes — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `USkeletalMesh` / `USkeleton` /
`UPhysicsAsset` ecosystem, leader-pose components, bone queries, modular characters,
and Nanite skeletal mesh. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/SkeletalMesh.h`,
`Engine/Source/Runtime/Engine/Classes/Components/SkeletalMeshComponent.h`,
`Engine/Source/Runtime/Engine/Classes/Components/SkinnedMeshComponent.h`,
`Engine/Source/Runtime/Engine/Classes/PhysicsEngine/PhysicsAsset.h`).

## The skeletal mesh ecosystem

```
USkeletalMesh
  ├─ USkeleton          — shared bone hierarchy; animations reference this
  ├─ UPhysicsAsset      — per-bone collision bodies + constraints (ragdoll, RBAN)
  ├─ USkeletalMeshSocket[]  — named attach points parented to bones
  └─ FSkeletalMaterial[]    — per-section material slots (parallel to sections)
```

`USkeletalMeshComponent` (derives from `USkinnedMeshComponent → UMeshComponent →
UPrimitiveComponent`) is the runtime counterpart: it owns the transform, animation
instance, bone transforms, and creates the render/physics state.

## USkeleton — the shared animation contract

One `USkeleton` asset is shared across all `USkeletalMesh` assets that are
"compatible" (same or virtual-bone-extended hierarchy). A single animation sequence
can play on any compatible mesh without retargeting:

```cpp
// Check skeleton compatibility in code (editor context):
bool bCompat = MyAnimSeq->CanBeUsedInSkeletalMesh(MyOtherSkeletalMesh);
```

Designers add **virtual bones** in the Skeleton Editor to extend the hierarchy for IK
targets or attachment points without changing the source mesh. Virtual bones are
visible to AnimBP nodes but not rendered.

`USkeletalMesh::GetSkeleton()` (line 740) returns the skeleton. Attempting to play an
animation sequence whose skeleton differs from the component's mesh skeleton will log
a warning and play nothing at runtime.

## UPhysicsAsset — ragdoll and physical animation

A `UPhysicsAsset` holds:
- **`USkeletalBodySetup[]`** — per-bone simple collision shapes (capsule/sphere/box/convex)
  and `EPhysicsType` (simulated / kinematic / default).
- **`FConstraintInstance[]`** — twist/swing limits and drives between bones.
- **`FPhysicsAssetSolverSettings`** — RBAN solver iteration counts
  (`PhysicsAsset.h`:30).

Assign at runtime:

```cpp
SkMesh->SetPhysicsAsset(MyPhysicsAsset, /*bForceReInit=*/false);  // line 2051
```

Setting `bForceReInit = true` rebuilds all physics bodies immediately (expensive; avoid
in tight loops). The physics asset is also used for `UPhysicalAnimationComponent`
blending and the `RigidBody` AnimGraph node.

## USkeletalMeshSocket — bone-parented attach points

Skeletal sockets follow the animation of their parent bone every frame. They are
stored on the `USkeletalMesh` asset and are shared across all components:

```cpp
// Retrieve a socket by name (USkinnedMeshComponent, line 1849):
USkeletalMeshSocket const* Sock = SkMesh->GetSocketByName(TEXT("hand_r"));
if (Sock)
{
    // Attach a component to the socket:
    WeaponMesh->AttachToComponent(
        SkMesh,
        FAttachmentTransformRules::SnapToTargetIncludingScale,
        TEXT("hand_r"));
}

// Get the socket's world transform this frame:
FTransform WorldSockTransform = SkMesh->GetSocketTransform(TEXT("hand_r"));
```

`USkeletalMesh::FindSocket()` (line 2637) searches the mesh's socket array and the
skeleton's sockets. `FindSocketInfo()` (line 2653) also returns the bone index and
the socket's local offset — useful for FK corrections.

## Setting up a skeletal mesh component

```cpp
// In an actor constructor:
SkMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("CharMesh"));
SetRootComponent(SkMesh);

// Assign mesh + animation class (both can be set via UPROPERTY in editor):
SkMesh->SetSkeletalMesh(MySkeletalMesh);         // line 2052
SkMesh->SetAnimInstanceClass(MyAnimBPClass);     // line 1010
SkMesh->SetPhysicsAsset(MyPhysicsAsset);         // line 2051

// Swap mesh at runtime without resetting current pose:
SkMesh->SetSkeletalMesh(NewMesh, /*bReinitPose=*/false);
```

`SetSkeletalMesh` by default calls `bReinitPose = true`, which restarts the animation
from the reference pose. Pass `false` when hot-swapping cosmetic mesh variations (body
armor, hair) to preserve the current animation state.

## Leader-pose component (modular characters)

Modular characters are composed of several `USkeletalMeshComponent`s on one actor —
one per body part (body, hair, helm, gloves). Running independent animation on each
would be expensive. Use the **leader-pose** pattern: one component (the body) runs
the animation; the others copy its bone transforms each frame.

```cpp
// Set up in BeginPlay (or PostInitializeComponents):
HairMesh->SetLeaderPoseComponent(BodyMesh);    // copies bone transforms from BodyMesh
HelmMesh->SetLeaderPoseComponent(BodyMesh);
GlovesMesh->SetLeaderPoseComponent(BodyMesh);
```

The follower components contribute their sections to the same draw call set as the
leader, significantly reducing rendering cost compared to independent animation
evaluation. All followers must share the same `USkeleton` as the leader.

See `animation-system` for AnimBP, blend spaces, and animation montages.

## Bone and transform queries

```cpp
// World-space transform of a named bone:
FTransform BoneWT = SkMesh->GetSocketTransform(TEXT("spine_03"), RTS_World);

// Bone index from name (returns INDEX_NONE on miss):
int32 BoneIdx = SkMesh->GetBoneIndex(TEXT("hand_r"));

// Local bone transform (ref pose + animation delta):
FTransform LocalBone = SkMesh->GetBoneTransform(BoneIdx, RTS_Component);
```

Bone transforms are only valid on the game thread after the animation has ticked for
that frame. Do not read bone transforms from async or physics threads without
`GetCachedAnimDataRequiresPerObjectLock` protection.

## Nanite skeletal mesh (UE 5.7)

In 5.7, Nanite for skeletal meshes is production-ready. Enabling it gives:
- One GPU draw call for the entire character (vs. one per material section).
- Virtual Shadow Map support.
- Animation LODs (not geometry LODs — bones/sections can be stripped per LOD).

Enable via the Skeletal Mesh Editor's Nanite Settings panel, or in C++ using the same
`GetNaniteSettings()` / `SetNaniteSettings()` accessors as static meshes.

Limitations: Morph targets are not supported with Nanite on skeletal meshes. Cloth
simulation output is still rendered via the traditional path when cloth is enabled.

## Version notes

- `SetSkeletalMeshWithoutResettingAnimation` is deprecated since 5.1; use
  `SetSkeletalMesh(Mesh, false)` instead.
- `K2_SetAnimInstanceClass` is deprecated since 4.23; use `SetAnimInstanceClass`.
- Leader-pose API is stable across UE5.

## See also

- [Skeletal Mesh assets](https://dev.epicgames.com/documentation/unreal-engine/skeletal-mesh-assets-in-unreal-engine)
- [Nanite Virtualized Geometry](https://dev.epicgames.com/documentation/unreal-engine/nanite-virtualized-geometry-in-unreal-engine)
- Sibling skills: `animation-system`, `physics-and-chaos`
