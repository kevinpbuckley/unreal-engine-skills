# Recording and runtime — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers recording a live MetaHuman subject with Take
Recorder (Live Link source vs Actor source, what assets result and where), baking recorded
data in Sequencer, Live Link presets for reproducible rigs, evaluation modes / buffering /
interpolation for latency control, Message Bus and UDP settings, and what works in a packaged
game. Grounded in UE 5.8.

---

## Take Recorder: two complementary sources

| Source | Class | Records | Result |
|---|---|---|---|
| **Live Link** | `UTakeRecorderLiveLinkSource` (`Engine/Plugins/Animation/LiveLink/Source/LiveLinkSequencer/Private/TakeRecorderSource/TakeRecorderLiveLinkSource.h`:48) | The subject's raw frames (every `PropertyValues` channel + metadata) as received | `UMovieSceneLiveLinkTrack` with a `UMovieSceneLiveLinkSection` in the take's Level Sequence; on playback it re-injects the data as a virtual Live Link subject so the same AnimBP plays it back |
| **Actor** | `UTakeRecorderActorSource` (`Engine/Plugins/VirtualProduction/Takes/Source/TakeRecorderSources/Public/TakeRecorderActorSource.h`:45) | The MetaHuman actor: transform, properties, and every skeletal mesh component's evaluated pose and curves via `UMovieSceneAnimationTrackRecorder` | `UAnimSequence` per skeletal mesh (Face and Body) + Skeletal Animation tracks binding them in the sequence |

Record **both** when you want editable raw curves *and* a portable AnimSequence. The Actor
source is what produces the AnimSequence; the Live Link source alone does not.

### UTakeRecorderLiveLinkSource

| Property | Line | Notes |
|---|---|---|
| `SubjectName` | :62 | The subject to record (by name, not key). |
| `bReduceKeys` | :58 | Key reduction on the recorded channels. |
| `bSaveSubjectSettings` | :66 | Store the subject's settings (role, pre-processors, MetaHuman calibration/smoothing) in the section so playback recreates them; the MetaHuman settings then run with `bIsLiveProcessing = false`. |
| `bUseSourceTimecode` | :73 | Stamp keys with the subject's `SceneTime` instead of engine time — use when the phone/camera is genlocked or you need to line up with external audio/video. |
| `bDiscardSamplesBeforeStart` | :77 | With source timecode, drop frames stamped before the take started. |
| `TrackRecorder` | :83 | The `UMovieSceneLiveLinkTrackRecorder` doing the work. |

The recorder (`LiveLinkSequencer/Public/MovieSceneLiveLinkTrackRecorder.h`:27) subscribes with
`ILiveLinkClient::RegisterForSubjectFrames` and keys every received frame (`OnFrameDataReceived`,
:61); `CreateTrack` (:48) makes a `UMovieSceneLiveLinkTrack` (`LiveLinkMovieScene/Public/MovieScene/MovieSceneLiveLinkTrack.h`:15)
whose `TrackRole` (:41) is the subject's role and a `UMovieSceneLiveLinkSection`
(`MovieSceneLiveLinkSection.h`:27) holding the `FLiveLinkSubjectPreset` (:84) and one float
channel per property. For a MetaHuman subject that is a Basic Role track with one channel per
raw control plus the head block.

The `LiveLinkSequencer` module is **`UncookedOnly`** (`LiveLink.uplugin`) — recording Live Link
is an editor / Live Link Hub feature. Playback of an existing Live Link track is in
`LiveLinkMovieScene` (`Runtime`), so a recorded take plays in a packaged game.

### UTakeRecorderActorSource

`Target` (:52, `TSoftObjectPtr<AActor>`), `RecordType` (:59, `ETakeRecorderActorRecordType`
Possessable / Spawnable / ProjectDefault, :33), `AddSourceForActor(Actor, Sources)` (:142),
`SetSourceActor` (:186). The animation recorder settings
(`TakeTrackRecorders/Public/TrackRecorders/MovieSceneAnimationTrackRecorderSettings.h`:16) decide
the AnimSequence name and folder: `AnimationAssetName` (:43), `AnimationSubDirectory` (:58),
`bRemoveRootAnimation` (:70), `InterpMode` / `TangentMode` (:62/:66). The recorder
(`MovieSceneAnimationTrackRecorder.h`:45) exposes `GetAnimSequence()` (:72).

For a MetaHuman this yields two AnimSequences (Face skeleton with the raw-control curves baked
as anim curves plus any head bone motion, and Body) — the Face one is the asset you hand to
Sequencer or gameplay and is directly compatible with the Face Control Board.

### Where takes land

`FTakeRecorderProjectParameters` (`TakeRecorder/Public/Recorder/TakeRecorderParameters.h`:73):
`RootTakeSaveDir` (:88), `TakeSaveDir` (:102, tokenised with `{slate}`, `{take}`, date/time
tokens), `SubSequenceDirectory` (:108), `bRecordSourcesIntoSubSequences` (:140),
`bRecordToPossessable` (:147). The Level Sequence is named from `UTakeMetaData` slate + take
number (`TakeMetaData.h`:214 `SetSlate`, :222 `SetTakeNumber`); AnimSequences go beside it under
`AnimationSubDirectory`. `FTakeRecorderUserParameters::bSaveRecordedAssets` (:61) controls
whether assets are saved to disk when the take stops.

### Driving a recording

Two API levels:

1. **Panel** — `UTakeRecorderBlueprintLibrary::OpenTakeRecorderPanel()`
   (`TakeRecorderBlueprintLibrary.h`:103) → `UTakeRecorderPanel` (`TakeRecorderPanel.h`:34):
   `ClearPendingTake` (:83), `GetSources` (:131), `GetTakeMetaData` (:103), `GetLevelSequence`
   (:89), `CanStartRecording(OutError)` (:151), `StartRecording` / `StopRecording` (:138/:145).
   Sources added to `GetSources()` are recorded exactly as if clicked in the UI.
2. **Headless** — `UTakeRecorderBlueprintLibrary::StartRecording(LevelSequence, Sources, MetaData, Parameters)`
   (:48) with `GetDefaultParameters()` (:55) and a `UTakeRecorderSources` you own
   (`TakesCore/Public/TakeRecorderSources.h`:54; `AddSource(Class)` :80, `RemoveSource` :88).
   Then `IsRecording` (:68), `GetActiveRecorder` (:75) → `UTakeRecorder::GetSequence()`
   (`TakeRecorder.h`:118) / `GetState()` (:127, `ETakeRecorderState` :37), `StopRecording`
   (:82), `CancelRecording` (:89). `UTakeRecorder::Initialize` (:149) is the C++ entry.

`FTakeRecorderParameters` (`TakeRecorderParameters.h`:184): `User`, `Project`, `HitchProtection`,
`TakeRecorderMode`, `StartFrame`, `bOpenSequencer` (:214 — set false for unattended capture).

### Baking in Sequencer

After recording with the Actor source there is nothing to bake: the Face AnimSequence is already
bone/curve data. If you only have a Live Link track, re-record with an Actor source while the
sequence plays (the Live Link section feeds a virtual subject during playback, so the AnimBP
animates the character), or bake through the Face Control Board: with the Face skeletal mesh's
default animating rig `Face_ControlBoard_CtrlRig` present, Sequencer's **Bake to Control Rig**
on the Face binding converts the animation track into Control Rig keys for hand editing, and
**Bake Animation Sequence** on the binding exports a new `UAnimSequence`. See
`ue-sequencer-and-cinematics` for the generic Sequencer baking API.

---

## Live Link presets

`ULiveLinkPreset` (`Engine/Plugins/Animation/LiveLink/Source/LiveLink/Public/LiveLinkPreset.h`:15)
stores `FLiveLinkSourcePreset[]` (GUID + instanced `ULiveLinkSourceSettings` + factory) and
`FLiveLinkSubjectPreset[]` (key, role, instanced subject settings, enabled;
`LiveLinkPresetTypes.h`:18/:35).

- `BuildFromClient()` (:66) — snapshot the current rig (e.g. a MetaHuman Video source with a
  calibrated, smoothed webcam subject) into an asset.
- `AddToClient(bRecreatePresets = true)` (:62) — synchronous, additive.
- `ApplyToClientLatent(...)` (:48) — removes everything then applies; latent because sources
  shut down asynchronously (`RequestSourceShutdown` polling, `ILiveLinkSource.h`:46).
- `ULiveLinkSettings::DefaultLiveLinkPreset` (`LiveLinkSettings.h`:96) — applied on editor start.

MetaHuman sources support presets explicitly: `UMetaHumanLocalLiveLinkSourceSettings::bIsPreset`
(`MetaHumanLocalLiveLinkSourceSettings.h`:33) tells the source it was restored, and the subject
settings' `MediaSourceCreateParams` (device name/URL/track/format) let it reopen the same camera;
the Live Link Face settings keep `ADDRESS:PORT` in `ConnectionString`
(`LiveLinkSourceSettings.h`:185) and reconnect automatically (`LiveLinkFaceSource.cpp`:104-112).
Calibration `NeutralFrame` and head neutrals are plain UPROPERTYs, so they persist too.

---

## Latency, buffering and interpolation

Per **source** (`ULiveLinkSourceSettings`, `LiveLinkSourceSettings.h`:161):

- `Mode` (:173, `ELiveLinkSourceMode` :40):
  - `Latest` — newest frame, no interpolation; lowest latency, can stutter if the solver rate
    beats the render rate unevenly.
  - `EngineTime` (default) — evaluate at engine time minus `BufferSettings.EngineTimeOffset`
    (:74), interpolating between buffered frames with the subject's interpolation processor.
    Smoothest for a webcam solver running at a different rate than the game.
  - `Timecode` — evaluate at the engine timecode provider's time; requires the source to stamp
    `SceneTime` (the local sources do when a timecode provider exists, `ETimeSource::System`
    vs `Media`) and the engine to have a timecode provider. Use with genlocked multi-source
    capture.
- `BufferSettings` (`FLiveLinkSourceBufferManagementSettings`, :60): `MaxNumberOfFrameToBuffered`
  (:137, default 10; `ULiveLinkDefaultSourceSettings::DefaultSourceFrameBufferSize` :31 = 64 is
  the config default), `EngineTimeOffset` (:74), `LatestOffset` (:133), `TimecodeFrameOffset`
  (:125), `bValidEngineTimeEnabled` / `ValidEngineTime` (:66/:70, drop stale frames),
  `bUseTimecodeSmoothLatest` (:105), `bGenerateSubFrame` / `SourceTimecodeFrameRate` (:93/:113).
- `ParentSubject` (:198, "Sync Subject") — rebroadcast/evaluate only when another subject ticks.

Per **subject** (`ULiveLinkSubjectSettings`): `InterpolationProcessor` (:83). MetaHuman
subjects get `ULiveLinkBasicFrameInterpolationProcessor`
(`LiveLink/Public/InterpolationProcessor/LiveLinkBasicFrameInterpolateProcessor.h`:15) whose
`bInterpolatePropertyValues` (:54) linearly blends curves between frames; interpolation never
crosses the newest sample (`FLiveLinkInterpolationInfo::bOverflowDetected`,
`LiveLinkFrameInterpolationProcessor.h`:36). Project defaults per role live in
`ULiveLinkSettings::DefaultRoleSettings` (`LiveLinkSettings.h`:84, `FLiveLinkRoleProjectSetting`
:27 — settings class, interpolation processor, pre-processors).

Practical latency budget for a webcam MetaHuman subject: solver `ProcessingRate` (watch
`UMetaHumanLocalLiveLinkSubjectSettings::ProcessingRate`, dropped frames in `Dropped`) +
smoothing window (`RollingAverageFrame`) + `EngineTimeOffset`. Start with `EngineTime`,
`EngineTimeOffset = 0`, buffer 10, `DefaultSmoothing`; raise the offset only if curves stutter.
Audio subjects add `Lookahead` (80–240 ms) on top.

---

## Message Bus, UDP and the network

Live Link between machines (Live Link Hub → editor, UE → UE) runs over Unreal Message Bus /
UDP Messaging:

- Provider side: `LiveLinkMessageBusFramework` (`Engine/Source/Runtime/LiveLinkMessageBusFramework/Public/LiveLinkProvider.h` —
  `ILiveLinkProvider::UpdateSubjectStaticData/UpdateSubjectFrameData`). This is how Live Link
  Hub and third-party apps publish.
- Consumer side: `ULiveLinkMessageBusSourceFactory` (`LiveLink/Public/LiveLinkMessageBusSourceFactory.h`:15)
  with `ULiveLinkMessageBusSourceSettings` (`LiveLinkMessageBusSourceSettings.h`:19):
  `bEnableFrameResequencing` (:29), `ResequencerMaxBufferSize` (:33), `ResequencerMaxWaitTimeSeconds`
  (:37) — reorder UDP frames that arrive out of order. Discovery: `ULiveLinkMessageBusFinder`
  (`LiveLinkMessageBusFinder.h`:83) → `GetAvailableProviders` (:98) → `ConnectToProvider` (:107);
  `ULiveLinkSettings::MessageBusPingRequestFrequency`, `MessageBusHeartbeatFrequency`,
  `MessageBusHeartbeatTimeout`, `MessageBusTimeBeforeRemovingInactiveSource`
  (`LiveLinkSettings.h`:118-130), `DefaultMessageBusSourceMode` (:114).
- Transport: `UUdpMessagingSettings` (`Engine/Plugins/Messaging/UdpMessaging/Source/UdpMessaging/Public/Shared/UdpMessagingSettings.h`)
  `UnicastEndpoint` (:140) and `MulticastEndpoint` (:150); packaged builds need the transport
  enabled, and the header documents the `-UDPMESSAGING_TRANSPORT_UNICAST=` /
  `-UDPMESSAGING_TRANSPORT_MULTICAST=` command-line overrides.

The MetaHuman local sources do **not** use Message Bus — they run in-process. Live Link Face
uses its own TCP control + UDP stream (ports in `live-link-sources.md`), and multicast
`239.255.137.139:27838` only for discovery. On corporate Wi-Fi that blocks multicast, type the
phone's IP; the stream itself is unicast.

---

## Packaged game considerations

- Modules: `MetaHumanLiveLinkSource`, `LiveLinkFaceSource`, `LiveLinkFaceDiscovery`,
  `MetaHumanLocalLiveLinkSource` are **Runtime** (`MetaHumanLiveLink.uplugin`), as are
  `LiveLink`, `LiveLinkComponents`, `LiveLinkMovieScene` and `LiveLinkAnimationCore`. A packaged
  game can host a webcam solver or receive from Live Link Face. `LiveLinkSequencer` (Take
  Recorder source) and all `*Editor` modules are not available.
- Creating sources at runtime: the `ULiveLinkSourceFactory` path works in game
  (`LiveLinkSourceFactory.h`:24 says so explicitly); so do `ULiveLinkFaceSourceBlueprint` and
  `UMetaHumanLocalLiveLinkSourceBlueprint`, which only need the client modular feature.
  Presets (`ULiveLinkPreset::AddToClient`) are `BlueprintType` runtime objects.
- Content: the NNE models under `/MetaHumanCoreTech/RealtimeMono/` and the smoothing data
  assets are plugin content — they are cooked only if referenced or if the plugin's content is
  included; reference them (e.g. a `TSoftObjectPtr<UMetaHumanRealtimeSmoothingParams>` in a
  loaded asset) or add the directories to "Additional Asset Directories to Cook".
- NNE runtime: the solver backend must exist in the build — `NNERuntimeORT` provides
  `NNERuntimeORTDml` (Windows, DirectML) and `NNERuntimeORTCpu`; pick the CPU backend via
  `FMonocularAnimationPipelineModels::NNEBackend` for machines without DirectML and monitor
  `ProcessingRate`.
- Media: webcam capture goes through `MediaFrameworkUtilities` / platform media players
  (WMF on Windows); keep the WmfMedia plugin enabled for packaged webcam capture.
- Timecode: `ELiveLinkSourceMode::Timecode` needs a timecode provider in the game; otherwise
  stay on `EngineTime`.
- Editor-only ticking flags on `ULiveLinkComponentController` (`bUpdateInEditor`) are irrelevant
  in game; `bEvaluateLiveLink` (`LiveLinkComponentController.h`:66) is the runtime pause.
- Thread safety: `PushSubject*_AnyThread` / `EvaluateFrame_AnyThread` are any-thread; source
  and subject management (`AddSource`, `RemoveSource`, `SetSubjectEnabled`, settings edits) must
  stay on the game thread (`ILiveLinkClient.h`:54-58).

---

## Source references (UE 5.9)

`Engine/Plugins/Animation/LiveLink/Source/`:
- `LiveLinkSequencer/Private/TakeRecorderSource/TakeRecorderLiveLinkSource.h`:11 — `FLiveLinkSubjectProperty`; :48 `UTakeRecorderLiveLinkSource`; :58 `bReduceKeys`; :62 `SubjectName`; :66 `bSaveSubjectSettings`; :73 `bUseSourceTimecode`; :77 `bDiscardSamplesBeforeStart`.
- `LiveLinkSequencer/Public/MovieSceneLiveLinkTrackRecorder.h`:27 — `UMovieSceneLiveLinkTrackRecorder`; :48 `CreateTrack`; :61 `OnFrameDataReceived`.
- `LiveLinkSequencer/Public/LiveLinkSequencerSettings.h`:21 — `ULiveLinkSequencerSettings`.
- `LiveLinkSequencer/LiveLinkSequencer.Build.cs`:5 — module dependencies.
- `LiveLinkMovieScene/Public/MovieScene/MovieSceneLiveLinkTrack.h`:15 — `UMovieSceneLiveLinkTrack`; :41 `TrackRole`.
- `LiveLinkMovieScene/Public/MovieScene/MovieSceneLiveLinkSection.h`:27 — `UMovieSceneLiveLinkSection`; :84 `SubjectPreset`.
- `LiveLink/Public/LiveLinkPreset.h`:15 — `ULiveLinkPreset`; :48 `ApplyToClientLatent`; :62 `AddToClient`; :66 `BuildFromClient`.
- `LiveLink/Public/LiveLinkSettings.h`:27 — `FLiveLinkRoleProjectSetting`; :71 `ULiveLinkSettings`; :84 `DefaultRoleSettings`; :96 `DefaultLiveLinkPreset`; :114 `DefaultMessageBusSourceMode`; :126 `MessageBusHeartbeatTimeout`; :134 `bReEnableSubjectOnRemoval`.
- `LiveLink/Public/LiveLinkMessageBusSourceFactory.h`:15 — `ULiveLinkMessageBusSourceFactory`.
- `LiveLink/Public/LiveLinkMessageBusSourceSettings.h`:19 — `ULiveLinkMessageBusSourceSettings`.
- `LiveLink/Public/LiveLinkMessageBusFinder.h`:24 — `FProviderPollResult`; :83 `ULiveLinkMessageBusFinder`.
- `LiveLink/Public/LiveLinkMessageBusDiscoveryManager.h`:17 — `FLiveLinkMessageBusDiscoveryManager`.
- `LiveLink/Public/InterpolationProcessor/LiveLinkBasicFrameInterpolateProcessor.h`:15 — `ULiveLinkBasicFrameInterpolationProcessor`; :54 `bInterpolatePropertyValues`.
- `LiveLinkComponents/Public/LiveLinkComponentController.h`:62 — `bDisableEvaluateLiveLinkWhenSpawnable`; :66 `bEvaluateLiveLink`.

`Engine/Source/Runtime/`:
- `LiveLinkInterface/Public/LiveLinkSourceSettings.h`:24 — `ULiveLinkDefaultSourceSettings`; :40 `ELiveLinkSourceMode`; :60 `FLiveLinkSourceBufferManagementSettings`; :161 `ULiveLinkSourceSettings`; :173 `Mode`; :177 `BufferSettings`; :185 `ConnectionString`; :198 `ParentSubject`.
- `LiveLinkInterface/Public/LiveLinkSubjectSettings.h`:83 — `InterpolationProcessor`.
- `LiveLinkInterface/Public/LiveLinkFrameInterpolationProcessor.h`:20 — `FLiveLinkInterpolationInfo`; :61 `ULiveLinkFrameInterpolationProcessor`.
- `LiveLinkInterface/Public/LiveLinkPresetTypes.h`:18 — `FLiveLinkSourcePreset`; :35 `FLiveLinkSubjectPreset`.
- `LiveLinkInterface/Public/ILiveLinkClient.h`:54 — threading contract; :366 `RegisterForSubjectFrames`.
- `LiveLinkInterface/Public/ILiveLinkSource.h`:46 — `RequestSourceShutdown`.
- `LiveLinkMessageBusFramework/Public/LiveLinkProvider.h` — `ILiveLinkProvider`.

`Engine/Plugins/VirtualProduction/Takes/Source/`:
- `TakeRecorder/Public/Recorder/TakeRecorderBlueprintLibrary.h`:25 — `UTakeRecorderBlueprintLibrary`; :48 `StartRecording`; :55 `GetDefaultParameters`; :82 `StopRecording`; :103 `OpenTakeRecorderPanel`.
- `TakeRecorder/Public/Recorder/TakeRecorderPanel.h`:34 — `UTakeRecorderPanel`; :83 `ClearPendingTake`; :131 `GetSources`; :138 `StartRecording`; :151 `CanStartRecording`.
- `TakeRecorder/Public/Recorder/TakeRecorderParameters.h`:18 — `FTakeRecorderUserParameters`; :73 `FTakeRecorderProjectParameters`; :88 `RootTakeSaveDir`; :102 `TakeSaveDir`; :184 `FTakeRecorderParameters`.
- `TakeRecorder/Public/Recorder/TakeRecorder.h`:37 — `ETakeRecorderState`; :71 `UTakeRecorder`; :149 `Initialize`.
- `TakesCore/Public/TakeRecorderSources.h`:54 — `UTakeRecorderSources`; :80 `AddSource`.
- `TakesCore/Public/TakeRecorderSource.h`:31 — `UTakeRecorderSource`.
- `TakesCore/Public/TakeMetaData.h`:214 — `SetSlate`; :222 `SetTakeNumber`.
- `TakeRecorderSources/Public/TakeRecorderActorSource.h`:33 — `ETakeRecorderActorRecordType`; :45 `UTakeRecorderActorSource`; :142 `AddSourceForActor`.
- `TakeTrackRecorders/Public/TrackRecorders/MovieSceneAnimationTrackRecorderSettings.h`:16 — `UMovieSceneAnimationTrackRecorderEditorSettings`.
- `TakeTrackRecorders/Public/TrackRecorders/MovieSceneAnimationTrackRecorder.h`:45 — `UMovieSceneAnimationTrackRecorder`; :72 `GetAnimSequence`.

Other:
- `Engine/Plugins/Messaging/UdpMessaging/Source/UdpMessaging/Public/Shared/UdpMessagingSettings.h`:140 — `UnicastEndpoint`; :150 `MulticastEndpoint`.
- `Engine/Plugins/MetaHuman/MetaHumanLiveLink/Source/MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSourceSettings.h`:33 — `bIsPreset`.
- `Engine/Plugins/MetaHuman/MetaHumanLiveLink/Source/LiveLinkFaceSource/Private/LiveLinkFaceSource.cpp`:100 — preset reconnect.
