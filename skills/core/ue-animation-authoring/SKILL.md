---
name: ue-animation-authoring
description: Create and edit UAnimSequence assets programmatically — build a sequence from
  code with UAnimSequenceFactory and IAnimationDataController (SetFrameRate,
  SetNumberOfFrames, AddBoneCurve, SetBoneTrackKeys), import animation-only FBX onto an
  existing USkeleton with UFbxImportUI, and verify results numerically with FAnimPose /
  UAnimPoseExtensions. Use when generating animation from code or a DCC round-trip
  (Blender/Maya export), writing bone track keys directly, importing a clip onto a shared
  skeleton (e.g. a MetaHuman body), debugging why an authored clip evaluates in the wrong
  place (skeleton ref pose vs mesh proportions, untracked bones), or validating poses
  without opening the editor UI.
metadata:
  engine-version: "5.8"
  category: animation
---

# Authoring AnimSequences from code

`UAnimSequence` data is edited through a controller interface, not by poking properties:
every structural change (frame rate, length, bone tracks, curves) goes through
`IAnimationDataController`, obtained from the sequence itself. This is the path for
generated animation — procedural gestures, DCC round-trips, batch fixes — and it is fully
scriptable from editor C++ or editor Python.

## When to use this skill

- Creating a new `UAnimSequence` entirely from code and filling its bone tracks.
- Importing an animation-only FBX (no mesh) onto an existing skeleton.
- Verifying what a clip actually evaluates to — bone positions/rotations at a frame —
  without playing it in a viewport.
- Debugging an authored clip that plays "in the wrong place" on a character.

## Mental model

- **Data model vs controller.** The sequence's animation data lives in an
  `IAnimationDataModel`; all edits go through `IAnimationDataController`
  (`UAnimSequenceBase::GetController()`). Wrap multi-step edits in
  `OpenBracket`/`CloseBracket` — one transaction, one rebuild.
- **Tracks are local-space and dense.** A bone track holds arrays of positional,
  rotational and scaling keys in **parent-bone space**, one key per frame. With
  `SetNumberOfFrames(N)` the clip spans N frame *intervals*, so supply **N + 1 keys**
  (frame 0 through N). Shorter arrays are an error; a track you never add leaves that bone
  at reference pose.
- **Two reference poses exist.** `USkeleton::GetReferenceSkeleton()` is the skeleton
  *asset's* ref pose; each `USkeletalMesh` carries its own reference skeleton with its own
  proportions. Characters sharing one skeleton asset (MetaHuman bodies are the canonical
  case) differ in bone translations. A clip authored against the skeleton asset's
  proportions evaluates correctly in skeleton-space previews but places joints elsewhere on
  a specific mesh — and vice versa. Author against the proportions you will play on, and
  for evaluation parity pin the parent chain (e.g. spine) with static tracks holding that
  mesh's bind-pose locals.

## Creating a sequence from code

```cpp
// Editor module. Factory creates the asset bound to a skeleton:
UAnimSequenceFactory* Factory = NewObject<UAnimSequenceFactory>();
Factory->TargetSkeleton = Skeleton;           // USkeleton*
UAnimSequence* Seq = Cast<UAnimSequence>(
    IAssetTools::Get().CreateAsset(TEXT("A_MyClip"), TEXT("/Game/Anims"),
                                   UAnimSequence::StaticClass(), Factory));

IAnimationDataController& Ctrl = Seq->GetController();
Ctrl.OpenBracket(NSLOCTEXT("MyGen", "Build", "Build clip"));
Ctrl.SetFrameRate(FFrameRate(30, 1));
Ctrl.SetNumberOfFrames(FFrameNumber(89));     // 90 keys: frames 0..89

Ctrl.AddBoneCurve(TEXT("hand_r"));
Ctrl.SetBoneTrackKeys(TEXT("hand_r"), PosKeys, RotKeys, ScaleKeys); // 90 entries each,
                                                                    // parent-space TRS
Ctrl.CloseBracket();
Seq->MarkPackageDirty();
```

The same calls exist in editor Python: `seq.controller` is the controller
(`open_bracket`, `set_frame_rate(unreal.FrameRate(30,1))`,
`set_number_of_frames(unreal.FrameNumber(89))`, `add_bone_curve(name)`,
`set_bone_track_keys(name, pos_list, quat_list, scale_list)`).

Rules that save a rebuild:

- **Local rotation = `inv(parent component rotation) * child component rotation`.** If you
  compute poses in component space, convert per frame; positional keys are the (usually
  constant) parent-space bind offsets.
- **Keep quaternion keys sign-continuous.** `q` and `-q` are the same rotation, but raw
  key arrays are interpolated componentwise; a sign flip between neighbouring keys drives
  interpolation through a near-zero quaternion and the bone (and every child) collapses
  for the frames between them. When generating keys, negate any quaternion whose dot
  product with the previous key is negative.
- Call `AddBoneCurve` before `SetBoneTrackKeys` for a bone that has no track yet;
  `RemoveAllBoneTracks` resets a sequence you are regenerating.

## Importing animation-only FBX onto an existing skeleton

For a clip exported from a DCC (armature + baked keys, no mesh), drive the legacy FBX
importer with `UFbxImportUI` through an automated `UAssetImportTask`:

```cpp
UFbxImportUI* Ui = NewObject<UFbxImportUI>();
Ui->bImportMesh = false;
Ui->bImportAsSkeletal = false;
Ui->bImportAnimations = true;
Ui->Skeleton = TargetSkeleton;                       // match by bone names
Ui->MeshTypeToImport = FBXIT_Animation;
Ui->bAutomatedImportShouldDetectType = false;
Ui->AnimSequenceImportData->AnimationLength = FBXALIT_ExportedTime;
Ui->AnimSequenceImportData->bUseDefaultSampleRate = false;
Ui->AnimSequenceImportData->CustomSampleRate = 30;
```

- Bones are matched **by name**; the FBX's bind orientations do not need to match the
  skeleton's own conventions because the file carries absolute local transforms per frame.
- A DCC whose coordinate system differs (Blender is right-handed, Y mismatch) round-trips
  correctly through the importer's axis conversion — verify with a pose evaluation
  (below), expecting the engine's own axes, not the DCC's.
- Set the sample rate explicitly; "use default" can resample a 30 fps export.

## Verifying a clip numerically

`FAnimPose` / `UAnimPoseExtensions` (editor-only module `AnimationBlueprintLibrary`)
evaluates a sequence without any viewport:

```cpp
FAnimPose Pose;
UAnimPoseExtensions::GetAnimPoseAtFrame(Seq, 27, FAnimPoseEvaluationOptions(), Pose);
FTransform HandWorld = UAnimPoseExtensions::GetBonePose(Pose, TEXT("hand_r"),
                                                        EAnimPoseSpaces::World);
FTransform HandBind  = UAnimPoseExtensions::GetRefBonePose(Pose, TEXT("hand_r"),
                                                           EAnimPoseSpaces::World);
```

- Compare evaluated joint **positions** against your targets — joint geometry is the
  ground truth. A rendered preview can look right from a flattering angle while the pose
  is wrong (a rolled wrist reads as palm-up from the camera the palm happens to face).
  Cheap geometric checks: are the knuckles level for a flat hand; does the triangle normal
  of three joints match the intended plane.
- Pose evaluation runs the **sequence only** — no post-process AnimBP, no Control Rig, no
  procedural correctives. On rigs whose final look depends on those (MetaHuman twist and
  corrective bones, head-IK driven by curves), a pose check can pass while the in-game
  result differs; `EvaluateAnimationBlueprintWithInputPose` exists for checking through an
  AnimBP.
- Frame indices here are 0-based; DCC timelines usually start at 1. An off-by-one makes a
  key frame compare against an interpolated frame.

## Gotchas & edge cases

- **Untracked bones = skeleton-asset ref pose** in evaluation and preview contexts. If the
  clip animates an arm but carries no spine tracks, evaluating against the skeleton asset
  composes the arm onto archetype proportions. Add static tracks for the parent chain
  (bind locals of the intended mesh) when numeric parity matters.
- **`FReferenceSkeleton` from the mesh, not the skeleton, for character-true bind data.**
  On proportioned characters the two differ by centimetres per bone.
- **Editor asset library loaders return null during PIE.** Editor-scripting paths that
  resolve assets with the editor subsystem loaders fail while any PIE session is active;
  `StaticLoadObject`/`LoadObject` keep working. Factory + controller authoring works
  during PIE.
- A `UAnimSequenceFactory` with no `TargetSkeleton` opens a modal picker — always set it
  when automating.

## References & source material

Engine source (5.8), paths under `Engine/Source/`:
- `Runtime/Engine/Classes/Animation/AnimData/IAnimationDataController.h` —
  `IAnimationDataController`:45, `OpenBracket`:109, `SetNumberOfFrames`:127,
  `SetFrameRate`:176, `SetBoneTrackKeys`:238 (FVector3f/FQuat4f) and :253
  (FVector/FQuat).
- `Runtime/Engine/Classes/Animation/AnimSequenceBase.h` — `GetController`:249.
- `Runtime/Engine/Classes/Animation/AnimSequence.h` — `UAnimSequence`.
- `Runtime/Engine/Classes/Animation/Skeleton.h` — `USkeleton`:294,
  `GetReferenceSkeleton`:366.
- `Editor/UnrealEd/Classes/Factories/AnimSequenceFactory.h` — `UAnimSequenceFactory`:18,
  `TargetSkeleton`:23.
- `Editor/UnrealEd/Classes/Factories/FbxImportUI.h` — `UFbxImportUI`:98,
  `MeshTypeToImport`:113.
- `Editor/AnimationBlueprintLibrary/Public/AnimPose.h` — `FAnimPoseEvaluationOptions`:52,
  `FAnimPose`:87, `UAnimPoseExtensions`:158, `GetBonePose`:193, `GetRefBonePose`:216,
  `GetAnimPoseAtFrame`:309, `EvaluateAnimationBlueprintWithInputPose`:320.

Related skills: [ue-animation-system](../ue-animation-system/SKILL.md) for the runtime
AnimInstance/AnimBP side; [ue-importing-content](../ue-importing-content/SKILL.md) for
general asset import.
