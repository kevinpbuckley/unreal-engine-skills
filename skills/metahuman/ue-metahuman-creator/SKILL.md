---
name: ue-metahuman-creator
description: Creates and edits MetaHumans in-editor with the MetaHuman Creator plugin
  (MetaHumanCharacter, UE 5.6+) - the UMetaHumanCharacter asset (face/body state, skin,
  eyes, makeup, body constraints, synthesized textures), the
  UMetaHumanCharacterEditorSubsystem edit session (TryAddObjectToEdit, Commit* settings,
  landmarks, ImportFromTemplate/FaceDna/Identity, RequestAutoRigging,
  RequestTextureSources, CanBuildMetaHuman/BuildMetaHuman, SpawnMetaHumanActor), the
  palette model (UMetaHumanCollection, UMetaHumanInstance, UMetaHumanWardrobeItem,
  FMetaHumanPaletteItemKey) and the build pipelines (UMetaHumanDefaultPipeline,
  EMetaHumanQualityLevel). Use when scripting MetaHuman creation (C++, Python),
  batch-building MetaHuman Blueprints, conforming a custom head/body mesh or DNA, adding
  grooms or clothing, custom wardrobe items (WardrobePaths,
  groom missing from the wardrobe, invalid item), migrating legacy Quixel Bridge MetaHumans, or diagnosing "Character
  is not rigged", "missing textures", optional content and cloud login.
metadata:
  aliases: "MetaHuman, MetaHuman Creator, digital human, character creator, groom, wardrobe"
  engine-version: "5.9"
  category: metahuman
---

# MetaHuman Creator (in-editor)

Since UE 5.6 MetaHuman Creator runs inside the editor as the **MetaHuman Creator** plugin
(`Engine/Plugins/MetaHuman/MetaHumanCharacter`, plugin name `MetaHumanCharacter`, beta).
A character is a `UMetaHumanCharacter` asset holding parametric face/body state plus look
settings; every edit goes through `UMetaHumanCharacterEditorSubsystem`; the result is
*assembled* by a pipeline into a `BP_<Name>` actor Blueprint with face and body skeletal
meshes, grooms and clothing. Two steps still call Epic's cloud service: face auto-rigging
and high-resolution texture download.

## When to use this skill

- Creating a `UMetaHumanCharacter` from code, sculpting body/face, setting skin, eyes,
  makeup, eyelashes and teeth, then building the playable Blueprint without the UI.
- Conforming a scanned or sculpted head/body mesh, a `.dna` file, or a MetaHuman Identity
  into a MetaHuman (mesh import / "Conform" tools).
- Dressing a character: adding `UMetaHumanWardrobeItem` grooms and outfits to slots and
  tweaking instance parameters (hair melanin, shirt colour).
- Understanding build output, pipeline types and quality levels, LODs, and what the face
  rig state means for MetaHuman Animator and Live Link.
- Migrating legacy Quixel Bridge MetaHumans, or diagnosing failures caused by missing
  "MetaHuman Creator Core Data" or a missing Epic account login.

## Mental model

| Concept | Type | Role |
|---|---|---|
| Character asset | `UMetaHumanCharacter` | Pure data: face/body state (bulk data), optional face/body DNA, `SkinSettings`, `EyesSettings`, `MakeupSettings`, `HeadModelSettings`, synthesized texture bulk data, an *internal* `UMetaHumanCollection`. |
| Edit session | `UMetaHumanCharacterEditorSubsystem` | Owns runtime identity models (`FMetaHumanCharacterIdentity::FState`, `FMetaHumanCharacterBodyIdentity::FState`), the live preview meshes and materials. All edits are its UFUNCTIONs. |
| Palette / collection | `UMetaHumanCollection : UMetaHumanCharacterPalette` | Items (`FMetaHumanCharacterPaletteItem`, keyed by `FMetaHumanPaletteItemKey`) per slot (`Hair`, `Eyebrows`, `Outfits`, ...) plus a `Pipeline` and a `DefaultInstance`. |
| Instance | `UMetaHumanInstance` | A selection per slot (`FMetaHumanPipelineSlotSelection`) + instance-parameter overrides; `Assemble()` produces the assembly output struct. |
| Wardrobe item | `UMetaHumanWardrobeItem` | A principal asset (groom binding, outfit, skeletal mesh) + its `UMetaHumanItemPipeline`. |
| Pipeline | `UMetaHumanCollectionPipeline` / `UMetaHumanCollectionEditorPipeline` | Runtime side assembles an instance; editor side builds assets and writes the actor Blueprint. Defaults: `UMetaHumanDefaultPipeline` (current), `...Legacy`, `...UEFN`. |

Three rules drive almost every gotcha:

1. **Nothing edits without a session.** Call `TryAddObjectToEdit(Character)` first; most
   subsystem functions require it and `BuildMetaHuman` fails without it. Call
   `RemoveObjectToEdit` when done.
2. **Apply vs Commit.** `Apply*` (native, const) only updates the preview; `Commit*` writes
   into the asset (and marks it dirty, transactable). Scripts use `Commit*`.
3. **Rig and textures gate the build.** `CanBuildMetaHuman` requires: added for edit, no
   pending cloud request, `EMetaHumanCharacterRigState::Rigged` (face DNA present), and
   `HasHighResolutionTextures()` (texture sources downloaded).

## Core workflow

1. **Create** the asset with `UMetaHumanCharacterFactoryNew` through Asset Tools
   (`IAssetTools::CreateAsset` / `AssetTools.create_asset`). The factory initializes a
   valid default face/body state; never `NewObject<UMetaHumanCharacter>` directly.
2. **Open for edit**: `TryAddObjectToEdit` (returns false if already registered, for
   example open in an asset editor; then edit via that session instead).
3. **Body**: `GetBodyConstraints` → set `bIsActive` / `TargetMeasurement` on the
   `FMetaHumanCharacterBodyConstraint`s you care about (`Height` in cm; others are
   measurements between `MinMeasurement`..`MaxMeasurement`) → `SetBodyConstraints` →
   `CommitBodyState`. Or conform: `ConformBodyToTarget`, `ImportBodyWholeRig`,
   `ImportFromBodyTemplate`.
4. **Face**: sculpt via `GetFaceLandmarks` / `TranslateFaceLandmarks` or
   `GetFaceModelCoefficients` / `SetFaceModelCoefficients`, or conform via
   `ImportFromTemplate`, `ImportFromFaceDna`, `ImportFromIdentity`,
   `FitStateToTargetVertices`; finish with `CommitFaceState`.
5. **Look**: fill `FMetaHumanCharacterSkinSettings`, `FMetaHumanCharacterEyesSettings`,
   `FMetaHumanCharacterMakeupSettings`, `FMetaHumanCharacterHeadModelSettings` and call the
   matching `CommitSkinSettings` / `CommitEyesSettings` / `CommitMakeupSettings` /
   `CommitHeadModelSettings`.
6. **Wardrobe**: `Character->GetMutableInternalCollection()->TryAddItemFromWardrobeItem(Slot, Item, OutKey)`,
   then `GetMutableDefaultInstance()->TryAddSlotSelection(FMetaHumanPipelineSlotSelection(Slot, Key))`;
   `RunCharacterEditorPipelineForPreview` (Python `assemble_for_preview`) builds only the edit
   session's preview collection, so query instance parameters on `GetPreviewCollection(Character)`.
   Project grooms/clothing (`WardrobePaths`, item pipelines, template-head grooms,
   the preview-collection trap): [references/custom-wardrobe-content.md](references/custom-wardrobe-content.md).
7. **Cloud**: `RequestAutoRigging` (`FMetaHumanCharacterAutoRiggingRequestParams`, pick
   `EMetaHumanRigType::JointsOnly` or `JointsAndBlendShapes`) then `RequestTextureSources`
   (`FMetaHumanCharacterTextureRequestParams`). Set `bBlocking = true` in scripts.
8. **Build**: `CanBuildMetaHuman` → `BuildMetaHuman(Character, FMetaHumanCharacterEditorBuildParameters)`.
   Output lands in `AbsoluteBuildPath/<Name>/BP_<Name>` with shared assets in
   `CommonFolderPath` (defaults `/Game/MetaHumans`, `/Game/MetaHumans/Common`).
9. **Save** the character asset, `RemoveObjectToEdit`. For a level preview while editing,
   `SpawnMetaHumanActor`; for gameplay, place the built `BP_<Name>`.

## Subsystem API map (BlueprintCallable, so also Python)

| Area | Functions |
|---|---|
| Session | `TryAddObjectToEdit`, `IsObjectAddedForEditing`, `RemoveObjectToEdit`, `GetPreviewCollection`, `OnEditPreviewCollection`, `RunCharacterEditorPipelineForPreview` (ScriptName `AssembleForPreview`) |
| Body | `GetBodyConstraints(Character, bScaleMeasurementRangesWithHeight=false)`, `SetBodyConstraints`, `CommitBodyState`, `ConformBodyToTarget`, `SetBodyMesh`, `SetBodyJoints`, `ImportBodyWholeRig`, `GetMeshForBodyConformingFromTemplate/FromDNA`, `GetJointsForBodyConformingFromTemplate/FromDNA` |
| Face | `GetFaceLandmarks`, `TranslateFaceLandmarks`, `GetFaceModelCoefficients`, `SetFaceModelCoefficients`, `CommitFaceState`, `FitStateToTargetVertices`, `ImportFromTemplate`, `ImportFromFaceDna`, `ImportFromIdentity`, `FitFaceStateFromBodyWithEyesTeethDNA/Template`, `ConformToTargetMeshes`, `AlignToTargetMeshes`, `CommitPosedStateAsAPose` |
| Look | `CommitSkinSettings`, `CommitEyesSettings`, `CommitMakeupSettings`, `CommitHeadModelSettings` |
| Cloud | `RequestAutoRigging`, `RemoveFaceRig`, `RequestTextureSources` |
| Build | `CanBuildMetaHuman(Character, bInLogError)`, `BuildMetaHuman`, `SpawnMetaHumanActor(Character, bKeepTransient)` |
| Testing | `CompareFaceState`, `CompareBodyState`, `CompareFaceTextures` |

Native-only (C++): `GetRiggingState`, `IsFixedBodyType`, `SetMetaHumanBodyType`,
`IsTextureSynthesisEnabled`, `GetFaceState`/`GetBodyState`, `ApplyFaceDNA`, `CommitFaceDNA`,
`CommitBodyDNA`, `ResetParametricBody`. Full signatures and line numbers:
[references/editor-subsystem-api.md](references/editor-subsystem-api.md).

## C++ pattern (editor module)

Module deps: `MetaHumanCharacter`, `MetaHumanCharacterEditor`, `MetaHumanCharacterPalette`,
`MetaHumanDefaultPipeline`, `MetaHumanCoreTechLib`, `MetaHumanSDKRuntime` (for
`EMetaHumanQualityLevel`), plus `AssetTools`, `UnrealEd`. Editor-only (`Type: Editor`).

```cpp
#include "MetaHumanCharacter.h"
#include "MetaHumanCharacterEditorSubsystem.h"
#include "MetaHumanCharacterFactoryNew.h"
#include "Subsystem/MetaHumanCharacterBuild.h"     // FMetaHumanCharacterEditorBuildParameters
#include "MetaHumanCharacterBodyIdentity.h"        // FMetaHumanCharacterBodyConstraint
#include "IAssetTools.h"

static void BuildPilot()
{
    UMetaHumanCharacter* Character = Cast<UMetaHumanCharacter>(IAssetTools::Get().CreateAsset(
        TEXT("MH_Pilot"), TEXT("/Game/Characters/MetaHumans"),
        UMetaHumanCharacter::StaticClass(), NewObject<UMetaHumanCharacterFactoryNew>()));
    if (!Character) { return; }

    UMetaHumanCharacterEditorSubsystem* MH = UMetaHumanCharacterEditorSubsystem::Get();
    if (!MH->TryAddObjectToEdit(Character)) { return; }   // not registered: do not Remove

    // Body: parametric constraints (names match the UI, e.g. "Height", "Muscularity")
    TArray<FMetaHumanCharacterBodyConstraint> Constraints = MH->GetBodyConstraints(Character);
    for (FMetaHumanCharacterBodyConstraint& C : Constraints)
    {
        if (C.Name == TEXT("Height")) { C.bIsActive = true; C.TargetMeasurement = 185.f; }
    }
    MH->SetBodyConstraints(Character, Constraints);
    MH->CommitBodyState(Character);

    // Skin: U = lightness (0 light .. 1 dark), V = redness; copy, edit, commit
    FMetaHumanCharacterSkinSettings Skin = Character->SkinSettings;
    Skin.Skin.U = 0.35f;
    Skin.Skin.V = 0.60f;
    Skin.Freckles.Mask = EMetaHumanCharacterFrecklesMask::Type1;
    MH->CommitSkinSettings(Character, Skin);

    // Cloud: blocking so a script can continue when the service answers
    FMetaHumanCharacterAutoRiggingRequestParams Rig;
    Rig.RigType = EMetaHumanRigType::JointsOnly;
    Rig.bBlocking = true;
    Rig.bReportProgress = false;
    MH->RequestAutoRigging(Character, Rig);

    FMetaHumanCharacterTextureRequestParams Tex;
    Tex.bBlocking = true;
    Tex.bReportProgress = false;
    MH->RequestTextureSources(Character, Tex);

    if (MH->CanBuildMetaHuman(Character, /*bInLogError*/ true))
    {
        FMetaHumanCharacterEditorBuildParameters Build;
        Build.PipelineType = EMetaHumanDefaultPipelineType::Optimized;   // Cinematic | Optimized | UEFN
        Build.PipelineQuality = EMetaHumanQualityLevel::High;            // Low..Cinematic; Optimized/UEFN only
        Build.AbsoluteBuildPath = TEXT("/Game/MetaHumans");
        Build.CommonFolderPath = TEXT("/Game/MetaHumans/Common");
        MH->BuildMetaHuman(Character, Build);                            // writes BP_MH_Pilot
    }
    MH->RemoveObjectToEdit(Character);
}
```

`Character->SkinSettings` / `EyesSettings` / `MakeupSettings` / `HeadModelSettings` are the
committed values; read them, mutate a copy, commit. Do not write the UPROPERTYs directly
(the preview meshes and materials would not update; `PostEditChangeProperty` only covers a
subset).

## Python worked example (Epic's exposed surface only)

Every call below is a `BlueprintCallable` UFUNCTION or a `BlueprintReadWrite` /
`BlueprintType` struct verified in the 5.8 headers; parameter names follow the Python
convention (`InCharacter` → `character`, `bInLogError` → `log_error`).

```python
import unreal

PKG, NAME = "/Game/Characters/MetaHumans", "MH_Pilot"

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
character = asset_tools.create_asset(
    asset_name=NAME, package_path=PKG,
    asset_class=unreal.MetaHumanCharacter,
    factory=unreal.new_object(type=unreal.MetaHumanCharacterFactoryNew))
if character is None:
    raise RuntimeError("MetaHumanCharacter creation failed")

mh = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
if not mh.try_add_object_to_edit(character):
    raise RuntimeError("Could not open for edit (already open in an asset editor?)")

try:
    # ---- body: parametric constraints -------------------------------------------
    constraints = mh.get_body_constraints(character)            # TArray<FMetaHumanCharacterBodyConstraint>
    by_name = {str(c.name): c for c in constraints}             # "Height", "Fat", "Muscularity", "Masculine/Feminine", ...
    by_name["Height"].is_active = True
    by_name["Height"].target_measurement = 185.0                # cm
    musc = by_name["Muscularity"]
    musc.is_active = True
    musc.target_measurement = unreal.MathLibrary.lerp(musc.min_measurement, musc.max_measurement, 0.7)
    mh.set_body_constraints(character, list(by_name.values()))
    mh.commit_body_state(character)

    # ---- skin ----------------------------------------------------------------------
    skin = character.skin_settings                              # struct copy of the committed value
    skin.skin.u = 0.35                                          # lightness 0..1 (0 = light)
    skin.skin.v = 0.60                                          # redness 0..1
    skin.freckles.mask = unreal.MetaHumanCharacterFrecklesMask.TYPE1
    skin.freckles.density = 0.3
    mh.commit_skin_settings(character, skin)

    # ---- eyes ----------------------------------------------------------------------
    iris = unreal.MetaHumanCharacterEyeIrisProperties()
    iris.pattern = unreal.MetaHumanCharacterEyesIrisPattern.IRIS003   # ScriptName "Pattern"
    iris.primary_color_u, iris.primary_color_v = 0.2, 0.8             # cool .. warm, dark .. light
    eyes = character.eyes_settings
    eyes.eye_left.iris = iris
    eyes.eye_right.iris = iris
    mh.commit_eyes_settings(character, eyes)

    # ---- eyelashes / teeth (head model) ----------------------------------------------
    head = character.head_model_settings
    head.eyelashes.type = unreal.MetaHumanCharacterEyelashesType.LONG_CURL
    head.teeth.tooth_length = 0.2
    mh.commit_head_model_settings(character, head)

    # ---- face sculpt: scale all landmarks 5% ---------------------------------------
    landmarks = mh.get_face_landmarks(character)
    deltas = [unreal.MathLibrary.subtract_vector_vector(v.multiply_float(1.05), v) for v in landmarks]
    mh.translate_face_landmarks(character, list(range(len(deltas))), deltas)
    mh.commit_face_state(character)

    # ---- cloud: auto-rig, then texture sources (both need an Epic login) ------------
    rig = unreal.MetaHumanCharacterAutoRiggingRequestParams()
    rig.rig_type = unreal.MetaHumanRigType.JOINTS_ONLY           # or JOINTS_AND_BLEND_SHAPES
    rig.blocking = True                                          # required in scripts
    rig.report_progress = False
    mh.request_auto_rigging(character, rig)

    tex = unreal.MetaHumanCharacterTextureRequestParams()
    tex.blocking = True
    tex.report_progress = False
    mh.request_texture_sources(character, tex)

    # ---- build the Blueprint ------------------------------------------------------------
    if not mh.can_build_meta_human(character, log_error=True):
        raise RuntimeError("Not buildable: rig or texture request did not complete")

    build = unreal.MetaHumanCharacterEditorBuildParameters()
    build.pipeline_type = unreal.MetaHumanDefaultPipelineType.OPTIMIZED
    build.pipeline_quality = unreal.MetaHumanQualityLevel.HIGH
    build.absolute_build_path = "/Game/MetaHumans"
    build.common_folder_path = "/Game/MetaHumans/Common"
    build.enable_wardrobe_item_validation = True
    mh.build_meta_human(character=character, params=build)      # -> /Game/MetaHumans/MH_Pilot/BP_MH_Pilot

    unreal.EditorAssetLibrary.save_loaded_asset(character)

    # ---- optional: live preview actor in the open level -------------------------------
    actor = mh.spawn_meta_human_actor(character=character, keep_transient=True)
    unreal.log(f"preview actor {actor.get_name()} mirrors edits until the session ends")
finally:
    if mh.is_object_added_for_editing(character):
        mh.remove_object_to_edit(character)
```

Grooms/clothing, conforming, export and the `MetaHumanGenerator` toolset wrapper are in
[references/python-scripting.md](references/python-scripting.md).

## Cloud dependencies and offline behaviour

- `RequestAutoRigging` and `RequestTextureSources` create `UE::MetaHuman::FAutoRigServiceRequest`
  / `FFaceTextureSynthesisServiceRequest` / `FBodyTextureSynthesisServiceRequest`
  (`MetaHumanSDKEditor`, `Cloud/`). They need an Epic Games account login (EOS auth;
  `ServiceAuthentication::CheckHasLoggedInUserAsync`, `LoginToAuthEnvironment`) and an
  accepted EULA. Failure codes: `EMetaHumanServiceRequestResult` (`Unauthorized`,
  `EulaNotAccepted`, `LoginFailed`, `Busy`, `Timeout`, `GatewayError`, ...).
- Offline or logged out: the request fails with a notification ("Auto-Rigging of Face failed
  with code ..."; textures: "User not logged in, please autorig before downloading source
  face textures"), the rig state stays `Unrigged`/`RigPending`, and `CanBuildMetaHuman`
  returns false ("Character is not rigged" / "The Character is missing textures").
- Everything else (sculpting, skin preview via local texture synthesis, body solve,
  conforming, wardrobe, preview assembly) is local. Local texture synthesis needs the
  optional content below (`IsTextureSynthesisEnabled()`).
- The subsystem keeps one `FMetaHumanCharacterEditorCloudRequests` per character; a second
  request while one is active is rejected (`HasActiveRequest()`).

## Optional content ("MetaHuman Creator Core Data")

`FMetaHumanCharacterEditorModule::IsOptionalMetaHumanContentInstalled()` checks the plugin's
`Content/Optional/` folder for `TextureSynthesis/` (with `*.ar` model files) and
`BodyTextures/`. It is installed from the Epic Games Launcher next to the engine, not with the
plugin. Without it the editor logs "MetaHuman Optional Content folder not found ... limited
features" and disables: local texture synthesis (skin tone preview becomes flat), presets
library and blend tool (`Optional/Presets`), body textures, the built-in wardrobe grooms and
clothing (`Optional/Grooms/...`, `Optional/Clothing/WI_DefaultGarment`), the legacy fixed body
types (`Optional/Body`), migration (`Optional/Migration/MigrationDatabase`) and DCC export
templates (`Optional/DCC`). Silence the warning with `mh.Character.SuppressContentWarnings`.

Plugin content that *does* ship with the engine (`Content/`): `Face/` (`SKM_Face`,
`SKM_Face_DNA`, `Face_Archetype_Skeleton`, `ABP_Face`, `ABP_Face_PostProcess`, `PHYS_Face`,
`Face_LODSettings[_Low|_Medium|_High]`, `IdentityTemplate/` model data, `ARKit/` mapping
assets), `Body/` (`ABP_Body_PostProcess`, `IdentityTemplate/` with `SKM_Body`, `SKM_Body_DNA`,
`body_model.dna`, `PHYS_Body`, `Body_LODSettings*`), `Female/Medium/NormalWeight/Body/metahuman_base_skel`,
`BuildPipeline/` (`BP_DefaultPipeline`, `BP_DefaultLegacyPipeline[_Low|_Medium|_High]`,
`BP_DefaultUEFNPipeline_*`, `BP_MetaHuman*`, `DefaultWardobePipeline/`), `Animation/`
(`ABP_MH_LiveLink`, `ABP_AnimationPreview`, `Retargeting/IK_MH_IKRig`, `RTG_MH_IKRig`),
`Clothing/` (translucent clothing material), `Common/MetaHuman_ControlRig`, `Controls/` (face
board), `LightingEnvironments/` (`Studio`, `Split`, `Fireside`, `Moonlight`, `Tungsten`,
`Portrait`, `RedLantern`, `TextureBooth` maps), `Materials/`, `TextureGraphs/`, `Textures/`,
`Tools/EyePresets/`, `Python/examples/`.

## Gotchas & edge cases

- **"Unable to edit asset"** — `TryAddObjectToEdit` returns false when the character is
  already registered (asset editor open). Either use that session (it is the same subsystem)
  or close the editor. Never call `RemoveObjectToEdit` after a false return.
- **Commit, not raw property writes.** Writing `Character->EyesSettings` directly leaves the
  preview and the identity state out of sync. Use `Commit*`. In Python, properties like
  `skin_settings` are `BlueprintReadOnly`: read, modify the copy, commit.
- **Rig state.** `EMetaHumanCharacterRigState { Unrigged, RigPending, Rigged }`. Any face
  sculpt or conform after rigging invalidates the DNA (back to `Unrigged`); re-run
  `RequestAutoRigging`. `RemoveFaceRig` reverts to the archetype DNA. A rigged face is what
  gives the built `SKM_Face` its RigLogic DNA and the 200+ facial controls that MetaHuman
  Animator, Live Link Face (`ABP_MH_LiveLink`, `Face/ARKit/` mapping) and Control Rig drive.
  `JointsOnly` is lighter; `JointsAndBlendShapes` adds blendshapes (`HasFaceDNABlendshapes()`)
  for the Cinematic look.
- **Textures gate the build** even when materials will be overridden: assembly needs the
  animated maps that arrive with the texture download. Desired resolutions live in
  `SkinSettings.DesiredTextureSourcesResolutions` (`ERequestTextureResolution` 2k/4k/8k);
  `NeedsToDownloadTextureSources()` tells you when a re-download is needed.
- **Fixed body types.** `bFixedBodyType` is set when a whole body rig is imported from DNA
  (`FImportFromDNAParams::bImportWholeRig`, `ImportBodyWholeRig`) or a legacy compatibility
  body (`EMetaHumanBodyType::f_med_nrw`...) is chosen: the body constraints then do nothing
  until `ResetParametricBody`.
- **Pipeline quality only matters for Optimized/UEFN.** `Cinematic` ignores
  `PipelineQuality`. Legacy pipelines come from `UMetaHumanCharacterPaletteProjectSettings::DefaultCharacterLegacyPipelines`
  keyed by `EMetaHumanQualityLevel`; `BP_DefaultPipeline` is the current default.
- **LODs.** Face/body LOD settings come from `Face_LODSettings*` / `Body_LODSettings*`;
  `FMetaHumanLODProperties` in the default editor pipeline overrides them and strips LODs
  (`FMetaHumanCharacterEditorBuild::StripLODsFromMesh`). Preview LOD is `EMetaHumanCharacterLOD`
  (`LOD0..LOD7`, `Auto`). Rendering-quality profiles (Epic/High/Medium) are viewport-only.
- **Preview actor is not your gameplay actor.** `SpawnMetaHumanActor` spawns an
  `AMetaHumanCharacterEditorActor` (Transient, NotPlaceable) that mirrors the live session;
  it is destroyed when the session ends. Ship the built `BP_<Name>` instead.
- **Build path.** Output folder is `AbsoluteBuildPath/<NameOverride or asset name>/`;
  leaving `AbsoluteBuildPath` empty uses the collection's unpack settings
  (`UMetaHumanCollection::UnpackPathMode`). Wardrobe validation can be skipped with
  `bEnableWardrobeItemValidation = false` (also a project setting).
- **Legacy Bridge MetaHumans.** The `MetaHumanCharacterMigrationEditor` module hooks
  `FMetaHumanImport` (Bridge / Fab import) and, when the source has `MigrationInfo.json`,
  offers Import / Migrate / Import and Migrate (`UMetaHumanCharacterEditorSettings::MigrationAction`,
  `MigratedPackagePath`, name prefix/suffix). Migration recreates skin, makeup, eyes and
  grooms through the subsystem using `Optional/Migration/MigrationDatabase`; it cannot run
  without the optional content.
- **UAF (experimental).** `Engine/Plugins/Experimental/MetaHuman/MetaHumanCharacterUAF`
  registers an extra animation system option
  (`AnimationSystemName = "Unreal Animation Framework (UAF) - Experimental"`) and per-quality
  actor Blueprints (`UMetaHumanCharacterUAFProjectSettings::Blueprints`). Default is
  `FMetaHumanCharacterAssemblySettings::AnimationSystemNameAnimBP` (`"AnimBP"`). Keep AnimBP
  unless the project already runs UAF.
- **Virtual textures.** `UMetaHumanCharacterEditorSettings::bUseVirtualTextures` is ignored
  when VT is off or `r.AllowStaticLighting` is on (MetaHuman VT materials fail to compile
  with static lighting).

## Version notes

- 5.6: MetaHuman Creator moved into the editor as this plugin; Quixel Bridge import became a
  migration path.
- 5.7: `AutoRigFace` deprecated in favour of `RequestAutoRigging` + params struct.
- 5.8: `RemoveFaceRig` exposed to Blueprint/Python; `FOnPaletteBuilt` → `FOnCollectionBuilt`;
  `IMetaHumanCharacterActorInterface::SetCharacterInstance` → `SetMetaHumanInstance`;
  `ConformBody`/`GetMeshForBodyConforming`/`GetJointsForBodyConforming` (FVector overloads)
  deprecated for the `*ToTarget` / `*FromTemplate` / `*FromDNA` FVector3f versions;
  `FMetaHumanCharacterSkinSettings::bEnableTextureOverrides`/`TextureOverrides` deprecated for
  `TextureMaterialOverrides`.

---

## References & source material

Engine source (UE 5.9 — all paths under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/`):
- `MetaHumanCharacter/Public/MetaHumanCharacter.h`:29 — `EMetaHumanCharacterRigState`.
- `MetaHumanCharacter/Public/MetaHumanCharacter.h`:162 — `FMetaHumanCharacterHeadModelSettings`.
- `MetaHumanCharacter/Public/MetaHumanCharacter.h`:206 — `UMetaHumanCharacter`.
- `MetaHumanCharacter/Public/MetaHumanCharacterSkin.h`:340 — `FMetaHumanCharacterSkinSettings`.
- `MetaHumanCharacter/Public/MetaHumanCharacterEyes.h`:241 — `FMetaHumanCharacterEyesSettings`.
- `MetaHumanCharacter/Public/MetaHumanCharacterMakeup.h`:196 — `FMetaHumanCharacterMakeupSettings`.
- `MetaHumanCharacter/Public/MetaHumanCharacterTeeth.h`:28 — `FMetaHumanCharacterTeethProperties`.
- `MetaHumanCharacter/Public/MetaHumanCharacterAssemblySettings.h`:14 — `EMetaHumanDefaultPipelineType`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:131 — `EMetaHumanRigType`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:138 — `FMetaHumanCharacterTextureRequestParams`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:152 — `FMetaHumanCharacterAutoRiggingRequestParams`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:496 — `UMetaHumanCharacterEditorSubsystem`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:534 — `TryAddObjectToEdit`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:782 — `CanBuildMetaHuman`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:793 — `BuildMetaHuman`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:1361 — `RequestAutoRigging`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:1932 — `GetBodyConstraints`.
- `MetaHumanCharacterEditor/Public/Subsystem/MetaHumanCharacterBuild.h`:25 — `FMetaHumanCharacterEditorBuildParameters`.
- `MetaHumanCharacterEditor/Public/Subsystem/MetaHumanCharacterService.h`:20 — `FMetaHumanCharacterEditorCloudRequests`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorModule.h`:15 — `IsOptionalMetaHumanContentInstalled`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSettings.h`:36 — `UMetaHumanCharacterEditorSettings`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterFactoryNew.h`:10 — `UMetaHumanCharacterFactoryNew`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterExportBlueprintLibrary.h`:184 — `UMetaHumanCharacterExportBlueprintLibrary`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorActor.h`:22 — `AMetaHumanCharacterEditorActor`.
- `MetaHumanCharacterPalette/Public/MetaHumanCollection.h`:71 — `UMetaHumanCollection`.
- `MetaHumanCharacterPalette/Public/MetaHumanInstance.h`:133 — `UMetaHumanInstance`.
- `MetaHumanCharacterPalette/Public/MetaHumanWardrobeItem.h`:14 — `UMetaHumanWardrobeItem`.
- `MetaHumanCharacterPalette/Public/MetaHumanPaletteItemKey.h`:15 — `FMetaHumanPaletteItemKey`.
- `MetaHumanCharacterPalette/Public/MetaHumanCollectionBlueprintLibrary.h`:372 — `UMetaHumanCollectionBlueprintLibrary`.
- `MetaHumanDefaultPipeline/Public/MetaHumanDefaultPipeline.h`:20 — `UMetaHumanDefaultPipeline`.
- `MetaHumanDefaultEditorPipeline/Public/MetaHumanDefaultEditorPipeline.h`:13 — `UMetaHumanDefaultEditorPipeline`.
- `MetaHumanCharacterMigrationEditor/Private/MetaHumanCharacterMigrationEditorModule.h`:17 — `FMetaHumanCharacterMigrationEditorModule`.

Related plugins (UE 5.8, under `Engine/Plugins/`):
- `MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanCoreTechLib/Public/MetaHumanCharacterBodyIdentity.h`:89 — `FMetaHumanCharacterBodyConstraint`.
- `MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanCoreTechLib/Public/MetaHumanCharacterIdentity.h`:41 — `EAlignmentOptions`, `FFitToTargetOptions`.
- `MetaHuman/MetaHumanSDK/Source/MetaHumanSDKRuntime/Public/MetaHumanTypes.h`:53 — `EMetaHumanQualityLevel`.
- `MetaHuman/MetaHumanSDK/Source/MetaHumanSDKRuntime/Public/MetaHumanBodyType.h`:10 — `EMetaHumanBodyType`.
- `MetaHuman/MetaHumanSDK/Source/MetaHumanSDKEditor/Public/Cloud/MetaHumanServiceRequest.h`:20 — `EMetaHumanServiceRequestResult`, `ServiceAuthentication`.
- `MetaHuman/MetaHumanSDK/Source/MetaHumanSDKEditor/Public/Cloud/MetaHumanARServiceRequest.h`:86 — `FAutoRigServiceRequest`.
- `Experimental/MetaHuman/MetaHumanCharacterUAF/Source/MetaHumanCharacterUAFEditor/Private/MetaHumanCharacterUAFProjectSettings.h`:12 — `UMetaHumanCharacterUAFProjectSettings`.

Epic Python examples (UE 5.8): `Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Python/examples/`
(`example_create_asset.py`, `example_auto_rig.py`, `example_assembly.py`, `example_modify_skin.py`,
`example_sculpt_body.py`, `example_live_edit.py`, `example_add_grooms.py`, `example_add_clothing.py`,
`example_conform_head.py`, `example_conform_body_from_template.py`, `example_download_textures.py`,
`example_export_tools.py`, `example_spawn_metahuman_actor.py`) and
`Engine/Plugins/Experimental/Toolsets/MetaHumanGenerator/Content/Python/metahuman_toolset/metahuman.py`.

Deep-dive references in this skill:
- [references/character-asset-and-settings.md](references/character-asset-and-settings.md) —
  `UMetaHumanCharacter` data model, every settings struct and enum, textures, body types.
- [references/editor-subsystem-api.md](references/editor-subsystem-api.md) — the subsystem
  UFUNCTIONs with signatures, param structs, import error codes, cloud flow, build checks.
- [references/palette-pipeline-assembly.md](references/palette-pipeline-assembly.md) —
  collection/instance/wardrobe model, pipelines, assembly output, Blueprint libraries,
  project settings, build output layout.
- [references/python-scripting.md](references/python-scripting.md) — Python naming rules,
  grooms/clothing, conforming, export, spawn, batch patterns, MetaHumanGenerator toolset.
- [references/custom-wardrobe-content.md](references/custom-wardrobe-content.md) — project
  wardrobe items: `WardrobePaths`, slot classes, item pipelines and validation, custom grooms
  on `SKM_Groom_Head_Legacy02`, preview collection, groom parameters, Chaos outfit refit.

After the build (packaged and web targets, face AnimBP, groom LOD holes, cook size, wardrobe for
close-ups): `ue-metahuman-runtime`.

Related skills: `ue-control-rig-and-ik`, `ue-animation-system`, `ue-hair-and-grooms` (groom
authoring, Alembic import, bindings, custom grooms as Creator hair).
