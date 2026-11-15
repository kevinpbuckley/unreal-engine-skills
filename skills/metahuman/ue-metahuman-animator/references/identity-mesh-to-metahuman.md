# Identity & Mesh to MetaHuman — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `UMetaHumanIdentity` asset: its parts
and poses, promoted frames and tracking, conforming the template mesh, the cloud auto-rig
service and offline DNA import/export, "Prepare for Performance", and feeding an Identity
into a MetaHuman Character. Grounded in UE 5.8
(`Engine/Plugins/MetaHuman/MetaHumanAnimator/Source/MetaHumanIdentity/`,
`Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterEditor/`).

---

## What an Identity is

`UMetaHumanIdentity` (`MetaHumanIdentity.h`:67) is the performer's digital double. Its class
comment spells out the pipeline: track facial features on capture data, fit a template mesh
with MetaHuman topology to the tracked curves, send the mesh to the MetaHuman service, get
back an auto-rigged face `USkeletalMesh`. That rig, plus trained predictive solvers, is
what a `DepthFootage` Performance solves against. An Identity is editor-only data; nothing
in it ships.

State flags that matter downstream (on the face part, `MetaHumanIdentityParts.h`):
- `bIsConformed` (`:352`) — `Conform()` succeeded at least once.
- `bIsAutoRigged` (`:356`) — DNA applied, from the service or `ImportDNAFile`.
- `RigComponent` (`:348`) — the `USkeletalMeshComponent` holding the rigged face mesh.
- `HasDNABuffer()` / `HasPredictiveSolvers()` (`:247`, `:250`).

`EIdentityInvalidationState` (`MetaHumanIdentity.h`:27: `Solve`, `AR`, `FitTeeth`,
`PrepareForPerformance`, `Valid`, `None`) names the stages the editor toolkit invalidates
when an upstream input changes; it is deprecated as a stored property but documents the order
of operations.

---

## Parts

`Parts` (`MetaHumanIdentity.h`:168) is `TArray<TObjectPtr<UMetaHumanIdentityPart>>`.
`UMetaHumanIdentityPart` (`MetaHumanIdentityParts.h`:56) is abstract with `Initialize()` and
`DiagnosticsIndicatesProcessingIssue(OutText)`. Access with
`FindPartOfClass(Class)` / templated `FindPartOfClass<T>()` / `GetOrCreatePartOfClass(Class)`
(`MetaHumanIdentity.h`:95-110) and `CanAddPartOfClass` (`:113`).

| Part | Line | Purpose |
|---|---|---|
| `UMetaHumanIdentityFace` | 106 | The only part with real processing: poses, template mesh, rig, solvers |
| `UMetaHumanIdentityBody` | 550 | `Height`, `BodyTypeIndex` (573, 576) — body preset forwarded to the auto-rig request and to MetaHuman Creator |
| `UMetaHumanIdentityHands` | 585 | Placeholder part (metadata only) |
| `UMetaHumanIdentityOutfit` | 607 | Placeholder part |
| `UMetaHumanIdentityProp` | 628 | Placeholder part |

Only the Face part is required. The shipped `create_identity_for_performance.py` also
creates a Body and sets `body_type_index` (1-6) before auto-rigging.

### UMetaHumanIdentityFace essentials

| Member | Line | Notes |
|---|---|---|
| `CanConform()`, `CanSubmitToAutorigging()` | 131, 134 | Preconditions for the two big steps |
| `Conform(EConformType)` | 138 | `BlueprintCallable`; returns `EIdentityErrorCode`. `EConformType::Solve` runs the face fitter; `Copy` takes an already-conformed mesh with MetaHuman topology as-is (`:92-103`) |
| `IsConformalRigValid()` | 142 | Rig component points at a valid skeletal mesh |
| `ExportTemplateMesh(Path, AssetName)` | 145 | Saves the conformed template as a static mesh |
| `CheckTargetTemplateMesh(Asset)` | 162 | `ETargetTemplateCompatibility` (`:32`) for `Copy` conforming — vertex count/topology checks |
| `ApplyDNAToRig(Reader, bBlendShapes, bSkinWeights)` | 171 | Editor-only; applies DNA to the rig component |
| `RunPredictiveSolverTraining()` | 184 | **Prepare for Performance**, synchronous, `BlueprintCallable` |
| `RunAsyncPredictiveSolverTraining(OnProgress, OnCompleted)` + `IsAsyncPredictiveSolverTrainingActive/Cancelling`, `Cancel...`, `Poll...Progress` | 190-211 | Async variant the toolkit uses |
| `CheckDNACompatible(Reader[, OutMsg])`, `CheckRigCompatible([OutMsg])` | 219-228 | Archetype compatibility — fails for non-MetaHuman DNA |
| `FindPoseByType`, `AddPoseOfType`, `RemovePose`, `GetPoses` | 234-244 | Pose management |
| `DefaultSolver` | 340 | `UMetaHumanFaceFittingSolver` used by `Conform` |
| `TemplateMeshComponent` | 344 | `UMetaHumanTemplateMeshComponent` showing head/eyes/teeth per pose |
| Diagnostics | 381-398 | `bSkipDiagnostics`, `MaximumScaleDifferenceFromAverage` (25 %), `MinimumDepthMapFaceCoverage` (80 %), `MinimumDepthMapFaceWidth` (120 px), `MaximumInvalidBrowAnnotations` (10 %) |

---

## Poses and promoted frames

A pose (`UMetaHumanIdentityPose`, `MetaHumanIdentityPose.h`:38) is one view of the performer:
`PoseType` (`:137`) is `EIdentityPoseType::Neutral`, `Teeth` or `Custom` (`:20`). The Neutral
pose is mandatory; Teeth improves the teeth fit (`ManualTeethDepthOffset`, `:168`, ±1 cm).

- `SetCaptureData(UCaptureData*)` / `GetCaptureData()` / `IsCaptureDataValid()` (`:56-63`) —
  either a `UFootageCaptureData` (promoted frames are video frames) or a `UMeshCaptureData`
  (a scan; a single camera frame is promoted).
- `bFitEyes` (`:141`, "Use Data Driven Eyes") — Neutral only; fit eyes from footage.
- `Camera` (`:210`) and `TimecodeAlignment` (`:214`) — which RGB view and how tracks align.
- `DefaultTracker` (`:149`) — `UMetaHumanFaceContourTrackerAsset`; `LoadDefaultTracker()`
  (`:108`) picks the plugin's generic tracker for the pose type if none is set.
- `AddNewPromotedFrame(OutIndex)` / `RemovePromotedFrame` (`:74`, `:78`) — creates an
  instance of `PromotedFrameClass` (`:153`) and appends to `PromotedFrames` (`:157`).
- `GetIsFrameValid(FrameNumber)` (`:226`) → `ECurrentFrameValid` (`Invalid_NoRGBOrDepth`,
  `Invalid_Excluded`, ...) — check before promoting.

Promoted frames (`UMetaHumanIdentityPromotedFrame`, `MetaHumanIdentityPromotedFrames.h`:18):
- `UMetaHumanIdentityFootageFrame` (`:197`) adds `FrameNumber` (`:204`, `BlueprintReadWrite`).
- `UMetaHumanIdentityCameraFrame` (`:134`) is the mesh-capture variant with a virtual camera.
- `bIsFrontView` (`:109`) — exactly one frame per pose should be the frontal view; the face
  fitter uses it first (`GetValidContourDataFramesFrontFirst`, `MetaHumanIdentityPose.h`:92).
- `bUseToSolve` (`:97`), `bIsNavigationLocked` (`:101`, `SetNavigationLocked`, `:71`).
- `ContourTracker` (`:113`), `ContourData` (`:117`) — the tracked landmark curves.
- `CanTrack()` (`:59`), `FrameContoursContainActiveData()` (`:55`),
  `DiagnosticsIndicatesProcessingIssue(MinCoverage, MinWidth, OutText)` (`:79`).

Tracking a footage frame from script is a three-step dance because the pipeline wants raw
pixels, not an asset:

1. `UPromotedFrameUtils::InitializeContourDataForFootageFrame(Pose, FootageFrame)`
   (`PromotedFrameUtils.h`:31) — parses the tracker config into the frame's `ContourData`.
2. `GetImagePathForFrame(CaptureData, Camera, FrameId, bIsImageSequence, Alignment)` (`:45`)
   for both the RGB (`true`) and depth (`false`) file, then
   `GetPromotedFrameAsPixelArrayFromDisk(ImagePath, OutSize, OutBGRA)` (`:35`).
3. `UMetaHumanIdentity::SetBlockingProcessing(true)` then
   `StartFrameTrackingPipeline(Pixels, W, H, DepthPath, Pose, Frame, bShowProgress)`
   (`MetaHumanIdentity.h`:140, 136); `IsFrameTrackingPipelineProcessing()` (`:142`) for the
   non-blocking case.

```python
face = identity.get_or_create_part_of_class(unreal.MetaHumanIdentityFace)
pose = unreal.new_object(type=unreal.MetaHumanIdentityPose, outer=face)
face.add_pose_of_type(unreal.IdentityPoseType.NEUTRAL, pose)
pose.set_capture_data(capture_data)
pose.fit_eyes = True
pose.load_default_tracker()
frame, index = pose.add_new_promoted_frame()
frame.is_front_view = True
frame.set_navigation_locked(True)
frame.frame_number = neutral_frame
if unreal.PromotedFrameUtils.initialize_contour_data_for_footage_frame(pose, frame):
    cam = pose.get_editor_property("camera")
    rgb = unreal.PromotedFrameUtils.get_image_path_for_frame(capture_data, cam, neutral_frame, True, pose.timecode_alignment)
    depth = unreal.PromotedFrameUtils.get_image_path_for_frame(capture_data, cam, neutral_frame, False, pose.timecode_alignment)
    size, pixels = unreal.PromotedFrameUtils.get_promoted_frame_as_pixel_array_from_disk(rgb)
    identity.set_blocking_processing(True)
    identity.start_frame_tracking_pipeline(pixels, size.x, size.y, depth, pose, frame, False)
    if unreal.MetaHumanIdentity.handle_error(face.conform(), True):
        print("conformed")
```

`UMetaHumanIdentity::HandleError(Code, bLogOnly)` (`MetaHumanIdentity.h`:192) returns true for
"no error or just a warning" and logs (or shows a dialog when `bLogOnly` is false).

For a mesh scan, create a `UMeshCaptureData` with `TargetMesh` set, assign it to the Neutral
pose, promote one camera frame and track it; the pixel array comes from rendering that
camera frame in the toolkit, so mesh-based identities are normally made in the editor UI or
by importing a DNA.

---

## Conforming and auto-rigging

`Face->Conform()` fits the template mesh (head, eyes, teeth if a Teeth pose exists) to the
tracked curves and depth. It needs valid contour data on at least the frontal frame
(`CanConform`). Result: `bIsConformed`, `TemplateMeshComponent` updated,
`BrowsBufferBulkData` (brows.json) produced for later animation.

### Cloud auto-rig (Mesh to MetaHuman)

`UMetaHumanIdentity`:
- `IsLoggedInToService()` (`:149`) — only checks a stored session, no network call.
- `LogInToAutoRigService()` (`:145`) — opens the Epic login flow (interactive).
- `CreateDNAForIdentity(bInLogOnly)` (`:155`) — validates (`CanSubmitToAutorigging`: conformed
  + Neutral pose with valid capture data), uploads the conformed vertices, and returns
  immediately. `IsAutoRiggingInProgress()` (`:152`) while waiting.
- `OnAutoRigServiceFinishedDynamicDelegate(bool bSuccess)` (`:82`, `:87`,
  `BlueprintAssignable`) — fires on completion; on success the DNA has been applied,
  `bIsAutoRigged` is true and `RigComponent` holds a new face skeletal mesh whose default
  animating rig is `Face_ControlBoard_CtrlRig` (`MetaHumanIdentityParts.cpp`:2047-2054) and
  whose physics asset is cleared.

Python binding (the dynamic delegate is multicast):

```python
def on_autorig_done(success: bool):
    identity.on_auto_rig_service_finished_dynamic_delegate.remove_callable(on_autorig_done)
    if success:
        identity.get_or_create_part_of_class(unreal.MetaHumanIdentityFace).run_predictive_solver_training()

if not identity.is_logged_in_to_service():
    identity.log_in_to_auto_rig_service()          # interactive; cannot run headless
identity.on_auto_rig_service_finished_dynamic_delegate.add_callable(on_autorig_done)
identity.create_dna_for_identity(True)
```

A headless commandlet cannot complete the login; cache a session by logging in once in the
editor, or use the DNA route below.

### Offline DNA

- `ImportDNAFile(DnaPath, EDNADataLayer, BrowsJsonPath)` (`:123`) — editor-only
  `BlueprintCallable`; the Identity must already have a Face part. `EDNADataLayer::All` is
  what the shipped script uses. Returns `EIdentityErrorCode`; compatibility is checked
  against the plugin archetype (`CheckDNACompatible`).
- `ExportDNADataToFiles(DnaPathWithName, BrowsPathWithName)` (`:127`) — writes the current
  DNA and brows.json; use it to move a rig between projects or into a MetaHuman Character.
- `ImportDNA(Reader, BrowsBuffer)` (`:130`) — C++ equivalent with an `IDNAReader`.

---

## Prepare for Performance

The toolbar button and `create_identity_for_performance.py` both call
`UMetaHumanIdentityFace::RunPredictiveSolverTraining()` (`MetaHumanIdentityParts.h`:184).
It trains the preview ("predictive") solvers from the rig's DNA and stores them in
`PredictiveSolversBulkData` / `PredictiveWithoutTeethSolverBulkData` (`:421-424`). It takes
minutes and needs the rig to exist first. `UMetaHumanPerformance::CanProcess` only insists on
`RigComponent`, `bIsAutoRigged` and *no training in progress*
(`MetaHumanPerformance.cpp`:2606-2623), but the preview pass and the global teeth solve read
the trained data, so an unprepared Identity gives poor or failed solves. Use the async form
(`RunAsyncPredictiveSolverTraining`) from UI code; the sync form from scripts.

---

## Identity → MetaHuman Character

The Character editor subsystem (`UMetaHumanCharacterEditorSubsystem`,
`MetaHumanCharacterEditorSubsystem.h`:496) fits a Character's face state to an Identity's
conformed mesh:

```python
subsys = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
if not subsys.try_add_object_to_edit(character):            # :529
    raise RuntimeError("character already open for edit")
try:
    params = unreal.ImportFromIdentityParams()              # :392
    params.use_eye_meshes = True
    params.use_teeth_mesh = True
    params.use_metric_scale = False                          # False: scale head to MetaHuman size
    result = subsys.import_from_identity(character, identity, params)   # :1437
    if result != unreal.ImportErrorCode.SUCCESS:             # :38 — IDENTITY_NOT_CONFORMED if Conform() never ran
        raise RuntimeError(str(result))
finally:
    if subsys.is_object_added_for_editing(character):
        subsys.remove_object_to_edit(character)              # :541
```

`EImportErrorCode` (`:38-54`) also reports `InvalidHeadMesh`, `NoEyeMeshesPresent`,
`NoTeethMeshPresent`, `FittingError`. Importing from an Identity only transfers the
*shape*; the Character then needs its own rig via `RequestAutoRigging(Character, Params)`
(`:1356`) before it can play face animation. The Identity's rig is not reused — the
Performance uses the Identity's rig for *solving*, while the Character's rig is what the
exported animation plays on. Alternatively `ImportFromFaceDna` (`:1442`) consumes a DNA
exported with `ExportDNADataToFiles`.

---

## Source references (UE 5.9)

All paths under `Engine/Plugins/MetaHuman/MetaHumanAnimator/Source/`:
- `MetaHumanIdentity/Public/MetaHumanIdentity.h`:27 — `EIdentityInvalidationState`.
- `MetaHumanIdentity/Public/MetaHumanIdentity.h`:67 — `UMetaHumanIdentity`; delegates (82-91); `FindPartOfClass`/`GetOrCreatePartOfClass` (95-99); `ImportDNAFile` (124); `ExportDNADataToFiles` (128); `StartFrameTrackingPipeline` (136); `SetBlockingProcessing` (140); auto-rig API (146-156); `HandleError` (192).
- `MetaHumanIdentity/Public/MetaHumanIdentityParts.h`:32 — `ETargetTemplateCompatibility`; `UMetaHumanIdentityPart` (56); `EConformType` (92); `UMetaHumanIdentityFace` (106); `Conform` (138); `RunPredictiveSolverTraining` (184); pose API (234-244); `RigComponent` (348); `bIsConformed` (352); `bIsAutoRigged` (356); `UMetaHumanIdentityBody` (550); Hands/Outfit/Prop (585, 607, 628).
- `MetaHumanIdentity/Public/MetaHumanIdentityPose.h`:20 — `EIdentityPoseType`; `UMetaHumanIdentityPose` (38); `SetCaptureData` (56); `AddNewPromotedFrame` (74); `LoadDefaultTracker` (108); `bFitEyes` (141); `Camera` (210); `TimecodeAlignment` (214).
- `MetaHumanIdentity/Public/MetaHumanIdentityPromotedFrames.h`:18 — `UMetaHumanIdentityPromotedFrame`; `bIsFrontView` (109); `UMetaHumanIdentityCameraFrame` (134); `UMetaHumanIdentityFootageFrame` (197); `FrameNumber` (204).
- `MetaHumanIdentity/Public/PromotedFrameUtils.h`:22 — `UPromotedFrameUtils`; `InitializeContourDataForFootageFrame` (31); `GetPromotedFrameAsPixelArrayFromDisk` (35); `GetImagePathForFrame` (45).
- `MetaHumanIdentity/Private/MetaHumanIdentityParts.cpp`:2047 — rigged mesh gets `Face_ControlBoard_CtrlRig` as default animating rig.
- `MetaHumanIdentityEditor/Private/MetaHumanIdentityFactoryNew.h`:13 — `UMetaHumanIdentityFactoryNew`.
- `MetaHumanFaceContourTracker/Public/MetaHumanFaceContourTrackerAsset.h`:23 — `UMetaHumanFaceContourTrackerAsset`.
- `MetaHumanPerformance/Private/MetaHumanPerformance.cpp`:2606 — Identity requirements inside `CanProcess`.

All paths under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/`:
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:38 — `EImportErrorCode`; `FImportFromIdentityParams` (397); `UMetaHumanCharacterEditorSubsystem` (496); `TryAddObjectToEdit` (534); `RemoveObjectToEdit` (546); `RequestAutoRigging` (1361); `ImportFromIdentity` (1430, 1442); `ImportFromFaceDna` (1447).

All paths under `Engine/Plugins/VirtualProduction/CaptureData/Source/`:
- `CaptureDataCore/Public/CaptureData.h`:93 — `UMeshCaptureData`; `UFootageCaptureData` (217).

Shipped Python: `Engine/Plugins/MetaHuman/MetaHumanAnimator/Content/Python/create_identity_for_performance.py`
and `Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Python/examples/example_conform_from_identity.py`.
