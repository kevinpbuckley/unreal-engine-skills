# Montages & slots — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers montage anatomy, sections, slot blending,
root motion, blend settings, completion delegates, and authoring patterns. Grounded in UE 5.7
(`Runtime/Engine/Classes/Animation/AnimMontage.h`,
`Runtime/Engine/Classes/Animation/AnimInstance.h`,
`Runtime/Engine/Classes/GameFramework/Character.h`).

## Montage anatomy

A `UAnimMontage` is a container asset that holds:

- **Slot tracks** (`SlotAnimTracks`: `AnimMontage.h`:688) — each slot track maps a named
  AnimGraph slot to a sequence of animation segments. A montage can have multiple slot
  tracks to drive upper and lower body independently through different slots.
- **Composite sections** (`CompositeSections`: `AnimMontage.h`:684) — named playback
  regions on the montage timeline. Code can jump between sections or loop within one.
- **Blend in / blend out** (`BlendIn`:637, `BlendOut`:646) — smooth entry and exit using
  `FAlphaBlend` settings (time, curve type). `BlendOutTriggerTime` controls when blend-out
  starts relative to the end.
- **Notify tracks** — anim notifies and notify states placed on the montage timeline.

## Slot nodes in the AnimGraph

The AnimGraph needs a **Slot** node (`FAnimNode_Slot`, `AnimNode_Slot.h`) connected between
the base locomotion result and the output pose. The slot node's `SlotName` must match the
slot name referenced in the montage track.

Common setup:
```
[Locomotion state machine] → [Slot "UpperBody"] → [Output Pose]
```

If the montage uses a `DefaultSlot` track, the slot name in the AnimGraph must be
`DefaultSlot`. Name them explicitly in multi-slot rigs to avoid confusion.

## Playing a montage

```cpp
UAnimInstance* AI = GetMesh()->GetAnimInstance();

// Basic play — returns montage length (or duration; see EMontagePlayReturnType)
float Length = AI->Montage_Play(AttackMontage, /*PlayRate=*/1.f);

// Play with custom blend-in
FAlphaBlendArgs CustomBlend;
CustomBlend.BlendTime = 0.1f;
AI->Montage_PlayWithBlendIn(AttackMontage, CustomBlend, 1.f);

// ACharacter convenience — jumps straight to a named section
PlayAnimMontage(AttackMontage, 1.f, FName("Combo1"));  // Character.h:773
```

`Montage_Play` stops all other montages by default (`bStopAllMontages = true`). Pass `false`
if you need simultaneous montages on different slots (e.g. upper-body attack + full-body hurt).

## Section control

```cpp
// Jump to a named section immediately
AI->Montage_JumpToSection(FName("Combo2"), AttackMontage);
// Jump to the end of a section (useful for looping out of a section early)
AI->Montage_JumpToSectionsEnd(FName("Loop"), AttackMontage);
// Query current position
float Pos = AI->Montage_GetPosition(AttackMontage);   // AnimInstance.h:687
bool  bActive = AI->Montage_IsActive(AttackMontage);  // AnimInstance.h:674
```

Sections are ordered in the editor and can be linked to loop or chain automatically without
code — use code jumps only for dynamic branching (combo logic, interrupt recovery).

## Completion delegates

```cpp
// Per-instance delegate (preferred for one-shot actions)
FOnMontageEnded EndDelegate;
EndDelegate.BindUObject(this, &AMyChar::HandleMontageEnded);
AI->Montage_SetEndDelegate(EndDelegate, AttackMontage);   // AnimInstance.h:771

// Multicast delegate — all montages
AI->OnMontageEnded.AddDynamic(this, &AMyChar::HandleAnyMontageEnded);
AI->OnMontageBlendingOut.AddDynamic(this, &AMyChar::HandleBlendingOut);
```

`FOnMontageEnded(UAnimMontage*, bool bInterrupted)` — `bInterrupted` is true when the
montage was stopped by another montage or by explicit `Montage_Stop`, false on natural end.
Unbind delegates in `EndPlay` / destructor if the listener might outlive the mesh.

## Stopping a montage

```cpp
AI->Montage_Stop(0.25f, AttackMontage);              // blend-out over 0.25 s
StopAnimMontage(AttackMontage);                      // Character.h:777 (uses montage's default blend-out)
AI->Montage_Stop(0.f, nullptr);                      // stop ALL montages immediately
```

## Root motion in montages

Set `bEnableRootMotion` on the source `UAnimSequence` (`AnimSequence.h`:320). In the
montage, the root motion extraction mode can be:

- **Ignore Root Motion** — root bone stays at origin; locomotion driven by
  `UCharacterMovementComponent`.
- **Root Motion from Everything** — all tracks contribute.
- **Root Motion from Montages Only** — only slot tracks in this montage contribute;
  AnimGraph base pose ignores root motion.

For melee attacks and traversal animations, use `Root Motion from Montages Only` so the
character physically moves to match the animation without fighting the CMC.

**Motion Warping** (see `motion-matching-and-warping.md`) adjusts root motion at runtime
to hit a target position — preferred over manually tweaking sequences.

## Multi-slot montages

A montage can contain separate tracks for multiple slots:
```
Track "UpperBody"  → upper body swing animation
Track "LowerBody"  → lower body idle / movement
```

Both slots must exist in the AnimGraph. This avoids the need for layered blend-per-bone
when the DCC artist already authored the split.

## Authoring tips

- Keep each montage focused on one action or action-family. Avoid mega-montages with dozens
  of sections — they are hard to maintain.
- Use **notify states** for weapon traces and hit windows rather than discrete notifies; the
  state's `NotifyTick` runs every frame of the window.
- Expose `TSubclassOf<UAnimMontage>` or `TSoftObjectPtr<UAnimMontage>` on C++ classes so
  designers can swap montages without recompiling.

## Related

- `AnimMontage.h`: `UAnimMontage`:621, `FCompositeSection`:37, `FSlotAnimationTrack`:83,
  `BlendIn`:637, `BlendOut`:646, `CompositeSections`:684, `SlotAnimTracks`:688.
- `AnimInstance.h`: `Montage_Play`:613, `Montage_Stop`:626, `Montage_JumpToSection`:650,
  `Montage_IsActive`:674, `Montage_GetPosition`:687, `OnMontageEnded`:757,
  `Montage_SetEndDelegate`:771.
- `Character.h`: `PlayAnimMontage`:773, `StopAnimMontage`:777.
- Official doc: [Animation Montage](https://dev.epicgames.com/documentation/unreal-engine/animation-montage-in-unreal-engine)
- Official doc: [Animation Slots](https://dev.epicgames.com/documentation/unreal-engine/animation-slots-in-unreal-engine)
