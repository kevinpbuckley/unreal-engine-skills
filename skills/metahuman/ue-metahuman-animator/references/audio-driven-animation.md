# Audio-Driven Animation — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the audio-only route of MetaHuman Animator:
the Speech2Face solver and its NNE models, moods and output controls, the offline vs
realtime audio solvers on `UMetaHumanPerformance`, the batch processor that turns a folder
of `USoundWave`s into AnimSequences, and the settings objects behind the Content Browser
"Speech to Animation" actions. Grounded in UE 5.8
(`Engine/Plugins/MetaHuman/MetaHumanAnimator/Source/MetaHumanSpeech2Face/`,
`MetaHumanBatchProcessor/`, `MetaHumanPipeline/`).

---

## How audio becomes animation

`FSpeech2Face` (`Speech2Face.h`:20, editor-only) wraps two NNE models — an **audio encoder**
and an **animation decoder** (`FAudioDrivenAnimationModels`, `AudioDrivenAnimationConfig.h`:13,
both `FSoftObjectPath` to `UNNEModelData`). `Create()` / `Create(Models)` (`:49`, `:57`) load
the models through the `NNERuntimeORT` module and the `NNERuntimeORTCpu` runtime
(`Speech2FaceInternal.cpp`:54-68) — CPU inference, no D3D12 requirement, so audio-only works
in a `-nullrhi` commandlet where footage processing cannot.

`GenerateFaceAnimation(AudioParams, OutputFps, bGenerateBlinks, ShouldCancel, OutAnimation, OutHeadAnimation)`
(`:81`) consumes `FAudioParams` (`:23`: `SpeechRecording` weak `USoundWave`,
`AudioStartOffsetSec`, `bDownmixChannels`, `AudioChannelIndex`) and returns one
`TMap<FString, float>` of face-board control values per frame plus a separate head-pose
map. Raw output is produced at 50 fps and resampled nearest-neighbour to `OutputFps`
(`:72`); the encoder itself runs at `AudioEncoderOutputFps = 100` (`:38`).
`SetMood` / `SetMoodIntensity` (`:62`, `:67`) steer the decoder.

Inside a Performance the pipeline node is `FSpeechToAnimNode` (`SpeechToAnimNode.h`:15):
`LoadModels()`, `SetMood`, `SetMoodIntensity`, `SetOutputControls`, public fields `Audio`,
`bDownmixChannels`, `AudioChannelIndex`, `ProcessingStartFrameOffset`, `OffsetSec`,
`FrameRate`, `bClampTongueInOut`, `bGenerateBlinks` (`:35-42`), and error codes
`InvalidAudio`, `InvalidChannelIndex`, `FailedToSolveSpeechToAnimation`, `FailedToInitialize`
(`:44-53`). The same node, in `EAudioProcessingMode::TongueTracking`, supplies the tongue
solve for footage routes (`bSkipTongueSolve`).

Helpers in `UE::MetaHuman` (`Speech2Face.h`:96-107): `ReplaceHeadGuiControlsWithRaw`,
`GetMouthOnlyRawControls`, `GetHeadPoseTransformFromRawControls` — the last turns the head
control values into the `FFrameAnimationData::Pose` transform.

---

## Moods and output controls

`EAudioDrivenAnimationMood` lives in the shared Audio Driven Animation plugin
(`Engine/Plugins/Animation/AudioDrivenAnimation/StreamingADA/Source/SpeechAnimationSolver/Public/SpeechAnimationSolverTypes.h`:13):

| Enumerator | Value | Display name |
|---|---|---|
| `AutoDetect` | 255 | Auto Detect (infer from the audio) |
| `Neutral` | 0 | Neutral |
| `Happiness` | 1 | Happy |
| `Sadness` | 2 | Sad |
| `Disgust` | 3 | Disgust |
| `Anger` | 4 | Anger |
| `Surprise` | 5 | Surprise |
| `Fear` | 6 | Fear |
| `Confidence` | 10 | Confident |
| `Excitement` | 14 | Excited |
| `Boredom` | 15 | Bored |
| `Playfulness` | 17 | Playful |

Python/Blueprint expose the **enumerator** names (`unreal.AudioDrivenAnimationMood.HAPPINESS`),
not the display names; the shipped `process_audio_performance.py` maps its CLI strings to
`.HAPPY`/`.SAD`, which do not exist on this enum — verify with `dir(unreal.AudioDrivenAnimationMood)`.

`FAudioDrivenAnimationSolveOverrides` (`AudioDrivenAnimationConfig.h`:36): `Mood`
(default `AutoDetect`, `:41`) and `MoodIntensity` 0..1 (default 1, `:44`; no effect with
`Neutral`).

`EAudioDrivenAnimationOutputControls` (`:29`): `FullFace` (default) or `MouthOnly`. Mouth-only
restricts the written controls to the lip/jaw set (`GetMouthOnlyRawControls`) so you can
layer it under hand-keyed brows/eyes; `FFrameAnimationData::AudioProcessingMode` records
which was used (`FrameAnimationData.h`:24).

---

## The audio route on UMetaHumanPerformance

Properties active when `InputType == EDataInputType::Audio` (`MetaHumanPerformance.h`):

| Property | Line | Notes |
|---|---|---|
| `Audio` | 189 | `USoundWave`; set through `SetAudio` (`:507`) |
| `bRealtimeAudio` | 368 | Use the realtime solver (`FRealtimeSpeechToAnimNode`, streaming ADA) instead of offline Speech2Face |
| `bDownmixChannels` | 372 | Offline only; mix all channels before solving |
| `AudioChannelIndex` | 376 | 0..64; used when not downmixing |
| `bGenerateBlinks` | 380 | Offline only |
| `AudioDrivenAnimationOutputControls` ("Process Mask") | 383 | Offline only |
| `AudioDrivenAnimationModels` ("Models", advanced) | 387 | Override encoder/decoder `UNNEModelData` |
| `AudioDrivenAnimationSolveOverrides` ("Solve Overrides") | 432 | Offline mood + intensity |
| `RealtimeAudioMood`, `RealtimeAudioMoodIntensity`, `RealtimeAudioLookahead` | 437, 441, 445 | Realtime only; lookahead 80-240 ms trades quality for latency |
| `HeadMovementMode` | 247 | `ControlRig` or `TransformTrack` to keep the solver's head motion, `Disabled` to drop it |
| `VisualizationObject` | 234 | Preview mesh or MetaHuman BP; purely visual for audio |

Frame rate: with no footage `GetFrameRate()` returns 30 fps (`MetaHumanPerformance.cpp`:1039),
so an audio performance yields 30 animation frames per second and the AnimSequence is
exported at that rate. The processing range spans the wave's duration; `SetProcessingRange`
trims it.

`CanProcess()` for audio only requires `GetAudioForProcessing() != nullptr`
(`MetaHumanPerformance.cpp`:2549-2554) plus a non-empty range; no Identity, footage, RHI or
authoring-content check. Processing of audio starts the pipeline stage immediately even in
non-blocking mode (`:1276-1279`); use `SetBlockingProcessing(true)` in scripts.

Minimal C++ (editor module, `MetaHumanPerformance` + `MetaHumanSpeech2Face` dependencies):

```cpp
UMetaHumanPerformance* Perf = NewObject<UMetaHumanPerformance>(GetTransientPackage()); // transient is fine for export-only
Perf->SetInputType(EDataInputType::Audio);
Perf->SetAudio(Wave);
Perf->bGenerateBlinks = true;
Perf->AudioDrivenAnimationOutputControls = EAudioDrivenAnimationOutputControls::FullFace;
Perf->AudioDrivenAnimationSolveOverrides = { EAudioDrivenAnimationMood::Confidence, 0.6f };
Perf->SetBlockingProcessing(true);
if (Perf->CanProcess() && Perf->StartPipeline() == EStartPipelineErrorType::None)
{
    for (const FFrameAnimationData& Frame : Perf->GetAnimationData())   // inspect raw controls
    {
        const float* JawOpen = Frame.AnimationData.Find(TEXT("CTRL_expressions_jawOpen"));
    }
}
```

`FAudioDrivenAnimationSolveOverrides` is a plain `USTRUCT` with two members, so aggregate
initialisation as above compiles; use member assignment if you prefer explicitness.

---

## Batch processing

### UMetaHumanBatchOperation (C++)

`MetaHumanBatchOperation.h` is the engine behind the Content Browser actions on
`USoundWave` assets. `UMetaHumanBatchOperation::RunProcess(FMetaHumanBatchOperationContext&)`
(`:83`) is a plain C++ method (not a `UFUNCTION`), editor-only.

`FMetaHumanBatchOperationContext` (`:31`):
- `AssetsToProcess` — `TArray<TWeakObjectPtr<UObject>>` of `USoundWave`s.
- `BatchStepsFlags` — `EBatchOperationStepsFlags` (`:19`): `SoundWaveToPerformance`,
  `ProcessPerformance`, `ExportAnimSequence`, `ExportLevelSequence` (bit flags; `ENUM_CLASS_FLAGS`).
  Omit `SoundWaveToPerformance` to use a transient performance and export only.
- `PerformanceNameRule`, `ExportedAssetNameRule` — `EditorAnimUtils::FNameDuplicationRule`
  (prefix/suffix/find-replace); validated by `ValidatePerformanceNameRule` / `ValidateExportAssetNameRule`.
- `bOverrideAssets` — overwrite existing outputs instead of uniquifying names.
- Processing: `bGenerateBlinks`, `bMixAudioChannels`, `AudioChannelIndex`,
  `AudioDrivenAnimationSolveOverrides`, `AudioDrivenAnimationOutputControls`.
- Export: `bEnableHeadMovement` (default **false** here), `CurveInterpolation`,
  `bRemoveRedundantKeys`, `TargetSkeletonOrSkeletalMesh` (soft), level-sequence options
  `bExportAudioTrack`, `bExportCamera`, `TargetMetaHuman` (soft `UBlueprint`).
- `IsValid()` — "could we process with this configuration".

```cpp
FMetaHumanBatchOperationContext Ctx;
for (USoundWave* W : Waves) { Ctx.AssetsToProcess.Add(W); }
Ctx.BatchStepsFlags = EBatchOperationStepsFlags::SoundWaveToPerformance
                    | EBatchOperationStepsFlags::ProcessPerformance
                    | EBatchOperationStepsFlags::ExportAnimSequence;
Ctx.PerformanceNameRule.Prefix = TEXT("MHP_");
Ctx.ExportedAssetNameRule.Prefix = TEXT("AS_");
Ctx.TargetSkeletonOrSkeletalMesh = FaceArchetypeSkeleton;
Ctx.bEnableHeadMovement = true;
Ctx.AudioDrivenAnimationSolveOverrides.Mood = EAudioDrivenAnimationMood::AutoDetect;
if (Ctx.IsValid())
{
    NewObject<UMetaHumanBatchOperation>(GetTransientPackage())->RunProcess(Ctx); // shows FScopedSlowTask progress, cancellable
}
```

The operation creates performances next to the sound waves (`CreatePerformanceFromSoundWave`),
processes them blocking, exports (`ExportAnimationSequence` / `ExportLevelSequence`), and on
cancel deletes everything it created (`CleanupIfCancelled`). Module: `MetaHumanBatchProcessor`.

### Settings objects (`MetaHumanSpeechProcessingSettings.h`)

These `BlueprintType` UObjects are what the batch UI edits and are convenient containers for
your own tooling:

- `FMetaHumanSpeechProcessingSettings` (`:13`): `bGenerateBlinks`, `bMixAudioChannels`,
  `AudioChannelIndex`, `OutputControls` ("Process Mask"), `SolveOverrides`, `bEnableHeadMovement`.
- `FExportAnimSequenceSettings` (`:43`): `bOverwriteAssets`, `TargetSkeletonOrSkeletalMesh`,
  `CurveInterpolation`, `bRemoveRedundantKeys`.
- `FExportLevelSequenceSettings` (`:66`): `bOverwriteAssets`, `CurveInterpolation`,
  `bRemoveRedundantKeys`, `TargetMetaHumanClass`, `bExportAudioTrack`, `bExportCamera`.
- `UMetaHumanSpeechToPerformance` (`:101`): `VisualizationMesh` + `ProcessingSettings` +
  `bOverwriteAssets` — the "Create Performance from Sound Wave" action.
- `UMetaHumanExportAnimSequenceSettings` (`:120`), `UMetaHumanExportLevelSequenceSettings` (`:147`).
- `UMetaHumanSpeechToAnimSequenceProcessingSettings` (`:132`): `ProcessingSettings` +
  `ExportSettings` — the "Speech to Anim Sequence" action.
- `UMetaHumanSpeechToLevelSequenceSettings` (`:158`): `ProcessingSettings` + level-sequence
  `ExportSettings` — the "Speech to Level Sequence" action.

### Python batch

Python cannot call `RunProcess`, so loop the per-asset recipe from SKILL.md's worked example
(create Performance → set audio → blocking `start_pipeline` → `export_animation_sequence`).
Each iteration must finish before the next starts because only one Performance can process
at a time. Save with `unreal.EditorAssetLibrary.save_loaded_asset(anim)` if you turned
`auto_save_anim_sequence` off.

---

## Practical notes

- **Input audio.** Any imported `USoundWave` works (WAV/OGG import; mono or multichannel).
  Stereo dialogue: leave `bDownmixChannels = true`. Multi-track stems: set
  `AudioChannelIndex` and disable downmix. Long files are fine — `AnimationData` is a
  `TArray64` precisely for long takes.
- **Timing.** Output is frame-quantised at 30 fps; if the target cinematic runs at 24 or 60,
  export anyway (curves are keyed per frame) and let Sequencer resample, or feed footage so
  `GetFrameRate()` follows the footage.
- **Head motion** from audio is synthetic. For a seated dialogue shot keep
  `HeadMovementMode = ControlRig` and `bEnableHeadMovement = true`; for a body-animated
  character disable it so the neck is not driven twice.
- **Blinks** are generated procedurally (`bGenerateBlinks`); turn them off when layering a
  separate eye-dart/blink pass.
- **Realtime solver.** `bRealtimeAudio = true` swaps in the streaming solver used by Live
  Link audio; lower latency, lower quality, mood via `RealtimeAudioMood`. Offline is the
  right default for baked assets.
- **Models.** `AudioDrivenAnimationModels` lets you point at alternative `UNNEModelData`
  assets (for example a language-specific decoder) without code changes; both paths must be
  set or `FSpeech2Face::Create` fails and `StartPipeline` logs `FailedToInitialize`.

---

## Source references (UE 5.9)

All paths under `Engine/Plugins/MetaHuman/MetaHumanAnimator/Source/`:
- `MetaHumanSpeech2Face/Public/Speech2Face.h`:20 — `FSpeech2Face`; `FAudioParams` (23); `AudioEncoderOutputFps` (38); `Create` (49, 57); `SetMood` (62); `SetMoodIntensity` (67); `GenerateFaceAnimation` (81); `UE::MetaHuman` helpers (96-107).
- `MetaHumanSpeech2Face/Public/AudioDrivenAnimationConfig.h`:13 — `FAudioDrivenAnimationModels`; `EAudioDrivenAnimationOutputControls` (29); `FAudioDrivenAnimationSolveOverrides` (36).
- `MetaHumanSpeech2Face/Private/Speech2FaceInternal.cpp`:54 — `NNERuntimeORT` module load; `NNERuntimeORTCpu` runtime (60).
- `MetaHumanPipeline/Public/Nodes/SpeechToAnimNode.h`:15 — `FSpeechToAnimNode`; fields (35-42); `ErrorCode` (44).
- `MetaHumanBatchProcessor/Public/MetaHumanBatchOperation.h`:19 — `EBatchOperationStepsFlags`; `FMetaHumanBatchOperationContext` (31); `UMetaHumanBatchOperation` (76); `RunProcess` (83).
- `MetaHumanBatchProcessor/Public/MetaHumanSpeechProcessingSettings.h`:13 — `FMetaHumanSpeechProcessingSettings`; `FExportAnimSequenceSettings` (43); `FExportLevelSequenceSettings` (66); `UMetaHumanSpeechToPerformance` (101); `UMetaHumanExportAnimSequenceSettings` (120); `UMetaHumanSpeechToAnimSequenceProcessingSettings` (132); `UMetaHumanExportLevelSequenceSettings` (147); `UMetaHumanSpeechToLevelSequenceSettings` (158).
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:190 — `Audio`; audio parameters (368-387, 432, 444-452); `SetAudio` (525).
- `MetaHumanPerformance/Private/MetaHumanPerformance.cpp`:1039 — 30 fps default; audio `CanProcess` branch (2549-2554); immediate stage start (1346-1349).

All paths under `Engine/Plugins/MetaHuman/MetaHumanCoreTechLib/Source/`:
- `MetaHumanCoreTech/Public/AudioDrivenAnimationMood.h`:18 — `SAudioDrivenAnimationMood` (mood picker widget; includes the enum header).
- `MetaHumanCoreTech/Public/FrameAnimationData.h`:24 — `EAudioProcessingMode`; `FFrameAnimationData` (44).
- `MetaHumanPipelineCore/Public/Nodes/RealtimeSpeechToAnimNode.h` — `FRealtimeSpeechToAnimNode` (realtime solver).

Other engine source (UE 5.9):
- `Engine/Plugins/Animation/AudioDrivenAnimation/StreamingADA/Source/SpeechAnimationSolver/Public/SpeechAnimationSolverTypes.h`:13 — `EAudioDrivenAnimationMood`.

Shipped Python: `Engine/Plugins/MetaHuman/MetaHumanAnimator/Content/Python/process_audio_performance.py`.
