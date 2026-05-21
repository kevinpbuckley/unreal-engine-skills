---
name: animation-system
description: Animate skeletal meshes in Unreal — the Anim Instance / Animation Blueprint model
  (AnimGraph vs Event Graph), the recommended C++ UAnimInstance base that computes data for the
  graph, animation assets (sequences, blend spaces, montages), state machines, and anim notifies.
  Use when setting up character animation, driving locomotion/blends, playing montages for actions,
  computing animation variables in C++, or firing gameplay events from animation (notifies).
metadata:
  engine-version: "5.7"
  category: animation
---

# Animation system

A `USkeletalMeshComponent` is animated by a `UAnimInstance` — the runtime of an **Animation
Blueprint**. The performant, testable pattern is a **C++ `UAnimInstance` base** that computes the
animation data each frame, with the Animation Blueprint's **AnimGraph** consuming that data to
produce the final pose.

## When to use this skill

- Setting up a character's animation (locomotion, idle, jump, actions).
- Driving blends from gameplay state (speed, direction, is-falling).
- Playing one-off animations (attacks, reloads) via montages.
- Firing gameplay events at precise animation frames (footsteps, hit windows).

## The model

- **AnimGraph** evaluates the pose: state machines, blend spaces, blends, IK, Control Rig nodes →
  final pose. Runs on the animation worker thread.
- **Event Graph / C++** computes the *variables* the AnimGraph reads (e.g. `Speed`, `Direction`,
  `bIsFalling`). Runs each update.
- The component picks which `UAnimInstance` class to run.

### Recommended split: C++ base computes data, AnimBP does the graph

```cpp
// MyAnimInstance.h
#include "Animation/AnimInstance.h"
UCLASS()
class MYGAME_API UMyAnimInstance : public UAnimInstance
{
    GENERATED_BODY()
public:
    virtual void NativeInitializeAnimation() override;        // cache owner/movement
    virtual void NativeUpdateAnimation(float DeltaSeconds) override; // compute vars (thread-safe)

    UPROPERTY(BlueprintReadOnly, Category="Locomotion") float Speed = 0.f;
    UPROPERTY(BlueprintReadOnly, Category="Locomotion") float Direction = 0.f;
    UPROPERTY(BlueprintReadOnly, Category="Locomotion") bool bIsFalling = false;
private:
    UPROPERTY() TObjectPtr<class ACharacter> Owner;
};
```
The AnimBP (subclass of `UMyAnimInstance`) reads `Speed`/`Direction`/`bIsFalling` in its AnimGraph.
Keep `NativeUpdateAnimation` free of non-thread-safe calls; for heavier work use
`NativeThreadSafeUpdateAnimation`.

Assign the class to the mesh:
```cpp
GetMesh()->SetAnimInstanceClass(MyAnimBPClass);   // TSubclassOf<UAnimInstance>
UMyAnimInstance* Anim = Cast<UMyAnimInstance>(GetMesh()->GetAnimInstance());
```

## Animation assets

| Asset | Use |
|---|---|
| `UAnimSequence` | a single clip (walk, idle) bound to a skeleton |
| `UBlendSpace` (1D/2D) | blend clips by parameters (e.g. speed × direction) |
| `UAnimMontage` | one-off, sectioned animations for actions; has slots & notifies |
| `UAnimComposite` | stitch sequences into one timeline |
| State machines | graph of states + transition rules (locomotion, combat states) |

All animations target a **`USkeleton`** — clips are shareable across meshes that use the same
skeleton (see `meshes-static-and-skeletal`).

## Montages (actions on top of locomotion)

Montages play in a **slot** that the AnimGraph blends over the base pose — good for attacks,
reloads, hit reactions:
```cpp
// Simple:
float Len = GetMesh()->GetAnimInstance()->Montage_Play(AttackMontage);
// Jump to / stop sections:
Anim->Montage_JumpToSection(TEXT("Combo2"), AttackMontage);
Anim->Montage_Stop(0.2f, AttackMontage);
// Or the actor helper:
PlayAnimMontage(AttackMontage, 1.f, TEXT("Combo1"));
```
Bind to montage end/blend-out delegates to know when an action finished.

## Anim Notifies (events from animation)

- **`UAnimNotify`** — a point event on a clip/montage (footstep SFX, spawn projectile).
- **`UAnimNotifyState`** — a ranged event with begin/end (enable weapon collision during a swing).
```cpp
UCLASS()
class UAnimNotify_Footstep : public UAnimNotify
{
    GENERATED_BODY()
    virtual void Notify(USkeletalMeshComponent* Mesh, UAnimSequenceBase* Anim,
                        const FAnimNotifyEventReference& Ref) override;  // play sound at foot socket
};
```
Notifies are the correct way to sync gameplay to animation timing — don't guess with timers.

## Modern options (5.x)

- **Motion Matching** (Pose Search plugin) for data-driven locomotion instead of hand-built state
  machines.
- **Control Rig** nodes in the AnimGraph for procedural adjustments / IK (see `control-rig-and-ik`).
- **Layered blend per bone** to play upper-body montages over lower-body locomotion.

## Gotchas

- **Non-thread-safe calls in `NativeUpdateAnimation`** can crash with multithreaded anim update;
  cache references in `NativeInitializeAnimation`, use thread-safe update for heavy logic.
- **Wrong skeleton** → clips won't apply / retarget needed (`control-rig-and-ik`).
- **Driving the pose from gameplay tick** instead of the AnimGraph → fighting the animation system.
- **Using timers for animation-timed events** instead of notifies → desync at varying play rates.
- **Heavy logic in the Event Graph** every frame for every character → cost; compute minimally.

## References & source material

Engine source (UE 5.7, `Runtime/Engine/Classes/Animation/`):
- `AnimInstance.h` — `UAnimInstance`, native init/update hooks.
- `AnimSequence.h`, `BlendSpace.h`, `AnimMontage.h` — the animation assets.
- `AnimNotifies/AnimNotify.h` — notify base classes.
- `AnimStateMachineTypes.h` — state machine types. `Skeleton.h` — `USkeleton`.
- `Runtime/Engine/Classes/Components/SkeletalMeshComponent.h` — `SetAnimInstanceClass`, `GetAnimInstance`.

Official docs (UE 5.7): Animating Characters and Objects —
<https://dev.epicgames.com/documentation/unreal-engine/animating-characters-and-objects-in-unreal-engine>
