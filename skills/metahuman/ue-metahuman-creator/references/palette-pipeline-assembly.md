# Palette, pipelines and assembly — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the palette object model
(`UMetaHumanCharacterPalette`, `UMetaHumanCollection`, `UMetaHumanInstance`,
`UMetaHumanWardrobeItem`, item keys and slot selections), the pipeline class hierarchy, the
default pipelines and their assembly output, the Blueprint function libraries, project
settings and what a build writes to disk. Grounded in UE 5.8 (`MetaHumanCharacterPalette`,
`MetaHumanDefaultPipeline`, `MetaHumanDefaultEditorPipeline` modules).

---

## Object model

```
UMetaHumanCharacter
 └─ InternalCollection : UMetaHumanCollection (UMetaHumanCharacterPalette)
     ├─ Items[] : FMetaHumanCharacterPaletteItem  { WardrobeItem, Variation, SlotName, PipelineProperties }
     │     └─ key = FMetaHumanPaletteItemKey      { PrincipalAssetOrExternalWardrobeItem, Variation }
     ├─ Pipeline : UMetaHumanCollectionPipeline  (e.g. BP_DefaultPipeline → UMetaHumanDefaultPipeline)
     │     └─ EditorPipeline : UMetaHumanCollectionEditorPipeline (UMetaHumanDefaultEditorPipeline)
     └─ DefaultInstance : UMetaHumanInstance    { SlotSelections[], overridden instance parameters }
UMetaHumanWardrobeItem (UMetaHumanCharacterPalette)  { PrincipalAsset, Pipeline : UMetaHumanItemPipeline }
```

### UMetaHumanCharacterPalette (abstract base)

- **BP** `TryAddItemFromWardrobeItem(FName SlotName, UMetaHumanWardrobeItem*, FMetaHumanPaletteItemKey& OutNewItemKey)`
  — the wardrobe item must be a standalone asset (not another palette's internal item).
- `TryAddItemFromPrincipalAsset(SlotName, FSoftObjectPath, OutKey)` — creates an internal
  wardrobe item for a raw asset (groom binding, outfit, skeletal mesh).
- `TryAddItem`, `TryRemoveItem`, `TryUpdateItemNonBuildProperties`, replace-in-place,
  `GenerateUniqueVariationName`, `ContainsItem`, `GetItems()`, `CopyContentsFromPalette`.
- Virtuals: `GetPalettePipeline()`, `GetPaletteEditorPipeline()`, `OnItemsModified()`,
  `TryImportWardrobeItem` (editor pipelines use this to validate compatibility).

### UMetaHumanCollection

`UCLASS(BlueprintType)`; editor-only mutation. Key members:
- `Pipeline` (`EditAnywhere, Instanced`, filtered by `GetDisallowedPipelineClasses()` —
  hides `meta=(MetaHumanCreatorOnly)` pipelines such as `UMetaHumanDefaultPipelineBase`
  subclasses when the collection is not a character's internal one).
- `DefaultInstance` (`BlueprintReadOnly`, editor-only data) → `GetDefaultInstance()` /
  `GetMutableDefaultInstance()`.
- Pipeline control: `SetDefaultPipeline()`, `SetPipeline(UMetaHumanCollectionPipeline*)`,
  `SetPipelineFromClass(TSubclassOf<...>)`, `GetPipeline()`, `GetMutablePipeline()`,
  `GetEditorPipeline()`.
- Build data: `SetQuality(EMetaHumanCharacterPaletteBuildQuality)` (`Production` or
  `Preview`; changing it clears built data), `GetQuality()`, `GetBuiltData()`,
  `ClearBuiltData()`, `RefreshBuildCacheGuid()`, `UnpackAssets(OnComplete)`.
- Unpack target: `UnpackPathMode` (`EMetaHumanCharacterUnpackPathMode`) + a folder; `GetUnpackFolder()`.
  The build's `AbsoluteBuildPath` overrides this.
- `CopyContentsFrom(Other)`; delegates `FOnCollectionBuilt`, `FOnPipelineChanged`,
  `FOnBuildComplete(EMetaHumanBuildStatus)` (`FOnPaletteBuilt` deprecated 5.8).
- `FMetaHumanCollectionBuiltData` (`IsValid()`) holds the per-item `FMetaHumanPaletteBuiltData`.

### UMetaHumanInstance

- **BP** `Assemble(const FMetaHumanCharacterAssembled& OnAssembled)` (+ native overloads with
  `FMetaHumanCharacterAssembledNative` and an explicit `EMetaHumanCharacterPaletteBuildQuality`).
- **BP** `GetAssemblyOutput()` (BlueprintPure; triggers assembly if needed),
  `GetExistingAssemblyOutput()`, `IsAssembled()`, `ClearAssemblyOutput()`. The output is an
  `FInstancedStruct` whose type is pipeline-defined — `FMetaHumanDefaultAssemblyOutput` for
  the default pipelines.
- **BP** `SetMetaHumanCollection(UMetaHumanCollection*)`, `GetMetaHumanCollection()`.
- **BP** `SetSingleSlotSelection(FName SlotName, const FMetaHumanPaletteItemKey&)` — replace
  selection (NAME_None key clears the slot); `TryAddSlotSelection(const FMetaHumanPipelineSlotSelection&)`
  (`[[nodiscard]] bool`; rejects duplicates and multi-select on single slots);
  `GetSlotSelectionData()`. Native: `TryGetAnySlotSelection`, `ContainsSlotSelection`,
  `TryRemoveSlotSelection`, `ToPinnedSlotSelections`.
- Instance parameters: `GetAssemblyInstanceParameters()`, `GetAssemblyParameters()`,
  `GetPostAssemblyParameters()`, `GetOverriddenInstanceParameters()`,
  `GetCurrentInstanceParametersForItem(ItemPath)`, `OverrideInstanceParameters(ItemPath, FInstancedPropertyBag)`
  → `EMetaHumanInstanceParameterOverrideResult`, `ClearOverriddenInstanceParameters`.
- `TryUnpack(TargetFolder)`; cook behaviour `EMetaHumanInstanceCookBehavior` /
  `ShouldCookInstanceAsAssembled` (the editor pipeline decides whether cooked instances ship
  pre-assembled).

### UMetaHumanWardrobeItem

`PrincipalAsset` (`FEditorOnlyAssetReference`, "Principal Asset"), private `Pipeline`
(`Instanced TObjectPtr<UMetaHumanItemPipeline>`; `SetPipeline`, `GetPipeline`,
`GetEditorPipeline`), `IsExternal()`, thumbnail info/image/name. Pick the item pipeline for
the asset type: `UMetaHumanGroomPipeline` (groom binding), `UMetaHumanOutfitPipeline`
(Chaos outfit / cloth), `UMetaHumanSkeletalMeshPipeline`. The shipped defaults are
`Content/BuildPipeline/DefaultWardobePipeline/{DefaultGroomPipeline,DefaultOutfitPipeline,DefaultSkeletalMeshPipeline}`.
Factory: `UMetaHumanWardrobeItemFactory` (`MetaHumanCharacterPaletteEditor`).

### Keys, paths, selections

- `FMetaHumanPaletteItemKey` (`BlueprintType`): `FromPrincipalAsset(SoftObjectPtr, Variation)`,
  `FromExternalWardrobeItem(SoftObjectPtr<UMetaHumanWardrobeItem>, Variation)`,
  `ReferencesExternalWardrobeItem()`, `ReferencesSameAsset(Other)`, `IsNull()`, `Reset()`,
  `ToAssetNameString()`, `ToDebugString()`; public `Variation` (`FName`, usually `NAME_None`).
- `FMetaHumanPaletteItemPath` — a key plus parent path for nested items; make with
  `UMetaHumanPaletteItemPathBlueprintLibrary::MakeItemPath(Key)`.
- `FMetaHumanPipelineSlotSelection` (`HasNativeMake` → `MakeSlotSelection`): ctor
  `(FName SlotName, const FMetaHumanPaletteItemKey& SelectedItem)` or with a parent path;
  `GetSelectedItemPath()`.
- `FMetaHumanCharacterPaletteItem`: `WardrobeItem`, `Variation`, `SlotName`, editor
  `DisplayName`, `PipelineEditorProperties`, `PipelineProperties` (`FInstancedStruct`);
  `GetItemKey()`, `GetOrGenerateDisplayName()`, `LoadPrincipalAssetSynchronous()`.

Default slot names (`UMetaHumanDefaultPipelineBase`): `OutfitsSlotName`, `TopGarmentSlotName`,
`BottomGarmentSlotName`, `SkeletalMeshSlotName`; groom slots are `Hair`, `Eyebrows`,
`Beard`, `Mustache`, `Eyelashes`, `Peachfuzz` (the fields of the assembly output). Query the
real list with `UMetaHumanCollectionBlueprintLibrary::GetSlotNames(Palette)`.

---

## Pipelines

```
UMetaHumanCharacterPipeline (abstract)              runtime: assembles; SetInstanceParameters(...)
 ├─ UMetaHumanCollectionPipeline                     AssembleCollection(FAssembleCollectionParams, FOnAssemblyComplete)
 │    └─ UMetaHumanDefaultPipelineBase  meta=(MetaHumanCreatorOnly)   slot names, DefaultAssetPipelines, Specification
 │         ├─ UMetaHumanDefaultPipeline        (Blueprintable, EditInlineNew) → BP_DefaultPipeline; ActorClass must implement IMetaHumanCharacterActorInterface
 │         ├─ UMetaHumanDefaultPipelineLegacy  → BP_DefaultLegacyPipeline[_Low|_Medium|_High]
 │         └─ UMetaHumanDefaultPipelineUEFN : Legacy → BP_DefaultUEFNPipeline_*; UEFN project path
 └─ UMetaHumanItemPipeline                           AssembleItem / AssembleItemSynchronous / SetPostAssemblyParameters
      ├─ UMetaHumanGroomPipeline      output FMetaHumanGroomPipelineAssemblyOutput; BP ApplyGroomAssemblyOutputToGroomComponent
      ├─ UMetaHumanOutfitPipeline     output FMetaHumanOutfitPipelineAssemblyOutput; BP ApplyOutfitAssemblyOutputToClothComponent / ToMeshComponent
      └─ UMetaHumanSkeletalMeshPipeline  output FMetaHumanSkeletalMeshPipelineAssemblyOutput

UMetaHumanCharacterEditorPipeline (abstract, editor)   slot compatibility: IsPrincipalAssetClassCompatibleWithSlot, TestWardrobeItemCompatibilityWithSlot → EMetaHumanWardrobeItemCompatibility
 ├─ UMetaHumanCollectionEditorPipeline               BuildCollection, ValidateCollection, WriteActorBlueprint, UpdateActorBlueprint, GetRuntimePipeline
 │    └─ UMetaHumanDefaultEditorPipelineBase          texture baking, LOD, hair, body RigLogic, costume properties; EditorActorClass, FaceSkeleton, BodySkeleton
 │         ├─ UMetaHumanDefaultEditorPipeline         WriteActorBlueprint(FWriteBlueprintSettings), UpdateActorBlueprint
 │         ├─ UMetaHumanDefaultEditorPipelineLegacy
 │         └─ UMetaHumanDefaultEditorPipelineUEFN
 └─ UMetaHumanItemEditorPipeline (Groom / Outfit / SkeletalMesh editor pipelines)
```

Each runtime pipeline owns its editor pipeline (`SetDefaultEditorPipeline`,
`GetEditorPipeline`, `GetMutableEditorPipeline`) as an `Instanced` property restricted by
`AllowedClasses`. Pipelines are `Blueprintable, EditInlineNew`: Epic's defaults are
Blueprint subclasses in `Content/BuildPipeline/`, and projects may subclass them to change
baking/LOD settings.

Quality: `EMetaHumanCharacterPaletteBuildQuality { Production, Preview }` is the palette
build quality (preview = the asset editor); `EMetaHumanQualityLevel { Low, Medium, High, Cinematic }`
is the *target* quality of the Optimized/UEFN pipelines (`FWriteBlueprintSettings::QualityLevel`,
`UMetaHumanCharacterPaletteProjectSettings::DefaultCharacterLegacyPipelines[Quality]`).

### Assembly output of the default pipelines

```cpp
USTRUCT(BlueprintType) struct FMetaHumanDefaultAssemblyOutput
{
    TObjectPtr<USkeletalMesh> FaceMesh;
    TObjectPtr<USkeletalMesh> BodyMesh;
    FMetaHumanGroomPipelineAssemblyOutput Hair, Eyebrows, Beard, Mustache, Eyelashes, Peachfuzz;
    TArray<FMetaHumanSkeletalMeshPipelineAssemblyOutput> SkeletalMeshData;
    TArray<FMetaHumanOutfitPipelineAssemblyOutput> ClothData;
};
```

An actor implementing `IMetaHumanCharacterActorInterface` (`SetMetaHumanInstance(UMetaHumanInstance*)`,
`GetMetaHumanInstance()`; `BlueprintNativeEvent, CallInEditor`) reads this struct from
`Instance->GetAssemblyOutput()` and assigns meshes/grooms/cloth to its components, using the
item pipelines' static **BP** helpers (`ApplyGroomAssemblyOutputToGroomComponent`, ...). The
built `BP_<Name>` and the editor preview actor (`AMetaHumanDefaultEditorPipelineActor :
AMetaHumanCharacterEditorActor`) both do this. `SetCharacterInstance` is the 5.8-deprecated name.

### Editor pipeline build knobs (`UMetaHumanDefaultEditorPipelineBase`)

`FMetaHumanMaterialBakingProperties` / `UMetaHumanMaterialBakingSettings` (texture graph
baking, `EMetaHumanBuildTextureResolution`, VT outputs), `FMetaHumanHairProperties`
(pre-baked grooms, cards), `FMetaHumanCostumeProperties`, `FMetaHumanBodyProperties` /
`FMetaHumanBodyRigLogicProperties` (unpack RigLogic, RBF to pose assets),
`FMetaHumanLODProperties` (face/body LOD settings assets, overrides), `FMetaHumanBuildTextureProperties`,
`EditorActorClass`, `FaceSkeleton`, `BodySkeleton`, bone-count optimisation. Overrides:
`BuildCollection`, `CanBuild`, `UnpackCollectionAssets`, `TryUnpackInstanceAssets`,
`TestWardrobeItemCompatibilityWithSlot`, `GetEditorActorClass`.

`FWriteBlueprintSettings { FString BlueprintPath; EMetaHumanQualityLevel QualityLevel = Cinematic; FName AnimationSystemName; }`
is what `FMetaHumanCharacterEditorBuild` passes to `WriteActorBlueprint`; `BlueprintPath` is
`Collection->GetUnpackFolder() / "BP_<CharacterName>"`.

---

## Blueprint / Python function libraries (`MetaHumanCollectionBlueprintLibrary.h`)

| Library | Functions |
|---|---|
| `UMetaHumanPaletteKeyBlueprintLibrary` | `ReferencesSameAsset`, `ToAssetNameString`, `IsNull` (ScriptMethod on `FMetaHumanPaletteItemKey`) |
| `UMetaHumanPaletteItemPathBlueprintLibrary` | `MakeItemPath(Key)` |
| `UMetaHumanCharacterInstanceParameterBlueprintLibrary` | `Get/SetBoolInstanceParameter`, `Get/SetFloat...`, `Get/SetName...`, `Get/SetString...`, `Get/SetColor...`, `Get/SetObject...`, `Get/SetSoftObject...` on `FMetaHumanCharacterInstanceParameter` (ScriptMethods `get_float`, `set_color`, ...) |
| `UMetaHumanPipelineSlotSelectionBlueprintLibrary` | `MakeSlotSelection(SlotName, SelectedItem, ParentItemPath)`, `GetSelectedItemPath`, `GetSelectedSlotName`, `GetSelectedItemKey` |
| `UMetaHumanCollectionBlueprintLibrary` | `GetPipelineSpecification(Palette)`, `GetSlotNames`, `GetAllItemKeys`, `GetItemKeysForSlot`, `GetItemKeysForPrincipalAsset`, `GetItemKeysForWardrobeItem`, `GetItemSlotName`, `GetItemDisplayName` |
| `UMetaHumanCharacterInstanceBlueprintLibrary` | `DuplicateMetaHumanInstance(Source, Outer)`, `GetInstanceParametersForItem(Instance, ItemPath)` (ScriptMethod `get_instance_parameters`), `GetInstanceParameterItemPaths`, `TryGetInstanceParameter(Instance, ItemPath, Name, Out)`, `GetAllowedItemKeysForSlot(Instance, Slot)` |

`FMetaHumanCharacterInstanceParameter` carries `Name`, `EMetaHumanCharacterInstanceParameterType`
and the value; setting it through the library writes an override on the instance.
Parameters exist only after an assembly (`RunCharacterEditorPipelineForPreview` in the
editor, `Assemble` at runtime) — read "the Parameter Output from the latest assembly".

---

## Project settings

- `UMetaHumanCharacterPaletteProjectSettings` (`Config=MetaHumanCharacter`, section
  "MetaHuman Character Build"): `DefaultCharacterPipelineClass`,
  `DefaultCharacterLegacyPipelines` (`TMap<EMetaHumanQualityLevel, TSoftClassPtr<UMetaHumanCollectionPipeline>>`),
  `DefaultCharacterUEFNPipelines`. `FMetaHumanCharacterEditorBuild::GetDefaultPipelineClass(Type, Quality)`
  resolves through these.
- `UMetaHumanCharacterEditorSettings` (section "MetaHumanCharacter"): texture synthesis dir
  and thread count, `bShowCompatibilityModeBodies`, `bEnableExperimentalWorkflows`,
  `PresetsDirectories`, `PresetsThumbnailType`, migration (`MigrationAction`,
  `MigratedPackagePath`, `MigratedNamePrefix/Suffix`), `WardrobePaths`
  ("New Wardrobe Default Asset Paths"), `bEnableWardrobeItemValidation`,
  `bSuppressMessageLogWhenValidatingItems`, lighting presets, rendering-quality profiles
  (`GetAllRenderingQualityProfiles`, `AddUserRenderingQualityProfile`, ...), `bUseVirtualTextures`.
- `UMetaHumanCharacterUAFProjectSettings` (experimental plugin): `Blueprints` per quality.

---

## What a build writes

`FMetaHumanCharacterEditorBuild::BuildMetaHumanCharacter(Character, Params)`:
1. Resolves the pipeline: `Params.PipelineOverride`, else the character's
   `PipelinesPerClass` entry for `GetDefaultPipelineClass(PipelineType, PipelineQuality)`.
2. Builds the internal collection at `Production` quality (`BuildCollection`): generates face
   and body skeletal meshes from the states + DNA (`FMetaHumanCharacterGeneratedAssets`:
   `FaceMesh`, `BodyMesh`, `BodyRigLogicAssets`, optional `MergedHeadAndBodyMesh`, metadata),
   bakes textures/materials, builds grooms and outfits per item pipeline, strips LODs by
   quality.
3. Unpacks into `<AbsoluteBuildPath>/<NameOverride or CharacterName>/` (face, body, grooms,
   materials, textures, a duplicated `UMetaHumanCollection` + `UMetaHumanInstance`) and
   shared assets into `CommonFolderPath` (default `/Game/MetaHumans/Common`; extenders may add
   package roots to copy there).
4. `WriteActorBlueprint` → `BP_<CharacterName>` (`UMetaHumanDefaultEditorPipeline` for
   Cinematic/Optimized; legacy pipelines write the pre-5.6 actor layout, UEFN writes to a
   `.uefnproject`). `AnimationSystemName` selects the AnimBP/UAF variant.
5. Optional DCC/zip export when `ArchiveName` / `bExportZipFile` are set in the assembly tool.

Content-side dependencies the Blueprint will reference: `Face_Archetype_Skeleton`,
`ABP_Face` / `ABP_Face_PostProcess`, `ABP_Body_PostProcess`, `metahuman_base_skel`,
`PHYS_Face` / `PHYS_Body`, `Face_LODSettings*` / `Body_LODSettings*`, materials under
`Content/Materials/`, and (when selected) grooms/outfits from `Optional/`.

---

## Source references (UE 5.9)

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterPalette/Public/`:
- `MetaHumanCharacterPalette.h`:77 — `UMetaHumanCharacterPalette`; 93 — `TryAddItemFromWardrobeItem`.
- `MetaHumanCollection.h`:19 — `EMetaHumanCharacterUnpackPathMode`; 48 — `FMetaHumanCollectionBuiltData`; 71 — `UMetaHumanCollection`; 375 — `Pipeline`; 379 — `DefaultInstance`.
- `MetaHumanInstance.h`:133 — `UMetaHumanInstance`; 144 — `Assemble`; 157 — `GetAssemblyOutput`; 243 — `SetSingleSlotSelection`; 263 — `TryAddSlotSelection`; 386 — `OverrideInstanceParameters`.
- `MetaHumanWardrobeItem.h`:14 — `UMetaHumanWardrobeItem`.
- `MetaHumanPaletteItemKey.h`:15 — `FMetaHumanPaletteItemKey`.
- `MetaHumanPaletteItemPath.h` — `FMetaHumanPaletteItemPath`.
- `MetaHumanCharacterPaletteItem.h`:18 — `FMetaHumanCharacterPaletteItem`.
- `MetaHumanPipelineSlotSelection.h`:12 — `FMetaHumanPipelineSlotSelection`.
- `MetaHumanCharacterPipeline.h`:36 — `EMetaHumanCharacterPaletteBuildQuality`; 78 — `FMetaHumanAssemblyOutput`; 138 — `UMetaHumanCharacterPipeline`.
- `MetaHumanCollectionPipeline.h`:19 — `UMetaHumanCollectionPipeline`.
- `MetaHumanItemPipeline.h`:19 — `UMetaHumanItemPipeline`.
- `MetaHumanCharacterEditorPipeline.h`:25 — `EMetaHumanBuildStatus`; 32 — `EMetaHumanWardrobeItemCompatibility`; 57 — `UMetaHumanCharacterEditorPipeline`.
- `MetaHumanCollectionEditorPipeline.h`:43 — `UMetaHumanCollectionEditorPipeline`; 218 — `FWriteBlueprintSettings`; 224 — `WriteActorBlueprint`.
- `MetaHumanCollectionBlueprintLibrary.h`:32 — key library; 128 — item-path library; 210 — `FMetaHumanCharacterInstanceParameter`; 255 — parameter library; 337 — slot-selection library; 372 — `UMetaHumanCollectionBlueprintLibrary`; 437 — `UMetaHumanCharacterInstanceBlueprintLibrary`.
- `MetaHumanCharacterActorInterface.h`:24 — `IMetaHumanCharacterActorInterface`.
- `MetaHumanCharacterPaletteProjectSettings.h`:13 — `UMetaHumanCharacterPaletteProjectSettings`.
- `MetaHumanCharacterPipelineSpecification.h`:178 — `UMetaHumanCharacterPipelineSpecification`; 118 — `FMetaHumanCharacterPipelineSlot`.

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanDefaultPipeline/Public/`:
- `MetaHumanDefaultPipelineBase.h`:37 — `FMetaHumanDefaultAssemblyOutput`; 79 — `UMetaHumanDefaultPipelineBase`; 115 — `IMetaHumanCharacterPipelineExtender`.
- `MetaHumanDefaultPipeline.h`:20 — `UMetaHumanDefaultPipeline`.
- `MetaHumanDefaultPipelineLegacy.h`:20 — `UMetaHumanDefaultPipelineLegacy`.
- `MetaHumanDefaultPipelineUEFN.h`:20 — `UMetaHumanDefaultPipelineUEFN`.
- `Item/MetaHumanGroomPipeline.h`:43 — `FMetaHumanGroomPipelineAssemblyOutput`; 61 — `UMetaHumanGroomPipeline`; 81 — `ApplyGroomAssemblyOutputToGroomComponent`.
- `Item/MetaHumanOutfitPipeline.h`:74 — `FMetaHumanOutfitPipelineAssemblyOutput`; 96 — `UMetaHumanOutfitPipeline`; 116 — `ApplyOutfitAssemblyOutputToClothComponent`; 119 — `ApplyOutfitAssemblyOutputToMeshComponent`.
- `Item/MetaHumanSkeletalMeshPipeline.h`:35 — `FMetaHumanSkeletalMeshPipelineAssemblyOutput`; 57 — `UMetaHumanSkeletalMeshPipeline`.

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanDefaultEditorPipeline/Public/`:
- `MetaHumanDefaultEditorPipelineBase.h`:193 — `EMetaHumanBuildTextureResolution`; 204 — `FMetaHumanHairProperties`; 298 — `FMetaHumanBodyRigLogicProperties`; 344 — `FMetaHumanLODProperties`; 390 — `UMetaHumanMaterialBakingSettings`; 482 — `UMetaHumanDefaultEditorPipelineBase`.
- `MetaHumanDefaultEditorPipeline.h`:13 — `UMetaHumanDefaultEditorPipeline`.
- `MetaHumanDefaultEditorPipelineActor.h`:26 — `AMetaHumanDefaultEditorPipelineActor`.

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterEditor/`:
- `Public/Subsystem/MetaHumanCharacterBuild.h`:150 — `FMetaHumanCharacterEditorBuild`; 210 — `GetDefaultPipelineClass`.
- `Private/Subsystem/MetaHumanCharacterBuild.cpp`:1564 — `BP_{CharacterName}` naming.
- `Public/MetaHumanCharacterEditorSettings.h`:36 — `UMetaHumanCharacterEditorSettings`.

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterPaletteEditor/Public/`:
- `MetaHumanWardrobeItemFactory.h` — `UMetaHumanWardrobeItemFactory`.
- `MetaHumanCollectionFactory.h` — `UMetaHumanCollectionFactory`.
- `MetaHumanCharacterEditorActorInterface.h` — `IMetaHumanCharacterEditorActorInterface`.
