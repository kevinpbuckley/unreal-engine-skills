# Capture Data & Ingest — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `UCaptureData` asset family, how
footage gets into the project through Capture Manager (Live Link Face takes, `.cptake`
archives, mono and stereo video), the deprecated MetaHuman capture sources that the shipped
Python samples still use, stereo depth generation, and the frame-rate/timecode rules the
Performance applies. Grounded in UE 5.8 (`Engine/Plugins/VirtualProduction/CaptureData/`,
`Engine/Plugins/VirtualProduction/CaptureManager/`, `Engine/Plugins/MetaHuman/MetaHumanAnimator/`).

---

## UCaptureData family

`UCaptureData` (`CaptureData.h`:43) is abstract with one virtual,
`IsInitialized(ECaptureDataInitializedCheck)`. The flags (`:23`) are
`ImageSequences`, `DepthSequences`, `Calibrations`, `Metadata`, with `Full` and
`ImageSequencesOnly` presets; the Performance uses them to decide what a route needs
(mono: `ImageSequencesOnly`; depth: `ImageSequences | Metadata`, then calibration and depth
separately). `OnCaptureDataInternalsChanged()` fires when any of the arrays change; the
Performance and Identity poses subscribe to it to recompute their frame ranges.

### UMeshCaptureData (`CaptureData.h`:93)

- `TargetMesh` (`:104`) — a `UStaticMesh` or `USkeletalMesh` scan of a neutral face. Used only
  by the Identity (a Mesh pose); `GetDataForConforming()` flattens it for the face fitter.
- Created with `UMeshCaptureDataFactory` (`CaptureDataFactory.h`:14).

### UFootageCaptureData (`CaptureData.h`:217)

| Property | Line | Meaning |
|---|---|---|
| `ImageSequences` | 242 | `TArray<UImgMediaSource*>`, one per RGB camera/view. Index order defines view index; `Camera` on the Performance/Pose picks by name (`GetViewIndexByCameraName`, 308). |
| `DepthSequences` | 245 | One `UImgMediaSource` per view, EXR depth. Empty for mono footage. |
| `AudioTracks` | 248 | `TArray<USoundWave*>`; the Performance uses the first unless `Audio` is overridden. |
| `CameraCalibrations` | 266 | `TArray<UCameraCalibration*>`; required for depth processing and stereo depth generation. |
| `Metadata` | 263 | `FFootageCaptureMetadata` (`:123`): `FrameRate`, `DeviceClass` (`EFootageDeviceClass`, `:111`), `DeviceModelName`. `SetDeviceClass(ModelString)` (`:146`) maps e.g. `iPhone15,2` → `iPhone14OrLater`. |
| `CaptureExcludedFrames` | 272 | `TArray<FFrameRange>` of frames the capture itself marked bad (dropped frames); merged into the Performance's exclusion list. |

`EFootageDeviceClass` values: `Unspecified`, `iPhone11OrEarlier`, `iPhone12`, `iPhone13`,
`iPhone14OrLater`, `OtheriOSDevice`, `StereoHMC`. The device class selects the
`UMetaHumanConfig` (solver/fitting/predictive-solver configs, `MetaHumanConfig.h`) that the
tracker and face solver use; an `Unspecified` class on depth footage stops the Performance
from resolving a config, which surfaces as an empty `CaptureDataConfig` and a disabled
Process button.

Useful helpers:
- `GetFrameRanges(TargetRate, Alignment, bIncludeAudio, OutMediaRanges, OutProcessingRange, OutMaxRange)` (`:276`) — the range maths the Performance uses.
- `VerifyData(Check)` (`:292`) → `TValueOrError<void, FString>` with a human-readable reason.
- `CheckImageSequencePaths()` (`:303`) — lists image sequences whose folder is missing on disk (moved projects).
- `PopulateCameraNames(...)` (`:306`) — fills the camera dropdown and validates a camera name.

Timecode per track lives on the `UImgMediaSource` as asset tags written by
`UImageSequenceTimecodeUtils::SetTimecodeInfo(Timecode, Rate, ImgMediaSource)`
(`ImageSequenceTimecodeUtils.h`:24); `GetEffectiveImageTimecode(View)` /
`GetEffectiveAudioTimecode()` fall back to other tracks when one has none (`:283-290`).

---

## Capture Manager (5.7+): the supported ingest path

Capture Manager is split across four plugins: `CaptureManagerCore` (pipeline, media RW,
metadata extraction, `DataIngestCore`), `CaptureManagerApp` (Live Link Hub integration and
device capabilities), `CaptureManagerDevices` (concrete devices) and `CaptureManagerEditor`
(settings, Blueprint/Python ingest library).

### Devices (Live Link Hub)

All ingest devices derive from `UBaseIngestLiveLinkDevice` (`BaseIngestLiveLinkDevice.h`:18)
and implement `ILiveLinkDeviceCapability_Ingest` (`LiveLinkDeviceCapability_Ingest.h`:38):

- `UpdateTakeList(Callback)` / `GetTakeIdentifiers()` / `GetTakeInformation(TakeId)` →
  `UIngestCapability_TakeInformation` (`IngestCapability_TakeInformation.h`:12): `DeviceName`,
  `SlateName`, `TakeNumber`, `DateTime`.
- `CreateIngestProcess(TakeId, ProcessConfig)` → `UIngestCapability_ProcessHandle`, then
  `RunIngestProcess(Handle, UIngestCapability_Options*)` (`IngestCapability_Options.h`:45:
  `WorkingDirectory`, `DownloadDirectory`, `Video`/`Audio` naming + format, `UploadHostName`).
- `CancelIngestProcess(Handle)`.

Concrete devices:
- `ULiveLinkFaceDevice` (`LiveLinkFaceDevice.h`:50) — connects to the Live Link Face app
  over the capture protocol (`ULiveLinkFaceDeviceSettings::IpAddress`, `Port = 14785`,
  `:39-42`), lists takes on the phone, downloads and converts them, and can start/stop
  recording (`ILiveLinkDeviceCapability_Recording`) and stream (`_Streaming`).
- `UMonoVideoIngestDevice` (`MonoVideoIngestDevice.h`:63) — watches a folder of
  `.mp4`/`.mov` files; each file becomes a take.
- `UTakeArchiveIngestDevice` (`TakeArchiveIngestDevice.h`:38) — folders containing
  `.cptake` archives (the 5.6+ Live Link Face and HMC export format, `FIngestCaptureData`,
  `IngestCaptureData.h`:11).

Output location and naming come from `UCaptureManagerEditorSettings`
(`CaptureManagerEditorSettings.h`:23): `MediaDirectory` (where converted image sequences
and audio files are written on disk, `:76`), `ImportDirectory` (Content Browser folder for the
assets, must be under `/Game`, `:82`), `bAutoSaveAssets` (`:86`), and token-based asset
names (`CaptureDataAssetName`, `ImageSequenceAssetName`, `DepthSequenceAssetName`,
`SoundwaveAssetName`, `CalibrationAssetName`, `:90-122`). `SetImportDirectory` /
`SetMediaDirectory` are `BlueprintCallable` for scripted setup (`:62-70`).

### Scripted ingest: UCaptureManagerIngestBlueprintLibrary

`CaptureManagerIngestBlueprintLibrary.h` (an `Internal/` header in 5.9, `Private/` in 5.8; reflected class) exposes blocking,
async and (new in 5.9) `*WithProgress` variants of every ingest. The blocking ones return the `UFootageCaptureData`
directly:

| Function | Line | Input |
|---|---|---|
| `IngestTakeArchiveSync(TakeArchivePath, Params, OutError)` | 136 | directory or `.cptake` file |
| `IngestMonoVideoSync(VideoFilePath, AudioFilePath, Slate, TakeNumber, Params, OutError)` | 170 | `.mp4`/`.mov`, optional separate audio |
| `IngestStereoVideoSync(VideoPathA, VideoPathB, AudioFilePath, CalibrationFilePath, Slate, TakeNumber, Params, OutError)` | 214 | two videos or two image-sequence folders + calibration JSON |
| `IngestLiveLinkFaceSync(TakeDirectoryPath, Params, OutError)` | 259 | Live Link Face take folder (`.cptake` or pre-5.6 layout) |
| `IngestCalibrationSync(CalibrationFilePath, CalibrationName, OutError)` | 291 | standalone calibration JSON → capture data with only `CameraCalibrations[0]` |
| `FindTakeDirectories(SearchDirectory, bRecursive)` | 398 | inventory (`FCaptureManagerTakeDirectoryInfo`, `:71`: `bIsTakeArchive`, `bIsLiveLinkFace`, `VideoFiles`, `ImageSeqDirs`, `AudioFiles`, `CalibrationFiles`) |

The async versions (`IngestMonoVideo`, `IngestLiveLinkFace`, ... `:152-306`; `IngestMonoVideoWithProgress` etc. `:317-361`) return an
`IngestId` and call `FCaptureManagerIngestSuccess(IngestId, ECaptureManagerIngestType, UFootageCaptureData*)`
or `FCaptureManagerIngestFailed(IngestId, Type, FText)` on the game thread (`:104-105`);
`CancelIngest(IngestId)` (`:381`) aborts.

`FCaptureManagerConversionParams` (`:39`): `ImageFormat` PNG/JPG, `AudioFormat` WAV, file
prefixes, `PixelFormat` (`ECaptureManagerPixelFormat::U8_BGRA` default), `Rotation`
(`ECaptureManagerRotation::Auto` — phone footage is usually portrait and gets rotated here).

Python (editor):

```python
import unreal
params = unreal.CaptureManagerConversionParams()
err = unreal.Text()
cd = unreal.CaptureManagerIngestBlueprintLibrary.ingest_mono_video_sync(
    r"D:/takes/webcam_take01.mp4", "", "webcam", 1, params, err)
if cd is None:
    raise RuntimeError(str(err))
```

Settings must be valid before ingesting: the library calls
`GetValidatedSettings` and fails with an error text if `ImportDirectory` is unset
(`CaptureManagerIngestBlueprintLibrary.cpp`:266, helper at :75).

---

## Live Link Face takes: MetaHuman Animator vs ARKit mode

Metadata extraction (`LiveLinkFaceMetadata.cpp`) recognises a take folder by
`take.json`, `video_metadata.json`, `frame_log.csv`, `audio_metadata.json`,
`thumbnail.jpg` and the `.mov` (`FLiveLinkFaceStaticFileNames`, `:47-58`;
`GetCommonFileNames`, `:213`). Two recording modes exist in the app:

- **MetaHuman Animator mode** adds `depth_data.bin` and `depth_metadata.mhaical`
  (`GetMHAFileNames`, `:224-232`). The `.mhaical` carries the TrueDepth intrinsics and
  lens-distortion tables (`FLiveLinkFaceDepthMetadata`, `:85-101`), which ingest turns into
  the `UCameraCalibration`. Only these takes can drive `EDataInputType::DepthFootage`.
- **ARKit mode** adds blendshape CSVs (`<slate>_<take>_<subject>.csv`, or `_cal/_neutral/_raw`
  when calibrated; `GetARKitFileNames`, `:234-247`) and no depth. Ingest still yields video
  + audio, so the take can be processed as `MonoFootage`, but not with an Identity.

Device class is parsed from `take.json`'s device model
(`FLiveLinkFaceMetadataParser::ParseiOSDeviceModel`) into `FFootageCaptureMetadata::DeviceClass`.
Since 5.6 the app exports takes as `.cptake` archives (`FIngestCaptureData::Extension`);
`IngestLiveLinkFaceSync` accepts both layouts and `IngestTakeArchiveSync` handles any
`.cptake` (HMC exports too).

---

## Legacy: UMetaHumanCaptureSource / UMetaHumanCaptureSourceSync (deprecated 5.7)

`MetaHumanCaptureSource.h`:97 and `MetaHumanCaptureSourceSync.h`:18 are `UE_DEPRECATED(5.7)`
("now available in the CaptureManager/CaptureManagerDevices module") but still compile and
are what the shipped `create_capture_data.py` drives:

```python
src = unreal.MetaHumanCaptureSourceSync()
src.set_editor_property('capture_source_type', unreal.MetaHumanCaptureSourceType.LIVE_LINK_FACE_ARCHIVES)
src.set_editor_property('storage_path', unreal.DirectoryPath(path=r"D:/LLF_Takes"))
if src.can_startup():
    src.startup()
    takes = src.refresh()                        # TArray<FMetaHumanTakeInfo>
    src.set_target_path(ingest_dir_on_disk, "/Game/MHA/Ingested")
    imported = src.get_takes([t.id for t in takes])   # TArray<FMetaHumanTake>: views, audio, calibration
    src.shutdown()
```

Relevant types: `EMetaHumanCaptureSourceType` (`LiveLinkFaceConnection`, `LiveLinkFaceArchives`,
`HMCArchives`; `MetaHumanCaptureSource.h`:21), `FMetaHumanTakeInfo` (`MetaHumanTakeData.h`:27:
`Name`, `Id`, `NumFrames`, `FrameRate`, `Resolution`, `DepthResolution`, `DeviceModel`,
`OutputDirectory`, `Issues`), `FMetaHumanTakeView` (`:84`: `Video`, `Depth`, timecodes) and
`FMetaHumanTake` (`:115`: `Views`, `CameraCalibration`, `Audio`, `CaptureExcludedFrames`).
The script then builds a `UFootageCaptureData` by hand with `UFootageCaptureDataFactory`
(`CaptureDataFactory.h`:30), copying views into `ImageSequences`/`DepthSequences`,
stamping timecode with `UImageSequenceTimecodeUtils::SetTimecodeInfo`, and filling
`Metadata.DeviceClass`/`DeviceModelName`/`FrameRate`. Capture Manager does all of that for
you; prefer it for new code and expect the legacy classes to disappear.

The depth-related enums survive in non-deprecated code: `EMetaHumanCaptureDepthPrecisionType`
(`Eightieth` = 0.125 mm, `Full`; `MetaHumanCaptureSource.h`:31) and
`EMetaHumanCaptureDepthResolutionType` (`Full`/`Half`/`Quarter`, `:38`) are reused by the
depth generator options.

---

## Stereo depth generation (UMetaHumanDepthGenerator)

For stereo HMC footage that has two RGB views but no depth EXRs:

```python
opts = unreal.MetaHumanGenerateDepthWindowOptions()
opts.asset_name = "HMC_Take01_Depth"
opts.package_path.path = "/Game/MHA/Depth/"
opts.image_sequence_root_path.path = unreal.Paths.project_content_dir() + "MHA/Depth/Images/"
# opts.reference_camera_calibration = None   -> uses cd.camera_calibrations[0]
# opts.min_distance / max_distance = 10.0 / 25.0 cm ; depth_precision EIGHTIETH ; depth_resolution FULL
ok = unreal.MetaHumanDepthGenerator().process(capture_data, opts)
```

`UMetaHumanDepthGenerator::Process(FootageCaptureData, Options)` (`MetaHumanDepthGenerator.h`:24,
`BlueprintCallable`) refuses footage with fewer than two `ImageSequences`
("Generating depth images requires two image sequences."), null sequences, and a missing
calibration or one with fewer than two cameras ("A valid stereo camera calibration is
required."). In 5.9 these checks moved from `MetaHumanDepthGenerator.cpp` into
`ValidateFootage` / `GenerateDepth` in `DepthGeneration/MetaHumanDepthGenerationService.cpp`
(:581-594, :640-644), which also reject a disabled Depth Processing plugin and empty output
paths (`ValidateRequest`, :596-619).
It writes depth EXRs under `ImageSequenceRootPath`, creates `UImgMediaSource` depth assets
and a `_Generated` calibration, and appends them to the capture data's `DepthSequences`.
The one-argument overload opens the modal options window (`:634-660`). Options
(`MetaHumanGenerateDepthWindowOptions.h`): `AssetName` (23), `PackagePath` (26),
`ImageSequenceRootPath` (29), `bAutoSaveAssets` (32), `bShouldExcludeDepthFilesFromImport`
(35), `bShouldCompressDepthFiles` (38), `ReferenceCameraCalibration` (41), `MinDistance`
(51), `MaxDistance` (61), `DepthPrecision` (65), `DepthResolution` (69).

A `DepthFootage` Performance can also generate depth on the fly: `CanProcess` admits
footage with no depth but ≥2 RGB views and a calibration
(`MetaHumanPerformance.cpp`:2586-2599), `NeedsCalibrationForDepthGeneration()`
(`MetaHumanPerformance.h`:658) tells you a calibration is missing, and `MinDistance`/
`MaxDistance` under "Processing Parameters | Depth Generation" (`:429-433`) apply.

Monocular footage has none of this. There is no mono depth estimator in 5.8; a webcam clip
is `MonoFootage`, full stop.

---

## Frame rate, timecode and excluded frames

- `FFootageCaptureMetadata::FrameRate` must be valid; `UMetaHumanPerformance::SetFootageCaptureData`
  rejects footage with an invalid rate and nulls the property (`MetaHumanPerformance.h`:515).
  `UMetaHumanPerformance::GetFrameRate()` returns `ImageSequences[0]->FrameRateOverride`,
  or 30 fps with no footage (`MetaHumanPerformance.cpp`:1031-1041).
- `ETimecodeAlignment` (`CaptureData.h`:196): `None` (tracks start at frame 0 together),
  `Absolute` (place each track at its embedded timecode), `Relative` (default — align by the
  earliest timecode, so tracks keep their relative offset). Both the Performance (`:210`) and
  each Identity pose (`MetaHumanIdentityPose.h`:214) carry their own setting.
- When image and depth sequences have different but compatible rates (e.g. 60 fps video,
  30 fps depth), `StartPipeline` computes rate-matching drop frames and excludes them with
  a warning in `LogMetaHumanPerformance` (`MetaHumanPerformance.cpp`:1174-1199).
- Exclusions come from three places and are merged into independent processing runs:
  `UserExcludedFrames`, rate-matching drops, and the footage's `CaptureExcludedFrames`
  offset by the media start frame (`:1138-1155`). A single excluded frame is skipped; a run of
  excluded frames splits processing into separate pipelines.
- Audio-only: the range is derived from the `USoundWave` duration at 30 fps.

---

## Source references (UE 5.9)

All paths under `Engine/Plugins/VirtualProduction/`:
- `CaptureData/Source/CaptureDataCore/Public/CaptureData.h`:26 — `ECaptureDataInitializedCheck`.
- `CaptureData/Source/CaptureDataCore/Public/CaptureData.h`:43 — `UCaptureData`.
- `CaptureData/Source/CaptureDataCore/Public/CaptureData.h`:93 — `UMeshCaptureData`, `TargetMesh` (107).
- `CaptureData/Source/CaptureDataCore/Public/CaptureData.h`:114 — `EFootageDeviceClass`; `FFootageCaptureMetadata` (126); `SetDeviceClass` (149).
- `CaptureData/Source/CaptureDataCore/Public/CaptureData.h`:196 — `ETimecodeAlignment`.
- `CaptureData/Source/CaptureDataCore/Public/CaptureData.h`:217 — `UFootageCaptureData`; arrays (242-272); `GetFrameRanges` (282); `VerifyData` (338).
- `CaptureData/Source/CaptureDataEditor/Public/CaptureDataFactory.h`:14 — `UMeshCaptureDataFactory`; `UFootageCaptureDataFactory` (30).
- `CaptureData/Source/CaptureDataUtils/Public/ImageSequenceTimecodeUtils.h`:13 — `UImageSequenceTimecodeUtils`; `SetTimecodeInfo` (24).
- `CaptureManager/CaptureManagerApp/Source/IngestLiveLinkDevice/Public/BaseIngestLiveLinkDevice.h`:18 — `UBaseIngestLiveLinkDevice`.
- `CaptureManager/CaptureManagerApp/Source/LiveLinkCapabilities/Public/Ingest/LiveLinkDeviceCapability_Ingest.h`:38 — `ILiveLinkDeviceCapability_Ingest`; `CreateIngestProcess` (51); `RunIngestProcess` (54); `UpdateTakeList` (60); `GetTakeInformation` (66).
- `CaptureManager/CaptureManagerApp/Source/LiveLinkCapabilities/Public/Ingest/IngestCapability_TakeInformation.h`:12 — `UIngestCapability_TakeInformation`.
- `CaptureManager/CaptureManagerApp/Source/LiveLinkCapabilities/Public/Ingest/IngestCapability_Options.h`:45 — `UIngestCapability_Options`.
- `CaptureManager/CaptureManagerDevices/Source/CPSLiveLinkDevice/Public/LiveLinkFaceDevice.h`:27 — `ULiveLinkFaceDeviceSettings`; `ULiveLinkFaceDevice` (50).
- `CaptureManager/CaptureManagerDevices/Source/MonoVideoIngestDevice/Private/MonoVideoIngestDevice.h`:63 — `UMonoVideoIngestDevice`.
- `CaptureManager/CaptureManagerDevices/Source/TakeArchiveIngestDevice/Private/TakeArchiveIngestDevice.h`:38 — `UTakeArchiveIngestDevice`.
- `CaptureManager/CaptureManagerCore/Source/DataIngestCore/Public/IngestCaptureData.h`:11 — `FIngestCaptureData` (`.cptake`).
- `CaptureManager/CaptureManagerCore/Source/CaptureMetadataExtraction/Internal/LiveLinkFaceMetadata.cpp`:47 — `FLiveLinkFaceStaticFileNames`; `GetMHAFileNames` (224); `GetARKitFileNames` (234).
- `CaptureManager/CaptureManagerEditor/Source/CaptureManagerIngestBlueprint/Internal/CaptureManagerIngestBlueprintLibrary.h`:39 — `FCaptureManagerConversionParams`; `FCaptureManagerTakeDirectoryInfo` (71); `UCaptureManagerIngestBlueprintLibrary` (122). (Moved from `Private/` in 5.8.)
- `CaptureManager/CaptureManagerEditor/Source/CaptureManagerIngestBlueprint/Private/CaptureManagerIngestBlueprintLibrary.cpp`:247 — `IngestMonoVideo_Internal`; `IngestLiveLinkFace_Internal` (434).
- `CaptureManager/CaptureManagerEditor/Source/CaptureManagerEditorSettings/Public/Settings/CaptureManagerEditorSettings.h`:23 — `UCaptureManagerEditorSettings`; `MediaDirectory` (76); `ImportDirectory` (82).

All paths under `Engine/Plugins/MetaHuman/MetaHumanAnimator/Source/`:
- `MetaHumanCaptureSource/Public/MetaHumanCaptureSource.h`:21 — `EMetaHumanCaptureSourceType` (deprecated); depth precision/resolution enums (31, 38); `UMetaHumanCaptureSource` (97).
- `MetaHumanCaptureSource/Public/MetaHumanCaptureSourceSync.h`:18 — `UMetaHumanCaptureSourceSync`; `Startup` (41); `Refresh` (45); `SetTargetPath` (49); `GetTakes` (74).
- `MetaHumanCaptureSource/Public/MetaHumanTakeData.h`:27 — `FMetaHumanTakeInfo`; `FMetaHumanTakeView` (84); `FMetaHumanTake` (115).
- `MetaHumanDepthGenerator/Private/MetaHumanDepthGenerator.h`:15 — `UMetaHumanDepthGenerator`; `Process` (24).
- `MetaHumanDepthGenerator/Private/MetaHumanDepthGenerator.cpp`:47 — modal overload; options overload (73).
- `MetaHumanDepthGenerator/Private/DepthGeneration/MetaHumanDepthGenerationService.cpp`:581 — `ValidateFootage`; `ValidateRequest` (596); `GenerateDepth` (622), calibration check (641-644).
- `MetaHumanDepthGenerator/Private/Widgets/MetaHumanGenerateDepthWindowOptions.h`:13 — `UMetaHumanGenerateDepthWindowOptions`.
- `MetaHumanPerformance/Public/MetaHumanPerformance.h`:207 — `Camera`; `TimecodeAlignment` (211); depth generation distances (436-440); `SetFootageCaptureData` (515-517); `NeedsCalibrationForDepthGeneration` (658).
- `MetaHumanPerformance/Private/MetaHumanPerformance.cpp`:1031 — `GetFrameRate`; rate matching (1174-1199); exclusion merging (1208-1225).
- `MetaHumanConfig/Public/MetaHumanConfig.h` — `FMetaHumanConfig::GetInfo`, `UMetaHumanConfig`.
