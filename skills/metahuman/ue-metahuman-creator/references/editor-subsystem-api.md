# UMetaHumanCharacterEditorSubsystem API — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the edit-session model, every important
UFUNCTION of `UMetaHumanCharacterEditorSubsystem` with its exact signature, the parameter
structs, import error codes, the cloud request flow and the build gate. Grounded in UE 5.8
(`MetaHumanCharacterEditor` module, `Public/MetaHumanCharacterEditorSubsystem.h`, 2216 lines).

The class comment states the contract: "Any edits to a MetaHumanCharacter that may need to be
exposed as an API should be done as part of this class, as UFUNCTIONs declared here are
automatically exposed" (to Blueprint and Python). Everything marked **BP** below is
`BlueprintCallable`; everything else is C++ only.

```cpp
UCLASS(BlueprintType)
class METAHUMANCHARACTEREDITOR_API UMetaHumanCharacterEditorSubsystem
    : public UEditorSubsystem, public FTickableEditorObject
{
    static UMetaHumanCharacterEditorSubsystem* Get();   // or GEditor->GetEditorSubsystem<...>()
```

---

## Session

| Function | Signature | Notes |
|---|---|---|
| **BP** `TryAddObjectToEdit` | `[[nodiscard]] bool (UMetaHumanCharacter*)` | Registers the character, creates `FMetaHumanCharacterEditorData` (face/body edit meshes, DNA-to-mesh maps, identity states, preview collection, materials). First registration loads the texture-synthesis model. Returns false if already registered — then do **not** call Remove. |
| **BP** `IsObjectAddedForEditing` | `bool (const UMetaHumanCharacter*) const` (BlueprintPure) | |
| **BP** `RemoveObjectToEdit` | `void (const UMetaHumanCharacter*)` | Unloads texture synthesis when the last character leaves. Destroys preview actors. |
| **BP** `GetPreviewCollection` | `UMetaHumanCollection* (const UMetaHumanCharacter*)` | The collection mirroring the internal one, used for the preview build; null when not added for edit. |
| **BP** `OnEditPreviewCollection` | `void (UMetaHumanCharacter*)` | Call after modifying the preview collection to propagate back to the asset. |
| **BP** `RunCharacterEditorPipelineForPreview` | `void (UMetaHumanCharacter*)`, `meta=(ScriptName="AssembleForPreview")` | Runs the editor pipeline at `Preview` quality; makes instance parameters available. |
| `GetMetaHumanCharacterEditorData` | `const TSharedRef<FMetaHumanCharacterEditorData>* (TNotNull<const UMetaHumanCharacter*>) const` | Read-only view on the live data. |
| `InitializeMetaHumanCharacter` | `void (TNotNull<UMetaHumanCharacter*>)` | What the factory calls to make a valid default state. |

`FMetaHumanCharacterEditorData` (line 207) holds `FaceMesh`, `BodyMesh` (edit skeletal
meshes), `FaceState` / `BodyState` (`TSharedRef<FMetaHumanCharacterIdentity::FState>` /
`FMetaHumanCharacterBodyIdentity::FState`), `HeadMaterials`, `BodyMaterial` (MIDs),
`PreviewCollection`, cached synthesized images, `InvisibleDrivingActor`, the latest
`SkinSettings` / `EyesSettings` / `MakeupSettings` / `HeadModelSettings` optionals, and the
per-character delegates (`OnFaceStateChangedDelegate`, `OnBodyStateChangedDelegate`, ...).

---

## Parameter structs and enums (top of the header)

```cpp
UENUM(BlueprintType) enum class EImportErrorCode : uint8 {
    FittingError, InvalidInputData, InvalidInputBones, InvalidHeadMesh, InvalidLeftEyeMesh,
    InvalidRightEyeMesh, InvalidTeethMesh, NoHeadMeshPresent, NoEyeMeshesPresent,
    NoTeethMeshPresent, IdentityNotConformed, GeneralError,
    CombinedBodyCannotBeImportedAsWholeRig, Success };

UENUM() enum class EMetaHumanRigType : uint8 { JointsOnly, JointsAndBlendShapes };

USTRUCT(BlueprintType) struct FMetaHumanCharacterTextureRequestParams {
    bool bReportProgress = true;   // Slate progress notifications
    bool bBlocking = false; };     // true for scripts/commandlets

USTRUCT(BlueprintType) struct FMetaHumanCharacterAutoRiggingRequestParams {
    EMetaHumanRigType RigType = EMetaHumanRigType::JointsOnly;
    bool bReportProgress = true;
    bool bBlocking = false; };

USTRUCT(BlueprintType) struct FMetaHumanCharacterFitToVerticesParams {
    FFitToTargetOptions Options;                 // AlignmentOptions, bDisableHighFrequencyDelta, bAdaptNeck
    TArray<FVector> HeadVertices, LeftEyeVertices, RightEyeVertices, TeethVertices; };

USTRUCT(BlueprintType) struct FImportFromIdentityParams { bool bUseEyeMeshes = true, bUseTeethMesh = true, bUseMetricScale = false; };
USTRUCT(BlueprintType) struct FImportFromDNAParams {
    bool bIsolateHeadFromBody = false;
    bool bImportWholeRig = true;                 // whole rig => fixed body type, non-editable
    EAlignmentOptions AlignmentOptions = EAlignmentOptions::ScalingRotationTranslation; };
USTRUCT() struct FImportBodyFromDNAParams { bool bImportWholeRig = false; FConformBodyParams ConformBodyParams; };
USTRUCT(BlueprintType) struct FImportFromTemplateParams {
    bool bIsolateHeadFromBody = false, bMatchVerticesByUVs = true, bUseEyeMeshes = true, bUseTeethMesh = true;
    EAlignmentOptions AlignmentOptions = EAlignmentOptions::ScalingRotationTranslation; };
```

`EAlignmentOptions` (`None`, `Translation`, `RotationTranslation`, `ScalingTranslation`,
`ScalingRotationTranslation`) is declared with `ScriptName = "MetaHumanAlignmentOptions"`,
so Python spells it `unreal.MetaHumanAlignmentOptions`.

---

## Body editing

| Function | Signature |
|---|---|
| **BP** `GetBodyConstraints` | `TArray<FMetaHumanCharacterBodyConstraint> (const UMetaHumanCharacter*, bool bScaleMeasurementRangesWithHeight = false) const` |
| **BP** `SetBodyConstraints` | `void (const UMetaHumanCharacter*, const TArray<FMetaHumanCharacterBodyConstraint>&)` — re-evaluates the preview body |
| **BP** `CommitBodyState` | `void (UMetaHumanCharacter*)` — writes the current body state into the asset |
| `CommitBodyState` (native) | `void (TNotNull<UMetaHumanCharacter*>, TSharedRef<const FMetaHumanCharacterBodyIdentity::FState>, EBodyMeshUpdateMode = Full)` |
| `ApplyBodyState` | preview only |
| `GetBodyState` / `CopyBodyState` | read / clone the state |
| `ResetParametricBody` | back to blendable default |
| `SetMetaHumanBodyType` | `void (TNotNull<const UMetaHumanCharacter*>, EMetaHumanBodyType, EBodyMeshUpdateMode)` |
| `IsFixedBodyType` | `bool` |
| `SetBodyGlobalDeltaScale` / `GetBodyGlobalDeltaScale` | sculpt delta strength |
| **BP** `ConformBodyToTarget` | `bool (UMetaHumanCharacter*, const TArray<FVector3f>& Vertices, const TArray<FVector3f>& JointRotations, bool bTargetIsInAPose, bool bEstimateJointsFromMesh)` |
| **BP** `SetBodyMesh` | `bool (UMetaHumanCharacter*, const TArray<FVector3f>&, bool bRepositionHelperJoints)` |
| **BP** `SetBodyJoints` | `bool (UMetaHumanCharacter*, const TArray<FVector3f>& ComponentJointTranslations, const TArray<FVector3f>& JointRotations, bool bImportHelperJoints)` |
| **BP** `GetMeshForBodyConformingFromTemplate` | `EImportErrorCode (UMetaHumanCharacter*, UObject* BodyTemplateMesh, UObject* HeadTemplateMesh, bool bMatchVerticesByUVs, TArray<FVector3f>& OutVertices)` |
| **BP** `GetMeshForBodyConformingFromDNA` | `EImportErrorCode (UMetaHumanCharacter*, const FString& BodyDnaFilePath, const FString& HeadDnaFilePath, TArray<FVector3f>&)` |
| **BP** `GetJointsForBodyConformingFromTemplate` | `EImportErrorCode (USkeletalMesh*, TArray<FVector3f>& OutJointWorldTranslations, TArray<FVector3f>& OutJointRotations)` |
| **BP** `GetJointsForBodyConformingFromDNA` | `EImportErrorCode (const FString& BodyDnaFilePath, ...)` |
| **BP** `ImportBodyWholeRig` | `EImportErrorCode (UMetaHumanCharacter*, const FString& BodyDnaFilePath, const FString& HeadDnaFilePath)` — fixed body |
| `ImportFromBodyTemplate` | `EImportErrorCode (UMetaHumanCharacter*, UObject* TemplateMesh, EMetaHumanCharacterBodyFitOptions)` |
| `ImportFromBodyDna`, `FitToBodyDna`, `CommitBodyDNA`, `ApplyBodyDNA`, `ParametricFitToDnaBody`, `ParametricFitToCompatibilityBody` | DNA paths, native |

Deprecated 5.8 (FVector overloads, still BP): `ConformBody`, `GetMeshForBodyConforming`,
`GetJointsForBodyConforming`.

Typical conform-from-template flow (body first, then head): `GetMeshForBodyConformingFromTemplate`
→ `GetJointsForBodyConformingFromTemplate` → `ConformBodyToTarget(..., bTargetIsInAPose=true, false)`.

---

## Face editing and conforming

| Function | Signature |
|---|---|
| **BP** `GetFaceLandmarks` | `void (const UMetaHumanCharacter*, TArray<FVector>& Out) const` (BlueprintPure) |
| **BP** `TranslateFaceLandmarks` | `void (const UMetaHumanCharacter*, const TArray<int32>& LandmarkIndices, const TArray<FVector>& Deltas)` — preview |
| **BP** `GetFaceModelCoefficients` / `SetFaceModelCoefficients` | `TArray<float>` PCA coefficients of the face model |
| **BP** `CommitFaceState` | `void (UMetaHumanCharacter*)` — persists sculpt/conform; invalidates an existing rig |
| `CommitFaceState` (native) | `void (TNotNull<UMetaHumanCharacter*>, TSharedRef<const FMetaHumanCharacterIdentity::FState>)` |
| `ApplyFaceState`, `GetFaceState`, `GetFaceDnaToSkelMeshMap` | native |
| `AddFaceLandmark` / `RemoveFaceLandmark` | custom landmarks by mesh vertex index |
| **BP** `FitStateToTargetVertices` | `bool (UMetaHumanCharacter*, const FMetaHumanCharacterFitToVerticesParams&)` — head vertices mandatory, eyes/teeth optional |
| **BP** `ImportFromTemplate` | `EImportErrorCode (UMetaHumanCharacter*, UObject* HeadMesh, UObject* LeftEye, UObject* RightEye, UObject* Teeth, const FImportFromTemplateParams&)` — meshes must be MetaHuman topology; static or skeletal |
| **BP** `ImportFromFaceDna` | `EImportErrorCode (UMetaHumanCharacter*, const FString& DNAFilePath, const FImportFromDNAParams&)` |
| **BP** `ImportFromIdentity` | `EImportErrorCode (UMetaHumanCharacter*, const UMetaHumanIdentity*, const FImportFromIdentityParams&)` — from a MetaHuman Animator Identity asset |
| **BP** `FitFaceStateFromBodyWithEyesTeethDNA` | `bool (UMetaHumanCharacter*, const FString& FaceDnaFilePath)` |
| **BP** `FitFaceStateFromBodyWithEyesTeethTemplate` | `bool (UMetaHumanCharacter*, UObject* Teeth, UObject* LeftEye, UObject* RightEye, bool bMatchVerticesByUVs)` |
| **BP** `GetMeshDataForConforming` | `static bool (UObject* Mesh, TArray<FVector3f>& OutVertices, TArray<int32>& OutTriangles)` |
| **BP** `ConformToTargetMeshes` / `AlignToTargetMeshes` | `bool (UMetaHumanCharacter*, const FMetaHumanCharacterTargetMeshKey&, const FConformTargetParams&)` — arbitrary-topology mesh import (keypoints + tracking) |
| `ConformTargetMeshesAsync` / `AlignToTargetMeshesAsync` / `RefineVerticesToTargeAsync` / `CancelMeshAsyncProcess` | async variants with `OnAsyncMeshConformIteration` / `OnAsyncMeshConformCompleted` |
| **BP** `CommitTargetMeshKeypoints`, `GetPresetBodyKeyPoints`, `TrackFaceLandmarksFromImage`, `CommitPosedStateAsAPose` | mesh-import tool helpers |
| `ApplyFaceDNA`, `ImportFaceDNA`, `CommitFaceDNA`, `AlignFaceDNAWithBody`, `ResetCharacterFace` | native DNA plumbing |
| `EnableAnimation` / `DisableAnimation`, `EnableSkeletalPostProcessing` / `DisableSkeletalPostProcessing` | preview animation toggles |

---

## Look

| Function | Signature |
|---|---|
| **BP** `CommitSkinSettings` | `void (UMetaHumanCharacter*, const FMetaHumanCharacterSkinSettings&)` |
| **BP** `CommitEyesSettings` | `void (UMetaHumanCharacter*, const FMetaHumanCharacterEyesSettings&) const` |
| **BP** `CommitMakeupSettings` | `void (UMetaHumanCharacter*, const FMetaHumanCharacterMakeupSettings&) const` |
| **BP** `CommitHeadModelSettings` | `void (UMetaHumanCharacter*, const FMetaHumanCharacterHeadModelSettings&)` |
| `ApplyEyesSettings` / `ApplyMakeupSettings` / `ApplyFaceEvaluationSettings` | preview-only, const |
| `CommitFaceEvaluationSettings` | `void (TNotNull<UMetaHumanCharacter*>, const FMetaHumanCharacterFaceEvaluationSettings&)` |
| `ToggleEyelashesGrooms` | swap groom/card eyelashes in preview |
| `UpdateCharacterPreviewMaterial` | `(Character, EMetaHumanCharacterSkinPreviewMaterial, bool bWritePersistentState)` |
| `IsTextureSynthesisEnabled` | `bool const` — false without the optional `TextureSynthesis` model |
| `GetSkinTone` | `FLinearColor (const FVector2f& UV) const` — ensure-fails if synthesis is disabled |
| `GetFaceTextureAttributeMap` | `const FMetaHumanFaceTextureAttributeMap&` |
| **BP** `CompareFaceTextures` / `CompareFaceState` / `CompareBodyState` | test helpers with tolerances |

---

## Cloud: auto-rigging and texture sources

| Function | Signature |
|---|---|
| **BP** `RequestAutoRigging` | `void (UMetaHumanCharacter*, const FMetaHumanCharacterAutoRiggingRequestParams& = {})` |
| **BP** `RemoveFaceRig` | `void (UMetaHumanCharacter*)` — back to archetype DNA, unregisters morph targets |
| `RemoveBodyRig` | native |
| `IsAutoRiggingFace` | `bool` — request in flight |
| `GetRiggingState` | `EMetaHumanCharacterRigState` (`Unrigged`, `RigPending`, `Rigged`) — native only |
| **BP** `RequestTextureSources` | `void (UMetaHumanCharacter*, const FMetaHumanCharacterTextureRequestParams& = {})` |
| `RequestHighResolutionTextures` | `(Character, ERequestTextureResolution)` — older entry point |
| `IsRequestingHighResolutionTextures` | `bool` |
| `RemoveTexturesAndRigs` | `bool (TNotNull<UMetaHumanCharacter*>)` |
| `AutoRigFace` | `UE_DEPRECATED(5.7)` → use `RequestAutoRigging` |

Flow for auto-rigging: `FMetaHumanCharacterEditorCloudRequests::InitFaceAutoRigParams(FaceState, FaceDNA, OutSolveParams)`
→ `UE::MetaHuman::FAutoRigServiceRequest::CreateRequest(Params)` → bind
`AutorigRequestCompleteDelegate` / `OnMetaHumanServiceRequestFailedDelegate` /
`MetaHumanServiceRequestProgressDelegate` → `RequestSolveAsync()`. On success
`OnAutoRigFaceRequestCompleted` applies the returned DNA (`ApplyFaceDNA`, `CommitFaceDNA`),
sets `bHasFaceDNABlendshapes` for `JointsAndBlendShapes`, fires `OnRiggingStateChanged`, and
pushes an `FAutoRigCommandChange` on the undo stack (`FRemoveRigCommandChange` for removal).
Textures: `FFaceTextureSynthesisServiceRequest` / `FBodyTextureSynthesisServiceRequest` →
`GenerateTexturesFromResponse` / `GenerateBodyTexturesFromResponse` → `StoreSynthesizedTextures`
→ `SetHasHighResolutionTextures(true)`.

Failures arrive as `EMetaHumanServiceRequestResult` (`Ok`, `Busy`, `Unauthorized`,
`EulaNotAccepted`, `InvalidArguments`, `ServerError`, `LoginFailed`, `Timeout`, `GatewayError`)
and surface as editor notifications: "Auto-Rigging of Face failed with code '<Result>'",
"Auto-Rigging failed due to incompatible DNA", "User not logged in, please autorig before
downloading source face textures" (`Unauthorized` on a texture request). Pre-flight the face
with the editor's compatibility check: the subsystem warns "Face mesh is not fully compatible
with MetaHuman topology ... Auto-rigging may fail" after an aggressive import.

Authentication lives in `MetaHumanSDKEditor` (`UE::MetaHuman::ServiceAuthentication`:
`CheckHasLoggedInUserAsync`, `LoginToAuthEnvironment`, `LogoutFromAuthEnvironment`,
`TickAuthClient` — the last one is what blocking requests pump while waiting). The editor's
login button is `SMetaHumanAuthenticationMenuButton`. There is no offline rigging path.

Only one request of each kind per character: `FMetaHumanCharacterEditorCloudRequests`
(`TextureSynthesis`, `BodyTextures`, `AutoRig`, progress handles, notification items,
`HasActiveRequest()`).

---

## Build and actors

| Function | Signature |
|---|---|
| **BP** `CanBuildMetaHuman` | `bool (const UMetaHumanCharacter*, bool bInLogError = false)` |
| `CanBuildMetaHuman` (native) | `bool (TNotNull<const UMetaHumanCharacter*>, FText& OutErrorMessage)` |
| **BP** `BuildMetaHuman` | `void (UMetaHumanCharacter*, const FMetaHumanCharacterEditorBuildParameters&)` — delegates to `FMetaHumanCharacterEditorBuild::BuildMetaHumanCharacter` |
| **BP** `SpawnMetaHumanActor` | `AActor* (UMetaHumanCharacter*, bool bKeepTransient = false)` — editor preview actor in the level |
| `TryGetMetaHumanCharacterEditorActorClass` | which actor class the pipeline would spawn |
| `CreateMetaHumanCharacterEditorActor` / `DestroyMetaHumanCharacterEditorActor` / `ForEachCharacterActor` | preview actor management |
| `TryGetCharacterPreviewAssets` | `FMetaHumanCharacterPreviewAssets` (`FaceMesh`, `BodyMesh`, `MergedHeadAndBodyMesh`, `BodyMeasurements`) — editor-owned, read-only |
| `CreateCombinedFaceAndBodyMesh` | `USkeletalMesh* (Character, const FString& AssetPathAndName, bool bOverwrite)` |
| `GetFaceArchetypeMesh` / `GetBodyArchetypeMesh` | static, by `EMetaHumanCharacterTemplateType` |
| `SetClothingVisibilityState` / `GetClothingVisibilityState`, `IsCharacterOutfitSelected` | preview clothing |

`CanBuildMetaHuman` checks, in order (source `MetaHumanCharacterEditorSubsystem.cpp`):
1. `IsObjectAddedForEditing` — "Character data is not loaded."
2. `!IsRequestingHighResolutionTextures` — "Requesting HighRes texture in progress."
3. `!IsAutoRiggingFace` — "Face auto rig in progress."
4. `GetRiggingState == Rigged` — "Character is not rigged."
5. `HasHighResolutionTextures` — "The Character is missing textures, use Download Texture
   Sources to create them before assembling" (assembly needs the animated maps).

`FMetaHumanCharacterEditorBuildParameters` (`Subsystem/MetaHumanCharacterBuild.h`:25):
`PipelineType` (default `Cinematic`), `PipelineQuality` (default `Cinematic`; only
Optimized/UEFN read it), `AnimationSystemName`, `AbsoluteBuildPath`, `NameOverride`,
`CommonFolderPath`, `bEnableWardrobeItemValidation`, `PipelineOverride`
(`TObjectPtr<UMetaHumanCollectionPipeline>`, plain `UPROPERTY()` so C++ only). The build
helper also exposes `StripLODsFromMesh`, `DownsizeTexture`, `MergeHeadAndBody_CreateAsset` /
`_CreateTransient`, `GetDefaultPipelineClass(Type, Quality)`.
`IMetaHumanCharacterBuildExtender` (modular feature) lets other plugins add mount points,
animation-system names (UAF does this), package roots to copy and post-duplicate fixups.

---

## Viewport / lighting (editor-only helpers)

`UpdateLightingEnvironment(Character, EMetaHumanCharacterEnvironment)`, `UpdateTonemapperOption`,
`UpdateLightRotation`, `UpdateBackgroundColor`, `UpdateCharacterLOD(Character, EMetaHumanCharacterLOD)`,
`UpdateAlwaysUseHairCardsOption`, `NotifyViewportToolbarRenderingQualityProfileChange`, plus
the matching delegate accessors (`OnLightEnvironmentChanged`, `OnCameraFocusRequested`, ...).
Static path helpers: `GetFaceIdentityTemplateModelPath`, `GetBodyIdentityModelPath`,
`GetLegacyBodiesPath` (the `Content/Face/IdentityTemplate`, `Content/Body/IdentityTemplate`
and `Optional/Body` folders).

---

## Source references (UE 5.9)

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterEditor/`:
- `Public/MetaHumanCharacterEditorSubsystem.h`:38 — `EImportErrorCode`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:56 — `FRemoveRigCommandChange`; 111 — `FAutoRigCommandChange`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:131 — `EMetaHumanRigType`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:138 — `FMetaHumanCharacterTextureRequestParams`; 152 — `FMetaHumanCharacterAutoRiggingRequestParams`; 170 — `FMetaHumanCharacterFitToVerticesParams`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:207 — `FMetaHumanCharacterEditorData`; 373 — `FMetaHumanCharacterPreviewAssets`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:397 — `FImportFromIdentityParams`; 415 — `FImportFromDNAParams`; 433 — `FImportBodyFromDNAParams`; 447 — `FImportFromTemplateParams`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:496 — `UMetaHumanCharacterEditorSubsystem`; 521 — `Get()`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:534 — `TryAddObjectToEdit`; 538 — `IsObjectAddedForEditing`; 546 — `RemoveObjectToEdit`; 564 — `GetPreviewCollection`; 573 — `OnEditPreviewCollection`; 577 — `RunCharacterEditorPipelineForPreview`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:690 — `SpawnMetaHumanActor`; 782 — `CanBuildMetaHuman`; 793 — `BuildMetaHuman`; 824 — `CreateCombinedFaceAndBodyMesh`; 834 — `IsTextureSynthesisEnabled`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:887 — `CommitHeadModelSettings`; 907 — `CommitSkinSettings`; 922 — `RequestTextureSources`; 1068 — `CommitEyesSettings`; 1094 — `CommitMakeupSettings`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:1149 — `CommitFaceState` (BP); 1282 — `GetFaceLandmarks`; 1302 — `TranslateFaceLandmarks`; 1313 — `GetFaceModelCoefficients`; 1324 — `SetFaceModelCoefficients`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:1361 — `RequestAutoRigging`; 1370 — `RemoveFaceRig`; 1396 — `IsAutoRiggingFace`; 1401 — `GetRiggingState`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:1420 — `FitStateToTargetVertices`; 1442 — `ImportFromIdentity`; 1460 — `ImportFromFaceDna`; 1479 — `ImportFromTemplate`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:1579 — `CommitBodyState` (BP); 1690 — `GetMeshForBodyConformingFromTemplate`; 1708 — `GetMeshForBodyConformingFromDNA`; 1728 — `GetJointsForBodyConformingFromTemplate`; 1746 — `GetJointsForBodyConformingFromDNA`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:1762 — `FitFaceStateFromBodyWithEyesTeethTemplate`; 1789 — `FitFaceStateFromBodyWithEyesTeethDNA`; 1802 — `GetMeshDataForConforming`; 1816 — `ConformToTargetMeshes`; 1838 — `CommitPosedStateAsAPose`; 1844 — `AlignToTargetMeshes`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:1898 — `ConformBodyToTarget`; 1902 — `SetBodyJoints`; 1906 — `SetBodyMesh`; 1913 — `ImportBodyWholeRig`; 1932 — `GetBodyConstraints`; 1943 — `SetBodyConstraints`; 1953 — `SetMetaHumanBodyType`; 1958 — `IsFixedBodyType`.
- `Public/Subsystem/MetaHumanCharacterBuild.h`:25 — `FMetaHumanCharacterEditorBuildParameters`; 87 — `IMetaHumanCharacterBuildExtender`; 150 — `FMetaHumanCharacterEditorBuild`.
- `Public/Subsystem/MetaHumanCharacterService.h`:20 — `FMetaHumanCharacterEditorCloudRequests`.
- `Public/MetaHumanCharacterEditorActor.h`:22 — `AMetaHumanCharacterEditorActor`.
- `Private/MetaHumanCharacterEditorSubsystem.cpp`:2407 — `CanBuildMetaHuman` checks; 3715 — `OnAutoRigFaceRequestFailed`; 4386 — `OnHighResolutionTexturesRequestFailed`.

Under `Engine/Plugins/MetaHuman/MetaHumanSDK/Source/MetaHumanSDKEditor/Public/`:
- `Cloud/MetaHumanServiceRequest.h`:20 — `EMetaHumanServiceRequestResult`; 63 — `ServiceAuthentication` namespace; 99 — `FMetaHumanServiceRequestBase`.
- `Cloud/MetaHumanARServiceRequest.h`:10 — `UE::MetaHuman::ERigType`; 86 — `FAutoRigServiceRequest`.
- `Cloud/MetaHumanTextureSynthesisServiceRequest.h`:92 — `FFaceTextureSynthesisServiceRequest`; 116 — `FBodyTextureSynthesisServiceRequest`.
- `UI/SMetaHumanAuthenticationMenuButton.h` — editor login button.

Under `Engine/Plugins/MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanCoreTechLib/Public/`:
- `MetaHumanCharacterIdentity.h`:28 — `EHeadFitToTargetMeshes`; 41 — `EAlignmentOptions`; 52 — `FFitToTargetOptions`.
- `MetaHumanCharacterBodyIdentity.h`:89 — `FMetaHumanCharacterBodyConstraint`.
