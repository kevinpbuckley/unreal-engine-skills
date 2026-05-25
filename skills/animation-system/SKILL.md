---
name: animation-system
description: Animate skeletal meshes in Unreal using the AnimInstance / Animation Blueprint
  model — C++ UAnimInstance base class (NativeInitializeAnimation, NativeUpdateAnimation,
  NativeThreadSafeUpdateAnimation), AnimGraph with state machines and blend spaces,
  animation assets (UAnimSequence, UBlendSpace, UAnimMontage, UAnimComposite, UPoseAsset),
  anim notifies and notify states, montage playback and delegates, linked anim layers,
  Motion Matching (Pose Search plugin), and Motion Warping. Use when setting up character
  animation, driving locomotion blends from C++, playing montages for actions, firing
  gameplay events at precise animation frames (notifies), switching animation sets at
  runtime, or integrating the Pose Search / Motion Warping plugins.
metadata:
  engine-version: "5.7"
  category: animation
---

# Animation system

A `USkeletalMeshComponent` is animated by a `UAnimInstance` — the runtime behind an
**Animation Blueprint**. The recommended architecture is a **C++ `UAnimInstance` base** that
computes animation variables each frame, with the AnimBP's **AnimGraph** consuming those
variables to produce the final pose.

## When to use this skill

- Setting up a character's locomotion (idle, walk, run, jump) with state machines and blend
  spaces driven from C++.
- Playing one-off animations (attacks, reloads, hit reactions) via montages with section
  control and completion delegates.
- Firing gameplay events (footsteps, hit windows, VFX triggers) at precise animation frames
  using custom anim notifies.
- Switching animation sets at runtime with linked anim layers / `LinkAnimClassLayers`.
- Integrating the Pose Search (Motion Matching) or Motion Warping plugins.

## Core mental model

| Thread | What runs there | What to do there |
|---|---|---|
| Game thread | `NativeInitializeAnimation`, `NativeUpdateAnimation`, event graph | Cache references, compute simple vars |
| Anim worker thread | `NativeThreadSafeUpdateAnimation`, AnimGraph evaluation | Heavy per-frame logic (read-only, no world queries) |

The AnimGraph **evaluates the pose** (state machines → blend spaces → IK → final pose). It
runs on the anim worker thread and must only read data the game thread wrote.
The **C++ update path computes the variables** the graph reads — never drive the final
bone transform directly from game code.

## C++ AnimInstance base

```cpp
// MyAnimInstance.h
#pragma once
#include "Animation/AnimInstance.h"
#include "MyAnimInstance.generated.h"

UCLASS()
class MYGAME_API UMyAnimInstance : public UAnimInstance
{
    GENERATED_BODY()
public:
    virtual void NativeInitializeAnimation() override;
    virtual void NativeUpdateAnimation(float DeltaSeconds) override;
    virtual void NativeThreadSafeUpdateAnimation(float DeltaSeconds) override;

    // Read by AnimGraph nodes (BlueprintReadOnly keeps them graph-accessible, thread-safe)
    UPROPERTY(BlueprintReadOnly, Category="Locomotion") float Speed = 0.f;
    UPROPERTY(BlueprintReadOnly, Category="Locomotion") float Direction = 0.f;
    UPROPERTY(BlueprintReadOnly, Category="Locomotion") bool  bIsFalling = false;

private:
    UPROPERTY() TObjectPtr<class ACharacter> OwnerCharacter;
};
```

```cpp
// MyAnimInstance.cpp
#include "MyAnimInstance.h"
#include "GameFramework/Character.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "KismetAnimationLibrary.h"   // CalculateDirection

void UMyAnimInstance::NativeInitializeAnimation()
{
    Super::NativeInitializeAnimation();
    OwnerCharacter = Cast<ACharacter>(TryGetPawnOwner());  // cache once; safe on game thread
}

void UMyAnimInstance::NativeUpdateAnimation(float DeltaSeconds)
{
    Super::NativeUpdateAnimation(DeltaSeconds);
    // Keep lightweight — prefer NativeThreadSafeUpdateAnimation for heavy logic
    if (!OwnerCharacter) { OwnerCharacter = Cast<ACharacter>(TryGetPawnOwner()); }
}

void UMyAnimInstance::NativeThreadSafeUpdateAnimation(float DeltaSeconds)
{
    Super::NativeThreadSafeUpdateAnimation(DeltaSeconds);
    if (!OwnerCharacter) { return; }
    const FVector Vel = OwnerCharacter->GetVelocity();
    Speed     = Vel.Size2D();
    bIsFalling = OwnerCharacter->GetCharacterMovement()->IsFalling();
    Direction = UKismetAnimationLibrary::CalculateDirection(Vel, OwnerCharacter->GetActorRotation());
}
```

Key rules:
- `NativeInitializeAnimation` — cache owner/movement references; runs once on game thread.
- `NativeUpdateAnimation` — game-thread update; keep minimal; call `Super` first.
- `NativeThreadSafeUpdateAnimation` — worker-thread update; no `UWorld` queries, no spawning,
  no non-thread-safe engine calls. This is where to put heavy per-frame computation.
- Assign variables used by the AnimGraph as `UPROPERTY(BlueprintReadOnly)` — the AnimGraph
  nodes read them by name. `BlueprintThreadSafe` meta is needed if accessed in thread-safe
  graph functions.

Assign at runtime:
```cpp
GetMesh()->SetAnimInstanceClass(MyAnimBPClass);          // TSubclassOf<UAnimInstance>
UMyAnimInstance* AI = Cast<UMyAnimInstance>(GetMesh()->GetAnimInstance());
```

## Animation assets

| Asset | Class | Use |
|---|---|---|
| Animation Sequence | `UAnimSequence` | Single clip bound to a skeleton |
| Blend Space (2D) | `UBlendSpace` | Blend clips by two parameters (speed × direction) |
| Blend Space 1D | `UBlendSpace1D` | Blend clips by one parameter (speed) |
| Aim Offset | `UAimOffsetBlendSpace` | Additive aim-offset by pitch/yaw |
| Montage | `UAnimMontage` | Sectioned one-off animations with slot blending |
| Composite | `UAnimComposite` | Stitch sequences into one timeline |
| Pose Asset | `UPoseAsset` | Curve-driven morph targets / facial poses |

All assets target a **`USkeleton`** — clips are shareable across meshes that use the same
skeleton (or compatible skeletons; see `USkeleton::CompatibleSkeletons`).

## State machines

State machines in the AnimGraph define locomotion or combat states. Each state holds an
animation graph sub-network; transitions carry rule expressions.
From C++, query state machine state via `FAnimNode_StateMachine`:
- `GetCurrentStateName()` — `FName` of the active state.
- `GetStateWeight(int32 StateIndex)` — blend weight of a state during transition.

Prefer driving transitions through `UPROPERTY` variables computed in the C++ update rather
than calling native state machine APIs directly.

## Montages (actions on top of locomotion)

Montages play in a named **slot** the AnimGraph exposes. The slot node blends the montage
over the base locomotion pose — good for attacks, reloads, hit reactions:

```cpp
UAnimInstance* AI = GetMesh()->GetAnimInstance();

// Play and get the length (or set ReturnValueType to MontageLength / Duration)
float Len = AI->Montage_Play(AttackMontage, 1.f);

// Jump to / stop sections
AI->Montage_JumpToSection(FName("Combo2"), AttackMontage);
AI->Montage_Stop(0.2f, AttackMontage);

// ACharacter convenience wrappers
PlayAnimMontage(AttackMontage, 1.f, FName("Intro"));
StopAnimMontage(AttackMontage);
```

Bind to completion to know when an action finishes:
```cpp
AI->OnMontageEnded.AddDynamic(this, &AMyChar::OnMontageEnded);
// or per-instance:
FOnMontageEnded EndDelegate;
EndDelegate.BindUObject(this, &AMyChar::OnMontageEnded);
AI->Montage_SetEndDelegate(EndDelegate, AttackMontage);
```

See [references/montages-and-slots.md](references/montages-and-slots.md) for section authoring,
root motion, blend settings, and `Montage_PlayWithBlendSettings`.

## Anim Notifies (events from animation)

- **`UAnimNotify`** — a point event (footstep SFX, spawn projectile at a bone socket).
- **`UAnimNotifyState`** — a ranged event with `NotifyBegin`/`NotifyTick`/`NotifyEnd`
  (enable weapon collision during a swing).

```cpp
UCLASS()
class MYGAME_API UAnimNotify_Footstep : public UAnimNotify
{
    GENERATED_BODY()
    virtual FString GetNotifyName_Implementation() const override { return TEXT("Footstep"); }
    virtual void Notify(USkeletalMeshComponent* MeshComp, UAnimSequenceBase* Animation,
                        const FAnimNotifyEventReference& Ref) override;
};

UCLASS()
class MYGAME_API UAnimNotifyState_WeaponTrace : public UAnimNotifyState
{
    GENERATED_BODY()
    virtual void NotifyBegin(USkeletalMeshComponent* MeshComp, UAnimSequenceBase* Animation,
                             float TotalDuration, const FAnimNotifyEventReference& Ref) override;
    virtual void NotifyTick (USkeletalMeshComponent* MeshComp, UAnimSequenceBase* Animation,
                             float FrameDelta, const FAnimNotifyEventReference& Ref) override;
    virtual void NotifyEnd  (USkeletalMeshComponent* MeshComp, UAnimSequenceBase* Animation,
                             const FAnimNotifyEventReference& Ref) override;
};
```

Notifies are the correct way to synchronize gameplay to animation timing. Using timers as a
substitute diverges at variable play rates and when animation blending delays the clip.

## Linked anim layers (runtime animation set swapping)

Linked anim layers let you swap a portion of the AnimGraph at runtime — useful for weapon
styles, character class variations, or costume-specific animations:

```cpp
// Replace the locomotion layer at runtime
GetMesh()->LinkAnimClassLayers(URifleLocomotionLayer::StaticClass());
// Revert to the default layer defined in the AnimBP
GetMesh()->UnlinkAnimClassLayers(URifleLocomotionLayer::StaticClass());
// Retrieve the active layer instance to set variables on it
UAnimInstance* Layer = GetMesh()->GetLinkedAnimLayerInstanceByClass(URifleLocomotionLayer::StaticClass());
```

The linked AnimBP class must implement the same `UAnimLayerInterface` interface as the parent.

## Modern options (5.x)

- **Motion Matching** (`PoseSearch` plugin) — data-driven locomotion selects poses from a
  database matching trajectory and pose queries. Replaces hand-built state machines for
  complex locomotion. Enable `PoseSearch` in the project plugins.
- **Motion Warping** (`MotionWarping` plugin) — warps root-motion clips to hit target
  positions/rotations at runtime (ledge grabs, cover transitions). Add
  `UMotionWarpingComponent` to the character; annotate montages with warp windows;
  call `AddOrUpdateWarpTargetFromTransform` before playing.
- **Control Rig** in the AnimGraph — procedural bone adjustments, IK, foot planting
  (see `control-rig-and-ik`).
- **Layered blend per bone** (`FAnimNode_LayeredBoneBlend`) — blend an upper-body montage
  slot over a lower-body locomotion pose, or blend full-body layers with per-bone masks.
- **Inertialization** (`AnimNode_Inertialization`) — cost-efficient smooth blending by
  recording velocity rather than maintaining two full pose evaluations simultaneously.
- **Animation Sharing plugin** — share a single AnimInstance across multiple distant characters
  to reduce per-character animation cost.

## Gotchas

- **Non-thread-safe calls in `NativeThreadSafeUpdateAnimation`** — any call that touches the
  `UWorld`, spawns objects, or reads non-thread-safe data will crash under multi-threaded anim
  update. Cache all needed references in `NativeInitializeAnimation`.
- **Wrong skeleton** — clips won't apply; retarget with the IK Retargeter or add the mesh's
  skeleton to `USkeleton::CompatibleSkeletons`.
- **Driving the pose from game code** instead of the AnimGraph — fighting the animation
  system. Compute data in C++; let the graph own the pose.
- **Using timers for animation-timed events** instead of notifies — desync at variable play
  rates and when blending delays a clip's effective start.
- **Forgetting to call `Super`** in `NativeUpdateAnimation` / `NativeInitializeAnimation` —
  the engine does essential bookkeeping in the base implementation.
- **Heavy game-thread logic in `NativeUpdateAnimation`** for many characters — move it to
  `NativeThreadSafeUpdateAnimation` to run in parallel across characters.
- **Slot with no weight in the AnimGraph** — montage plays but produces no output; ensure
  the slot node is wired between source and output and the blend weight is > 0.
- **`bUseMultiThreadedAnimationUpdate` disabled** on the AnimBP — disables the worker-thread
  path; re-enable (default on) unless you deliberately need single-threaded evaluation.

## Version notes

- `TObjectPtr<T>` is the modern member UPROPERTY form (UE5+); older code uses raw `T*`.
- `NativeThreadSafeUpdateAnimation` was introduced in UE 4.15 and is stable across all
  UE 5.x versions.
- `LinkAnimClassLayers` / `UnlinkAnimClassLayers` replaced the deprecated `SetLayerOverlay` /
  `ClearLayerOverlay` (deprecated since 4.24).
- `SetAnimInstanceClass` (the `USkeletalMeshComponent` overriding version) deprecated
  `K2_SetAnimInstanceClass` (deprecated 4.23) and a `TSubclassOf` setter (deprecated 5.5).
- The `PoseSearch` plugin (Motion Matching) is production-ready in UE 5.4+ and ships with
  the engine (no separate download). API surface stabilized significantly in 5.4.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Animation/AnimInstance.h` — `UAnimInstance`:352,
  `NativeInitializeAnimation`:1372, `NativeUpdateAnimation`:1375,
  `NativeThreadSafeUpdateAnimation`:1378, `NativePostEvaluateAnimation`:1380,
  `NativeBeginPlay`:1391, `Montage_Play`:613, `Montage_Stop`:626,
  `Montage_JumpToSection`:650, `GetCurrentActiveMontage`:741,
  `OnMontageBlendingOut`:745, `OnMontageEnded`:757, `Montage_SetEndDelegate`:771,
  `TryGetPawnOwner`:452, `GetOwningActor`:533, `GetOwningComponent`:537,
  `LinkAnimClassLayers`:860, `UnlinkAnimClassLayers`:871,
  `GetLinkedAnimLayerInstanceByClass`:893, `bUseMultiThreadedAnimationUpdate`:376.
- `Runtime/Engine/Classes/Animation/AnimMontage.h` — `UAnimMontage`:621,
  `FCompositeSection`:37, `FSlotAnimationTrack`:83, `BlendIn`:637, `BlendOut`:646,
  `CompositeSections`:684, `SlotAnimTracks`:688.
- `Runtime/Engine/Classes/Animation/AnimSequenceBase.h` — `UAnimSequenceBase`:36,
  `Notifies`:43, `RateScale`:61, `GetDataModel`:258.
- `Runtime/Engine/Classes/Animation/AnimSequence.h` — `UAnimSequence`:202,
  `bEnableRootMotion`:320, `RootMotionRootLock`:324.
- `Runtime/Engine/Classes/Animation/BlendSpace.h` — `UBlendSpace`:466,
  `BlendParameters`:907, `NotifyTriggerMode`:849.
- `Runtime/Engine/Classes/Animation/BlendSpace1D.h` — `UBlendSpace1D`:19.
- `Runtime/Engine/Classes/Animation/AnimNotifies/AnimNotify.h` — `UAnimNotify`:51,
  `Notify`:87, `GetNotifyName`:59.
- `Runtime/Engine/Classes/Animation/AnimNotifies/AnimNotifyState.h` — `UAnimNotifyState`:24,
  `NotifyBegin`:71, `NotifyTick`:72, `NotifyEnd`:73.
- `Runtime/Engine/Classes/Animation/AnimNode_StateMachine.h` — `FAnimNode_StateMachine`:122,
  `GetCurrentStateName`:178, `GetStateWeight`:258.
- `Runtime/Engine/Classes/Animation/Skeleton.h` — `USkeleton`:294,
  `CompatibleSkeletons`:345, `IsCompatibleMesh`:771.
- `Runtime/Engine/Classes/Components/SkeletalMeshComponent.h` — `SetAnimInstanceClass`:1010,
  `GetAnimInstance`:1025, `LinkAnimClassLayers`:1105, `UnlinkAnimClassLayers`:1116,
  `GetLinkedAnimLayerInstanceByClass` (via `UAnimInstance`).
- `Runtime/Engine/Classes/GameFramework/Character.h` — `PlayAnimMontage`:773,
  `StopAnimMontage`:777, `GetCurrentMontage`:781.
- `Runtime/Engine/Public/Animation/AnimNotifyQueue.h` — `FAnimNotifyEventReference`:21.
- `Runtime/AnimGraphRuntime/Public/KismetAnimationLibrary.h` —
  `UKismetAnimationLibrary::CalculateDirection`:225.
- `Runtime/AnimGraphRuntime/Public/AnimNodes/AnimNode_LayeredBoneBlend.h` —
  `FAnimNode_LayeredBoneBlend`:21.
- `Plugins/Animation/MotionWarping/Source/MotionWarping/Public/MotionWarpingComponent.h` —
  `UMotionWarpingComponent`:99, `AddOrUpdateWarpTargetFromTransform`:166.
- `Plugins/Animation/PoseSearch/Source/Runtime/Public/PoseSearch/PoseSearchLibrary.h` —
  `UPoseSearchLibrary`:159, `FMotionMatchingState`:56.

Official docs (UE 5.7):
- Skeletal Mesh Animation System —
  <https://dev.epicgames.com/documentation/unreal-engine/skeletal-mesh-animation-system-in-unreal-engine>
- Animation Blueprints —
  <https://dev.epicgames.com/documentation/unreal-engine/animation-blueprints-in-unreal-engine>
- Animation Assets and Features —
  <https://dev.epicgames.com/documentation/unreal-engine/animation-assets-and-features-in-unreal-engine>
- Animating Characters and Objects —
  <https://dev.epicgames.com/documentation/unreal-engine/animating-characters-and-objects-in-unreal-engine>

Deep-dive references:
- [references/anim-instance-and-update.md](references/anim-instance-and-update.md) — full
  update pipeline, thread model, proxy, Property Access, BlueprintThreadSafe functions.
- [references/montages-and-slots.md](references/montages-and-slots.md) — montage anatomy,
  sections, root motion, blend settings, delegates, slot blending.
- [references/state-machines-and-blending.md](references/state-machines-and-blending.md) —
  state machine internals, sync groups, inertialization, layered blending.
- [references/motion-matching-and-warping.md](references/motion-matching-and-warping.md) —
  Pose Search / Motion Matching setup, Motion Warping integration.
