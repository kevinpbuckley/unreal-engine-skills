# Performance Processing & Export — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers every `UMetaHumanPerformance` property
grouped by input route, how the pipeline runs (stages, blocking vs async, exclusions,
diagnostics), the per-frame result type `FFrameAnimationData`, and the two export paths in
`UMetaHumanPerformanceExportUtils` with how to land the result on a MetaHuman. Grounded in
UE 5.8 (`Engine/Plugins/MetaHuman/MetaHumanAnimator/Source/MetaHumanPerformance/`).

---

## Data properties (`MetaHumanPerformance.h`)

| Property | Line | Route | Notes |
|---|---|---|---|
| `InputType` | 180 | all | `EDataInputType` (`:35`): `DepthFootage`, `Audio`, `MonoFootage`. `BlueprintSetter = SetInputType` (`:503`) clears stale state and may null footage with a bad frame rate |
| `FootageCaptureData` | 185 | footage | `BlueprintSetter = SetFootageCaptureData` (`:499`) |
| `Audio` | 189 | audio | `BlueprintSetter = SetAudio` (`:507`); `GetAudioForProcessing()` (`:192`) returns this or the footage's first audio track |
| `CaptureDataConfig` | 202 | depth | Transient display name of the resolved `UMetaHumanConfig`; empty means the device class could not be matched |
| `Camera` | 206 | footage | RGB view name for multi-camera footage |
| `TimecodeAlignment` | 210 | all | `ETimecodeAlignment` None/Absolute/Relative |
| `Identity` | 214 | depth | `BlueprintSetter = SetIdentity` (`:511`); resets processed output |
| `ControlRigAssetReference` | 226 | all | `FControlRigAssetStrongReference`; defaults to the plugin's `Face_ControlBoard_CtrlRig` (`LoadDefaultControlRig`, `.cpp`:3491) |
| `VisualizationObject` | 234 | all | `USkeletalMesh` or MetaHuman Blueprint used for preview; `GetHeadMesh()` (`:584`) resolves it |
| `HeadMovementMode` | 247 | all (hidden when body tracking) | `TransformTrack` (move the mesh by its root), `ControlRig` (head control switch in the rig), `Disabled` |
| `HeadMovementReferenceFrame`, `bAutoChooseHeadMovementReferenceFrame` | 251, 255 | footage | Reference frame for head pose (auto picks most frontal frame) |
| `bNeutralPoseCalibrationEnabled`, `NeutralPoseCalibrationFrame`, `...Alpha`, `...Curves` | 263-275 | mono | Subtract a neutral frame from mono results |

## Processing parameters

### Depth footage (`DepthFootage`)

| Property | Line | Notes |
|---|---|---|
| `DefaultTracker` | 279 | `UMetaHumanFaceContourTrackerAsset` — landmark NNE models |
| `DefaultSolver` | 283 | `UMetaHumanFaceAnimationSolver` — can override `DeviceConfig`, depth-map influence, eye smoothness, teeth mode (`MetaHumanFaceAnimationSolver.h`:51-75) |
| `SolveType` | 295 | `ESolveType` (`:43`): `Preview`, `Standard`, `AdditionalTweakers` (default), `AdditionalTweakersPlusChinCompress` |
| `bEasyToEditControlCurves` | 299 | Produce combined, animator-friendly curves |
| `bSkipPreview` ("Run Preview Pass") | 304 | Predictive-solver preview pass before the full solve |
| `bSkipFiltering` ("Filter Animation") | 309 | Post-filter stage |
| `bSkipTongueSolve` ("Solve Tongue") | 319 | Also mono; audio-driven tongue solve |
| `bSkipPerVertexSolve` ("Run Per Vertex Solve") | 357 | Slow, slightly better |
| `MinDistance`, `MaxDistance` | 429, 433 | Only when stereo depth generation applies (`ShouldShowDepthParameters`, `:618`) |
| Diagnostics: `bSkipDiagnostics` ("Compute Diagnostics"), `MinimumDepthMapFaceCoverage` 80 %, `MinimumDepthMapFaceWidth` 120 px, `MaximumStereoBaselineDifferenceFromIdentity` 10 %, `MaximumScaleDifferenceFromIdentity` 7.5 % | 450-466 | Results in `DepthMapDiagnosticResults` (`:538`) and `ScaleEstimate` (`:541`); `DiagnosticsIndicatesProcessingIssue(OutText)` (`:121`) summarises |

Note the inverted names: `bSkipPreview = false` means the preview pass *runs*; the display
names ("Run Preview Pass", "Filter Animation", "Compute Diagnostics") are the truthful ones.

### Monocular footage (`MonoFootage`)

| Property | Line | Notes |
|---|---|---|
| `bFaceTracking` | 314 | `BlueprintReadWrite`; face solve on/off |
| `bBodyTracking` | 324 | `BlueprintSetter = SetBodyTracking` (`:534`); needs the body tracker modular feature (`IMetaHumanBodyTrackerInterface`) |
| `bAutoBodyHeight`, `BodyHeight` | 329, 333 | cm; 145-190 recommended |
| `BodyDetectionConfidence`, `BodyTrackingConfidence` | 340, 347 | Acquire / keep thresholds |
| `bEnableFootLocking` | 352 | |
| `MonocularAnimationPipelineModels` ("Facial Models") | 384 | `FMonocularAnimationPipelineModels` (`HyprsenseRealtimeNode.h`:59): `NNEBackend`, `FaceDetector`, `FaceHeadPoseTracker`, `FaceSolver` (NNE model data) |
| `FocalLength`, `EstimateFocalLength(OutError)` | 388, 629 | -1 until estimated; the estimate runs a short pipeline |
| `bHeadStabilization` | 392 | |
| `HeadAllowedRotationLeftRight` 45°, `HeadAllowedRotationUpDown` 30° | 399, 406 | Frames beyond are unsolved |
| `HeadRotationHandler` | 413 | `EFaceUnsolvedFrameBehavior` (`HyprsenseRealtimeNode.h`:42): `None` (gap, curves interpolate) or `NeutralPose` |
| `MonoSmoothingParams` | 417 | `UMetaHumanRealtimeSmoothingParams` |

### Audio (`Audio`) — see [audio-driven-animation.md](audio-driven-animation.md)

`bRealtimeAudio` (361), `bDownmixChannels` (365), `AudioChannelIndex` (369), `bGenerateBlinks`
(373), `AudioDrivenAnimationOutputControls` (376), `AudioDrivenAnimationModels` (380),
`AudioDrivenAnimationSolveOverrides` (425), realtime mood/intensity/lookahead (437-445).

### Common

- `StartFrameToProcess`, `EndFrameToProcess` (`:287`, `:291`) — `uint32`; prefer
  `SetProcessingRange(Start, End)` (`:520`): clamps to the active limits, treats negatives as
  0, snaps to the full range when there is no overlap, and *defers* the request if source
  data has not loaded yet (`bHasPendingProcessingRange`, `:750`). End is exclusive.
- `UserExcludedFrames` (`:470`), `ProcessingExcludedFrames` (`:474`, filled by the solver
  for frames it judged bad; export skips them), `GetExcludedFrame(Frame)` (`:623`).
- `bShowFramesAsTheyAreProcessed` (`:421`) — editor viewport scrubbing during processing.

---

## Running the pipeline

```cpp
if (Perf->CanProcess())                              // see SKILL.md for the full ladder
{
    Perf->SetBlockingProcessing(true);               // optional
    const EStartPipelineErrorType Err = Perf->StartPipeline(/*bIsScriptedProcessing*/ true);
}
```

`StartPipeline` (`MetaHumanPerformance.cpp`:1104) resets state, returns `Disabled` if
`CanProcess()` fails or the footage view lookups are invalid, computes rate-matching drop
frames for depth footage, merges exclusions into one or more frame ranges (one pipeline run
per contiguous block), resets output and then:

- Audio and mono: `StartPipelineStage()` immediately (`:1276-1279`).
- Depth + blocking: `DefaultTracker->LoadTrackersSynchronous()` then start (`:1280-1286`).
- Depth + async: `LoadTrackers(true, callback)` and start on the next editor tick (`:1288-1297`).

Each stage builds a `UE::MetaHuman::Pipeline::FPipeline`, picks the GPU
(`FPipeline::PickPhysicalDevice()`), and runs it in `PushSyncNodes` (blocking),
`PushSync` (blocking + body tracking, nodes on the game thread) or `PushAsyncNodes`
(`:2086-2104`). Depth footage runs multi-stage (preview → full solve → filtering; tongue and
body add stages); `GetPipelineStage()` / `GetTotalPipelineStage()` (`:570`, `:575`) and the
editor-only `OnStageProcessingFinished()` / `OnFrameProcessed()` delegates (`:156`, `:160`)
report progress. `OnProcessingFinishedDynamic` (`:107`) is the only `BlueprintAssignable`
completion signal; the C++ `OnProcessingFinished()` (`:157`) passes the pipeline data.

`CancelPipeline()` (`:489`) stops an async run. `bIsScriptedProcessing` only affects
telemetry and progress UI; default `true` suppresses the modal progress.

Only one performance processes at a time (`CurrentlyProcessedPerformance`, `:710`).

### Results: FFrameAnimationData

`AnimationData` (`:547`) is a `TArray64<FFrameAnimationData>` indexed by *animation frame*
(0 = `StartFrameToProcess`), not sequencer frame. `GetAnimationData(Start, End)` (`:560`)
copies a slice; `GetNumberOfProcessedFrames()` (`:563`); `ContainsAnimationDataType(Face|Body)`
(`:555`). Per frame (`FrameAnimationData.h`:44):

- `Pose` (`:49`) — head transform (zero scale means "no pose"; `HasValidAnimationPose`, `:599`).
- `AnimationData` (`:55`) — `TMap<FString, float>` of face-board control name → value; this is
  what becomes AnimSequence curves. `GetAnimationCurveNames()` (`:605`) lists them.
- `BodyAnimationData` (`:61`) — bone name → transform for body tracking.
- `AnimationQuality` (`:79`, `EFrameAnimationQuality` Preview/Final/PostFiltered) and
  `AudioProcessingMode` (`:82`).

---

## Export: UMetaHumanPerformanceExportUtils

Header `MetaHumanPerformanceExportUtils.h`. All functions are static; the four
`BlueprintCallable` ones:

- `GetExportAnimationSequenceSettings(Perf)` (`:302`) — mutable CDO pre-filled from the
  performance (`.cpp`:797-842): `PackagePath` = performance folder, `AssetName` = `AS_<name>`,
  `ExportRange = ProcessingRange`, `bEnableHeadMovement` if head pose available and mode not
  Disabled, `bExportFace`/`bExportBody` from what was solved, `BodyRetargeter` from the body
  tracker plugin, `TargetSkeletonOrSkeletalMesh` = `SKM_Body` (body) or
  `<ContentBrowserSavePath>/MetaHumans/Common/Face/Face_Archetype_Skeleton` (face).
- `GetExportLevelSequenceSettings(Perf)` (`:306`) — `LS_<name>`, camera on, lens distortion
  off, `WholeSequence`, control-rig head movement when `HeadMovementMode == ControlRig`,
  transform track when `TransformTrack` (`.cpp`:858-882).
- `ExportAnimationSequence(Perf, Settings = nullptr)` (`:310`) → `UAnimSequence*`.
- `ExportLevelSequence(Perf, Settings = nullptr)` (`:314`) → `ULevelSequence*`.

Also exported for C++: `BakeControlRigAnimationData` / `BakeTransformAnimationData` (`:317`,
`:320`) to key a single frame into an existing Control Rig or transform section,
`SetHeadControlSwitchEnabled(Track, bEnable)` (`:323`), `CanExportFaceAnimation` /
`CanExportBodyAnimation` / `CanExportHeadMovement` / `CanExportVideoTrack` /
`CanExportDepthTrack` / `CanExportAudioTrack` / `CanExportIdentity` /
`CanExportLensDistortion` (`:325-332`). `UMetaHumanPerformance::CanExportAnimation()`
(`MetaHumanPerformance.h`:111) is the simple "is there anything to export" check.

### UMetaHumanPerformanceExportAnimationSettings (`:48`)

| Property | Line | Default | Notes |
|---|---|---|---|
| `bEnableHeadMovement` | 67 | true | Adds `HeadYaw`, `HeadPitch`, `HeadRoll`, `HeadTranslationX/Y/Z` curves (`.cpp`:100-105) |
| `bShowExportDialog` | 71 | true | **Set false for scripts** |
| `bAutoSaveAnimSequence` | 75 | true | |
| `ExportRange` | 84 | WholeSequence | `EPerformanceExportRange` (`:20`): `ProcessingRange` or `WholeSequence` (unprocessed frames hold the reference pose) |
| `bExportFace`, `bExportBody` | 90, 96 | | Only meaningful with body tracking |
| `ExportSkeleton` | 101 | PerformerSkeleton | `EPerformanceExportSkeleton` (`:27`): `PerformerSkeleton` (copy of the solved body skeleton), `ExistingSkeleton` (IK retarget via `BodyRetargeter`, `:111`), `Raw` (hidden, SMPL) |
| `TargetSkeletonOrSkeletalMesh` | 106 | | `USkeleton` or `USkeletalMesh`; `GetTargetSkeleton()` (`:151`) resolves it |
| `BodyUnsolvedBehavior` | 118 | LastValidFrame | `EBodyUnsolvedFrameBehavior` (`:36`) |
| `CurveInterpolation` | 122 | Linear | `ERichCurveInterpMode` |
| `bRemoveRedundantCurveKeys` | 127 | true | Python `remove_redundant_curve_keys` (alias `remove_redundant_keys`) |
| `AssetName`, `PackagePath` | 131, 135 | | Ignored when the dialog is shown |
| `SourceSkeletalMesh`, `SMPLSourceSkeletalMesh` | 140, 145 | | Transient; scripted body exports must populate them (the toolkit does it from the body tracker actor) |

`IsTargetSkeletonCompatible(Curves, OutMissing)` (`:158`) checks the skeleton's curve
metadata for every performance curve; the export warns and lists missing curves. A skeleton
without `CTRL_expressions_*` curve names is not a MetaHuman face skeleton.

Face-only export writes curves only — no bone tracks — so the AnimSequence is portable
across all MetaHumans sharing `Face_Archetype_Skeleton`.

### UMetaHumanPerformanceExportLevelSequenceSettings (`:173`)

Media: `bExportVideoTrack` (214), `bExportDepthTrack` (218), `bExportAudioTrack` (222),
`bExportImagePlane` (226), `bExportDepthMesh` (230). Camera: `bExportCamera` (234),
`bApplyLensDistortion` (238), `bMatchCameraAspectRatioToOriginalFootage` (242). Identity
binding: `bExportIdentity` (246), `bExportControlRigTrack` (250),
`bEnableControlRigHeadMovement` (254), `bExportTransformTrack` (258). MetaHuman binding:
`TargetMetaHumanClass` (271, a `UBlueprint` spawned into the sequence),
`bEnableMetaHumanHeadMovement` (267). Range: `ExportRange` (275), `bKeepFrameRange` (262 —
keep processing-range frame numbers instead of starting at 0). Curves: `CurveInterpolation`
(279), `bRemoveRedundantKeys` (283). Placement: `PackagePath`, `AssetName`, `bShowExportDialog`
(202-210).

The exported sequence contains a Control Rig track (`Face_ControlBoard_CtrlRig`) on the
Identity's skeletal mesh actor and/or the MetaHuman's Face component, with the head
control switch set by `SetHeadControlSwitchEnabled` (`.cpp`:1154). Level Sequence export
needs a live editor (spawnables, Sequencer modules); Epic's scripts state it is unsupported
in headless `-run=pythonscript` mode.

---

## Applying exported animation to a MetaHuman

1. **Curves, not bones.** The face AnimSequence drives RigLogic through curve values.
   Assembled MetaHumans run RigLogic in the Face component's post-process Animation
   Blueprint (`ABP_Face_PostProcess`, loaded in `MetaHumanCharacterEditorActor.cpp`:74;
   legacy exports use `Face_PostProcess_AnimBP`). Any playback path that evaluates the
   sequence on that component works: Sequencer Animation track, `PlayAnimation`, a Slot in
   the face AnimBP, or an `AnimSequence` player in a custom AnimBP — as long as the
   post-process ABP stays assigned on the face skeletal mesh.
2. **Skeleton match.** Export against `Face_Archetype_Skeleton` (shared by every MetaHuman
   face) or directly against the target Character's face skeletal mesh. Mixed-skeleton
   playback needs no retargeting because curves are matched by name.
3. **Head movement.** With `bEnableHeadMovement` the head curves exist; the MetaHuman's
   face board rig and RigLogic map them onto the head/neck. Disable it when a body animation
   already drives the neck to avoid double rotation.
4. **Preview before export.** Set `VisualizationObject` to the target MetaHuman Blueprint so
   the Performance viewport shows the real character; `GetHeadMesh()` resolves its Face
   component.
5. **Cinematics.** Prefer `ExportLevelSequence` with `TargetMetaHumanClass` for a Sequencer
   shot — you get the Control Rig track (editable keys), camera, audio and image plane.

---

## Source references (UE 5.9)

All paths under `Engine/Plugins/MetaHuman/MetaHumanAnimator/Source/`:
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:35 — `EDataInputType`; `ESolveType` (43); `EPerformanceHeadMovementMode` (52); `EStartPipelineErrorType` (65).
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:82 — `UMetaHumanPerformance`; `OnProcessingFinishedDynamic` (108); `CanExportAnimation` (111); `DiagnosticsIndicatesProcessingIssue` (122); editor delegates (125-171).
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:181 — data properties (181-276); depth parameters (280-364); mono parameters (315-424); audio parameters (368-452); diagnostics (455-473); exclusions (477-481).
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:504 — `StartPipeline`; `CancelPipeline` (507); `IsProcessing` (510); `CanProcess` (513); setters (517-558); outputs (580-605); `GetExportFrameRange` (610); `GetHeadMesh` (626); `GetAnimationCurveNames` (647); `GetCannotProcessTooltipText` (650); `EstimateFocalLength` (671); `CurrentlyProcessedPerformance` (752).
- `MetaHumanPerformance/Private/MetaHumanPerformance.cpp`:1104 — `StartPipeline`; tracker loading (1346-1367); pipeline mode selection (2157-2175); `CanProcess` (2535-2658); `SetProcessingRange` (439); `LoadDefaultControlRig` (3572).
- `MetaHumanPerformance/Public/MetaHumanPerformanceExportUtils.h`:20 — `EPerformanceExportRange`; `EPerformanceExportSkeleton` (27); `EBodyUnsolvedFrameBehavior` (36); `UMetaHumanPerformanceExportAnimationSettings` (48); `UMetaHumanPerformanceExportLevelSequenceSettings` (173); `UMetaHumanPerformanceExportUtils` (293); `ExportAnimationSequence` (310); `ExportLevelSequence` (314); bake helpers (317-323); `CanExport*` (325-332).
- `MetaHumanPerformance/Private/MetaHumanPerformanceExportUtils.cpp`:101 — head curve names; `GetExportAnimationSequenceSettings` (804); `GetExportLevelSequenceSettings` (865); head switch baking (1161).
- `MetaHumanFaceAnimationSolver/Public/MetaHumanFaceAnimationSolver.h`:33 — `UMetaHumanFaceAnimationSolver`.
- `MetaHumanFaceContourTracker/Public/MetaHumanFaceContourTrackerAsset.h`:23 — `UMetaHumanFaceContourTrackerAsset`.

All paths under `Engine/Plugins/MetaHuman/MetaHumanCoreTechLib/Source/`:
- `MetaHumanCoreTech/Public/FrameAnimationData.h`:13 — `EFrameAnimationQuality`; `EAudioProcessingMode` (24); `EFrameAnimationDataType` (33); `FFrameAnimationData` (44).
- `MetaHumanPipelineCore/Public/Nodes/HyprsenseRealtimeNode.h`:42 — `EFaceUnsolvedFrameBehavior`; `FMonocularAnimationPipelineModels` (59).
- `MetaHumanCoreTech/Public/MetaHumanCommonDataUtils.h`:34 — `GetDefaultControlRigFromRegistry`; `GetAnimatorPluginFaceControlRigPath` (48); `GetAnimatorPluginFacePostProcessABPPath` (51).

All paths under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/`:
- `MetaHumanCharacterEditor/Private/MetaHumanCharacterEditorActor.cpp`:74 — `ABP_Face_PostProcess` assignment on the Face component.

Shipped Python: `Engine/Plugins/MetaHuman/MetaHumanAnimator/Content/Python/process_performance.py`,
`process_monocular_performance.py`, `export_performance.py`.
