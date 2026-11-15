# MetaHuman Character asset and settings — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `UMetaHumanCharacter` data model, the
settings structs it serializes (skin, eyes, makeup, head model, face evaluation, viewport),
texture storage, body types and the internal collection. Grounded in the UE 5.8
`MetaHumanCharacter` plugin (runtime module `MetaHumanCharacter`, `Public/`).

---

## UMetaHumanCharacter — a data container

`UMetaHumanCharacter : UObject` (`UCLASS(BlueprintType)`) stores everything needed to
rebuild a MetaHuman. The class comment is explicit: it "relies on the
`UMetaHumanCharacterEditorSubsystem` to have its properties initialized and is basically a
container for data". `IsCharacterValid()` is false until the subsystem's
`InitializeMetaHumanCharacter` has run — the factory does that for you.

### Public UPROPERTYs

| Property | Type | Specifiers | Notes |
|---|---|---|---|
| `TemplateType` | `EMetaHumanCharacterTemplateType` | `VisibleAnywhere` | Only `MetaHuman` today; selects the identity template model. |
| `FaceEvaluationSettings` | `FMetaHumanCharacterFaceEvaluationSettings` | `VisibleAnywhere, BlueprintReadOnly` | `GlobalDelta` (0..1), `HighFrequencyDelta` ("Texture Position Offset"), `HeadScale` (0.8..1.3). Committed via native `CommitFaceEvaluationSettings`. |
| `HeadModelSettings` | `FMetaHumanCharacterHeadModelSettings` | `VisibleAnywhere, BlueprintReadOnly` | `Eyelashes` + `Teeth`. Commit with `CommitHeadModelSettings`. |
| `SkinSettings` | `FMetaHumanCharacterSkinSettings` | `VisibleAnywhere, BlueprintReadOnly` | Commit with `CommitSkinSettings`. |
| `EyesSettings` | `FMetaHumanCharacterEyesSettings` | `EditAnywhere, BlueprintReadWrite` | Commit with `CommitEyesSettings`. |
| `MakeupSettings` | `FMetaHumanCharacterMakeupSettings` | `EditAnywhere, BlueprintReadWrite` | Commit with `CommitMakeupSettings`. |
| `bHasHighResolutionTextures` | `bool` | `BlueprintReadOnly, AssetRegistrySearchable` | True after `RequestTextureSources` succeeds; build prerequisite. |
| `bFixedBodyType` | `bool` | `BlueprintReadOnly, AssetRegistrySearchable` | Whole-rig DNA import or compatibility body; parametric constraints are inert. |
| `SynthesizedFaceTexturesInfo` | `TMap<EFaceTextureType, FMetaHumanCharacterTextureInfo>` | `BlueprintReadOnly` | Size/format of each stored face texture. |
| `SynthesizedFaceTextures` | `TMap<EFaceTextureType, TObjectPtr<UTexture2D>>` | `Transient` | Rebuilt on load from bulk data. |
| `HighResBodyTexturesInfo` / `BodyTextures` | body equivalents | | |
| `ViewportSettings` | `FMetaHumanCharacterViewportSettings` | `EditAnywhere, BlueprintReadWrite` | Lighting environment, LOD, camera frame, rendering quality for the asset editor. |

Editor-only data (`WITH_EDITORONLY_DATA`): `PreviewMaterialType`
(`EMetaHumanCharacterSkinPreviewMaterial`: `Default`="Topology", `Editable`="Skin", `Clay`),
`ThumbnailInfo`, `WardrobePaths` (`TArray<FMetaHumanCharacterAssetsSection>`: a content
directory to monitor, target `SlotName`, `ClassesToFilter`), `WardrobeIndividualAssets`,
`CharacterIndividualAssets` (presets/blend library), `PipelinesPerClass`
(`TMap<TSubclassOf<UMetaHumanCollectionPipeline>, TObjectPtr<UMetaHumanCollectionPipeline>>`
— one instanced pipeline per class so pipeline properties persist per character),
`AssemblySettings` (`FMetaHumanCharacterAssemblySettings`), `LastTargetMeshKey`,
`TargetMeshKeyPointsCollection`, `TargetMeshTrackingResultsCollection` (mesh-import tool).

Private: `InternalCollection` (`TObjectPtr<UMetaHumanCollection>`, `Instanced`, display
"Internal Palette (build)") + `InternalCollectionKey`. Access with
`GetMutableInternalCollection()` / `GetInternalCollection()` / `GetInternalCollectionKey()`.
The internal collection's `Character` slot is kept pointing at this asset by the private
`ConfigureCollection()`.

### Bulk data API (native)

| Data | Set | Get / query |
|---|---|---|
| Face state (parametric identity) | `SetFaceStateData(FSharedBuffer)` | `GetFaceStateData()` |
| Face DNA (rig) | `SetFaceDNABuffer(TConstArrayView<uint8>, bool bHasBlendshapes)` | `HasFaceDNA()`, `GetFaceDNABuffer()`, `HasFaceDNABlendshapes()` |
| Body state | `SetBodyStateData` | `GetBodyStateData()` |
| Posed body state per target mesh | `SetBodyTargetPoseStateData(Key, Buffer)`, `SetTargetFaceModelCoefficients(Key, Coeffs)` | `GetBodyTargetPoseStateData(Key)`, `GetTargetFaceModelCoefficients(Key)` |
| Body DNA | `SetBodyDNABuffer` | `HasBodyDNA()`, `GetBodyDNABuffer()` |
| Face textures | `StoreSynthesizedFaceTexture(EFaceTextureType, const FImage&)` | `HasSynthesizedTextures()`, `GetSynthesizedFaceTexturesResolution(Type)`, `GetSynthesizedFaceTextureDataAsync(Type)` → `TFuture<FSharedBuffer>`, `GetValidFaceTextures()` |
| Body textures | `StoreHighResBodyTexture(EBodyTextureType, const FImage&)` | `GetHighResBodyTextureDataAsync`, `GetSynthesizedBodyTexturesResolution` |
| High-res flag | `SetHasHighResolutionTextures(bool)` | `HasHighResolutionTextures()`, `NeedsToDownloadTextureSources()` |
| Cleanup | `ResetUnreferencedHighResTextureData()`, `RemoveAllTextures()` | |

All of it is `UE::Serialization::FEditorBulkData` (compressed, editor-only). The runtime game
never loads a `UMetaHumanCharacter`; it loads the built Blueprint and meshes.

`FMetaHumanCharacterTextureInfo` (`SizeX`, `SizeY`, `NumSlices`, `Format` =
`ERawImageFormat`, `GammaSpace`) is what lets the editor allocate the transient `UTexture2D`s
before the async bulk-data load finishes. `EFaceTextureType` / `EBodyTextureType` live in
`MetaHumanSDK` (`MetaHumanTypes.h`) and enumerate basecolor, normal, cavity, animated maps
and the body/chest/underwear sets.

### Editor delegates

`OnWardrobePathsChanged`, `OnRiggingStateChanged` (fired by `NotifyRiggingStateChanged()`),
`OnAnimationReinitialized`. `GetThumbnailPathInPackage(Path, EMetaHumanCharacterThumbnailCameraPosition)`
names the extra `Face` / `Body` / `Character_Body` / `Character_Face` thumbnails.

---

## Head model settings (eyelashes, teeth)

`FMetaHumanCharacterHeadModelSettings` = `Eyelashes` (`FMetaHumanCharacterEyelashesProperties`)
+ `Teeth` (`FMetaHumanCharacterTeethProperties`). Both are geometry *variants* baked into the
face state (`UpdateEyelashesVariantFromProperties`, `UpdateTeethVariantFromProperties`), so
changing them re-evaluates the face mesh — commit with `CommitHeadModelSettings`.

**Eyelashes** — `Type` (`EMetaHumanCharacterEyelashesType`: `None`, `ShortSparse`, `ShortFine`,
`ShortThin`, `LongSlightCurl`, `LongCurl`, `LongThickCurl`), `DyeColor`, `Melanin`, `Redness`,
`Roughness`, `SaltAndPepper`, `Lightness` (all 0..1), `bEnableGrooms` (groom strands vs
card eyelashes; the subsystem's `ToggleEyelashesGrooms` swaps them in the preview).

**Teeth** — sliders in -1..1: `ToothLength`, `ToothSpacing`, `UpperShift`, `LowerShift`,
`Overbite`, `Overjet`; in 0..1: `WornDown`, `Polycanine`, `RecedingGums`, `Narrowness`,
`Variation`, `JawOpen`; colours `TeethColor`, `GumColor`, `PlaqueColor`, `PlaqueAmount`;
`EnableShowTeethExpression` (Transient — the editor's "show teeth" pose while editing).
`EMetaHumanCharacterTeethType` (`None`, `Variant_01..08`) names the baked variants.

Eyebrows, beard, mustache, peach fuzz and hair are **not** head-model settings: they are
groom wardrobe items in palette slots (see palette reference).

---

## Skin settings

`FMetaHumanCharacterSkinSettings` (`MetaHumanCharacterSkin.h`:340):

- `Skin` — `FMetaHumanCharacterSkinProperties`: `U` (0..1 lightness; 0 = light), `V`
  (0..1 redness), `BodyBias`/`BodyGain` (VisibleAnywhere, texture-synthesis internals),
  `bShowTopUnderwear`, `BodyTextureIndex` (0..8), `FaceTextureIndex` (0..1), `Roughness`
  (clamped 0.85..1.15, default 1.06), hands and feet: `PalmLightness`, `PalmTint`,
  `PalmCavityDarkness`, `FingernailTintColor/Intensity/Metallic/Roughness`, `Toenail*`.
- `Freckles` — `Density`, `Strength`, `Saturation`, `ToneShift`, `Mask`
  (`EMetaHumanCharacterFrecklesMask`: `None`, `Type1`, `Type2`, `Type3`).
- `Accents` — `FMetaHumanCharacterAccentRegions`: `Scalp`, `Forehead`, `Nose`, `UnderEye`,
  `Cheeks`, `Lips`, `Chin`, `Ears`, each `FMetaHumanCharacterAccentRegionProperties`
  (`Redness`, `Saturation`, `Lightness`, 0..1, default 0.5).
- `DesiredTextureSourcesResolutions` — `FMetaHumanCharacterTextureSourceResolutions`:
  `FaceAlbedo`, `FaceNormal`, `FaceCavity`, `FaceAnimatedMaps`, `BodyAlbedo`, `BodyNormal`,
  `BodyCavity`, `BodyMasks`, each `ERequestTextureResolution` (`Res2k`=2048, `Res4k`,
  `Res8k`). Changing these makes `NeedsToDownloadTextureSources()` true.
- `TextureMaterialOverrides` — `FMetaHumanCharacterTextureMaterialOverrides`:
  `bEnableTextureOverrides` + `TextureOverrides` (`FMetaHumanCharacterSkinTextureSoftSet`,
  soft refs for face and body texture sets), `bEnableMaterialOverrides` + `MaterialOverrides`
  (`FMetaHumanCharacterMaterialOverrideSet`: face, "Teeth & Eyes" keyed by
  `EMetaHumanCharacterTeethAndEyesSlot`, `Body` — all `TSoftObjectPtr<UMaterialInstanceConstant>`),
  `bInheritUIParamsAndSrcTextures`.
- Deprecated in 5.8: top-level `bEnableTextureOverrides`, `TextureOverrides`.

The skin tone (`U`,`V`) is looked up in the texture-synthesis model
(`UMetaHumanCharacterEditorSubsystem::GetSkinTone(FVector2f)`), which is why skin preview is
flat without the optional content.

---

## Eyes settings

`FMetaHumanCharacterEyesSettings` = `EyeLeft` + `EyeRight` (`FMetaHumanCharacterEyeProperties`),
each with:

- `Iris` — `IrisPattern` (`EMetaHumanCharacterEyesIrisPattern` `Iris001..Iris009`;
  ScriptName `Pattern`), `IrisRotation` (ScriptName `Rotation`), `PrimaryColorU/V`,
  `SecondaryColorU/V` (0..1 colour-chart coordinates: U cool→warm, V dark→light),
  `ColorBlend`, `ColorBlendSoftness`, `BlendMethod` (`EMetaHumanCharacterEyesBlendMethod`,
  default `Structural`), `ShadowDetails`, `LimbalRingSize` (0.6..0.85), `LimbalRingSoftness`
  (0.02..0.15), `LimbalRingColor`, `GlobalSaturation` (0..4, default 2), `GlobalTint`.
- `Pupil` — `Dilation` (0.85..1.2), `Feather`.
- `Cornea` — `Size` (0.145..0.185), `LimbusSoftness`, `LimbusColor`.
- `Sclera` — `Rotation`, `bUseCustomTint`, `Tint`, `TransmissionSpread` (0.03..0.2),
  `TransmissionColor`, `VascularityIntensity` (0..2), `VascularityCoverage` (0.1..0.4).

Eye presets in `Content/Tools/EyePresets/` (`EyePresets` data + `T_EyePreset_001..012`).

---

## Makeup settings

`FMetaHumanCharacterMakeupSettings`:
- `Foundation` — `bApplyFoundation`, `PresetIndex`, `Color`, `Intensity`, `Roughness`,
  `Concealer`.
- `Eyes` — `Type` (`EMetaHumanCharacterEyeMakeupType`: `None`, `ThinLiner`, `SoftSmokey`,
  `FullThinLiner`, `CatEye`, `PandaSmudge`, `DramaticSmudge`, `DoubleMod`, `ClassicBar`),
  `PrimaryColor`, `SecondaryColor`, `Roughness`, `Opacity`, `Metalness`.
- `Blush` — `Type` (`EMetaHumanCharacterBlushMakeupType`), `Color`, `Intensity`, `Roughness`.
- `Lips` — `Type` (`EMetaHumanCharacterLipsMakeupType`), `Color`, `Roughness`, `Opacity`,
  `Metalness`.

Makeup is a material layer in the editor; at build time `FMetaHumanCharacterAssemblySettings::bBakeMakeup`
/ `FMetaHumanDCCExportParams::bBakeMakeUp` bakes it into the face textures.

---

## Body: parametric vs fixed

The body is a PCA/parametric model (`FMetaHumanCharacterBodyIdentity`, `MetaHumanCoreTechLib`)
driven by named constraints:

```cpp
USTRUCT(BlueprintType) struct FMetaHumanCharacterBodyConstraint
{
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) FName Name;         // "Height", "Fat", "Muscularity", "Masculine/Feminine", "Upper Arm Length", ...
    UPROPERTY(EditAnywhere, BlueprintReadWrite)  bool  bIsActive = false;        // inactive => TargetMeasurement ignored
    UPROPERTY(EditAnywhere, BlueprintReadWrite)  float TargetMeasurement = 100.f;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) float MinMeasurement = 50.f;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) float MaxMeasurement = 50.f;
};
```

`GetBodyConstraints(Character, bScaleMeasurementRangesWithHeight)` returns the full list with
current values and ranges; height is in centimetres, the rest are measurements whose
min/max you lerp between. Epic's `MetaHumanGenerator` toolset treats `Masculine/Feminine`,
`Fat`, `Muscularity` as 0..1 lerps over `[MinMeasurement, MaxMeasurement]`.

Fixed bodies (`bFixedBodyType = true`): either the 18 legacy compatibility bodies
`EMetaHumanBodyType` (`f_med_nrw` ... `m_tal_unw`, pattern `<f|m>_<srt|med|tal>_<nrw|ovw|unw>`;
`BlendableBody` is the parametric default) set via native `SetMetaHumanBodyType`, or a whole
rig imported from DNA (`ImportBodyWholeRig`, `FImportFromDNAParams::bImportWholeRig`). Legacy
bodies need `Optional/Body` content and `UMetaHumanCharacterEditorSettings::bShowCompatibilityModeBodies`.
`ResetParametricBody` returns to the blendable body.

Body fit options when importing DNA: `EMetaHumanCharacterBodyFitOptions` (`FitFromMeshOnly`,
`FitFromMeshAndSkeleton`, `FitFromMeshToFixedSkeleton`); `FConformBodyParams`
(`bBlendNeckToBody`, `bImportHelperJoints`, `bTargetIsInMetaHumanAPose`,
`bEstimateJointsFromMesh`, `bAutoRigHelperJoints`).

---

## Viewport settings and lighting

`FMetaHumanCharacterViewportSettings` persists the asset editor's view: `EMetaHumanCharacterEnvironment`
(`Studio`, `Split`, `Fireside`, `Moonlight`, `Tungsten`, `Portrait`, `RedLantern`,
`TextureBooth`, plus `Custom` and `Default` sentinels), `EMetaHumanCharacterLOD`
(`LOD0..LOD7`, `Auto`), `EMetaHumanCharacterCameraFrame`, `EMetaHumanCharacterRenderingQuality`.
Lighting maps are `Content/LightingEnvironments/*.umap`; custom presets are registered in
`UMetaHumanCharacterEditorSettings::CustomLightPresets` and `DefaultLightingEnvironment`.

---

## Assembly settings stored on the asset

`FMetaHumanCharacterAssemblySettings` (`MetaHumanCharacterAssemblySettings.h`:22) remembers
the last Assemble-tool choices: `PipelineType` (`EMetaHumanDefaultPipelineType`:
`Cinematic` "UE Cine (Complete)", `Optimized` "UE Optimized", `UEFN` "UEFN Export"),
`PipelineQuality` (`EMetaHumanQualityLevel`: `Low`, `Medium`, `High`, `Cinematic`),
`RootDirectory` (`/Game/MetaHumans`), `CommonDirectory` (`/Game/MetaHumans/Common`),
`AnimationSystemName` (`AnimationSystemNameAnimBP` = `"AnimBP"`), `NameOverride`,
`ArchiveName`, `OutputFolder`, `bBakeMakeup`, `bExportZipFile`. These mirror
`FMetaHumanCharacterEditorBuildParameters`, which is what you pass to `BuildMetaHuman`.

---

## Source references (UE 5.9)

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacter/Public/`:
- `MetaHumanCharacter.h`:29 — `EMetaHumanCharacterRigState`.
- `MetaHumanCharacter.h`:40 — `FMetaHumanCharacterAssetsSection`.
- `MetaHumanCharacter.h`:88 — `FMetaHumanCharacterFaceEvaluationSettings`.
- `MetaHumanCharacter.h`:119 — `FMetaHumanCharacterTextureInfo`.
- `MetaHumanCharacter.h`:162 — `FMetaHumanCharacterHeadModelSettings`.
- `MetaHumanCharacter.h`:206 — `UMetaHumanCharacter`; bulk-data API lines 235–378; UPROPERTYs lines 383–465.
- `MetaHumanCharacterSkin.h`:14 — `FMetaHumanCharacterSkinProperties`.
- `MetaHumanCharacterSkin.h`:88 — `EMetaHumanCharacterFrecklesMask`; 100 — `FMetaHumanCharacterFrecklesProperties`.
- `MetaHumanCharacterSkin.h`:136 — `FMetaHumanCharacterAccentRegions`.
- `MetaHumanCharacterSkin.h`:166 — `EMetaHumanCharacterSkinPreviewMaterial`.
- `MetaHumanCharacterSkin.h`:262 — `ERequestTextureResolution`; 271 — `FMetaHumanCharacterTextureSourceResolutions`.
- `MetaHumanCharacterSkin.h`:312 — `FMetaHumanCharacterTextureMaterialOverrides`.
- `MetaHumanCharacterSkin.h`:340 — `FMetaHumanCharacterSkinSettings`.
- `MetaHumanCharacterEyes.h`:17 — `EMetaHumanCharacterEyesIrisPattern`; 34 — `FMetaHumanCharacterEyeIrisProperties`.
- `MetaHumanCharacterEyes.h`:124 — pupil; 147 — sclera; 193 — cornea; 220 — `FMetaHumanCharacterEyeProperties`.
- `MetaHumanCharacterEyes.h`:241 — `FMetaHumanCharacterEyesSettings`.
- `MetaHumanCharacterEyes.h`:256 — `EMetaHumanCharacterEyelashesType`; 271 — `FMetaHumanCharacterEyelashesProperties`.
- `MetaHumanCharacterMakeup.h`:10 — foundation; 49 — `EMetaHumanCharacterEyeMakeupType`; 66 — eyes; 118 — blush; 161 — lips; 196 — `FMetaHumanCharacterMakeupSettings`.
- `MetaHumanCharacterTeeth.h`:10 — `EMetaHumanCharacterTeethType`; 28 — `FMetaHumanCharacterTeethProperties`.
- `MetaHumanCharacterViewport.h`:12 — `EMetaHumanCharacterEnvironment`; 34 — `EMetaHumanCharacterLOD`; 77 — `FMetaHumanCharacterViewportSettings`.
- `MetaHumanCharacterAssemblySettings.h`:14 — `EMetaHumanDefaultPipelineType`; 22 — `FMetaHumanCharacterAssemblySettings`.
- `MetaHumanCharacterGeneratedAssets.h`:27 — `FMetaHumanCharacterGeneratedAssets`.

Under `Engine/Plugins/MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanCoreTechLib/Public/`:
- `MetaHumanCharacterBodyIdentity.h`:31 — `EMetaHumanCharacterBodyFitOptions`; 39 — `FConformBodyParams`.
- `MetaHumanCharacterBodyIdentity.h`:89 — `FMetaHumanCharacterBodyConstraint`.
- `MetaHumanCharacterBodyIdentity.h`:123 — `FMetaHumanCharacterBodyIdentity::FState` (`GetBodyConstraints`, `EvaluateBodyConstraints`).
- `MetaHumanCharacterIdentity.h`:41 — `EAlignmentOptions`; 52 — `FFitToTargetOptions`; 166 — `FMetaHumanCharacterIdentity::FState`.

Under `Engine/Plugins/MetaHuman/MetaHumanSDK/Source/MetaHumanSDKRuntime/Public/`:
- `MetaHumanTypes.h`:53 — `EMetaHumanQualityLevel` (`EFaceTextureType`, `EBodyTextureType` earlier in the same file).
- `MetaHumanBodyType.h`:10 — `EMetaHumanBodyType`.
