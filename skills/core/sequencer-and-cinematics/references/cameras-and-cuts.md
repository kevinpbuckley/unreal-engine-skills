# Cameras & camera cuts — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UCineCameraComponent`, `ACineCameraActor`,
the Camera Cuts track, camera blending, and the `OnCameraCut` delegate. Grounded in UE 5.7
(`Engine/Source/Runtime/CinematicCamera/Public/CineCameraComponent.h`,
`CineCameraActor.h`, `Engine/Source/Runtime/LevelSequence/Public/LevelSequencePlayer.h`).

## UCineCameraComponent

`UCineCameraComponent` (`CineCameraComponent.h`) extends `UCameraComponent` with film-style
properties. All primary fields are marked `UPROPERTY(Interp, …)` so Sequencer can keyframe
them directly in the Curve Editor.

### Key properties

| Property | Type | Notes |
|---|---|---|
| `CurrentFocalLength` | `float` | Focal length in mm; derives FoV from Filmback sensor |
| `CurrentAperture` | `float` | f-stop (e.g. 2.8 for f/2.8); drives depth of field |
| `CurrentFocusDistance` | `float` | Read-only display; control via `FocusSettings` |
| `Filmback` | `FCameraFilmbackSettings` | Sensor width/height in mm (defines aspect ratio) |
| `LensSettings` | `FCameraLensSettings` | Min/max focal length and aperture range |
| `FocusSettings` | `FCameraFocusSettings` | Focus method + target actor/distance |
| `CropSettings` | `FPlateCropSettings` | Matte/crop overlay |
| `ExposureMethod` | `ECameraExposureMethod` | Whether to derive exposure from aperture |

### Mutators

```cpp
// All are BlueprintSetter UFUNCTIONs — call directly or via Sequencer keyframes.
Component->SetCurrentFocalLength(50.f);       // 50 mm — wide-to-normal for typical sensor
Component->SetCurrentAperture(2.8f);          // f/2.8 — shallow DoF
Component->SetFilmback(FCameraFilmbackSettings{36.f, 24.f}); // 35 mm full-frame
```

Depth of field is driven by post-process settings derived from `CurrentAperture` +
`CurrentFocusDistance`. The component overrides `GetCameraView` (line 29) to inject these
into `FMinimalViewInfo` each frame.

### Focus settings

`FCameraFocusSettings.FocusMethod`:
- `EFocusMethod::DoNotOverride` — disable cinematic focus.
- `EFocusMethod::Manual` — set `ManualFocusDistance` in world units.
- `EFocusMethod::Tracking` — track an actor; the component raycasts to the target each tick.

## ACineCameraActor

`ACineCameraActor` (`CineCameraActor.h`) is a `ACameraActor` subclass that creates a
`UCineCameraComponent` as its camera. Access it via `GetCineCameraComponent()` (line 90).

Additional feature — **Lookat tracking** (`FCameraLookatTrackingSettings`):
- `bEnableLookAtTracking` — orient the camera toward a tracked actor each tick.
- `ActorToTrack` — `TSoftObjectPtr<AActor>` target.
- `LookAtTrackingInterpSpeed` — smoothing; 0 = instant snap.

Lookat tracking runs in `Tick` and is suitable for live cameras; for pre-authored animation
key the transform track instead.

## Camera Cuts track

The **Camera Cuts** master track (`UMovieSceneCameraCutTrack`) drives which camera the player
views during playback. Add one camera-cut section per shot, pointing to a bound
`ACineCameraActor` (or any actor with a `UCameraComponent`).

During playback the `ULevelSequencePlayer`:
1. Reads the active camera-cut section's bound camera.
2. Overrides the local player controller's view target.
3. On sequence stop (or when cuts are disabled), restores the original view target.

Control from C++:
```cpp
// Disable camera-cut override while still playing the sequence (e.g. for a dialogue overlay):
Player->SetDisableCameraCuts(true);

// Check which camera is currently active:
UCameraComponent* ActiveCam = Player->GetActiveCameraComponent();
```

## OnCameraCut delegate

`ULevelSequencePlayer` exposes:

```cpp
UPROPERTY(BlueprintAssignable)
FOnLevelSequencePlayerCameraCutEvent OnCameraCut;  // line 110
// Signature: void Callback(UCameraComponent* NewCameraComponent)
```

The delegate fires every time the active camera changes (including on sequence start). Use it
to synchronise audio listener position, trigger VFX relative to the camera, or update UI
overlays.

```cpp
Player->OnCameraCut.AddDynamic(this, &AMyListener::OnCamCut);

UFUNCTION()
void AMyListener::OnCamCut(UCameraComponent* NewCam)
{
    // NewCam is the UCineCameraComponent (or UCameraComponent) now active.
}
```

## Camera blending

Camera cuts default to an instant hard cut. For blended transitions, configure the cut
section's **Easing** settings in the Sequencer UI (ease in/out curves on the section border).
The underlying blend uses the same `FCameraBlendView` used by gameplay camera blending;
the sequence player's `GetCameraBlendPlayRate()` (virtual, line 140 in LevelSequencePlayer.h)
controls the rate.

## FLevelSequenceCameraSettings

Passed to `ULevelSequencePlayer::Initialize` and stored per-player. Controls behaviour at
sequence end:

- Whether to restore the original view target on stop.
- Aspect ratio axis constraint override.

Passed through `ALevelSequenceActor::CameraSettings` (`LevelSequenceActor.h`:99).

## Practical patterns

### Spawnable cinematic camera

Place the camera as a spawnable inside the sequence so it doesn't clutter the level. The
Camera Cuts track references the spawnable binding by GUID, not by a level actor path, making
the sequence portable across levels.

### Multi-camera sequences

One Camera Cuts master track; multiple camera-cut sections pointing to different
`ACineCameraActor` bindings. Use Subsequences (Shot track) for per-shot camera setups.

### Depth of field in gameplay

For interactive moments where only the camera (not the full sequence) plays, drive DoF via
`UCineCameraComponent` properties directly from C++ — no need for a sequence:

```cpp
ACineCameraActor* Cam = ...;
UCineCameraComponent* CC = Cam->GetCineCameraComponent();
CC->SetCurrentFocalLength(85.f);
CC->SetCurrentAperture(1.8f);
CC->FocusSettings.FocusMethod = ECameraFocusMethod::Tracking;
CC->FocusSettings.TrackingFocusSettings.ActorToTrack = PlayerPawn;
```

## Version notes

- `UCineCameraComponent::FilmbackSettings_DEPRECATED` — replaced by `Filmback`; auto-upgraded
  on load.
- Camera-cut blending quality improved in UE 5.3; older sequences play the same but can now
  use the new easing controls without re-authoring.
- `ACineCameraActor` is in module `CinematicCamera`; add it to `.Build.cs` if you reference
  the class directly. Otherwise forward-declare and use `Cast<>` only.
