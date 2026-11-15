# MetaHuman Live Link sources — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the three sources shipped by the MetaHuman
Live Link plugin — **MetaHuman (Video)**, **MetaHuman (Audio)** and **Live Link Face** — plus
the legacy Apple ARKit source: class hierarchy, how sources and subjects are created, every
settings class an agent can set, calibration and smoothing, the realtime NNE models, and the
network protocol the iPhone app uses. Grounded in UE 5.8
(`Engine/Plugins/MetaHuman/MetaHumanLiveLink/Source/`).

---

## Class hierarchy at a glance

```
ILiveLinkSource                              (LiveLinkInterface)
 ├─ FMetaHumanLocalLiveLinkSource            local solver sources, owns N subjects
 │   ├─ FMetaHumanVideoLiveLinkSource        "MetaHuman (Video)"
 │   └─ FMetaHumanAudioLiveLinkSource        "MetaHuman (Audio)"
 └─ FLiveLinkFaceSource                      "Live Link Face" (iPhone), one subject

ULiveLinkSourceSettings
 ├─ UMetaHumanLocalLiveLinkSourceSettings    RequestSubjectCreation(), bIsPreset
 │   ├─ UMetaHumanVideoLiveLinkSourceSettings   default MonocularAnimationPipelineModels
 │   └─ UMetaHumanAudioLiveLinkSourceSettings
 └─ ULiveLinkFaceSourceSettings              Address / Port / SubjectName, RequestConnect()

ULiveLinkSubjectSettings → ULiveLinkHubSubjectSettings
 └─ UMetaHumanLiveLinkSubjectSettings        calibration, smoothing, head neutrals, PreProcess()
     ├─ UMetaHumanLocalLiveLinkSubjectSettings      state/FPS/timecode, Reload/Remove
     │   ├─ UMetaHumanVideoBaseLiveLinkSubjectSettings   head toggles, monitor image, rotation
     │   │   └─ UMetaHumanVideoLiveLinkSubjectSettings   + MediaSourceCreateParams
     │   └─ UMetaHumanAudioBaseLiveLinkSubjectSettings   mood, intensity, lookahead
     │       └─ UMetaHumanAudioLiveLinkSubjectSettings   + MediaSourceCreateParams
     └─ ULiveLinkFaceSubjectSettings                 head toggles (phone)
```

Factories (`ULiveLinkSourceFactory` subclasses, all `EMenuType::MenuEntry`):
`UMetaHumanVideoLiveLinkSourceFactory`, `UMetaHumanAudioLiveLinkSourceFactory`
(`MetaHumanLocalLiveLinkSource/Private/`), `ULiveLinkFaceSourceFactory`
(`LiveLinkFaceSource/Private/`). Their headers are private, so C++ outside the module reaches
them by class name (`FindFirstObject<UClass>`) or through `ILiveLinkClient::CreateSource` with a
`FLiveLinkSourcePreset` whose `Factory` is set (`LiveLinkPresetTypes.h`:18).

Every subject from any of these sources is pushed with **`ULiveLinkBasicRole`**
(`MetaHumanLocalLiveLinkSubject.cpp`:217, `LiveLinkFaceSource.cpp`:300).

---

## Common: UMetaHumanLiveLinkSubjectSettings

`MetaHumanLiveLinkSource/Public/MetaHumanLiveLinkSubjectSettings.h`:15. Everything here is
`UFUNCTION(BlueprintCallable)` with Set/Get pairs, so it is scriptable from Python.

| Property / function | Line | Meaning |
|---|---|---|
| `bIsLiveProcessing` (Transient) | :38 | True for live subjects; false when the settings object is used for Take Recorder playback, which hides all live-only controls through `EditCondition`. |
| `Properties` + `SetCalibrationProperties` | :45 / :48 | Which curve names calibration touches; default from `FMetaHumanRealtimeCalibration::GetDefaultProperties()` (`MetaHumanLiveLinkSubjectSettings.cpp`:18). |
| `Alpha` + `SetCalibrationAlpha` | :54 / :57 | 0..1 strength of the neutral-frame subtraction. |
| `NeutralFrame` + `SetCalibrationNeutralFrame` | :63 / :66 | The captured neutral values (one float per property). Empty = no calibration. |
| `CaptureNeutralFrameCountdown` | :72 | -1 idle; counts down to 0 then the current frame becomes `NeutralFrame` (`.cpp`:111-115). |
| `Parameters` + `SetSmoothing` | :76 / :79 | `UMetaHumanRealtimeSmoothingParams` data asset. |
| `NeutralHeadTranslation`, `NeutralHeadOrientation`, `NeutralHeadPoseInverse` | :88 / :98 / :107 | Head neutral captured by `CaptureNeutralHeadPose()`; translation output is relative to it. |
| `CaptureNeutrals()` | :113 | Captures both neutral frame and neutral head pose. |
| `CaptureNeutralFrame()` / `CaptureNeutralHeadPose()` | :116 / :119 | Individually. `CaptureNeutralHeadTranslation()` is deprecated since 5.7 (:121). |
| `PreProcess(StaticData, FrameData)` | :128 | Called by the source for every frame: calibration then smoothing (`.cpp`:78-115). |

`EMetaHumanLiveLinkHeadPoseMode` (:141) is a bitmask — `CameraRelativeTranslation`,
`Orientation` — written into every frame's `MetaData.StringMetaData["HeadPoseMode"]`
(`MetaHumanLocalLiveLinkSubject.cpp`:259, `LiveLinkFaceSource.cpp`:424) so downstream
consumers know which head channels are valid.

### Smoothing

`MetaHumanCoreTechLib/Source/MetaHumanCoreTech/Public/MetaHumanRealtimeSmoothing.h`:

- `EMetaHumanRealtimeSmoothingParamMethod` (:18) — `RollingAverage` or `OneEuro`.
- `FMetaHumanRealtimeSmoothingParam` (:25) — `Method`, `RollingAverageFrame` (uint8, default 1,
  :35), `OneEuroSlope` (default 5000, :38), `OneEuroMinCutoff` (default 5, :41).
- `UMetaHumanRealtimeSmoothingParams : UDataAsset` (:45) — `TMap<FName, FMetaHumanRealtimeSmoothingParam> Parameters` (:54), keyed by curve name.
- `FMetaHumanRealtimeSmoothing` (:57) — the worker; `GetDefaultSmoothingParams()` (:64),
  `ProcessFrame(PropertyNames, InOutFrame, DeltaTime)` (:66). Head orientation properties get
  a separate One-Euro path (:80-83).

Shipped assets: `/MetaHumanCoreTech/RealtimeMono/DefaultSmoothing` (loaded by default,
`MetaHumanLiveLinkSubjectSettings.cpp`:21-22) and `/MetaHumanCoreTech/RealtimeMono/HeavySmoothing`.
Create your own `UMetaHumanRealtimeSmoothingParams` asset and assign it with `SetSmoothing()`
to tune per curve (e.g. heavier smoothing on `HeadYaw`, none on `CTRL_expressions_jawOpen`).

Alternative: `UMetaHumanSmoothingPreProcessor` (`MetaHumanSmoothingPreProcessor.h`:12) is a
`ULiveLinkFramePreProcessor` with the same `Parameters` property (:54); add it to any Basic
Role subject's `PreProcessors` array (`LiveLinkSubjectSettings.h`:79) — useful for smoothing a
subject that arrives via Live Link Hub rebroadcast rather than a local source.

### Calibration

`MetaHumanRealtimeCalibration.h`:9 — `FMetaHumanRealtimeCalibration(Properties, NeutralFrame, Alpha)`,
`GetDefaultProperties()` (:15), `ProcessFrame()` (:21). It subtracts the performer's resting
expression from the listed properties, blended by `Alpha`. Calibration is skipped while a
neutral capture countdown is running (`.cpp`:94).

---

## MetaHuman (Video) — local webcam solver

### Source

`FMetaHumanLocalLiveLinkSource` (`MetaHumanLocalLiveLinkSource.h`:15) implements
`ILiveLinkSource`; `GetSourceType()` returns "MetaHuman (Video)" for the video subclass
(`MetaHumanVideoLiveLinkSource.cpp`:12). Key API:

- `CreateSubjectSettings<T>()` (:32) — `NewObject<T>` in the transient package + `Setup()`.
- `RequestSubjectCreation(SubjectName, Settings)` (:41) — creates the `FMetaHumanLocalLiveLinkSubject`, returns its `FLiveLinkSubjectKey`.
- `CreateSubject()` (:55, protected pure virtual) — subclass builds the concrete subject.
- `OnSourceCreated(bIsPreset)` (:53) — distinguishes a fresh source from one restored by a preset (`UMetaHumanLocalLiveLinkSourceSettings::bIsPreset`, `MetaHumanLocalLiveLinkSourceSettings.h`:33).

A source holds many subjects (`TMap<FLiveLinkSubjectKey, TSharedPtr<FMetaHumanLocalLiveLinkSubject>>`, :62) —
one webcam source can drive several performers if you add several subjects, each with its own
device.

### Subject (worker thread)

`FMetaHumanLocalLiveLinkSubject : FRunnable` (`MetaHumanLocalLiveLinkSubject.h`:15) runs a
`UE::MetaHuman::Pipeline::FPipeline` (:53) on its own thread. For video
(`FMetaHumanVideoBaseLiveLinkSubject`, `MetaHumanVideoBaseLiveLinkSubject.h`:18) the pipeline is
`FVideoSourceNode → FUEImageRotateNode → FHyprsenseRealtimeNode (+FNeutralFrameNode)` (:63-66).
Each solved frame becomes `FFrameAnimationData` (:55) → `PushFrameData()`:

```
PropertyValues = [raw controls…, HeadControlSwitch, HeadRoll, HeadPitch, HeadYaw,
                  HeadTranslationX, HeadTranslationY, HeadTranslationZ, MHFDSVersion=1, DisableFaceOverride=1]
MetaData.SceneTime      = sample timecode (ETimeSource System or Media, :33-41)
StringMetaData          = { IsNeutralFrame, HeadPoseMode }
```

(`MetaHumanLocalLiveLinkSubject.cpp`:228-259). Head pose is converted from mesh space to the
head bone with `FMetaHumanHeadTransform::MeshToBone` (:236).

### Settings you can set

`UMetaHumanVideoBaseLiveLinkSubjectSettings` (`MetaHumanVideoBaseLiveLinkSubjectSettings.h`:31):

| Property | Line | Notes |
|---|---|---|
| `bHeadOrientation` / `SetHeadOrientation` | :55 / :58 | Output head rotation curves. Off when head is tracked elsewhere. |
| `bHeadTranslation` / `SetHeadTranslation` | :65 / :68 | Output camera-relative translation (needs a neutral head pose). |
| `bHeadStabilization` / `SetHeadStabilization` | :75 / :78 | Solver-side noise reduction on head pose. |
| `MonocularAnimationPipelineModels` | :85 | Models actually used (copied from source settings at creation). |
| `MonitorImage` / `SetMonitorImage` | :89 / :92 | `EHyprsenseRealtimeNodeDebugImage`: None, Input Video, FaceDetect, Headpose, Trackers, Solver (`HyprsenseRealtimeNode.h`:21). Costs GPU/CPU; leave `None` in production. |
| `Rotation` / `SetRotation` | :103 / :106 | `EMetaHumanVideoRotation` 0/90/180/270 for sideways cameras (:14). |
| `FocalLength` | :113 | Read-only estimate used for translation. |
| `VideoStateEnum` | :51 | `NoFaceDetected`, `SubjectTooFar` when base `StateEnum == DeviceSpecific`. |
| `ConfidenceValue`, `ImageResolution`, `Dropped` | :122 / :129 / :136 | Diagnostics (Transient, BlueprintReadOnly). |

Base `UMetaHumanLocalLiveLinkSubjectSettings` (`MetaHumanLocalLiveLinkSubjectSettings.h`:34)
adds `StateEnum` (`EMetaHumanLocalLiveLinkSubjectState` Unknown/OK/Completed/Error/DeviceSpecific,
:22), `FrameNumber` (:66), `ProcessingRate` / `CaptureRate` (:73/:76), `Timecode` (:79),
`ReloadSubject()` (:85, restarts the pipeline after a device hiccup), `RemoveSubject()` (:88)
and `SetMonitoring(Basic|Advanced, bool)` (:91).

Project-wide defaults for new video subjects: `UMetaHumanVideoLiveLinkSettings`
(`MetaHumanVideoLiveLinkSettings.h`:14, `config=Editor`): `bHeadOrientation`,
`bHeadTranslation`, `MonitorImage`, `MonitorImageHeight`.

### Device discovery and media params

`FMetaHumanMediaSourceCreateParams` (`MetaHumanMediaSourceCreateParams.h`:10) describes the
device: `VideoName`, `VideoURL`, `VideoTrack`, `VideoTrackFormat`, `VideoTrackFormatName`
(and the audio equivalents), plus `StartTimeout` (5 s), `FormatWaitTime` (0.1 s),
`SampleTimeout` (5 s). `EMetaHumanLocalLiveLinkSourceDeviceType`
(`MetaHumanLocalLiveLinkSourceSettings.h`:13): `CaptureDevice`, `MediaBundle`, `MediaSource`,
`MediaProfile` — so a Media Bundle or Media Profile (SDI/NDI capture card) is a valid input,
and a movie file via a Media Source works for offline testing.

`UMetaHumanLocalLiveLinkSourceBlueprint` (`MetaHumanLocalLiveLinkSourceBlueprint.h`:130) wraps
`MediaCaptureSupport::EnumerateVideoCaptureDevices` for scripting:
`GetVideoDevicesOfType` (:138), `GetVideoDevices` (:141), `GetVideoTracks` (:144),
`GetVideoFormats(…, FilterFormats=true)` (:147), `CreateVideoSource` (:150),
`CreateVideoSubject` (:153), and the audio twins (:156-171), plus `GetSubjectSettings` (:174).
Structs: `FMetaHumanLiveLinkVideoDevice` (:15), `FMetaHumanLiveLinkVideoTrack` (:30),
`FMetaHumanLiveLinkVideoFormat` (:45 — `Resolution`, `FrameRate`, `Type`, `Name`).

### NNE models and backend

`FMonocularAnimationPipelineModels` (`HyprsenseRealtimeNode.h`:59): `NNEBackend` (:70),
`FaceDetector` (:74), `FaceHeadPoseTracker` (:78), `FaceSolver` (:82), all
`BlueprintReadWrite`. `SetModelConfiguration(EHyprsenseRealtimeNodeModelConfiguration)` picks
`Default`, `StereoHMC` (head-mounted camera) or `SmallFace` (:51-56).

Defaults (`HyprsenseRealtimeNode.cpp`): backend from a per-platform console variable —
`NNERuntimeORTDml` on Windows, `NNERuntimeCoreML` on Mac, `NNERuntimeORTCpu` elsewhere
(:37-47); models under `/MetaHumanCoreTech/RealtimeMono/` (`HeadPoseTracker`,
`GenericRigSolver`, `StereoHMCRigSolver`; :71-91) or `/MetaHumanCoreML/…` when CoreML. The
plugin depends on **NNERuntimeORT** for this. Set `NNEBackend = "NNERuntimeORTCpu"` on machines
without a DirectML-capable GPU; expect a lower `ProcessingRate`.

---

## MetaHuman (Audio) — local audio-driven solver

Same `FMetaHumanLocalLiveLinkSource` machinery (`GetSourceType()` = "MetaHuman (Audio)",
`MetaHumanAudioLiveLinkSource.cpp`:12); the subject
(`FMetaHumanAudioBaseLiveLinkSubject`, `MetaHumanAudioBaseLiveLinkSubject.h`:16) runs
`FAudioSourceNode → FRealtimeSpeechToAnimNode` (:46-47). Settings
(`UMetaHumanAudioBaseLiveLinkSubjectSettings`, `MetaHumanAudioBaseLiveLinkSubjectSettings.h`:13):

| Property | Line | Notes |
|---|---|---|
| `Level` | :29 | Crude input meter (Transient). |
| `Mood` / `SetMood` | :32 / :35 | `EAudioDrivenAnimationMood`, default `AutoDetect`. |
| `MoodIntensity` / `SetMoodIntensity` | :41 / :44 | 0..1. |
| `Lookahead` / `SetLookahead` | :51 / :54 | 80–240 ms of audio the solver looks ahead; more = better animation, more latency. |

Head pose is not produced from audio; `HeadControlSwitch` stays 0 unless you add head motion
another way. `UMetaHumanAudioLiveLinkSubjectSettings` (`MetaHumanAudioLiveLinkSubjectSettings.h`:12)
adds the `MediaSourceCreateParams` with `AudioName/AudioURL/AudioTrack/AudioTrackFormat`.
Windows uses `AudioMixerWasapi` for capture (`MetaHumanLocalLiveLinkSource.Build.cs`:37-42).
The solver (`FRealtimeSpeechToAnimNode`, `RealtimeSpeechToAnimNode.h`:17) also takes an
`NNEBackend` (:38); its console-variable defaults match the video solver.

---

## Live Link Face — iPhone source

### Protocol

`FLiveLinkFaceSource` (`LiveLinkFaceSource/Private/LiveLinkFaceSource.h`:20;
`GetSourceType()` = "Live Link Face", `.cpp`:25):

1. `InitializeSettings` → `ULiveLinkFaceSourceSettings::Init(this, "ADDRESS:PORT")`
   (`LiveLinkFaceSourceSettings.h`:20); if the address is valid (preset restore) it connects
   immediately (`LiveLinkFaceSource.cpp`:100-112).
2. `Connect()` opens a UDP receive socket, then a `FLiveLinkFaceControl` thread
   (`LiveLinkFaceControl.h`:14) that talks the Capture Protocol Stack **control** channel
   (TCP, `UE::CaptureManager::FControlMessenger`) to the phone at `Host:Port` (default port
   **14785**, `LiveLinkFaceSourceSettings.h`:52), telling it which local UDP port to stream to
   (`LiveLinkFaceSource.cpp`:115-146).
3. The phone answers with its subjects (`FRemoteSubject`: `Id`, `Name`,
   `AnimationType` = `ArKit` | `Mha`, `AnimationVersion`, `PropertyNames`;
   `LiveLinkFaceControl.h`:18-39). `OnSelectRemoteSubject` chooses one; `OnStreamingStarted`
   creates the Live Link subject on the game thread as Basic Role with
   `ULiveLinkFaceSubjectSettings` + `ULiveLinkBasicFrameInterpolationProcessor`
   (`LiveLinkFaceSource.cpp`:286-325). The subject name is the phone's subject name unless
   `SubjectName` was set in the settings (`CustomSubjectName`, `.h`:57).
4. Each UDP packet (`FLiveLinkFacePacket`, `LiveLinkFacePacket.h`:8) carries version, subject
   id, `FQualifiedFrameTime`, `uint16` control values (scaled by `UINT16_MAX`, `.cpp`:30/:442)
   and six head-pose floats (`HeadPoseValueCount = 6`, :11). `ProcessPacket` appends the head
   block and `MHFDSVersion = AnimationVersion` (`.cpp`:378-426) and runs `PreProcess`.

`ULiveLinkFaceSourceBlueprint` (`LiveLinkFaceSourceBlueprint.h`:13) exposes
`CreateLiveLinkFaceSource(OutHandle, OutSucceeded)` (:21 — `MakeShared<FLiveLinkFaceSource>("")`
+ `AddSource`) and `Connect(Handle, SubjectName, Address, OutSucceeded, Port = 14785)` (:24 —
sets address/port/name on the settings and `RequestConnect()`).

### Subject settings (phone)

`ULiveLinkFaceSubjectSettings` (`LiveLinkFaceSubjectSettings.h`:10): `bHeadOrientation` (:17),
`bHeadTranslation` (:26) with Set/Get. Project defaults come from `ULiveLinkFaceSourceDefaults`
(`LiveLinkFaceSourceDefaults.h`:12, `config=Editor`). Both toggles feed `HeadControlSwitch` and
`HeadPoseMode` per frame (`LiveLinkFaceSource.cpp`:387-418).

### Discovery

`FLiveLinkFaceDiscovery` (`LiveLinkFaceDiscovery/Public/LiveLinkFaceDiscovery.h`:20):
construct with `RefreshDelay` (3 s) / `ServerExpiry` (6 s) (:68), bind `OnServersUpdated`
(:83) **before** `Start()` (:74), receive `TSet<FServer>` with `Id`, `Name`, `Address`,
`ControlPort`, `LastSeen` (:26-61). Under the hood it multicasts discovery requests through
`UE::CaptureManager::FDiscoveryMessenger` to `239.255.137.139:27838`
(`CaptureProtocolStack/Private/Discovery/Communication/DiscoveryCommunication.cpp`:10-11) and
listens for responses/notifications. Feed `Address:ControlPort` into `Connect`. The editor's
Live Link Face source panel (`SLiveLinkFaceDiscoveryPanel`) is just a UI over this class.

### App modes

The same app streams either **MetaHuman Animator** data (`Mha` — raw rig controls, head pose
from the device solver) or **ARKit** data (`ArKit` — Apple's 52 blendshapes). The UE source
accepts both into the same Basic Role layout; it is the *consumer* (`ABP_MH_LiveLink`'s
`ARKit_Mapping` remap vs direct curve use) that must match. The `MHFDSVersion` curve carries
the phone's `AnimationVersion` so an AnimBP can branch on it.

---

## Legacy: Apple ARKit source

`Engine/Plugins/Runtime/AR/AppleAR/AppleARKitFaceSupport/`:

- `UAppleARKitLiveLinkSourceFactory` (`Public/AppleARKitLiveLinkSourceFactory.h`:48) —
  `EMenuType::SubPanel`; connection = `FAppleARKitLiveLinkConnectionSettings::Port`
  (`Private/AppleARKitLiveLinkConnectionSettings.h`:14, default **11111**).
- `FAppleARKitLiveLinkSourceFactory` (:31) — static helpers `CreateLiveLinkSource()`,
  `CreateLiveLinkRemotePublisher(RemoteAddr)`, `CreateLiveLinkLocalFileWriter()`.
- `IARKitBlendShapePublisher::PublishBlendShapes(SubjectName, FrameTime, FARBlendShapeMap, DeviceID)` (:15-20).
- Static data = `EARFaceBlendShape` names with the enum prefix stripped
  (`Engine/Source/Runtime/AugmentedReality/Public/ARTrackable.h`:262 — `EyeBlinkLeft` …
  `JawOpen` … `HeadYaw`, `HeadPitch`, `HeadRoll`, `LeftEyeYaw` …), pushed as
  **Basic Role** (`AppleARKitLiveLinkSource.cpp`:28, :191-243).

This is the "Live Link (ARKit)" target of older Live Link Face builds and of
`UAppleARKitFaceMeshComponent`-based iOS apps. It coexists with the MetaHuman Live Link
sources; it does not understand the MHA control protocol.

---

## Source references (UE 5.9)

All paths under `Engine/Plugins/MetaHuman/MetaHumanLiveLink/Source/` unless noted:
- `MetaHumanLiveLinkSource/Public/MetaHumanLiveLinkSubjectSettings.h`:15 — `UMetaHumanLiveLinkSubjectSettings`; :128 `PreProcess`; :141 `EMetaHumanLiveLinkHeadPoseMode`.
- `MetaHumanLiveLinkSource/Private/MetaHumanLiveLinkSubjectSettings.cpp`:18 — default calibration properties; :21 `DefaultSmoothing` path; :78 `PreProcess` body.
- `MetaHumanLiveLinkSource/Public/MetaHumanSmoothingPreProcessor.h`:12 — `UMetaHumanSmoothingPreProcessor`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSource.h`:15 — `FMetaHumanLocalLiveLinkSource`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSourceSettings.h`:13 — `EMetaHumanLocalLiveLinkSourceDeviceType`; :23 `UMetaHumanLocalLiveLinkSourceSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSourceBlueprint.h`:130 — `UMetaHumanLocalLiveLinkSourceBlueprint`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSubject.h`:15 — `FMetaHumanLocalLiveLinkSubject`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSubjectSettings.h`:34 — `UMetaHumanLocalLiveLinkSubjectSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanVideoBaseLiveLinkSubject.h`:18 — `FMetaHumanVideoBaseLiveLinkSubject`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanVideoBaseLiveLinkSubjectSettings.h`:31 — `UMetaHumanVideoBaseLiveLinkSubjectSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanVideoLiveLinkSubjectSettings.h`:12 — `UMetaHumanVideoLiveLinkSubjectSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanVideoLiveLinkSourceSettings.h`:14 — `UMetaHumanVideoLiveLinkSourceSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanVideoLiveLinkSettings.h`:14 — `UMetaHumanVideoLiveLinkSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanAudioBaseLiveLinkSubject.h`:16 — `FMetaHumanAudioBaseLiveLinkSubject`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanAudioBaseLiveLinkSubjectSettings.h`:13 — `UMetaHumanAudioBaseLiveLinkSubjectSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanAudioLiveLinkSubjectSettings.h`:12 — `UMetaHumanAudioLiveLinkSubjectSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanAudioLiveLinkSourceSettings.h`:14 — `UMetaHumanAudioLiveLinkSourceSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanMediaSourceCreateParams.h`:10 — `FMetaHumanMediaSourceCreateParams`.
- `MetaHumanLocalLiveLinkSource/Private/MetaHumanVideoLiveLinkSourceFactory.h`:12 — `UMetaHumanVideoLiveLinkSourceFactory`.
- `MetaHumanLocalLiveLinkSource/Private/MetaHumanAudioLiveLinkSourceFactory.h`:12 — `UMetaHumanAudioLiveLinkSourceFactory`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanVideoLiveLinkSource.h`:8 — `FMetaHumanVideoLiveLinkSource` (moved from `Private/` in 5.8; now exported with `METAHUMANLOCALLIVELINKSOURCE_API`).
- `MetaHumanLocalLiveLinkSource/Private/MetaHumanAudioLiveLinkSource.h`:9 — `FMetaHumanAudioLiveLinkSource`.
- `MetaHumanLocalLiveLinkSource/Private/MetaHumanLocalLiveLinkSubject.cpp`:198 — static layout; :228 frame layout; :236 head pose.
- `MetaHumanLocalLiveLinkSource/Private/MetaHumanLocalLiveLinkSourceBlueprint.cpp`:471 — `CreateVideoSource`; :489 `CreateVideoSubject`.
- `MetaHumanLocalLiveLinkSource/MetaHumanLocalLiveLinkSource.Build.cs`:12 — module dependencies.
- `LiveLinkFaceSource/Private/LiveLinkFaceSource.h`:20 — `FLiveLinkFaceSource`.
- `LiveLinkFaceSource/Private/LiveLinkFaceSource.cpp`:115 — `Connect`; :286 subject creation; :378 `ProcessPacket`; :477 `PushStaticData`.
- `LiveLinkFaceSource/Private/LiveLinkFaceControl.h`:14 — `FLiveLinkFaceControl`; :18 `FRemoteSubject`.
- `LiveLinkFaceSource/Private/LiveLinkFacePacket.h`:8 — `FLiveLinkFacePacket`.
- `LiveLinkFaceSource/Private/LiveLinkFaceSourceFactory.h`:12 — `ULiveLinkFaceSourceFactory`.
- `LiveLinkFaceSource/Private/LiveLinkFaceSubjectSettings.h`:10 — `ULiveLinkFaceSubjectSettings`.
- `LiveLinkFaceSource/Public/LiveLinkFaceSourceBlueprint.h`:13 — `ULiveLinkFaceSourceBlueprint`.
- `LiveLinkFaceSource/Public/LiveLinkFaceSourceSettings.h`:13 — `ULiveLinkFaceSourceSettings`; :52 default port.
- `LiveLinkFaceSource/Public/LiveLinkFaceSourceDefaults.h`:12 — `ULiveLinkFaceSourceDefaults`.
- `LiveLinkFaceDiscovery/Public/LiveLinkFaceDiscovery.h`:20 — `FLiveLinkFaceDiscovery`.

Other (UE 5.8, `Engine/Plugins/`):
- `MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanCoreTech/Public/MetaHumanRealtimeSmoothing.h`:25 — `FMetaHumanRealtimeSmoothingParam`; :45 `UMetaHumanRealtimeSmoothingParams`; :57 `FMetaHumanRealtimeSmoothing`.
- `MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanCoreTech/Public/MetaHumanRealtimeCalibration.h`:9 — `FMetaHumanRealtimeCalibration`.
- `MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanPipelineCore/Public/Nodes/HyprsenseRealtimeNode.h`:21 — `EHyprsenseRealtimeNodeDebugImage`; :51 `EHyprsenseRealtimeNodeModelConfiguration`; :59 `FMonocularAnimationPipelineModels`.
- `MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanPipelineCore/Private/Nodes/HyprsenseRealtimeNode.cpp`:37 — backend console variables; :71 model paths.
- `MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanPipelineCore/Public/Nodes/RealtimeSpeechToAnimNode.h`:17 — `FRealtimeSpeechToAnimNode`.
- `VirtualProduction/CaptureManager/CaptureManagerCore/Source/CaptureProtocolStack/Public/Discovery/DiscoveryMessenger.h`:19 — `FDiscoveryMessenger`.
- `VirtualProduction/CaptureManager/CaptureManagerCore/Source/CaptureProtocolStack/Private/Discovery/Communication/DiscoveryCommunication.cpp`:10 — multicast port/address.
- `Runtime/AR/AppleAR/AppleARKitFaceSupport/Source/AppleARKitFaceSupport/Public/AppleARKitLiveLinkSourceFactory.h`:15 — `IARKitBlendShapePublisher`; :48 `UAppleARKitLiveLinkSourceFactory`.
- `Runtime/AR/AppleAR/AppleARKitFaceSupport/Source/AppleARKitFaceSupport/Private/AppleARKitLiveLinkConnectionSettings.h`:14 — port 11111.
- `Runtime/AR/AppleAR/AppleARKitFaceSupport/Source/AppleARKitFaceSupport/Private/AppleARKitLiveLinkSource.cpp`:191 — `PublishBlendShapes`.
- `Animation/LiveLink/Source/LiveLink/Public/InterpolationProcessor/LiveLinkBasicFrameInterpolateProcessor.h`:15 — `ULiveLinkBasicFrameInterpolationProcessor`.

Engine core (`Engine/Source/Runtime/`):
- `LiveLinkInterface/Public/ILiveLinkSource.h`:15 — `ILiveLinkSource`.
- `LiveLinkInterface/Public/LiveLinkSourceFactory.h`:27 — `ULiveLinkSourceFactory`.
- `LiveLinkInterface/Public/LiveLinkFramePreProcessor.h`:41 — `ULiveLinkFramePreProcessor`.
- `LiveLinkInterface/Public/LiveLinkPresetTypes.h`:18 — `FLiveLinkSourcePreset`.
- `LiveLinkInterface/Public/Roles/LiveLinkBasicRole.h`:20 — `ULiveLinkBasicRole`.
- `AugmentedReality/Public/ARTrackable.h`:262 — `EARFaceBlendShape`.
