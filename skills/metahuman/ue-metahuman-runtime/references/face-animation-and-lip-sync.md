# Face animation, offline lip sync, blinks and the no-Lumen face look

Deep dive for [../SKILL.md](../SKILL.md). Measured or made to work in a 48-hour UE 5.9 game-jam
project (2026-11): six MetaHumans, 132 baked lines, a Windows and a web build. Asset paths under
`/Game/<Project>/...` are placeholders; engine plugin paths are real.

---

## 1. The face Animation Blueprint that shipped

Skeleton: `/MetaHumanCharacter/Face/Face_Archetype_Skeleton`. Set the AnimBP as the Anim Class
of the `Face` component on every built character Blueprint (a Creator rebuild sets the plugin's
`ABP_Face` back).

```
Copy Pose From Mesh (attached parent, copy curves)  ----------------------------+--> base
Copy Pose From Mesh (second copy) --> Slot 'DefaultSlot' --> blend pose 0 ------+
        Layered Blend Per Bone: branch filter FACIAL_C_FacialRoot, curve blend = Override
  --> Modify Curve (apply mode Scale): HeadControlSwitch x 0
  --> Layered Blend Per Bone (no bones, curve blend = Use Max Value) over a looping Sequence
      Player of a blink-only clip (eyeBlinkL/R, 7 blinks in 22 s)
  --> Output Pose
```

Why each node is there:

- **Copy pose first.** The face follows the body's head and neck. The plugin's `ABP_Face` stops
  here (it has no Slot node), which is why no montage ever shows on it.
- **Slot inside a layered blend, not after the copy.** An exported face clip holds a root and
  about 260 curves. A plain Slot after the copy replaced the copied pose and snapped head and
  neck to the reference pose. Blending the slot in only below `FACIAL_C_FacialRoot`, with curves
  overriding, keeps the body-driven head and adds the face.
- **`HeadControlSwitch` x 0.** The clips were exported with head movement. In
  `ABP_Face_PostProcess` that curve gates head IK; it is on or off (0.35 behaved as off), and on
  means a snap to the archetype head pose (about 4.4 cm forward and down on one character).
  Scaling HeadYaw, HeadPitch or the translation curves left the offset.
- **Blink loop with Use Max Value.** Blinks during silence. The baked clips carry their own
  blinks too (section 3), and max-value blending lets either one close the eyes. One shared loop
  blinks every character in phase.

Authoring limits met from Python: an AnimGraph node's `show_pin_for_properties` change cannot be
applied (no node reconstruction, and `set_editor_property` does not fire the pin change), so use
nodes configured by property maps (Modify Curve's curve map). Never build this by duplicating a
plugin AnimBP into `/Game` and editing the copy: deleting such a copy crashed the editor (the
package could not unload, then a fatal `RigVMHost` cast).

### Playing a line (C++)

Find the component named `Face`, take its anim instance, call
`UAnimInstance::PlaySlotAnimationAsDynamicMontage(Clip, TEXT("DefaultSlot"), BlendIn, BlendOut)`,
and start the voice in the same frame. If there is no anim instance, log an error and play the
voice alone. Do not fall back to `USkeletalMeshComponent::PlayAnimation` (single-node mode) on a
face that has an AnimBP: it replaces the AnimBP instance for the whole line and a seated
character's head drops off the neck. An AnimBP without the Slot gives no error: the line plays,
the face stays still.

---

## 2. Offline lip-sync bake (audio to face AnimSequence)

UE 5.9 exposes the bake as AI-toolset tools of the experimental `MetaHumanAnimatorToolset`
plugin (enabled through `AllMetaHumanToolsets` or on its own). From editor Python they are
reached through the 5.9 toolset registry's `call_tool` (see `ue-ai-toolsets` /
`ue-editor-scripting-and-python`); tool ids are `<Toolset>.<Tool>`:

```python
PERF = "MetaHumanAnimatorToolset.MetaHumanAnimatorPerformanceTools"
EXP  = "MetaHumanAnimatorToolset.MetaHumanAnimatorExportTools"
SKEL = "/MetaHumanCharacter/Face/Face_Archetype_Skeleton.Face_Archetype_Skeleton"   # full object path

# 1. solve: SoundWave -> Performance asset (CPU only)
res = await call_tool(PERF + ".GenerateAnimationFromAudio", audio=sound_wave,
        params={"outputControls": "FullFace", "mood": "Neutral", "moodIntensity": 1.0},
        outputLocation={"assetPath": "/Game/<Project>/Editor/FacePerf", "assetName": "PERF_<LineId>"})
# fields used: bSucceeded, animationDataStatus ("Produced" | "PartiallyProduced"),
# performanceAssetPath, errorCode, errorMessage, nextAction (may arrive wrapped as {"value": {...}})

# 2. export: Performance -> AnimSequence on the face archetype skeleton
res = await call_tool(EXP + ".ExportPerformanceAnimationSequence", performance=performance_object,
        options={"assetPath": "/Game/<Project>/Anims/Face", "assetName": "FA_<LineId>__new",
                 "targetSkeletonOrSkeletalMesh": SKEL, "bExportFace": True, "bExportBody": False,
                 "bEnableHeadMovement": True, "exportRange": "ProcessingRange"})
# fields used: bCompleted, animationSequencePath, exportedFrameCount, errorCode, errorMessage, nextAction
```

The C++ parameter structs are `FMetaHumanPerformanceAudioParams` (`OutputControls` default
`FullFace`, `Mood` default `AutoDetect`, `MoodIntensity` 1.0), `FMetaHumanPerformanceOutputLocation`
(`AssetPath`, `AssetName`) and `FPerformanceAnimationExportOptions` (`AssetPath`, `AssetName`,
`ExportRange`, `bExportFace`, `bExportBody`, `bEnableHeadMovement`, `bRemoveRedundantCurveKeys`,
`TargetSkeletonOrSkeletalMesh`, `BodyRetargeter`). Moods the jam used: `Neutral`, `Anger`,
`Sadness`, `Fear`, `Happiness`, `Surprise` (one per line). WAV import: `unreal.AssetImportTask`
(`filename`, `destination_path`, `destination_name`, `replace_existing=True`, `automated=True`,
`save=False`) through `AssetToolsHelpers.get_asset_tools().import_asset_tasks`.

Batch rules, each one a failure it prevents:

- **Export to a temporary name and swap only when the export completed.** The export refuses to
  overwrite, and a failed export must leave the old clip playing rather than none (a frozen face).
- **A state file keyed per line** on a hash of the WAV plus mood, intensity, skeleton and a recipe
  version. A line is re-baked only when its audio or mood changed: a re-take costs one bake.
- **Batches of about 10, save and write state after each, a limit on batches per call.** Editor
  tool calls must stay short; call again until nothing remains.
- **Save the Performance yourself.** A solve that succeeded with a failed export can then be
  exported again without solving again.
- **Stop after 3 consecutive failures**, and at once when the toolset is not registered.
- **Do not delete a Performance that is still processing.**
- **Mono audio.** Warn on anything else.
- **Tool results are strict:** reading a field the tool does not declare raises a `KeyError`
  even through `.get`. Copy field names from the tool schema.
- **Verify by numbers**, not by trust: clip exists, length within 0.1 s of the audio, jaw-open
  curve peak above 0.3 (`CTRL_expressions_jawOpen`; else any curve containing "jaw" and "open"),
  baked from the current audio and mood. Report every stale or failed line.

Sizes: 132 clips, 3.22 MB cooked (largest 95 KB), 232 MB in the editor. Performances 277 MB,
editor-only, never cooked. Voice-only speakers (a radio voice with no face) are imported and never
baked.

---

## 3. Blink pass on the baked clips

The numbers that looked natural:

- Curves `CTRL_expressions_eyeBlinkL` and `CTRL_expressions_eyeBlinkR`; names read back
  lowercased, so compare lowercased.
- A baked value of 0.6 or more counts as an existing blink. No new blink within 1.2 s of one.
- First blink 0.6-1.4 s in, then every 2.8-4.2 s, placed by a checksum of the asset name
  (deterministic, re-run safe).
- Shape: start 0.07 s before the peak at the bake's own value, 1.0 at the peak, held 0.05 s,
  back to the bake's value 0.17 s after the peak. Linear keys.
- Engine calls (editor Python): `unreal.AnimationLibrary.get_animation_curve_names(seq,
  unreal.RawCurveTrackTypes.RCT_FLOAT)`, `AnimationLibrary.get_float_keys`,
  `AnimationCurveIdentifierExtensions.get_curve_identifier`, then on `seq.controller`:
  `open_bracket`, `add_curve` (when missing), `set_curve_keys`, `close_bracket` (the
  `IAnimationDataController` rules are in `ue-animation-authoring`).
- Result: 243 blinks added over 132 clips, 74 baked blinks kept; in PIE the blink curve reached
  1.0 in a test line and the jaw still moved.

A still or reference image can now catch a character mid-blink: look at it, and render again.

---

## 4. Face look when Lumen is not running (web, mobile renderer, low end)

Apply to every component named `Face` at `StartPlay` and to actors spawned later
(`UWorld::AddOnActorSpawnedHandler`), only when the game is not in the editor and Lumen is off
(feature level below SM5, or `r.DynamicGlobalIlluminationMethod` not 1).

```cpp
// Skin slots of a MetaHuman face start with "head_", the teeth slot with "teeth".
void ApplyNoLumenFaceLook(USkeletalMeshComponent* Face, UMaterialInterface* WebTeeth)   // your simple material
{
    const TArray<FName> Slots = Face->GetMaterialSlotNames();
    for (int32 i = 0; i < Slots.Num(); ++i)
    {
        const FString Slot = Slots[i].ToString();
        const bool bSkin  = Slot.StartsWith(TEXT("head_"), ESearchCase::IgnoreCase);
        const bool bTeeth = Slot.StartsWith(TEXT("teeth"), ESearchCase::IgnoreCase);
        if (!bSkin && !bTeeth) { continue; }
        UMaterialInterface* Current = Face->GetMaterial(i);
        UMaterialInstanceDynamic* MID = Cast<UMaterialInstanceDynamic>(Current);
        if (bTeeth && WebTeeth && (!MID || MID->Parent != WebTeeth))
        {
            UTexture* Baked = nullptr;      // keep this character's own baked teeth texture
            if (Current) { Current->GetTextureParameterValue(FHashedMaterialParameterInfo(TEXT("Basecolor Baked")), Baked); }
            MID = UMaterialInstanceDynamic::Create(WebTeeth, Face);
            if (Baked) { MID->SetTextureParameterValue(TEXT("Basecolor"), Baked); }
            Face->SetMaterial(i, MID);
        }
        if (!MID) { MID = Face->CreateAndSetMaterialInstanceDynamic(i); }
        if (!MID) { continue; }
        if (bSkin)
        {
            MID->SetScalarParameterValue(TEXT("Roughness Global Offset Post-Bake"), 0.2f);
            MID->SetScalarParameterValue(TEXT("Specular Global Multiply Post-Bake"), 0.55f);
        }
        else
        {
            MID->SetVectorParameterValue(TEXT("Tint"), FLinearColor(0.5f, 0.465f, 0.4f));   // warm grey
            MID->SetScalarParameterValue(TEXT("Roughness"), 0.55f);
            MID->SetScalarParameterValue(TEXT("Specular"), 0.15f);
        }
    }
}
```

- `WebTeeth` is a plain lit material you make: texture parameter `Basecolor` times vector `Tint`,
  scalars `Roughness` and `Specular`. It is loaded by path, so its folder goes in
  `DirectoriesToAlwaysCook`, or the web build has no teeth material.
- The two skin parameter names are the MetaHuman baked skin material's own (they worked on an
  Optimized build's `head_LOD*` slots); they live in plugin material assets, not in C++.
- The stock teeth material's value and occlusion parameters do nothing on its low-quality path,
  which is why the slot is swapped instead of tuned.
- Add a non-Shipping console command that takes the five numbers and re-applies the look, and
  tune it in a Development web build in the browser. The numbers above were chosen that way.

---

## Source references (UE 5.9)

- `Engine/Source/Runtime/Engine/Classes/Animation/AnimInstance.h`:591 — `PlaySlotAnimationAsDynamicMontage`.
- `Engine/Source/Runtime/Engine/Classes/Components/SkeletalMeshComponent.h` — `PlayAnimation`, `GetAnimInstance`.
- `Engine/Source/Runtime/Engine/Public/Materials/MaterialInstanceDynamic.h` — `UMaterialInstanceDynamic::Create`, `SetScalarParameterValue`.
- `Engine/Plugins/Experimental/Toolsets/MetaHumanAnimatorToolset/Source/MetaHumanAnimatorToolset/Private/MetaHumanAnimatorPerformanceTools.h`:100 — `GenerateAnimationFromAudio`.
- `Engine/Plugins/Experimental/Toolsets/MetaHumanAnimatorToolset/Source/MetaHumanAnimatorToolset/Private/MetaHumanAnimatorPerformanceTypes.h`:262 — `FMetaHumanPerformanceAudioParams`; 289 — `FMetaHumanPerformanceOutputLocation`; 125 — `EAnimationDataStatus`.
- `Engine/Plugins/Experimental/Toolsets/MetaHumanAnimatorToolset/Source/MetaHumanAnimatorToolset/Private/MetaHumanAnimatorExportTools.h`:22 — `FPerformanceAnimationExportOptions`; 95 — `FPerformanceAnimationExportResult`; 169 — `ExportPerformanceAnimationSequence`.
- Content: `Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Face/ABP_Face.uasset` (Copy Pose From
  Mesh, no Slot node), `ABP_Face_PostProcess.uasset` (`HeadControlSwitch`),
  `Face_Archetype_Skeleton.uasset`.
