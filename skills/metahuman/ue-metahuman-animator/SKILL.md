---
name: ue-metahuman-animator
description: Facial performance to animation with MetaHuman Animator in Unreal Engine
  5.8 — ingest footage into UFootageCaptureData (Capture Manager, Live Link Face iPhone
  takes, mono webcam/DSLR video), build a UMetaHumanIdentity (Mesh to MetaHuman,
  auto-rig service, Prepare for Performance), process a UMetaHumanPerformance from depth
  footage, monocular video or audio only (Speech2Face), and export UAnimSequence /
  ULevelSequence through UMetaHumanPerformanceExportUtils onto a MetaHuman face
  (Face_Archetype_Skeleton, Face_ControlBoard_CtrlRig). Use when scripting MetaHuman
  Animator (C++/Python), batch-converting USoundWave dialogue to face animation,
  ingesting iPhone or webcam takes, debugging CanProcess/StartPipeline failures, or
  applying exported animation to an assembled MetaHuman. Covers EDataInputType,
  UCaptureData, UMetaHumanIdentityFace, UMetaHumanIdentityPose, UMetaHumanDepthGenerator,
  UCaptureManagerIngestBlueprintLibrary, UMetaHumanBatchOperation,
  FAudioDrivenAnimationSolveOverrides, EAudioDrivenAnimationMood.
metadata:
  aliases: "MetaHuman Animator, facial animation, face capture, lip sync from audio, Performance asset"
  engine-version: "5.9"
  category: metahuman
---

# MetaHuman Animator (offline facial performance → animation)

MetaHuman Animator turns a recorded face performance — depth footage from an iPhone or
stereo head-mounted camera, plain monocular video, or just an audio file — into a
`UAnimSequence` of MetaHuman face-board control curves that plays on any MetaHuman. All of
it lives in the **MetaHuman Animator** plugin (`Engine/Plugins/MetaHuman/MetaHumanAnimator/`,
`MetaHuman.uplugin`); every processing module is `Type: Editor`, so nothing here runs in a
cooked game. Ingest lives in the **Capture Manager** plugins
(`Engine/Plugins/VirtualProduction/CaptureManager*/`) and the capture-data asset types in
`Engine/Plugins/VirtualProduction/CaptureData/`.

## When to use this skill

- Converting dialogue `USoundWave` assets into face animation (single or batch) without any
  camera — the audio-only route.
- Ingesting Live Link Face (iPhone) takes or webcam/DSLR video into `UFootageCaptureData`
  and processing them into animation.
- Creating a `UMetaHumanIdentity` from footage or a mesh (Mesh to MetaHuman), auto-rigging it,
  and preparing it for performance processing, or pushing it into a MetaHuman Character.
- Writing editor C++ or Python that drives `UMetaHumanPerformance`, exports
  `UAnimSequence`/`ULevelSequence`, and wires the result onto an assembled MetaHuman.
- Diagnosing "Process" being greyed out, `StartPipeline` returning `Disabled`, missing
  curves on export, or depth/frame-rate/timecode mismatches.

## Mental model

```
Capture (device/file) ──ingest──▶ UFootageCaptureData ──┐
                                                         ├─▶ UMetaHumanPerformance ──process──▶ FFrameAnimationData[]
UMetaHumanIdentity (face rig, "prepared") ──────────────┤        │
USoundWave (audio only) ────────────────────────────────┘        └──export──▶ UAnimSequence / ULevelSequence
```

Four asset types carry the pipeline:

| Asset | Class | Role |
|---|---|---|
| Capture Data (Footage) | `UFootageCaptureData` (`CaptureData.h`:217) | Image sequences, depth sequences, audio tracks, camera calibrations, metadata (frame rate, device class), excluded frames |
| Capture Data (Mesh) | `UMeshCaptureData` (`CaptureData.h`:93) | A static/skeletal mesh scan used as an Identity pose |
| MetaHuman Identity | `UMetaHumanIdentity` (`MetaHumanIdentity.h`:67) | The performer's digital double: a conformed template mesh + auto-rigged face skeletal mesh + trained predictive solvers |
| MetaHuman Performance | `UMetaHumanPerformance` (`MetaHumanPerformance.h`:82) | One take: input type, sources, solver settings, processing range, per-frame results, export |

### The three input routes

`EDataInputType` (`MetaHumanPerformance.h`:35) selects the solver stack and which
properties are relevant. Everything else on the Performance is gated by `EditCondition`s on
this enum.

| Route | `InputType` | Needs | Produces |
|---|---|---|---|
| iPhone (Live Link Face, *MetaHuman Animator* capture mode) or stereo HMC | `DepthFootage` | `FootageCaptureData` with `ImageSequences` + `DepthSequences` (or ≥2 RGB views for stereo depth generation) + calibration, **and** an `Identity` that is auto-rigged and prepared | Highest fidelity face + head pose + tongue |
| Webcam / DSLR / phone video, no depth | `MonoFootage` | `FootageCaptureData` with `ImageSequences` only; **no Identity** | Face via NNE realtime models, optional body tracking, head pose |
| Audio only | `Audio` | a `USoundWave`; **no footage, no Identity** | Speech2Face lip/face animation, optional blinks and head motion, mood control |

Two facts the editor hides from you:

- **Depth generation is stereo-only.** `UMetaHumanDepthGenerator::Process` refuses footage
  with fewer than two image sequences and requires a two-camera `UCameraCalibration`
  (`MetaHumanDepthGenerationService.cpp`:581-594, 641-644 in 5.9). A single webcam video can never become
  `DepthFootage`; process it as `MonoFootage`.
- **Processing is asynchronous unless you ask otherwise.** `StartPipeline` returns
  immediately and the pipeline runs with `PushAsyncNodes`; `SetBlockingProcessing(true)`
  switches it to `PushSyncNodes` and blocks the game thread until done
  (`MetaHumanPerformance.cpp`:2157-2175). Scripts must block or bind
  `OnProcessingFinishedDynamic` (`MetaHumanPerformance.h`:108).

### What `CanProcess()` checks (`MetaHumanPerformance.cpp`:2535)

In order: not already processing; no *other* Performance is processing (only one at a
time — `CurrentlyProcessedPerformance`, `MetaHumanPerformance.h`:752); then per route:

- `Audio`: `GetAudioForProcessing()` non-null. Nothing else — audio runs on the CPU ORT
  runtime and skips the RHI check.
- `MonoFootage`: footage initialised for image sequences; at least one of `bFaceTracking`
  or (`bBodyTracking` + body tracker modular feature present).
- `DepthFootage`: face tracker modular feature present; footage initialised for
  `ImageSequences | Metadata`; calibration present (or ≥2 RGB views, no depth → stereo
  depth generation); depth present or ≥2 RGB views; `Identity` non-null with a
  `UMetaHumanIdentityFace` whose `RigComponent` is set, `bIsAutoRigged` is true and no
  predictive-solver training is running; `DefaultTracker`/`DefaultSolver` can process.
- Footage routes additionally require `FMetaHumanSupportedRHI::IsSupported()` (D3D12 on
  Windows, Vulkan on Linux, Metal on Mac — `MetaHumanSupportedRHI.cpp`:31-35) and the
  MetaHuman authoring content to be present (`FMetaHumanAuthoringObjects::ArePresent`).
- Finally the processing limit range must be non-empty.

`GetCannotProcessTooltipText()` (`MetaHumanPerformance.h`:650) mirrors the same ladder and
is the fastest way to learn *why* processing is disabled.

## Core workflow

### A. Audio only (no camera)

1. Create a `UMetaHumanPerformance` asset (Python: `AssetTools.create_asset(...,
   unreal.MetaHumanPerformance, unreal.MetaHumanPerformanceFactoryNew())`; C++: `IAssetTools::CreateAsset` with a null
   factory, or `NewObject` for a transient one).
2. `SetInputType(EDataInputType::Audio)` then `SetAudio(SoundWave)`
   (`MetaHumanPerformance.h`:521, 525). Use the setters — they reset stale state and recompute
   the frame range; raw property writes do not.
3. Optional: `AudioDrivenAnimationSolveOverrides.Mood/MoodIntensity` (`:425`),
   `AudioDrivenAnimationOutputControls` FullFace/MouthOnly (`:376`), `bGenerateBlinks`
   (`:373`), `bDownmixChannels`/`AudioChannelIndex` (`:365`, `:369`), `HeadMovementMode`
   (`:247`), `VisualizationObject` (`:234`) for a preview mesh or MetaHuman BP.
4. `SetBlockingProcessing(true)`; check `CanProcess()`; `StartPipeline()` must return
   `EStartPipelineErrorType::None` (`:65`: `None`, `NoFrames`, `Disabled`).
5. Export with `UMetaHumanPerformanceExportUtils::ExportAnimationSequence(Perf, Settings)`
   (`MetaHumanPerformanceExportUtils.h`:310) with `bShowExportDialog = false`.

### B. iPhone Live Link Face take (depth footage)

1. Record in the Live Link Face app's **MetaHuman Animator** capture mode. Those takes carry
   `depth_data.bin` + `depth_metadata.mhaical` next to the `.mov`, `frame_log.csv`,
   `audio_metadata.json` and `take.json` (`LiveLinkFaceMetadata.cpp`:47-58, 224-232).
   ARKit-mode takes have blendshape CSVs instead of depth (`:234`) and can only be
   processed as `MonoFootage`.
2. Ingest with Capture Manager: a `ULiveLinkFaceDevice` in Live Link Hub (IP + port
   14785, `LiveLinkFaceDevice.h`:39-42) pulls takes off the phone through
   `ILiveLinkDeviceCapability_Ingest` (`UpdateTakeList`, `GetTakeIdentifiers`,
   `GetTakeInformation`, `CreateIngestProcess`/`RunIngestProcess`), or from script call
   `UCaptureManagerIngestBlueprintLibrary::IngestLiveLinkFaceSync(TakeDir, Params, OutError)`
   / `IngestTakeArchiveSync` for `.cptake` archives (`CaptureManagerIngestBlueprintLibrary.h`:259, 136).
   Assets land under `UCaptureManagerEditorSettings::ImportDirectory`.
3. Build or reuse a `UMetaHumanIdentity` of the same performer (section D) and make sure it
   is auto-rigged and prepared for performance.
4. Performance: `SetInputType(DepthFootage)`, `SetFootageCaptureData(CD)`, `SetIdentity(Id)`;
   set `Camera` if the footage has several views; leave `TimecodeAlignment = Relative`
   unless you have real timecode. Optionally `SetProcessingRange(Start, End)` (`:520`,
   end exclusive). Process and export as in A.

### C. Monocular video (webcam / DSLR)

1. `IngestMonoVideoSync(VideoPath, OptionalAudioPath, Slate, TakeNumber, Params, OutError)`
   (`CaptureManagerIngestBlueprintLibrary.h`:170) → `UFootageCaptureData` with one image
   sequence (+ audio). `.mp4`/`.mov` only.
2. Performance: `SetInputType(MonoFootage)`, `SetFootageCaptureData(CD)`. No Identity.
   Tune `bFaceTracking` (`:314`), `bBodyTracking` (`:324`, needs the body tracker plugin),
   `HeadAllowedRotationLeftRight/UpDown` + `HeadRotationHandler` (`:399-413`),
   `bHeadStabilization`, `MonoSmoothingParams`, and optionally `EstimateFocalLength()`
   (`:629`) when `FocalLength` is -1.
3. Process and export as in A. Mono uses the NNE models in
   `MonocularAnimationPipelineModels` (`:384`); `NNEBackend` is `NNERuntimeORTDml` on
   Windows GPUs (`HyprsenseNode.cpp`:257).

### D. Identity (Mesh to MetaHuman)

1. Create `UMetaHumanIdentity`; `GetOrCreatePartOfClass(UMetaHumanIdentityFace)`
   (`MetaHumanIdentity.h`:99). Optional parts: `UMetaHumanIdentityBody`
   (`Height`, `BodyTypeIndex`), Hands, Outfit, Prop (`MetaHumanIdentityParts.h`:550-643).
2. Add a Neutral pose: `NewObject<UMetaHumanIdentityPose>(Face)`,
   `Face->AddPoseOfType(EIdentityPoseType::Neutral, Pose)`, `Pose->SetCaptureData(CD)`
   (`MetaHumanIdentityPose.h`:20, 56; `MetaHumanIdentityParts.h`:238). A Teeth pose is
   optional and improves the teeth fit.
3. Promote a frame: `Pose->LoadDefaultTracker()`, `Pose->AddNewPromotedFrame(Index)`
   → `UMetaHumanIdentityFootageFrame` (`FrameNumber`, `bIsFrontView`,
   `MetaHumanIdentityPromotedFrames.h`:197-204, 109). Track it with
   `UPromotedFrameUtils::InitializeContourDataForFootageFrame` and
   `UMetaHumanIdentity::StartFrameTrackingPipeline(...)` under `SetBlockingProcessing(true)`
   (`PromotedFrameUtils.h`:31; `MetaHumanIdentity.h`:136, 140).
4. `Face->Conform()` → `EIdentityErrorCode`; `UMetaHumanIdentity::HandleError(Code, bLogOnly)`
   returns true when it is not an error (`MetaHumanIdentityParts.h`:138; `MetaHumanIdentity.h`:192).
5. Auto-rig (cloud): `IsLoggedInToService()` / `LogInToAutoRigService()`, bind
   `OnAutoRigServiceFinishedDynamicDelegate`, call `CreateDNAForIdentity(bLogOnly)`
   (`MetaHumanIdentity.h`:146-156, 88). Offline alternative:
   `ImportDNAFile(DnaPath, EDNADataLayer::All, BrowsJsonPath)` (`:123`);
   `ExportDNADataToFiles` writes them back out (`:127`).
6. **Prepare for Performance** = `Face->RunPredictiveSolverTraining()`
   (`MetaHumanIdentityParts.h`:184; async variant `:190`). Without it the Identity cannot
   be used by a `DepthFootage` Performance.
7. To seed a MetaHuman Character from the Identity:
   `UMetaHumanCharacterEditorSubsystem::ImportFromIdentity(Character, Identity,
   FImportFromIdentityParams)` → `EImportErrorCode` (`IdentityNotConformed` if step 4 was
   skipped), inside `TryAddObjectToEdit`/`RemoveObjectToEdit`
   (`MetaHumanCharacterEditorSubsystem.h`:1442, 397, 38, 534, 546).

## UMetaHumanPerformance API cheat sheet

| Member | Line | Notes |
|---|---|---|
| `InputType`, `FootageCaptureData`, `Audio`, `Identity` | 180, 185, 189, 214 | All have `BlueprintSetter`s — use `SetInputType`/`SetFootageCaptureData`/`SetAudio`/`SetIdentity` (499-511) |
| `Camera`, `TimecodeAlignment` | 206, 210 | View name in multi-camera footage; `ETimecodeAlignment` None/Absolute/Relative (`CaptureData.h`:196) |
| `ControlRigAssetReference`, `VisualizationObject` | 226, 234 | Face board rig used for preview/baking (defaults to `Face_ControlBoard_CtrlRig`); preview skel mesh or MetaHuman BP |
| `HeadMovementMode` | 247 | `EPerformanceHeadMovementMode` TransformTrack / ControlRig / Disabled (`:52`) |
| `StartFrameToProcess`, `EndFrameToProcess`, `SetProcessingRange` | 287, 291, 520 | End is exclusive; negatives clamp to 0; held until source data loads |
| `bSkipDiagnostics`, `MinimumDepthMapFaceCoverage`, `MinimumDepthMapFaceWidth` | 457-465 | Depth diagnostics; results in `DepthMapDiagnosticResults` (538), `DiagnosticsIndicatesProcessingIssue` (121) |
| `UserExcludedFrames`, `ProcessingExcludedFrames` | 470, 474 | Ranges skipped / flagged bad |
| `StartPipeline(bIsScriptedProcessing=true)`, `CancelPipeline`, `IsProcessing`, `CanProcess` | 504-513 | |
| `SetBlockingProcessing`, `SetDepthDistanceRange`, `SetBodyTracking` | 531, 528, 534 | |
| `OnProcessingFinishedDynamic` | 108 | `BlueprintAssignable`; fire-and-forget scripts bind this |
| `ContainsAnimationDataType`, `GetAnimationData(Start, End)`, `GetNumberOfProcessedFrames` | 597-605 | `FFrameAnimationData` per frame (`FrameAnimationData.h`:44): `Pose` head transform, `AnimationData` control→value map, `BodyAnimationData` |
| `GetAnimationCurveNames`, `GetHeadMesh`, `GetExportFrameRange` | 605, 584, 568 | |

## C++ pattern — audio → AnimSequence (editor module)

Build.cs: `PrivateDependencyModuleNames.AddRange(new[] { "MetaHumanPerformance",
"MetaHumanSpeech2Face", "CaptureDataCore", "AssetTools", "UnrealEd" });` — editor target only.

```cpp
#include "MetaHumanPerformance.h"
#include "MetaHumanPerformanceExportUtils.h"
#include "AssetToolsModule.h"

UAnimSequence* SolveSpeechToAnim(USoundWave* Wave, const FString& PackagePath, USkeleton* FaceSkeleton)
{
    IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
    // Null factory is allowed: CreateAsset falls back to NewObject<AssetClass>.
    UMetaHumanPerformance* Perf = Cast<UMetaHumanPerformance>(
        AssetTools.CreateAsset(TEXT("MHP_") + Wave->GetName(), PackagePath, UMetaHumanPerformance::StaticClass(), nullptr));
    if (!Perf) { return nullptr; }

    Perf->SetInputType(EDataInputType::Audio);          // BlueprintSetter: resets state, recomputes range
    Perf->SetAudio(Wave);
    Perf->AudioDrivenAnimationSolveOverrides.Mood = EAudioDrivenAnimationMood::AutoDetect;
    Perf->AudioDrivenAnimationSolveOverrides.MoodIntensity = 1.0f;
    Perf->AudioDrivenAnimationOutputControls = EAudioDrivenAnimationOutputControls::FullFace;
    Perf->HeadMovementMode = EPerformanceHeadMovementMode::ControlRig;
    Perf->SetBlockingProcessing(true);                  // run synchronously on this thread

    if (!Perf->CanProcess())
    {
        UE_LOG(LogTemp, Error, TEXT("%s"), *Perf->GetCannotProcessTooltipText().ToString());
        return nullptr;
    }
    if (Perf->StartPipeline(/*bIsScriptedProcessing*/ true) != EStartPipelineErrorType::None)
    {
        return nullptr;
    }

    UMetaHumanPerformanceExportAnimationSettings* Settings =
        UMetaHumanPerformanceExportUtils::GetExportAnimationSequenceSettings(Perf); // sensible defaults
    Settings->bShowExportDialog = false;
    Settings->PackagePath = PackagePath;
    Settings->AssetName = TEXT("AS_") + Wave->GetName();
    Settings->TargetSkeletonOrSkeletalMesh = FaceSkeleton;   // Face_Archetype_Skeleton or a MetaHuman face mesh
    Settings->ExportRange = EPerformanceExportRange::ProcessingRange;
    Settings->bEnableHeadMovement = true;                    // HeadYaw/Pitch/Roll + HeadTranslationX/Y/Z curves
    return UMetaHumanPerformanceExportUtils::ExportAnimationSequence(Perf, Settings);
}
```

`GetExportAnimationSequenceSettings` returns the mutable CDO pre-filled with the
performance's folder, `AS_<name>`, `ProcessingRange`, head movement if available, and a
`Face_Archetype_Skeleton` found under the Content Browser's current save path
(`MetaHumanPerformanceExportUtils.cpp`:804-849) — always set `TargetSkeletonOrSkeletalMesh`
explicitly in scripts.

## Worked example — scripted audio-only batch (Python, editor)

Every call below is `BlueprintCallable` or a reflected `UPROPERTY` in the headers cited
(`MetaHumanPerformance.h`:504-555, 372-432; `MetaHumanPerformanceExportUtils.h`:66-135,
302-310). Epic ships the same shape in
`Engine/Plugins/MetaHuman/MetaHumanAnimator/Content/Python/process_audio_performance.py`,
`process_performance.py` and `export_performance.py`.

```python
import unreal

FACE_SKELETON = "/Game/MetaHumans/Common/Face/Face_Archetype_Skeleton.Face_Archetype_Skeleton"

def audio_to_anim(sound_wave_path: str, out_path: str, mood=unreal.AudioDrivenAnimationMood.AUTO_DETECT,
                  intensity: float = 1.0) -> unreal.AnimSequence | None:
    wave = unreal.load_asset(sound_wave_path)
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    perf = tools.create_asset(asset_name=f"MHP_{wave.get_name()}", package_path=out_path,
                              asset_class=unreal.MetaHumanPerformance,
                              factory=unreal.MetaHumanPerformanceFactoryNew())

    # set_editor_property goes through the BlueprintSetters (SetInputType / SetAudio),
    # which reset state and recompute the processing range. Order matters: type first.
    perf.set_editor_property("input_type", unreal.DataInputType.AUDIO)
    perf.set_editor_property("audio", wave)

    overrides = unreal.AudioDrivenAnimationSolveOverrides()
    overrides.mood = mood                      # enumerators follow the C++ names: NEUTRAL, HAPPINESS, SADNESS, ANGER ...
    overrides.mood_intensity = intensity       # clamped 0..1
    perf.set_editor_property("audio_driven_animation_solve_overrides", overrides)
    perf.set_editor_property("audio_driven_animation_output_controls",
                             unreal.AudioDrivenAnimationOutputControls.FULL_FACE)
    perf.set_editor_property("generate_blinks", True)
    perf.set_editor_property("head_movement_mode", unreal.PerformanceHeadMovementMode.CONTROL_RIG)

    perf.set_blocking_processing(True)         # otherwise start_pipeline returns before any frame is solved
    if not perf.can_process():
        unreal.log_error(f"{perf.get_name()}: cannot process (audio missing or another performance is running)")
        return None
    err = perf.start_pipeline()                # bIsScriptedProcessing defaults to True
    if err != unreal.StartPipelineErrorType.NONE:
        unreal.log_error(f"{perf.get_name()}: start_pipeline -> {err}")
        return None
    unreal.log(f"{perf.get_name()}: solved {perf.get_number_of_processed_frames()} frames")

    settings = unreal.MetaHumanPerformanceExportAnimationSettings()
    settings.show_export_dialog = False        # headless: no path picker
    settings.package_path = out_path
    settings.asset_name = f"AS_{wave.get_name()}"
    settings.target_skeleton_or_skeletal_mesh = unreal.load_asset(FACE_SKELETON)
    settings.export_range = unreal.PerformanceExportRange.PROCESSING_RANGE
    settings.enable_head_movement = True
    settings.auto_save_anim_sequence = True
    anim = unreal.MetaHumanPerformanceExportUtils.export_animation_sequence(perf, settings)
    if anim is None:
        unreal.log_error("export_animation_sequence returned None (skeleton missing CTRL_expressions_ curves?)")
    return anim

for path in unreal.EditorAssetLibrary.list_assets("/Game/Audio/Dialogue", recursive=True):
    data = unreal.EditorAssetLibrary.find_asset_data(path)
    if data.asset_class_path.asset_name == "SoundWave":
        audio_to_anim(path, "/Game/Animation/Faces")
```

Run it with `UnrealEditor-Cmd.exe <Project>.uproject -run=pythonscript -script=...` or from
the editor Python console. Level Sequence export (`export_level_sequence`) needs a live
editor; Epic's scripts note it is not supported in headless `-run=pythonscript` mode.

For many files from C++ use `UMetaHumanBatchOperation::RunProcess(FMetaHumanBatchOperationContext&)`
(`MetaHumanBatchOperation.h`:83, 31): fill `AssetsToProcess` with `USoundWave`s, OR the
`EBatchOperationStepsFlags` (`SoundWaveToPerformance | ProcessPerformance | ExportAnimSequence`),
set `TargetSkeletonOrSkeletalMesh`, mood/output controls and naming rules. The
`UMetaHumanSpeechTo*Settings` objects (`MetaHumanSpeechProcessingSettings.h`:101-168) are
the detail-panel payloads behind the Content Browser "Speech to Anim/Level Sequence" actions.

## Applying the result to a MetaHuman

- The exported `UAnimSequence` holds **curves**, not bone tracks (face only): one curve per
  face-board control (`CTRL_expressions_*`, plus `CTRL_*` GUI controls) and, when head
  movement is enabled, `HeadYaw`, `HeadPitch`, `HeadRoll`, `HeadTranslationX/Y/Z`
  (`MetaHumanPerformanceExportUtils.cpp`:101-106). Its skeleton is whatever you passed as
  `TargetSkeletonOrSkeletalMesh` — the MetaHuman `Face_Archetype_Skeleton` or the Face
  skeletal mesh of an assembled character.
- On an assembled MetaHuman the Face component's post-process AnimBP
  (`ABP_Face_PostProcess`, `MetaHumanCharacterEditorActor.cpp`:74) runs RigLogic, which
  reads those curves and drives the face joints and blend shapes. So any way of playing the
  sequence works: a Sequencer Animation track bound to the Face component, a Play Animation
  node or a Slot in the face AnimBP, or `USkeletalMeshComponent::PlayAnimation`.
- For a Sequencer-editable result export a Level Sequence instead
  (`ExportLevelSequence`, `MetaHumanPerformanceExportUtils.h`:314) with `TargetMetaHumanClass`
  set to the MetaHuman Blueprint (`:271`); the Performance bakes a `Face_ControlBoard_CtrlRig`
  Control Rig track and toggles the head control switch (`SetHeadControlSwitchEnabled`, `:323`).
- Check curve compatibility first: `Settings->IsTargetSkeletonCompatible(Perf->GetAnimationCurveNames(), Missing)`
  (`:158`). Missing `CTRL_expressions_` curves mean the skeleton is not a MetaHuman face skeleton.

## Gotchas & edge cases

- **"Prepared for performance" is a real state.** A `DepthFootage` Performance needs an
  Identity whose face has `RigComponent`, `bIsAutoRigged == true` and trained predictive
  solvers (`MetaHumanPerformance.cpp`:2606-2623; `MetaHumanIdentityParts.h`:348-356, 184).
  Auto-rigging is a cloud call (`CreateDNAForIdentity`) that needs an Epic login
  (`LogInToAutoRigService`) and finishes asynchronously on
  `OnAutoRigServiceFinishedDynamicDelegate`; run `RunPredictiveSolverTraining()` *after* it.
- **Async by default.** Without `SetBlockingProcessing(true)` the pipeline runs on worker
  threads and `StartPipeline` returns at once; your script's next line sees zero frames.
  In blocking mode depth-footage processing also loads trackers synchronously
  (`MetaHumanPerformance.cpp`:1350-1356).
- **Only one Performance processes at a time** (`CurrentlyProcessedPerformance`); a second
  `CanProcess()` returns false until the first finishes or is cancelled.
- **GPU/RHI.** Footage routes require D3D12/Vulkan/Metal and the NNE runtimes the plugin
  depends on (`NNERuntimeORT`, listed in `MetaHuman.uplugin`); mono inference uses
  `NNERuntimeORTDml`, speech-to-face uses `NNERuntimeORTCpu` (`Speech2FaceInternal.cpp`:60).
  A `-nullrhi` commandlet cannot process footage; audio-only can.
- **Depth range.** `MinDistance`/`MaxDistance` (cm, default 10–25) clip depth for stereo
  generation and HMC ingest (`MetaHumanPerformance.h`:436-440,
  `MetaHumanGenerateDepthWindowOptions.h`:51-61). A performer 40 cm from an HMC rig loses
  depth entirely; iPhone depth is already metric and ignores these.
- **Frame rate and timecode.** `SetFootageCaptureData` rejects footage whose frame rate is
  invalid (`:497`). Image and depth tracks at different but compatible rates are
  rate-matched by dropping frames (`MetaHumanPerformance.cpp`:1178-1199). `TimecodeAlignment`
  Relative aligns tracks by their first frame; Absolute uses embedded timecode and will
  produce an empty range when sources have no timecode. Audio-only performances run at
  30 fps when there is no footage (`MetaHumanPerformance.cpp`:1039); Speech2Face solves at
  50 fps and resamples nearest-neighbour (`Speech2Face.h`:72).
- **Live Link Face capture mode matters.** Only *MetaHuman Animator* mode records depth;
  ARKit mode gives video + blendshape CSVs and can only go the `MonoFootage` route. Since
  5.6 the app writes `.cptake` archives; `IngestLiveLinkFaceSync` accepts both formats.
- **Mono head rotation limits.** Frames past `HeadAllowedRotationLeftRight` (45°) /
  `UpDown` (30°) are unsolved; `HeadRotationHandler` chooses gap vs neutral pose
  (`MetaHumanPerformance.h`:406-420). Changing them requires reprocessing.
- **Export defaults depend on editor state.** The default target skeleton is looked up
  relative to the Content Browser's initial save path; headless runs must set
  `TargetSkeletonOrSkeletalMesh`. `bShowExportDialog` defaults to true — set it false.
- **Mood enumerators.** `EAudioDrivenAnimationMood` names are `Happiness`, `Sadness`,
  `Anger`, `Confidence`, ... with display names "Happy", "Sad"
  (`SpeechAnimationSolverTypes.h`:13-27); Python exposes the C++ names
  (`HAPPINESS`, not `HAPPY`). Check `dir(unreal.AudioDrivenAnimationMood)`.
- **Deprecated ingest classes.** `UMetaHumanCaptureSource`, `UMetaHumanCaptureSourceSync`,
  `FMetaHumanTakeInfo`/`FMetaHumanTake` are `UE_DEPRECATED(5.7)`; the shipped
  `create_capture_data.py` still uses them. New code goes through Capture Manager.

## Version notes

- 5.7: `MetaHumanCaptureSource` module deprecated in favour of
  `CaptureManager/CaptureManagerDevices`; Capture Manager moved into Live Link Hub devices.
- 5.8: `ContainsAnimationData()` → `ContainsAnimationDataType(EFrameAnimationDataType)`;
  `VisualizationMesh` → `VisualizationObject` (accepts a MetaHuman BP);
  `ControlRigClass` → `ControlRigAssetReference` (`FControlRigAssetStrongReference`);
  `UCaptureData::EInitializedCheck` → global `ECaptureDataInitializedCheck` flags; body
  tracking (`bBodyTracking`, `EPerformanceExportSkeleton`, `BodyRetargeter`) added to
  mono processing and export.

---

## References & source material

Engine source (UE 5.9 — all paths under `Engine/Plugins/MetaHuman/MetaHumanAnimator/Source/`):
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:35 — `EDataInputType`.
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:52 — `EPerformanceHeadMovementMode`.
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:65 — `EStartPipelineErrorType`.
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:82 — `UMetaHumanPerformance`.
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:108 — `OnProcessingFinishedDynamic`.
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:181 — `InputType`, `FootageCaptureData`, `Audio`, `Identity` (181-215).
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:504 — `StartPipeline`, `CancelPipeline`, `IsProcessing`, `CanProcess` (504-513).
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:517 — `SetFootageCaptureData`, `SetInputType`, `SetAudio`, `SetIdentity`, `SetProcessingRange`, `SetBlockingProcessing` (517-555).
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:602 — `GetAnimationData`, `GetNumberOfProcessedFrames`.
- `MetaHumanPerformance/Public/MetaHumanPerformanceExportUtils.h`:20 — `EPerformanceExportRange`, `EPerformanceExportSkeleton`.
- `MetaHumanPerformance/Public/MetaHumanPerformanceExportUtils.h`:48 — `UMetaHumanPerformanceExportAnimationSettings`.
- `MetaHumanPerformance/Public/MetaHumanPerformanceExportUtils.h`:173 — `UMetaHumanPerformanceExportLevelSequenceSettings`.
- `MetaHumanPerformance/Public/MetaHumanPerformanceExportUtils.h`:293 — `UMetaHumanPerformanceExportUtils`, `ExportAnimationSequence` (310), `ExportLevelSequence` (314).
- `MetaHumanPerformance/Private/MetaHumanPerformance.cpp`:1104 — `StartPipeline` implementation; `CanProcess` (2535).
- `MetaHumanPerformance/Private/MetaHumanPerformanceExportUtils.cpp`:101 — head movement curve names; `GetExportAnimationSequenceSettings` (804).
- `MetaHumanPerformance/Private/MetaHumanPerformanceFactoryNew.h`:14 — `UMetaHumanPerformanceFactoryNew`.
- `MetaHumanIdentity/Public/MetaHumanIdentity.h`:67 — `UMetaHumanIdentity`; auto-rig API (146-156); `ImportDNAFile` (124); `StartFrameTrackingPipeline` (136).
- `MetaHumanIdentity/Public/MetaHumanIdentityParts.h`:106 — `UMetaHumanIdentityFace`; `Conform` (138); `RunPredictiveSolverTraining` (184); `bIsAutoRigged` (356).
- `MetaHumanIdentity/Public/MetaHumanIdentityPose.h`:20 — `EIdentityPoseType`; `UMetaHumanIdentityPose` (38).
- `MetaHumanIdentity/Public/MetaHumanIdentityPromotedFrames.h`:18 — `UMetaHumanIdentityPromotedFrame`; `UMetaHumanIdentityFootageFrame` (197).
- `MetaHumanIdentity/Public/PromotedFrameUtils.h`:22 — `UPromotedFrameUtils`.
- `MetaHumanSpeech2Face/Public/AudioDrivenAnimationConfig.h`:13 — `FAudioDrivenAnimationModels`, `EAudioDrivenAnimationOutputControls` (29), `FAudioDrivenAnimationSolveOverrides` (36).
- `MetaHumanSpeech2Face/Public/Speech2Face.h`:20 — `FSpeech2Face`.
- `MetaHumanSpeech2Face/Private/Speech2FaceInternal.cpp`:54 — `NNERuntimeORT` / `NNERuntimeORTCpu` requirement.
- `MetaHumanBatchProcessor/Public/MetaHumanBatchOperation.h`:19 — `EBatchOperationStepsFlags`, `FMetaHumanBatchOperationContext` (31), `UMetaHumanBatchOperation` (76).
- `MetaHumanBatchProcessor/Public/MetaHumanSpeechProcessingSettings.h`:101 — `UMetaHumanSpeechToPerformance`, `UMetaHumanSpeechToAnimSequenceProcessingSettings` (132), `UMetaHumanSpeechToLevelSequenceSettings` (158).
- `MetaHumanDepthGenerator/Private/MetaHumanDepthGenerator.h`:15 — `UMetaHumanDepthGenerator`.
- `MetaHumanDepthGenerator/Private/Widgets/MetaHumanGenerateDepthWindowOptions.h`:13 — `UMetaHumanGenerateDepthWindowOptions`.
- `MetaHumanDepthGenerator/Private/DepthGeneration/MetaHumanDepthGenerationService.cpp`:581 — two-image-sequence and calibration requirements (`ValidateFootage`, `GenerateDepth`; moved out of `MetaHumanDepthGenerator.cpp` in 5.9).
- `MetaHumanCaptureSource/Public/MetaHumanCaptureSource.h`:97 — `UMetaHumanCaptureSource` (deprecated 5.7).
- `MetaHumanCaptureSource/Public/MetaHumanCaptureSourceSync.h`:18 — `UMetaHumanCaptureSourceSync` (deprecated 5.7).
- `MetaHumanCaptureSource/Public/MetaHumanTakeData.h`:27 — `FMetaHumanTakeInfo`, `FMetaHumanTake` (115).
- `MetaHumanPipeline/Public/Nodes/SpeechToAnimNode.h`:15 — `FSpeechToAnimNode`.
- `MetaHumanPipeline/Private/Nodes/HyprsenseNode.cpp`:257 — `NNERuntimeORTDml` GPU backend for mono tracking.
- `MetaHumanCore/Public/MetaHumanSupportedRHI.h`:11 — `FMetaHumanSupportedRHI`; `MetaHumanCore/Private/MetaHumanSupportedRHI.cpp`:31.
- `MetaHumanCore/Public/MetaHumanAuthoringObjects.h`:12 — `FMetaHumanAuthoringObjects::ArePresent`.
- `MetaHumanFaceAnimationSolver/Public/MetaHumanFaceAnimationSolver.h`:33 — `UMetaHumanFaceAnimationSolver`.
- `MetaHumanFaceContourTracker/Public/MetaHumanFaceContourTrackerAsset.h`:23 — `UMetaHumanFaceContourTrackerAsset`.
- `MetaHumanConfig/Public/MetaHumanConfig.h` — `UMetaHumanConfig`, `EMetaHumanConfigType`.

Engine source (UE 5.9 — all paths under `Engine/Plugins/MetaHuman/MetaHumanCoreTechLib/Source/`):
- `MetaHumanCoreTech/Public/FrameAnimationData.h`:44 — `FFrameAnimationData`; `EFrameAnimationDataType` (33).
- `MetaHumanCoreTech/Public/MetaHumanCommonDataUtils.h`:48 — `GetAnimatorPluginFaceControlRigPath`, `GetDefaultControlRigFromRegistry` (34).
- `MetaHumanPipelineCore/Public/Nodes/HyprsenseRealtimeNode.h`:42 — `EFaceUnsolvedFrameBehavior`; `FMonocularAnimationPipelineModels` (59).

Engine source (UE 5.9 — all paths under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/`):
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:38 — `EImportErrorCode`; `FImportFromIdentityParams` (397); `UMetaHumanCharacterEditorSubsystem` (496); `TryAddObjectToEdit` (534); `ImportFromIdentity` (1442).
- `MetaHumanCharacterEditor/Private/MetaHumanCharacterEditorActor.cpp`:74 — face post-process AnimBP (`ABP_Face_PostProcess`).

Engine source (UE 5.9 — all paths under `Engine/Plugins/VirtualProduction/`):
- `CaptureData/Source/CaptureDataCore/Public/CaptureData.h`:43 — `UCaptureData`; `UMeshCaptureData` (93); `EFootageDeviceClass` (114); `FFootageCaptureMetadata` (126); `ETimecodeAlignment` (196); `UFootageCaptureData` (217).
- `CaptureData/Source/CaptureDataEditor/Public/CaptureDataFactory.h`:30 — `UFootageCaptureDataFactory`.
- `CaptureData/Source/CaptureDataUtils/Public/ImageSequenceTimecodeUtils.h`:13 — `UImageSequenceTimecodeUtils`.
- `CaptureManager/CaptureManagerEditor/Source/CaptureManagerIngestBlueprint/Internal/CaptureManagerIngestBlueprintLibrary.h`:122 — `UCaptureManagerIngestBlueprintLibrary`; `IngestMonoVideoSync` (170); `IngestLiveLinkFaceSync` (259); `IngestTakeArchiveSync` (136). (`Private/` in 5.8.)
- `CaptureManager/CaptureManagerEditor/Source/CaptureManagerEditorSettings/Public/Settings/CaptureManagerEditorSettings.h`:23 — `UCaptureManagerEditorSettings`; `ImportDirectory` (82).
- `CaptureManager/CaptureManagerDevices/Source/CPSLiveLinkDevice/Public/LiveLinkFaceDevice.h`:50 — `ULiveLinkFaceDevice`; `ULiveLinkFaceDeviceSettings` (27).
- `CaptureManager/CaptureManagerApp/Source/LiveLinkCapabilities/Public/Ingest/LiveLinkDeviceCapability_Ingest.h`:38 — `ILiveLinkDeviceCapability_Ingest`.
- `CaptureManager/CaptureManagerCore/Source/CaptureMetadataExtraction/Internal/LiveLinkFaceMetadata.cpp`:47 — Live Link Face take file names; MHA vs ARKit file sets (224, 234).

Other engine source (UE 5.9):
- `Engine/Plugins/Animation/AudioDrivenAnimation/StreamingADA/Source/SpeechAnimationSolver/Public/SpeechAnimationSolverTypes.h`:13 — `EAudioDrivenAnimationMood`.
- `Engine/Source/Developer/AssetTools/Public/IAssetTools.h`:381 — `CreateAsset` (null factory allowed).

Shipped Python examples (UE 5.8): `Engine/Plugins/MetaHuman/MetaHumanAnimator/Content/Python/`
(`process_audio_performance.py`, `process_performance.py`, `process_monocular_performance.py`,
`create_identity_for_performance.py`, `export_performance.py`, `create_capture_data.py`) and
`Engine/Plugins/MetaHuman/MetaHumanAnimator/Content/DepthGenerator/depth_generator_example.py`.

Deep-dive references in this skill:
- [references/capture-data-and-ingest.md](references/capture-data-and-ingest.md) — `UFootageCaptureData` anatomy, Capture Manager ingest (Live Link Face, mono/stereo video, take archives), legacy capture sources, stereo depth generation, timecode.
- [references/identity-mesh-to-metahuman.md](references/identity-mesh-to-metahuman.md) — Identity parts, poses, promoted frames, conforming, auto-rig service, DNA import/export, Prepare for Performance, Identity → MetaHuman Character.
- [references/performance-processing-and-export.md](references/performance-processing-and-export.md) — every `UMetaHumanPerformance` property by route, pipeline stages, diagnostics, `FFrameAnimationData`, AnimSequence/LevelSequence export settings, applying to MetaHumans.
- [references/audio-driven-animation.md](references/audio-driven-animation.md) — Speech2Face internals, moods, output controls, realtime vs offline audio solve, batch processor, speech-to-animation settings objects.

Related skills: `ue-control-rig-and-ik`, `ue-animation-system`, `ue-sequencer-and-cinematics`.
Playing the exported face clips in a packaged game (face AnimBP with a Slot, head snap, blinks,
cook size): `ue-metahuman-runtime`.
