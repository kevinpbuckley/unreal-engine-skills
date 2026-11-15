---
name: ue-metahuman-live-link
description: Streams real-time facial animation onto a MetaHuman in Unreal Engine 5.8 and 5.9 through
  Live Link — the MetaHuman Live Link plugin's three sources (MetaHuman Video from a webcam,
  MetaHuman Audio from a microphone, Live Link Face from an iPhone in MetaHuman Animator or
  ARKit mode), programmatic source/subject creation (ILiveLinkClient::AddSource,
  ULiveLinkSourceFactory, ULiveLinkPreset, ULiveLinkBlueprintLibrary,
  UMetaHumanLocalLiveLinkSourceBlueprint, ULiveLinkFaceSourceBlueprint), subject settings
  (UMetaHumanLiveLinkSubjectSettings calibration, smoothing, head pose), binding a subject to
  an assembled MetaHuman (LiveLinkSetup / LLink_Face_Subj, FAnimNode_LiveLinkPose,
  ULiveLinkComponentController), Take Recorder (UTakeRecorderLiveLinkSource,
  UTakeRecorderActorSource) and packaged-game behaviour. Use when wiring a live performer to a
  MetaHuman face, debugging a subject with no data or the wrong role (Basic vs Animation
  Role), tuning latency/smoothing, or recording a live take to an AnimSequence.
metadata:
  aliases: "MetaHuman Live Link, Live Link Face, live facial capture, webcam face tracking"
  engine-version: "5.9"
  category: metahuman
---

# MetaHuman Live Link

Live Link is Unreal's generic real-time data bus: **sources** push timestamped **frames** for
named **subjects**, each subject has a **role** that defines its data layout, and consumers
(AnimBPs, components, Sequencer) evaluate the latest or time-synced frame every tick. The
**MetaHuman Live Link** plugin (`Engine/Plugins/MetaHuman/MetaHumanLiveLink/`) adds sources
that produce MetaHuman facial animation — the same raw-control curves a MetaHuman Animator
performance produces — either by running the realtime solver locally on webcam/microphone
input or by receiving it from the Live Link Face iOS app.

## When to use this skill

- Driving an assembled MetaHuman's face live from a webcam, a microphone, or an iPhone.
- Creating Live Link sources and subjects from Python or C++ instead of the Live Link panel,
  including presets that re-create a rig on editor start.
- Binding a subject to a placed MetaHuman actor and understanding what the generated character
  Blueprint and `ABP_MH_LiveLink` actually read.
- Recording a live session to a Level Sequence / AnimSequence with Take Recorder.
- Diagnosing: subject shows `Unresponsive`, face does not move but head does, the head moves
  twice as much as it should, jittery curves, or Live Link in a packaged build.

For offline MetaHuman Animator processing (footage ingest, Identity, Performance) see
`ue-metahuman-animator`.

## Mental model

| Concept | Type (header) | What to remember |
|---|---|---|
| Client | `ILiveLinkClient` (`ILiveLinkClient.h`:60) | Modular feature `ILiveLinkClient::ModularFeatureName`; owns sources and subjects; frame push/evaluate is any-thread, everything else game thread. |
| Source | `ILiveLinkSource` (`ILiveLinkSource.h`:15) | Non-UObject, shared-ptr owned. Created directly or via a `ULiveLinkSourceFactory` (`LiveLinkSourceFactory.h`:27) from a connection string. |
| Source settings | `ULiveLinkSourceSettings` (`LiveLinkSourceSettings.h`:161) | `Mode` (`ELiveLinkSourceMode` Latest / EngineTime / Timecode) and `BufferSettings` control latency and interpolation. |
| Subject | `FLiveLinkSubjectKey` = source GUID + `FLiveLinkSubjectName` (`LiveLinkTypes.h`:77) | Only one subject per *name* may be enabled across sources; consumers address subjects by name. |
| Role | `ULiveLinkRole` subclasses (`LiveLinkRole.h`:17) | Every MetaHuman Live Link subject uses **`ULiveLinkBasicRole`** (`Roles/LiveLinkBasicRole.h`:20): static `PropertyNames` + per-frame `PropertyValues`. Not the Animation Role. |
| Subject settings | `ULiveLinkSubjectSettings` → `ULiveLinkHubSubjectSettings` → `UMetaHumanLiveLinkSubjectSettings` | Pre-processors, interpolation, translators, remapper live here; the MetaHuman subclass adds calibration, smoothing and head-pose neutrals. |

Every MetaHuman source pushes the same static layout: the rig's raw control names followed by
`HeadControlSwitch`, `HeadRoll`, `HeadPitch`, `HeadYaw`, `HeadTranslationX/Y/Z`, `MHFDSVersion`
and `DisableFaceOverride` (`MetaHumanLocalLiveLinkSubject.cpp`:198-210 and
`LiveLinkFaceSource.cpp`:484-493). Head rotation is therefore **curve data**, not a transform;
`ABP_MH_LiveLink` turns those curves into head-bone rotation, gated by `HeadControlSwitch`.

### The three sources (plugin `MetaHumanLiveLink`)

| Source | Factory (menu name) | Module | Input | Notes |
|---|---|---|---|---|
| **MetaHuman (Video)** | `UMetaHumanVideoLiveLinkSourceFactory` | `MetaHumanLocalLiveLinkSource` | Webcam / capture card / Media Bundle / movie file | Runs the monocular realtime solver (`FHyprsenseRealtimeNode`) locally through NNE. |
| **MetaHuman (Audio)** | `UMetaHumanAudioLiveLinkSourceFactory` | `MetaHumanLocalLiveLinkSource` | Microphone / audio capture device | Audio-driven animation (`FRealtimeSpeechToAnimNode`) with mood and lookahead controls. |
| **Live Link Face** | `ULiveLinkFaceSourceFactory` | `LiveLinkFaceSource` + `LiveLinkFaceDiscovery` | iPhone running Live Link Face | Device solves; UE receives UDP frames. App streams either **MetaHuman Animator** (`Mha`) or **ARKit** (`ArKit`) animation (`LiveLinkFaceControl.h`:20-24). |

The legacy **Apple ARKit** source (`UAppleARKitLiveLinkSourceFactory`,
`Engine/Plugins/Runtime/AR/AppleAR/AppleARKitFaceSupport/`) still exists for the app's old
"Live Link (ARKit)" streaming on UDP port 11111; it publishes the 52 `EARFaceBlendShape`
curves plus head yaw/pitch/roll, also as Basic Role. Prefer the MetaHuman Live Link path.

Plugin dependencies that must be enabled (`MetaHumanLiveLink.uplugin`): LiveLink, LiveLinkHub,
MediaFrameworkUtilities, CaptureManagerCore, MetaHumanCoreTech, **NNERuntimeORT**.

## Core workflow

1. **Enable plugins**: MetaHuman Live Link (pulls in Live Link, Live Link Hub, NNERuntimeORT).
   The assembled character also needs the `LiveLink` module loaded — the MetaHuman import
   path refuses a CharacterAssembly otherwise (`MetaHumanPackageFactory.cpp`:182).
2. **Create a source** (Live Link panel, Python, or C++). Video and Audio sources are empty
   containers; you then **request a subject** on them with a device/format and a subject name.
   Live Link Face connects to one phone (address + control port 14785) and creates the
   subject itself once streaming starts.
3. **Check the subject** is enabled and `ELiveLinkSubjectState::Connected`
   (`ILiveLinkClient.h`:27). Its role must be `ULiveLinkBasicRole`.
4. **Calibrate**: with the performer neutral, call `CaptureNeutrals()` on the subject
   settings (captures a neutral frame for curve calibration and a neutral head pose).
5. **Bind the character**: set the MetaHuman actor's Live Link subject (the `LiveLinkSetup`
   function on the generated Blueprint, or `LLink_Face_Subj` on `ABP_MH_LiveLink`), or use a
   `FAnimNode_LiveLinkPose` in your own face AnimBP.
6. **Tune**: `ULiveLinkSourceSettings::Mode` + `BufferSettings` for latency, the subject's
   `UMetaHumanRealtimeSmoothingParams` for jitter, `bHeadOrientation` / `bHeadTranslation`
   when head motion comes from body mocap.
7. **Record**: Take Recorder with a Live Link source (raw curves into a Live Link track) and/or
   an Actor source on the MetaHuman (baked AnimSequence on the Face skeletal mesh).

## C++ patterns

### Get the client and add a source

```cpp
#include "Features/IModularFeatures.h"
#include "ILiveLinkClient.h"
#include "ILiveLinkSource.h"
#include "LiveLinkSourceFactory.h"

ILiveLinkClient* GetLiveLinkClient()
{
    IModularFeatures& Features = IModularFeatures::Get();
    if (!Features.IsModularFeatureAvailable(ILiveLinkClient::ModularFeatureName))
    {
        return nullptr;
    }
    return &Features.GetModularFeature<ILiveLinkClient>(ILiveLinkClient::ModularFeatureName);
}

// Factory classes in MetaHumanLiveLink are private headers; find them by reflection.
FGuid AddSourceFromFactory(ILiveLinkClient& Client, const TCHAR* FactoryClassName, const FString& ConnectionString)
{
    UClass* FactoryClass = FindFirstObject<UClass>(FactoryClassName, EFindFirstObjectOptions::ExactClass);
    const ULiveLinkSourceFactory* Factory = FactoryClass ? GetDefault<ULiveLinkSourceFactory>(FactoryClass) : nullptr;
    TSharedPtr<ILiveLinkSource> Source = Factory ? Factory->CreateSource(ConnectionString) : nullptr;
    return Source.IsValid() ? Client.AddSource(Source) : FGuid();   // ILiveLinkClient.h:70
}
// e.g. AddSourceFromFactory(*Client, TEXT("MetaHumanVideoLiveLinkSourceFactory"), TEXT(""));
//      AddSourceFromFactory(*Client, TEXT("LiveLinkFaceSourceFactory"), TEXT("192.168.1.20:14785"));
```

`AddSource` calls `ILiveLinkSource::ReceiveClient`, instantiates `GetSettingsClass()` and then
`InitializeSettings` (`ILiveLinkSource.h`:21-27). For the Live Link Face source the connection
string is `ADDRESS:PORT`; a valid address triggers an immediate connect
(`LiveLinkFaceSourceSettings.h`:19, `LiveLinkFaceSource.cpp`:100-112).

### Request a video subject on a MetaHuman (Video) source

```cpp
#include "MetaHumanVideoLiveLinkSourceSettings.h"
#include "MetaHumanVideoLiveLinkSubjectSettings.h"

FLiveLinkSubjectKey AddWebcamSubject(ILiveLinkClient& Client, FGuid VideoSourceGuid,
                                     const FString& DeviceName, const FString& DeviceUrl,
                                     int32 Track, int32 Format, const FString& SubjectName)
{
    auto* SourceSettings = Cast<UMetaHumanVideoLiveLinkSourceSettings>(Client.GetSourceSettings(VideoSourceGuid)); // ILiveLinkClient.h:240
    if (!SourceSettings) { return FLiveLinkSubjectKey(); }

    auto* SubjectSettings = NewObject<UMetaHumanVideoLiveLinkSubjectSettings>(GetTransientPackage());
    SubjectSettings->MediaSourceCreateParams.VideoName        = DeviceName;   // MetaHumanMediaSourceCreateParams.h:17
    SubjectSettings->MediaSourceCreateParams.VideoURL         = DeviceUrl;
    SubjectSettings->MediaSourceCreateParams.VideoTrack       = Track;
    SubjectSettings->MediaSourceCreateParams.VideoTrackFormat = Format;
    SubjectSettings->MonocularAnimationPipelineModels = SourceSettings->MonocularAnimationPipelineModels; // defaults
    SubjectSettings->Setup();                                                  // MetaHumanLocalLiveLinkSubjectSettings.h:40

    return SourceSettings->RequestSubjectCreation(SubjectName, SubjectSettings); // MetaHumanLocalLiveLinkSourceSettings.h:30
}
```

This is exactly what `UMetaHumanLocalLiveLinkSourceBlueprint::CreateVideoSubject` does
(`MetaHumanLocalLiveLinkSourceBlueprint.cpp`:489-528). Audio subjects mirror it with
`UMetaHumanAudioLiveLinkSubjectSettings` (`AudioName/AudioURL/AudioTrack/AudioTrackFormat`).

### Enumerate, check and evaluate subjects

```cpp
#include "Roles/LiveLinkBasicRole.h"
#include "Roles/LiveLinkBasicTypes.h"

for (const FLiveLinkSubjectKey& Key : Client.GetSubjects(/*bIncludeDisabled*/false, /*bIncludeVirtual*/false)) // :174
{
    const bool bBasic = Client.GetSubjectRole_AnyThread(Key) == ULiveLinkBasicRole::StaticClass();           // :153
    const ELiveLinkSubjectState State = Client.GetSubjectState(Key.SubjectName);                            // :226
    UE_LOG(LogTemp, Display, TEXT("%s basic=%d state=%d"), *Key.SubjectName.ToString(), bBasic, (int32)State);
}

FLiveLinkSubjectFrameData Frame;                                   // LiveLinkTypes.h:526
if (Client.EvaluateFrame_AnyThread(SubjectName, ULiveLinkBasicRole::StaticClass(), Frame)) // :282
{
    const FLiveLinkBaseStaticData* Static = Frame.StaticData.Cast<FLiveLinkBaseStaticData>();
    const FLiveLinkBaseFrameData*  Data   = Frame.FrameData.Cast<FLiveLinkBaseFrameData>();
    float JawOpen = 0.f;
    Static->FindPropertyValue(*Data, TEXT("CTRL_expressions_jawOpen"), JawOpen);          // LiveLinkTypes.h:265
}
```

`EvaluateFrame_AnyThread` returns the per-tick snapshot and is stable within a frame; use
`EvaluateFrameAtWorldTime_AnyThread` / `EvaluateFrameAtSceneTime_AnyThread`
(`ILiveLinkClient.h`:292, :305) for explicit time sampling.

### Drive subject settings at runtime

```cpp
#include "MetaHumanLiveLinkSubjectSettings.h"
#include "MetaHumanVideoBaseLiveLinkSubjectSettings.h"

if (auto* S = Cast<UMetaHumanLiveLinkSubjectSettings>(Client.GetSubjectSettings(Key)))   // ILiveLinkClient.h:252
{
    S->CaptureNeutrals();                 // neutral frame + neutral head pose, :113
    S->SetCalibrationAlpha(0.8f);         // 0..1 blend of the calibration, :57
    S->SetSmoothing(MySmoothingParams);   // UMetaHumanRealtimeSmoothingParams data asset, :79
}
// Video-only: head output toggles live on UMetaHumanVideoBaseLiveLinkSubjectSettings
if (auto* V = Cast<UMetaHumanVideoBaseLiveLinkSubjectSettings>(Client.GetSubjectSettings(Key)))
{
    V->SetHeadOrientation(false);         // head comes from body mocap instead, :58
    V->SetHeadTranslation(false);         // :68
}
```

All of these are `UFUNCTION(BlueprintCallable)`, so they are reachable from Python as well.

### Bind a subject with ULiveLinkComponentController (non-AnimBP consumers)

```cpp
#include "LiveLinkComponentController.h"
#include "Roles/LiveLinkTransformRole.h"

ULiveLinkComponentController* LL = Actor->FindComponentByClass<ULiveLinkComponentController>();
FLiveLinkSubjectRepresentation Rep(FLiveLinkSubjectName(TEXT("HeadTracker")), ULiveLinkTransformRole::StaticClass()); // LiveLinkRole.h:35
LL->SetSubjectRepresentation(Rep);                              // LiveLinkComponentController.h:90 — rebuilds ControllerMap
LL->SetControlledComponent(ULiveLinkTransformRole::StaticClass(), HeadSceneComponent); // :104
```

The controller map (`ControllerMap`, :41) picks a `ULiveLinkControllerBase` per role via
`IsRoleSupported` (`LiveLinkControllerBase.h`:44). The engine ships Transform, Light, Camera
and Lens controllers; **there is no face/Basic Role controller** — MetaHuman face curves are
consumed by the AnimBP (`FAnimNode_LiveLinkPose`), not by this component. Use the component
for a Transform-role head/body tracker and leave the face to the AnimBP.

## Python patterns

```python
import unreal

# --- MetaHuman (Video) source + webcam subject -----------------------------------
devices = unreal.MetaHumanLocalLiveLinkSourceBlueprint.get_video_devices(include_media_bundles=False)
cam = next(d for d in devices if "Logitech" in d.name)
tracks, timed_out = unreal.MetaHumanLocalLiveLinkSourceBlueprint.get_video_tracks(cam, timeout=5.0)
formats, timed_out = unreal.MetaHumanLocalLiveLinkSourceBlueprint.get_video_formats(tracks[0], filter_formats=True, timeout=5.0)
fmt = max(formats, key=lambda f: (f.resolution.x * f.resolution.y, f.frame_rate))

video_source, ok = unreal.MetaHumanLocalLiveLinkSourceBlueprint.create_video_source()
subject_key, ok = unreal.MetaHumanLocalLiveLinkSourceBlueprint.create_video_subject(
    video_source, fmt, "Webcam", start_timeout=5.0, format_wait_time=0.1, sample_timeout=5.0)

# --- Live Link Face (iPhone) --------------------------------------------------------
face_source, ok = unreal.LiveLinkFaceSourceBlueprint.create_live_link_face_source()
ok = unreal.LiveLinkFaceSourceBlueprint.connect(face_source, "Performer", "192.168.1.20", port=14785)

# --- Inspect ---------------------------------------------------------------------------
for key in unreal.LiveLinkBlueprintLibrary.get_live_link_subjects(include_disabled_subject=True, include_virtual_subject=False):
    role  = unreal.LiveLinkBlueprintLibrary.get_specific_live_link_subject_role(key)
    state = unreal.LiveLinkBlueprintLibrary.get_live_link_subject_state(key.subject_name)
    print(key.subject_name.name, role, state)

settings = unreal.MetaHumanLocalLiveLinkSourceBlueprint.get_subject_settings(subject_key)
settings.capture_neutrals()
```

Out-parameters come back as a tuple in declaration order (`create_video_source()` →
`(video_source, succeeded)`). A `ULiveLinkPreset` restores a whole rig:
`preset.add_to_client(recreate_presets=True)` (`LiveLinkPreset.h`:62) or the latent
`apply_to_client_latent` which first removes every existing source (:48).

## Worked example — webcam to a placed MetaHuman, then record a take

Editor-side Python; every call is checked against the headers cited above.

```python
import unreal

SUBJECT = "Webcam"

# 1. Source + subject (see Python patterns above for device discovery)
devices = unreal.MetaHumanLocalLiveLinkSourceBlueprint.get_video_devices(include_media_bundles=False)
tracks, _ = unreal.MetaHumanLocalLiveLinkSourceBlueprint.get_video_tracks(devices[0], timeout=5.0)
formats, _ = unreal.MetaHumanLocalLiveLinkSourceBlueprint.get_video_formats(tracks[0], filter_formats=True, timeout=5.0)
video_source, ok = unreal.MetaHumanLocalLiveLinkSourceBlueprint.create_video_source()
assert ok, "Live Link client unavailable"
subject_key, ok = unreal.MetaHumanLocalLiveLinkSourceBlueprint.create_video_subject(video_source, formats[0], SUBJECT)
assert ok, "no subject created"

# 2. Spawn the assembled MetaHuman and point it at the subject.
#    The generated Blueprint exposes a LiveLinkSetup function (verified by the MetaHuman SDK)
#    that switches the Face component to ABP_MH_LiveLink and writes LLink_Face_Subj.
bp_class = unreal.EditorAssetLibrary.load_blueprint_class("/Game/MetaHumans/Ada/BP_Ada")
actor = unreal.EditorLevelLibrary.spawn_actor_from_class(bp_class, unreal.Vector(0, 0, 0))
try:
    actor.call_method("LiveLinkSetup")
except Exception:
    pass  # older template without the function: fall through to the AnimBP variable
face = next(c for c in actor.get_components_by_class(unreal.SkeletalMeshComponent) if c.get_name() == "Face")
ll_abp = unreal.load_class(None, "/MetaHumanCharacter/Animation/ABP_MH_LiveLink.ABP_MH_LiveLink_C")
face.set_anim_instance_class(ll_abp)
face.get_anim_instance().set_editor_property("LLink_Face_Subj", unreal.LiveLinkSubjectName(SUBJECT))

# 3. Neutral calibration once the performer is still
unreal.MetaHumanLocalLiveLinkSourceBlueprint.get_subject_settings(subject_key).capture_neutrals()

# 4. Take Recorder: curves (Live Link source) + baked face/body (Actor source)
panel = unreal.TakeRecorderBlueprintLibrary.open_take_recorder_panel()      # TakeRecorderBlueprintLibrary.h:103
panel.clear_pending_take()                                                   # TakeRecorderPanel.h:83
sources = panel.get_sources()                                                # TakeRecorderPanel.h:131
ll_src = sources.add_source(unreal.TakeRecorderLiveLinkSource)               # TakeRecorderSources.h:80
ll_src.set_editor_property("subject_name", SUBJECT)                          # TakeRecorderLiveLinkSource.h:62
ll_src.set_editor_property("save_subject_settings", True)                    # :66
actor_src = unreal.TakeRecorderActorSource.add_source_for_actor(actor, sources) # TakeRecorderActorSource.h:142
panel.get_take_meta_data().set_slate("WebcamTest")                           # TakeMetaData.h:214
ok, err = panel.can_start_recording(unreal.Text(""))                         # TakeRecorderPanel.h:151
assert ok, str(err)
panel.start_recording()                                                      # TakeRecorderPanel.h:138
# ... later: panel.stop_recording()  -> Level Sequence under Project Settings > Take Recorder > Root Take Save Dir
```

`LiveLinkSetup` is the function name the MetaHuman verifier looks for on the character
Blueprint (`VerifyMetaHumanCharacter.cpp`:476-510); the editor's own preview path writes the
same `LLink_Face_Subj` property (`MetaHumanInvisibleDrivingActor.cpp`:55-64). What lands on
disk after recording is covered in [references/recording-and-runtime.md](references/recording-and-runtime.md).

## Gotchas & edge cases

- **Role mismatch.** Every MetaHuman source is `ULiveLinkBasicRole`. A `FAnimNode_LiveLinkPose`
  still works (it falls back to `BuildPoseFromCurveData`, `AnimNode_LiveLinkPose.h`:71) but
  `GetAnimationFrameData`, `ULiveLinkTransformController` and anything requesting the Animation
  or Transform role silently evaluates nothing. Query with `ULiveLinkBasicRole`.
- **ARKit vs MetaHuman Animator stream.** The Live Link Face app can stream either; the UE
  source reports which via `FRemoteSubject::AnimationType` and the `MHFDSVersion` curve. ARKit
  frames carry 52 blendshapes and must go through the `ARKit_Mapping` remap in
  `ABP_MH_LiveLink`; MHA frames are raw rig controls consumed directly. Mixing them yields a
  face that only half-animates.
- **Head moves twice.** Head rotation arrives as curves *and* the body may already be driven by
  mocap. Disable `bHeadOrientation` / `bHeadTranslation` on the subject settings (video:
  `MetaHumanVideoBaseLiveLinkSubjectSettings.h`:55/:65, phone:
  `LiveLinkFaceSubjectSettings.h`:17/:26); the source then sends `HeadControlSwitch = 0`
  (`LiveLinkFaceSource.cpp`:392) so the rig ignores head curves.
- **Head translation needs a neutral.** Translation is camera-relative and only meaningful
  after `CaptureNeutralHeadPose()`; `NeutralHeadPoseInverse` is identity until then
  (`MetaHumanLiveLinkSubjectSettings.h`:107).
- **Smoothing defaults are light.** Settings load `/MetaHumanCoreTech/RealtimeMono/DefaultSmoothing`
  (`MetaHumanLiveLinkSubjectSettings.cpp`:21); a `HeavySmoothing` asset ships alongside. Per
  property you choose `RollingAverage` (frames) or `OneEuro` (slope / min cutoff)
  (`MetaHumanRealtimeSmoothing.h`:18-41). More smoothing = more latency.
- **Discovery is multicast.** Phone discovery uses `239.255.137.139:27838`
  (`DiscoveryCommunication.cpp`:10-11); the control link is TCP on the phone's port
  (default 14785) and frames come back on UDP to a port UE picks. Phone and PC must share a
  subnet that permits multicast; otherwise type the IP manually.
- **App version.** The `Mha` animation type and the CPS control protocol require a Live Link
  Face build that offers the MetaHuman Animator capture mode; older ARKit-only builds appear
  only through the legacy Apple ARKit source (port 11111) and never as "Live Link Face".
- **Current rig required.** Raw control names in the stream must exist on the character's
  face rig; a pre-5.6 (Quixel Bridge) MetaHuman needs re-assembly or the legacy
  `BP_MetaHuman_Legacy*` templates (`MetaHumanCharacter/Content/BuildPipeline/`) whose
  `LiveLinkSetup` and `ABP_MH_LiveLink` handle the mapping.
- **Subject name collisions.** Only one subject per name is enabled; adding a second source
  with the same subject name shadows the first (`ILiveLinkClient.h`:188-214). Set
  `bReEnableSubjectOnRemoval` (`LiveLinkSettings.h`:134) if you hot-swap devices.
- **NNE backend.** The video solver defaults to `NNERuntimeORTDml` on Windows and
  `NNERuntimeCoreML` on Mac (`HyprsenseRealtimeNode.cpp`:37-47); override with the
  `MonocularAnimationPipelineModels.NNEBackend` string, e.g. `NNERuntimeORTCpu` on a machine
  without a DirectML-capable GPU.
- **`bIsLiveProcessing` hides controls.** Subject settings reused by Take Recorder playback set
  it false (`MetaHumanLiveLinkSubjectSettings.h`:29-38); calibration/head controls disappear
  from the details panel because they cannot apply to recorded data.
- **Editor-only recording.** `LiveLinkSequencer` (Take Recorder Live Link source) is
  `UncookedOnly`; `LiveLinkComponents`, `LiveLinkMovieScene` and the MetaHuman source modules
  are `Runtime` and work in packaged builds.

---

## References & source material

Engine source (UE 5.9, `Engine/Plugins/MetaHuman/MetaHumanLiveLink/Source/`):
- `MetaHumanLiveLinkSource/Public/MetaHumanLiveLinkSubjectSettings.h`:15 — `UMetaHumanLiveLinkSubjectSettings` (calibration `Properties`/`Alpha`/`NeutralFrame`, smoothing `Parameters`, `CaptureNeutrals()`, head neutrals).
- `MetaHumanLiveLinkSource/Public/MetaHumanLiveLinkSubjectSettings.h`:141 — `EMetaHumanLiveLinkHeadPoseMode`.
- `MetaHumanLiveLinkSource/Public/MetaHumanSmoothingPreProcessor.h`:12 — `UMetaHumanSmoothingPreProcessor` (`ULiveLinkFramePreProcessor` variant).
- `MetaHumanLiveLinkSource/Public/MetaHumanLiveLinkSourceBlueprint.h`:12 — `UMetaHumanLiveLinkSourceBlueprint::SubjectAdded` delegate.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSource.h`:15 — `FMetaHumanLocalLiveLinkSource` (`RequestSubjectCreation`, `CreateSubject`).
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSourceSettings.h`:23 — `UMetaHumanLocalLiveLinkSourceSettings::RequestSubjectCreation`, `bIsPreset`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSourceBlueprint.h`:130 — `UMetaHumanLocalLiveLinkSourceBlueprint` (device/track/format enumeration, `CreateVideoSource`, `CreateVideoSubject`, `CreateAudioSource`, `CreateAudioSubject`, `GetSubjectSettings`).
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanLocalLiveLinkSubjectSettings.h`:34 — `UMetaHumanLocalLiveLinkSubjectSettings` (state, FPS, `ReloadSubject`, `RemoveSubject`).
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanVideoBaseLiveLinkSubjectSettings.h`:31 — `UMetaHumanVideoBaseLiveLinkSubjectSettings` (head toggles, `MonitorImage`, `Rotation`, `MonocularAnimationPipelineModels`).
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanVideoLiveLinkSourceSettings.h`:14 — `UMetaHumanVideoLiveLinkSourceSettings`.
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanAudioBaseLiveLinkSubjectSettings.h`:13 — `UMetaHumanAudioBaseLiveLinkSubjectSettings` (`Mood`, `MoodIntensity`, `Lookahead`).
- `MetaHumanLocalLiveLinkSource/Public/MetaHumanMediaSourceCreateParams.h`:10 — `FMetaHumanMediaSourceCreateParams`.
- `MetaHumanLocalLiveLinkSource/Private/MetaHumanVideoLiveLinkSourceFactory.h`:12 — `UMetaHumanVideoLiveLinkSourceFactory`.
- `MetaHumanLocalLiveLinkSource/Private/MetaHumanAudioLiveLinkSourceFactory.h`:12 — `UMetaHumanAudioLiveLinkSourceFactory`.
- `MetaHumanLocalLiveLinkSource/Private/MetaHumanLocalLiveLinkSubject.cpp`:198 — static property layout; :236 head pose curves.
- `LiveLinkFaceSource/Public/LiveLinkFaceSourceBlueprint.h`:13 — `ULiveLinkFaceSourceBlueprint::CreateLiveLinkFaceSource`, `Connect` (port 14785).
- `LiveLinkFaceSource/Public/LiveLinkFaceSourceSettings.h`:13 — `ULiveLinkFaceSourceSettings` (`ADDRESS:PORT` connection string).
- `LiveLinkFaceSource/Public/LiveLinkFaceSourceDefaults.h`:12 — `ULiveLinkFaceSourceDefaults` (project-wide head toggles).
- `LiveLinkFaceSource/Private/LiveLinkFaceSourceFactory.h`:12 — `ULiveLinkFaceSourceFactory`.
- `LiveLinkFaceSource/Private/LiveLinkFaceSubjectSettings.h`:10 — `ULiveLinkFaceSubjectSettings`.
- `LiveLinkFaceSource/Private/LiveLinkFaceControl.h`:18 — `FRemoteSubject` (`EAnimationType::ArKit` / `Mha`).
- `LiveLinkFaceSource/Private/LiveLinkFaceSource.cpp`:300 — Basic Role subject creation; :484 static layout.
- `LiveLinkFaceDiscovery/Public/LiveLinkFaceDiscovery.h`:20 — `FLiveLinkFaceDiscovery` (`FServer`, `OnServersUpdated`).

Engine source (UE 5.9, `Engine/Source/Runtime/LiveLinkInterface/Public/`):
- `ILiveLinkClient.h`:60 — `ILiveLinkClient` (`AddSource` :70, `GetSubjects` :174, `GetSubjectState` :226, `GetSubjectSettings` :252, `EvaluateFrame_AnyThread` :282).
- `ILiveLinkSource.h`:15 — `ILiveLinkSource`; :77 `FLiveLinkSourceHandle`.
- `LiveLinkSourceFactory.h`:27 — `ULiveLinkSourceFactory::CreateSource`.
- `LiveLinkSourceSettings.h`:40 — `ELiveLinkSourceMode`; :60 `FLiveLinkSourceBufferManagementSettings`; :161 `ULiveLinkSourceSettings`.
- `LiveLinkSubjectSettings.h`:53 — `ULiveLinkSubjectSettings`.
- `LiveLinkTypes.h`:77 — `FLiveLinkSubjectKey`; :216 `FLiveLinkBaseFrameData`; :256 `FLiveLinkBaseStaticData`.
- `LiveLinkRole.h`:17 — `ULiveLinkRole`; :35 `FLiveLinkSubjectRepresentation`.
- `Roles/LiveLinkBasicRole.h`:20 — `ULiveLinkBasicRole`.
- `LiveLinkPresetTypes.h`:18 — `FLiveLinkSourcePreset`; :35 `FLiveLinkSubjectPreset`.

Engine source (UE 5.9, `Engine/Plugins/Animation/LiveLink/Source/`):
- `LiveLink/Public/LiveLinkBlueprintLibrary.h`:29 — `ULiveLinkBlueprintLibrary`.
- `LiveLink/Public/LiveLinkPreset.h`:15 — `ULiveLinkPreset` (`AddToClient`, `ApplyToClientLatent`, `BuildFromClient`).
- `LiveLink/Public/LiveLinkHubSubjectSettings.h`:16 — `ULiveLinkHubSubjectSettings`.
- `LiveLink/Public/LiveLinkSettings.h`:71 — `ULiveLinkSettings`.
- `LiveLinkComponents/Public/LiveLinkComponentController.h`:22 — `ULiveLinkComponentController`.
- `LiveLinkComponents/Public/LiveLinkControllerBase.h`:20 — `ULiveLinkControllerBase`.
- `LiveLinkSequencer/Private/TakeRecorderSource/TakeRecorderLiveLinkSource.h`:48 — `UTakeRecorderLiveLinkSource`.

Engine source (UE 5.9, other):
- `Engine/Source/Runtime/LiveLinkAnimationCore/Public/AnimNode_LiveLinkPose.h`:23 — `FAnimNode_LiveLinkPose`.
- `Engine/Plugins/MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanCoreTech/Public/MetaHumanRealtimeSmoothing.h`:45 — `UMetaHumanRealtimeSmoothingParams`.
- `Engine/Plugins/MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanPipelineCore/Public/Nodes/HyprsenseRealtimeNode.h`:59 — `FMonocularAnimationPipelineModels`.
- `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterEditor/Public/MetaHumanInvisibleDrivingActor.h`:17 — `AMetaHumanInvisibleDrivingActor` (editor preview Live Link binding).
- `Engine/Plugins/MetaHuman/MetaHumanSDK/Source/MetaHumanSDKEditor/Private/Verification/VerifyMetaHumanCharacter.cpp`:476 — `LiveLinkSetup` verification.
- `Engine/Plugins/Runtime/AR/AppleAR/AppleARKitFaceSupport/Source/AppleARKitFaceSupport/Public/AppleARKitLiveLinkSourceFactory.h`:48 — `UAppleARKitLiveLinkSourceFactory` (legacy ARKit source).
- `Engine/Plugins/VirtualProduction/Takes/Source/TakeRecorder/Public/Recorder/TakeRecorderBlueprintLibrary.h`:25 — `UTakeRecorderBlueprintLibrary`.
- `Engine/Plugins/VirtualProduction/Takes/Source/TakeRecorder/Public/Recorder/TakeRecorderPanel.h`:34 — `UTakeRecorderPanel`.
- `Engine/Plugins/VirtualProduction/Takes/Source/TakeRecorderSources/Public/TakeRecorderActorSource.h`:45 — `UTakeRecorderActorSource`.

Deep-dive references in this skill:
- [references/live-link-sources.md](references/live-link-sources.md) — the three MetaHuman
  sources in depth: factories, settings classes, device discovery, calibration, smoothing,
  NNE models, Live Link Face protocol and discovery, legacy ARKit source.
- [references/character-binding-and-roles.md](references/character-binding-and-roles.md) —
  roles and data layout, `ABP_MH_LiveLink` and `LiveLinkSetup`, `FAnimNode_LiveLinkPose`,
  remap assets, `ULiveLinkComponentController`, Live Link Hub rebroadcast.
- [references/recording-and-runtime.md](references/recording-and-runtime.md) — Take Recorder
  Live Link and Actor sources, what gets written where, Sequencer baking, presets, evaluation
  modes and buffering, Message Bus / UDP settings, packaged-game behaviour.

Related skills: `ue-metahuman-animator`, `ue-animation-system`, `ue-sequencer-and-cinematics`.
Shipping without live solving (baked lip sync, never-cooking the ~318 MB realtime solver models,
the ARKit face-tracking listener in Shipping builds): `ue-metahuman-runtime`.
