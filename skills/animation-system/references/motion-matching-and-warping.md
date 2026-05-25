# Motion Matching & Motion Warping — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the Pose Search (Motion Matching) plugin
and the Motion Warping plugin. Grounded in UE 5.7
(`Plugins/Animation/PoseSearch/Source/Runtime/Public/PoseSearch/PoseSearchLibrary.h`,
`Plugins/Animation/MotionWarping/Source/MotionWarping/Public/MotionWarpingComponent.h`).

## Motion Matching (Pose Search plugin)

### What it is

Motion Matching selects the best-matching animation pose from a database at each frame by
comparing a feature vector (trajectory, bone velocities, current pose) against all
candidates. It replaces hand-authored state machines for locomotion, especially when large
motion-capture libraries are available.

The Pose Search plugin ships with UE 5.7 and is production-ready (stabilized in 5.4).
Enable it in Edit → Plugins → Animation → Pose Search.

### Key classes

- **`UPoseSearchDatabase`** — the motion matching database; references animation sequences
  and their schemas.
- **`UPoseSearchSchema`** — defines which features are extracted (bone positions/velocities,
  trajectory points, tags).
- **`UPoseSearchLibrary`** — Blueprint/C++ library with the search entry point
  (`PoseSearchLibrary.h`:159).
- **`FMotionMatchingState`** — per-character state that persists the current search result
  between frames (`PoseSearchLibrary.h`:56).

### AnimGraph integration

Motion Matching is used via the **Motion Matching** AnimGraph node (added by the plugin).
It manages its own `FMotionMatchingState` internally. The node takes:
- A **Database** (or array of databases to search across).
- A **Trajectory** input (future + past root motion trajectory, fed from a trajectory
  component or computed in the AnimBP).
- Optional **Interrupt** mode — whether a better-matching pose can interrupt mid-clip.

No C++ is strictly required to drive the node; designers configure the databases and schemas.

### C++ trajectory integration

For responsive locomotion, feed predicted trajectory into the MM node:

```cpp
// In NativeThreadSafeUpdateAnimation (thread-safe):
// Compute or retrieve a trajectory from UCharacterTrajectoryComponent (if added to the character)
// The component caches past/future trajectory samples compatible with Pose Search schemas.
```

The `AnimationLocomotionLibrary` plugin (`Plugins/Animation/AnimationLocomotionLibrary`)
provides `UAnimationWarpingLibrary::ComputeTrajectory` and related helpers for building
trajectory data without a dedicated component.

### Tuning

- **Schema** — add trajectory samples at t = {-0.5, -0.25, 0, 0.25, 0.5} seconds; bone
  channels for hips and feet.
- **Cost factors** — weight trajectory cost higher for fast direction changes; weight pose
  cost higher for stable locomotion.
- **Continuing cost** — a bias toward the current clip reduces jitter; tune per game.
- **Notify tags** — mark clips with gameplay tags to constrain searches (e.g. only search
  "crouch" clips when crouched).

## Motion Warping

### What it is

Motion Warping adjusts root-motion clips at runtime to land a character at a target
position or orientation — useful for vaulting, ledge grabs, melee attacks, and any
context-sensitive traversal where the animation must meet a world point.

Enable the `MotionWarping` plugin (bundled with UE 5.7).

### Setup

1. Add `UMotionWarpingComponent` to the character:
   ```cpp
   // In character constructor:
   MotionWarpingComp = CreateDefaultSubobject<UMotionWarpingComponent>(TEXT("MotionWarping"));
   ```

2. Annotate the montage: in the Animation Sequence Editor, add a **Motion Warping** notify
   state (`AnimNotifyState_MotionWarping`) to the montage track. Name the warp target (e.g.
   `"VaultTarget"`) and set the window where warping applies.

3. Register the warp target before playing:
   ```cpp
   // Before calling PlayAnimMontage:
   FTransform TargetTransform(TargetRotation, TargetLocation);
   MotionWarpingComp->AddOrUpdateWarpTargetFromTransform(FName("VaultTarget"), TargetTransform);
   // Or from a component/socket:
   MotionWarpingComp->AddOrUpdateWarpTargetFromComponent(
       FName("VaultTarget"), LedgeComponent, NAME_None, /*bFollowComponent=*/false);
   ```

4. Play the montage normally — the component intercepts the root motion and warps it.

### Root motion requirements

The source animation must have root motion enabled (`bEnableRootMotion` on `UAnimSequence`).
The montage must use **Root Motion from Montages Only** or **Root Motion from Everything**
mode. The character's `UCharacterMovementComponent` must be set to **Root Motion from
Montages Only** mode (default for `ACharacter`).

### Warp modifier types

`MotionWarpingComponent.h` defines several root motion modifier types (via subclasses of
`URootMotionModifier`):

- **Scale** — uniformly scales the root motion to reach the target.
- **Skew Warp** — skews the trajectory without changing timing.
- **Adjustment Blend Warp** — blends between warped and unwarped motion for smooth
  character-controller feel.

The modifier type is configured in the notify state in the editor.

### Searching for warp windows in sub-montages

`UMotionWarpingComponent` has `bSearchForWindowsInAnimsWithinMontages` (default: false).
Enable it if your montage references composite animations that themselves contain the warp
notify states rather than having them directly on the montage timeline.

## Chooser (Dynamic Asset Selection)

The **Chooser** system (`Dynamic Asset Selection` doc page) lets designers build lookup
tables that select animation assets at runtime based on `FGameplayTag` context, character
state, or other parameters. The `FChooserTable` evaluates a decision tree of conditions and
returns an animation (or montage, or blend space). This is a lighter-weight alternative to
a full Motion Matching database for deterministic asset selection.

## Related

- `PoseSearchLibrary.h`: `UPoseSearchLibrary`:159, `FMotionMatchingState`:56.
- `MotionWarpingComponent.h`: `UMotionWarpingComponent`:99,
  `AddOrUpdateWarpTargetFromTransform`:166, `bSearchForWindowsInAnimsWithinMontages`:107.
- Official doc: [Motion Matching](https://dev.epicgames.com/documentation/unreal-engine/motion-matching-in-unreal-engine)
- Official doc: [Dynamic Asset Selection](https://dev.epicgames.com/documentation/unreal-engine/dynamic-asset-selection-in-unreal-engine)
- Official doc: [Locomotion](https://dev.epicgames.com/documentation/unreal-engine/locomotion-in-unreal-engine)
