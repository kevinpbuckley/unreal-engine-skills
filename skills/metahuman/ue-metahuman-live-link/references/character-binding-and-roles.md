# Character binding and Live Link roles — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers how Live Link data is typed (roles, static
vs frame data), exactly what a MetaHuman subject contains, how the assembled MetaHuman
character consumes it (`LiveLinkSetup`, `ABP_MH_LiveLink`, `LLink_Face_Subj`), how to consume
it in your own AnimBP with `FAnimNode_LiveLinkPose` and a remap asset, and when
`ULiveLinkComponentController` is the right tool. Grounded in UE 5.8.

---

## Roles and data structs

A role (`ULiveLinkRole`, `Engine/Source/Runtime/LiveLinkInterface/Public/LiveLinkRole.h`:17)
declares three `UScriptStruct`s: static data, frame data, Blueprint data. Relevant roles:

| Role | Static / frame structs | Used by |
|---|---|---|
| `ULiveLinkBasicRole` (`Roles/LiveLinkBasicRole.h`:20) | `FLiveLinkBaseStaticData` (`LiveLinkTypes.h`:256) / `FLiveLinkBaseFrameData` (:216) — `PropertyNames` + `PropertyValues` | **All MetaHuman Live Link subjects**, legacy ARKit face |
| `ULiveLinkAnimationRole` (`Roles/LiveLinkAnimationRole.h`:23) | skeleton + transforms + curves | Body mocap (Vicon, Xsens, …), Live Link Hub skeleton subjects |
| `ULiveLinkTransformRole` (`Roles/LiveLinkTransformRole.h`) | single transform | Head/prop trackers |

`FLiveLinkSubjectRepresentation` (`LiveLinkRole.h`:35) = `FLiveLinkSubjectName Subject` +
`TSubclassOf<ULiveLinkRole> Role`; it is what `ULiveLinkComponentController` and the
`EvaluateLiveLinkFrame` Blueprint node take. A subject can be *translated* to another role
through `ULiveLinkFrameTranslator`s on its settings (`LiveLinkSubjectSettings.h`:87); check with
`ILiveLinkClient::DoesSubjectSupportsRole_AnyThread` (`ILiveLinkClient.h`:165).

`FLiveLinkBaseFrameData` also carries `WorldTime` (:222), `MetaData` (`FLiveLinkMetaData`:
`StringMetaData` + `SceneTime`, :197-205) and `PropertyValues` (:230).
`FLiveLinkBaseStaticData::FindPropertyValue(FrameData, Name, OutValue)` (:265) is the lookup.

## What a MetaHuman subject contains

Static `PropertyNames` (pushed once per connection; re-pushing clears the frame buffer):

```
<raw rig controls in solver order>     e.g. CTRL_expressions_jawOpen, CTRL_expressions_browDownL, …
HeadControlSwitch                      1 = head curves are valid, 0 = ignore them
HeadRoll, HeadPitch, HeadYaw           degrees, head-bone space
HeadTranslationX/Y/Z                   cm, relative to the captured neutral head pose
MHFDSVersion                           MetaHuman facial data version (1 for local sources; the app's AnimationVersion for Live Link Face)
DisableFaceOverride                    1 for local sources
```

(`MetaHumanLocalLiveLinkSubject.cpp`:198-210; `LiveLinkFaceSource.cpp`:477-495.) Frame metadata
`StringMetaData["HeadPoseMode"]` is the `EMetaHumanLiveLinkHeadPoseMode` bitmask and
`["IsNeutralFrame"]` marks the calibration frame (`MetaHumanLocalLiveLinkSubject.cpp`:258-259).

The raw control names are the MetaHuman DNA's raw controls — the same names a MetaHuman
Animator performance exports as curves — so the face rig (RigLogic post-process AnimBP) can
consume them directly as anim curves. There is no body data in these subjects.

## The assembled MetaHuman character

### What the generated Blueprint provides

The MetaHuman SDK verifier (`MetaHumanSDK/Source/MetaHumanSDKEditor/Private/Verification/VerifyMetaHumanCharacter.cpp`:476-510)
expects the character Blueprint to have:

- a skeletal mesh component named **`Face`** (component name from
  `UMetaHumanComponentBase::FaceComponentName`, `MetaHumanComponentBase.h`:126) whose mesh has
  a post-process AnimBP and `Face_ControlBoard_CtrlRig` as default animating rig;
- a construction script calling `SetLeaderPoseComponent` (Face follows Body);
- a function graph named **`LiveLinkSetup`** (warning 1021 if missing).

The template Blueprints in `MetaHumanCharacter/Content/BuildPipeline/BP_MetaHuman_Legacy*.uasset`
contain `LiveLinkSetup` and reference `ABP_MH_LiveLink` and the `LLink_Face_Subj` variable.
`LiveLinkSetup` swaps the Face component's AnimBP to the Live Link AnimBP and writes the
subject name into it; the Python/C++ equivalent is below.

### ABP_MH_LiveLink

`/MetaHumanCharacter/Animation/ABP_MH_LiveLink` is the AnimBP the editor's own Live Link
preview uses (`MetaHumanInvisibleDrivingActor.cpp`:21). It exposes:

- **`LLink_Face_Subj`** — `FLiveLinkSubjectName` variable; the editor sets it by reflection
  (`MetaHumanInvisibleDrivingActor.cpp`:55-64). This is the one property you must set.
- A **Live Link Pose** node (`FAnimNode_LiveLinkPose`) fed by that subject, with an
  **`ARKit_Mapping`** `ULiveLinkRemapAsset` for the ARKit stream.
- An **Evaluate Live Link Frame** (`ULiveLinkBlueprintLibrary::EvaluateLiveLinkFrameWithSpecificRole`,
  `LiveLinkBlueprintLibrary.h`:206) with **`ULiveLinkBasicRole`** reading `HeadYaw`,
  `HeadPitch`, `HeadRoll` and `HeadControlSwitch`, driving the head via layered bone blends.

Consequence: the character needs no `ULiveLinkComponentController`; the AnimBP pulls the
subject by name each tick.

### Setting the subject from code

```cpp
// Editor or runtime. Face component is the skeletal mesh named "Face".
#include "Animation/AnimInstance.h"
#include "Components/SkeletalMeshComponent.h"
#include "LiveLinkTypes.h"

bool SetMetaHumanLiveLinkSubject(AActor* MetaHuman, FName Subject)
{
    USkeletalMeshComponent* Face = nullptr;
    TInlineComponentArray<USkeletalMeshComponent*> Meshes(MetaHuman);
    for (USkeletalMeshComponent* C : Meshes)
    {
        if (C->GetName() == TEXT("Face")) { Face = C; break; }
    }
    UAnimInstance* Anim = Face ? Face->GetAnimInstance() : nullptr;
    if (!Anim) { return false; }

    FStructProperty* Prop = CastField<FStructProperty>(Anim->GetClass()->FindPropertyByName(TEXT("LLink_Face_Subj")));
    if (!Prop || Prop->Struct != FLiveLinkSubjectName::StaticStruct()) { return false; }
    Prop->ContainerPtrToValuePtr<FLiveLinkSubjectName>(Anim)->Name = Subject;   // same as MetaHumanInvisibleDrivingActor.cpp:60-64
    return true;
}
```

If the Face component is still running `ABP_Face` (the non-Live-Link face AnimBP, which is
mostly `AnimNode_CopyPoseFromMesh` from the body), switch it first:
`Face->SetAnimInstanceClass(LoadClass<UAnimInstance>(nullptr, TEXT("/MetaHumanCharacter/Animation/ABP_MH_LiveLink.ABP_MH_LiveLink_C")))`
— that is what `AMetaHumanInvisibleDrivingActor::InitLiveLinkAnimInstance` does
(`MetaHumanInvisibleDrivingActor.cpp`:85-92). Calling the Blueprint's own `LiveLinkSetup`
function (`CallFunctionByNameWithArguments` / Python `call_method`) does both when present.

### Body and head

Body motion is unrelated to these sources — use a Live Link **Animation Role** subject from a
body mocap system through a separate `FAnimNode_LiveLinkPose` on the Body AnimBP, or a
`ULiveLinkComponentController` with the Transform role for a head tracker. When body mocap
already rotates the head/neck, turn off `bHeadOrientation` on the face subject so the two do
not add up.

## Your own AnimBP: FAnimNode_LiveLinkPose

`Engine/Source/Runtime/LiveLinkAnimationCore/Public/AnimNode_LiveLinkPose.h`:23:

| Pin / property | Line | Notes |
|---|---|---|
| `InputPose` | :29 | Pose to layer onto. |
| `LiveLinkSubjectName` | :32 | `PinShownByDefault` — bind to a variable so game code can swap subjects. |
| `bDoLiveLinkEvaluation` | :35 | Transient toggle; false freezes to the cached frame. |
| `RetargetAsset` | :44 | `TSubclassOf<ULiveLinkRetargetAsset>`; default `ULiveLinkRemapAsset`. |

Evaluation path: the node asks the client for the subject's role; Animation Role →
`BuildPoseFromAnimData` (:68); **Basic Role → `BuildPoseFromCurveData`** (:71), which calls
`ULiveLinkRetargetAsset::BuildPoseAndCurveFromBaseData` (`LiveLinkRemapAsset.h`:38) and writes
each `PropertyValues[i]` into the output curve named `PropertyNames[i]`. That is why a MetaHuman
subject "just works": the raw control names become anim curves the RigLogic post-process AnimBP
reads.

`ULiveLinkRemapAsset` (`LiveLinkRemapAsset.h`:26) is Blueprintable — override
`GetRemappedCurveName` to map ARKit names (`jawOpen`) to rig controls, or override
`GetRemappedBoneName` for Animation Role subjects. `ULiveLinkInstance`
(`LiveLinkInstance.h`:41) is a ready-made `UAnimInstance` whose graph is a single Live Link
Pose node, with `SetSubject()` (:48) and `SetRetargetAsset()` (:54) — handy for a bare
skeletal mesh actor driven by a Transform- or Animation-role subject, less so for MetaHumans
because it bypasses the body/face layering.

Minimal graph for a custom MetaHuman face AnimBP:

```
[Copy Pose From Mesh (Body)] → [Live Link Pose (Subject=LiveLinkSubject, Retarget=ULiveLinkRemapAsset)] → [Output]
```

plus, for head motion, `Evaluate Live Link Frame (Basic Role)` → read `HeadControlSwitch`,
`HeadYaw/Pitch/Roll` → `Transform (Modify) Bone` on `head` gated by the switch.

## ULiveLinkComponentController

`Engine/Plugins/Animation/LiveLink/Source/LiveLinkComponents/Public/LiveLinkComponentController.h`:22
(`BlueprintSpawnableComponent`). Not for the face, but the right tool for any transform-,
camera-, light- or lens-role subject on the same actor (head tracker, witness camera).

| Member | Line | Notes |
|---|---|---|
| `SubjectRepresentation` | :32 | Subject + role; use `SetSubjectRepresentation` (:90) so `ControllerMap` is rebuilt. |
| `ControllerMap` | :41 | `TMap<TSubclassOf<ULiveLinkRole>, TObjectPtr<ULiveLinkControllerBase>>`, instanced; one controller per role in the role's hierarchy. |
| `bUpdateInEditor` / `bUpdateInPreviewEditor` | :44 / :70 | Tick outside PIE. |
| `bEvaluateLiveLink` | :66 | Runtime pause. |
| `bDisableEvaluateLiveLinkWhenSpawnable` | :62 | Default true: a Sequencer spawnable plays its recorded track instead of live data. |
| `OnLiveLinkUpdated` | :48 | Blueprint event per new frame. |
| `SetControllerClassForRole` | :82 | Choose a specific `ULiveLinkControllerBase` subclass. |
| `GetControlledComponent` / `SetControlledComponent` | :100 / :104 | The component a controller drives. |

Controllers (`ULiveLinkControllerBase`, `LiveLinkControllerBase.h`:20): `Tick(DeltaTime, const FLiveLinkSubjectFrameData&)`
(:38), `IsRoleSupported` (:44), `GetDesiredComponentClass` (:49), `ComponentPicker` (:101).
Engine-provided: `ULiveLinkTransformController` (`Controllers/LiveLinkTransformController.h`:60 —
`bWorldTransform`, `bUseLocation/Rotation/Scale`, `bSweep`, `bTeleport`),
`ULiveLinkLightController`, `ULiveLinkCameraController` (LiveLinkCamera plugin),
`ULiveLinkLensController` (LiveLinkLens plugin). None supports `ULiveLinkBasicRole`; to consume
face curves outside an AnimBP write a `ULiveLinkControllerBase` subclass whose
`IsRoleSupported` returns true for the Basic Role and read `PropertyValues` in `Tick`.

## Blueprint/Python-side evaluation

`ULiveLinkBlueprintLibrary` (`LiveLinkBlueprintLibrary.h`:29):

- `EvaluateLiveLinkFrameWithSpecificRole(SubjectName, Role, OutBlueprintData)` (:206) — the
  "Evaluate Live Link Frame" node; with `ULiveLinkBasicRole` the output is
  `FLiveLinkBasicBlueprintData`, read with `GetPropertyValue(BasicData, Name, Value)` (:37).
  It is `CustomThunk` and `BlueprintInternalUseOnly`, so it is **not** callable from Python —
  evaluate in a Blueprint or in C++ with `EvaluateFrame_AnyThread`.
- `GetLiveLinkSubjects(bIncludeDisabled, bIncludeVirtual)` (:148),
  `GetLiveLinkEnabledSubjectNames` (:144), `GetLiveLinkSubjectRole` (:190),
  `GetSpecificLiveLinkSubjectRole` (:186), `GetLiveLinkSubjectState` (:172),
  `IsLiveLinkSubjectEnabled` (:166), `SetLiveLinkSubjectEnabled(Key, bool)` (:182),
  `PauseSubject` / `UnpauseSubject` (:194/:198) — all plain `BlueprintCallable`, fine from Python.
- Source handles: `IsSourceStillValid`, `RemoveSource`, `GetSourceStatus`, `GetSourceType`,
  `GetSourceMachineName` (:115-131) take the `FLiveLinkSourceHandle` returned by the MetaHuman
  Blueprint libraries.

## Live Link Hub and rebroadcast

`UMetaHumanLiveLinkSubjectSettings` derives from `ULiveLinkHubSubjectSettings`
(`Engine/Plugins/Animation/LiveLink/Source/LiveLink/Public/LiveLinkHubSubjectSettings.h`:16),
which adds `OutboundName` (:57) — the name clients see when the subject is rebroadcast — and a
`TranslatorsProxy`. The MetaHuman sources can therefore run inside the **Live Link Hub**
application and stream the solved curves to one or more editors or packaged games over Message
Bus. On the receiving side the subject arrives through a `ULiveLinkMessageBusSource` with
`ULiveLinkHubMessageBusSourceSettings`
(`LiveLinkHubMessaging/Public/LiveLinkHubMessageBusSourceSettings.h`:11); it is still Basic
Role with the same property layout, so the character binding is identical. Enable
`bRebroadcastSubject` (`LiveLinkSubjectSettings.h`:102) on the Hub side;
`ULiveLinkHubMessagingSettings::bAllowReceivingFromUnreal` (`LiveLinkHubMessagingSettings.h`:44)
governs the reverse direction.

---

## Source references (UE 5.9)

`Engine/Source/Runtime/LiveLinkInterface/Public/`:
- `LiveLinkRole.h`:17 — `ULiveLinkRole`; :35 `FLiveLinkSubjectRepresentation`.
- `Roles/LiveLinkBasicRole.h`:20 — `ULiveLinkBasicRole`.
- `Roles/LiveLinkAnimationRole.h`:23 — `ULiveLinkAnimationRole`.
- `Roles/LiveLinkTransformRole.h` — `ULiveLinkTransformRole`.
- `LiveLinkTypes.h`:39 — `FLiveLinkSubjectName`; :77 `FLiveLinkSubjectKey`; :197 `FLiveLinkMetaData`; :216 `FLiveLinkBaseFrameData`; :256 `FLiveLinkBaseStaticData`; :265 `FindPropertyValue`; :526 `FLiveLinkSubjectFrameData`.
- `LiveLinkSubjectSettings.h`:53 — `ULiveLinkSubjectSettings`; :79 `PreProcessors`; :83 `InterpolationProcessor`; :87 `Translators`; :91 `Remapper`; :102 `bRebroadcastSubject`.
- `ILiveLinkClient.h`:165 — `DoesSubjectSupportsRole_AnyThread`; :282 `EvaluateFrame_AnyThread`.

`Engine/Source/Runtime/LiveLinkAnimationCore/Public/`:
- `AnimNode_LiveLinkPose.h`:23 — `FAnimNode_LiveLinkPose`; :32 `LiveLinkSubjectName`; :44 `RetargetAsset`; :68 `BuildPoseFromAnimData`; :71 `BuildPoseFromCurveData`.
- `LiveLinkRemapAsset.h`:26 — `ULiveLinkRemapAsset`; :38 `BuildPoseAndCurveFromBaseData`.
- `LiveLinkRetargetAsset.h` — `ULiveLinkRetargetAsset`.
- `LiveLinkInstance.h`:41 — `ULiveLinkInstance`; :48 `SetSubject`; :54 `SetRetargetAsset`.

`Engine/Plugins/Animation/LiveLink/Source/`:
- `LiveLinkComponents/Public/LiveLinkComponentController.h`:22 — `ULiveLinkComponentController`; :32 `SubjectRepresentation`; :41 `ControllerMap`; :90 `SetSubjectRepresentation`; :104 `SetControlledComponent`.
- `LiveLinkComponents/Public/LiveLinkControllerBase.h`:20 — `ULiveLinkControllerBase`; :38 `Tick`; :44 `IsRoleSupported`; :94 `GetControllersForRole`.
- `LiveLinkComponents/Public/Controllers/LiveLinkTransformController.h`:60 — `ULiveLinkTransformController`.
- `LiveLinkComponents/Public/Controllers/LiveLinkLightController.h` — `ULiveLinkLightController`.
- `LiveLink/Public/LiveLinkBlueprintLibrary.h`:29 — `ULiveLinkBlueprintLibrary`; :37 `GetPropertyValue`; :148 `GetLiveLinkSubjects`; :182 `SetLiveLinkSubjectEnabled`; :206 `EvaluateLiveLinkFrameWithSpecificRole`.
- `LiveLink/Public/LiveLinkHubSubjectSettings.h`:16 — `ULiveLinkHubSubjectSettings`; :57 `OutboundName`.

`Engine/Plugins/Animation/LiveLinkHub/Source/`:
- `LiveLinkHubMessaging/Public/LiveLinkHubMessageBusSourceSettings.h`:11 — `ULiveLinkHubMessageBusSourceSettings`.
- `LiveLinkHubMessaging/Public/LiveLinkHubMessagingSettings.h`:14 — `ULiveLinkHubMessagingSettings`; :44 `bAllowReceivingFromUnreal`.

`Engine/Plugins/MetaHuman/`:
- `MetaHumanLiveLink/Source/MetaHumanLocalLiveLinkSource/Private/MetaHumanLocalLiveLinkSubject.cpp`:198 — static property names; :258 frame metadata.
- `MetaHumanLiveLink/Source/LiveLinkFaceSource/Private/LiveLinkFaceSource.cpp`:477 — `PushStaticData`.
- `MetaHumanLiveLink/Source/MetaHumanLiveLinkSource/Public/MetaHumanLiveLinkSubjectSettings.h`:141 — `EMetaHumanLiveLinkHeadPoseMode`.
- `MetaHumanCharacter/Source/MetaHumanCharacterEditor/Public/MetaHumanInvisibleDrivingActor.h`:17 — `AMetaHumanInvisibleDrivingActor`; :27 `InitLiveLinkAnimInstance`; :44 `SetLiveLinkSubjectNameChanged`.
- `MetaHumanCharacter/Source/MetaHumanCharacterEditor/Private/MetaHumanInvisibleDrivingActor.cpp`:21 — `ABP_MH_LiveLink` path; :55 `LLink_Face_Subj`; :85 `InitLiveLinkAnimInstance`.
- `MetaHumanCharacter/Source/MetaHumanCharacterEditor/Private/SMetaHumanCharacterEditorPreviewSettingsView.h`:108 — `LiveLinkSubjectName` preview setting.
- `MetaHumanSDK/Source/MetaHumanSDKEditor/Private/Verification/VerifyMetaHumanCharacter.cpp`:476 — `LiveLinkSetup` / `SetLeaderPoseComponent` checks.
- `MetaHumanSDK/Source/MetaHumanSDKRuntime/Public/MetaHumanComponentBase.h`:126 — `FaceComponentName`; :134 `RigLogicLODThreshold`.
- `MetaHumanSDK/Source/MetaHumanSDKRuntime/Public/MetaHumanComponentUE.h`:12 — `UMetaHumanComponentUE`.
