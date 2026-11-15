# Custom wardrobe content — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers getting project-made grooms and clothing
into the MetaHuman Creator wardrobe: why only `UMetaHumanWardrobeItem` assets appear, the
`WardrobePaths` project setting and how monitored folders behave, which principal asset each
slot takes, the item pipeline that validation requires, authoring a custom groom against the
library template head so the Creator transfers it to any face, the library hair settings to
match, the preview-collection trap when scripting a character that is open in the Creator,
per-item instance parameters, and skeletal-mesh clothing versus Chaos outfits. Grounded in
UE 5.8 (`MetaHumanCharacterEditor`, `MetaHumanCharacterPalette`, `MetaHumanDefaultPipeline`,
`MetaHumanDefaultEditorPipeline`, `HairStrandsCore`), re-checked against 5.9 with line numbers
re-mapped. Lines marked **Observed in 5.8** are editor behaviour seen in practice and not traced
to source.

---

## Why a groom or mesh does not show up

The Hair & Clothing tool lists **only `UMetaHumanWardrobeItem` (`WI_`) assets**. No slot
accepts a `UGroomAsset` (groom slots take a `UGroomBindingAsset`), so dragging a groom into
the wardrobe does nothing. Dropping a principal asset depends on where it lands:

- **On a monitored-folder view:** nothing happens. Only views backed by a virtual folder
  allow dropping (`SMetaHumanCharacterEditorAssetViewsPanel.cpp`).
- **On the slot's "Individual Assets" box** (every slot panel gets one at the top,
  `bPureVirtual = true`, `ClassesToFilter = {UMetaHumanWardrobeItem}`): a supported principal
  asset (a groom binding on a groom slot, a `USkeletalMesh`, a `UChaosOutfitAsset`) is wrapped
  in a `WI_<Name>`, given a new instance of the collection's fallback item pipeline
  (`UMetaHumanDefaultPipelineBase::DefaultAssetPipelines`), duplicated into the dropped
  asset's own folder and added to `Character->WardrobeIndividualAssets[Slot]`. This path is
  read from source; it was not exercised in the editor.
- **A content-browser folder dropped on the same "Individual Assets" box** adds a project
  `WardrobePaths` entry for that slot (`OnProcessDroppedFolders`). Folder drops on
  monitored-folder views are ignored like any other drop.

For anything repeatable, create the `WI_` asset yourself (see "Making a wardrobe item").

---

## Slot → principal asset class

From the `UMetaHumanDefaultEditorPipelineBase` constructor and the runtime slot spec in
`UMetaHumanDefaultPipelineBase`:

| Slot (`FName`) | Principal asset | Default item pipeline (Blueprint in `/MetaHumanCharacter/BuildPipeline/DefaultWardobePipeline/`) | Notes |
|---|---|---|---|
| `Hair`, `Eyebrows`, `Beard`, `Mustache`, `Eyelashes`, `Peachfuzz` | `UGroomBindingAsset` | `DefaultGroomPipeline` (child of `UMetaHumanDefaultGroomPipeline`) | Single selection (`bAllowsMultipleSelection` defaults to false). |
| `Outfits` | `UChaosOutfitAsset` | `DefaultOutfitPipeline` | Multi-select, `bVisibleToUser = false`. |
| `Top Garment`, `Bottom Garment` | `UChaosOutfitAsset` | `DefaultOutfitPipeline` | Virtual slots, `TargetSlot = Outfits`. |
| `SkeletalMesh` | `USkeletalMesh` | `DefaultSkeletalMeshPipeline` | Multi-select; UI label "Skeletal Clothing". |
| `Character` | `UMetaHumanCharacter` | — | |

The folder name `DefaultWardobePipeline` is Epic's spelling. Because a groom slot holds one
item, an add-on fringe or bangs groom cannot be layered as a second `Hair` item; merge it into
the main groom as another hair group instead. After changing the group count, rebuild the
binding (`binding.build(unreal.OnGroomBindingAssetBuildComplete())`): a binding whose group
count differs from its groom's is rejected and the groom renders unbound
(`UGroomBindingAsset::IsCompatible`).

---

## Project wardrobe folders (`WardrobePaths`)

`UMetaHumanCharacterEditorSettings` is `UCLASS(BlueprintType, config = MetaHumanCharacter, defaultconfig)`,
so its `WardrobePaths` ("New Wardrobe Default Asset Paths") live in the project's
`Config/DefaultMetaHumanCharacter.ini` under
`[/Script/MetaHumanCharacterEditor.MetaHumanCharacterEditorSettings]`. A source comment that
mentions `DefaultEditor.ini` is stale; old values in `EditorPerProjectUserSettings` are
migrated once.

`FMetaHumanCharacterAssetsSection` (plain `USTRUCT()`, not `BlueprintType`):

| Field | Type | Meaning |
|---|---|---|
| `ContentDirectoryToMonitor` | `FDirectoryPath` (`LongPackageName`) | Folder to list. |
| `SlotName` | `FName` | Target slot (table above). |
| `ClassesToFilter` | `TArray<TSubclassOf<UObject>>` | Principal asset classes to accept. |
| `bPureVirtual` | `bool`, `UPROPERTY()` only | Hidden in the settings UI but serialised; a virtual section lists `WardrobeIndividualAssets` instead of a folder. |

```ini
[/Script/MetaHumanCharacterEditor.MetaHumanCharacterEditorSettings]
+WardrobePaths=(ContentDirectoryToMonitor=(Path="/Game/Characters/Wardrobe/Hair"),SlotName="Hair",ClassesToFilter=("/Script/HairStrandsCore.GroomBindingAsset"),bPureVirtual=False)
+WardrobePaths=(ContentDirectoryToMonitor=(Path="/Game/Characters/Wardrobe/Clothing"),SlotName="SkeletalMesh",ClassesToFilter=("/Script/Engine.SkeletalMesh"),bPureVirtual=False)
+WardrobePaths=(ContentDirectoryToMonitor=(Path="/Game/Characters/Wardrobe/Outfits"),SlotName="Outfits",ClassesToFilter=("/Script/ChaosOutfitAssetEngine.ChaosOutfitAsset"),bPureVirtual=False)
```

The plugin's own sections in `Engine/Plugins/MetaHuman/MetaHumanCharacter/Config/Editor.ini`
use the long form `ClassesToFilter=("/Script/CoreUObject.Class'/Script/HairStrandsCore.GroomBindingAsset'")`.

How the Creator uses them:

- **Three lists are merged:** the plugin's `UMetaHumanCharacterEditorWardrobeSettings::WardrobeSections`
  (plugin `Config/Editor.ini`, used only when the Optional content is installed), then the
  character's own `WardrobePaths`, then the project `WardrobePaths`.
- **A section is dropped silently** when `ClassesToFilter` is empty, its (non-virtual) path
  cannot be mapped to a filename, or `SlotName` is set but is not in the pipeline's
  `SlotEditorData` or does not support a filter class. A section with no `SlotName` is kept.
- **Folders are monitored non-recursively.** The asset-registry filter gets only
  `PackagePaths.Add(Dir)` with no recursion, and a `DirectoryWatcher` callback triggers the
  refresh. A section lists the `WI_` assets directly in the folder whose `PrincipalAsset`
  class is in `ClassesToFilter`; the principal asset itself can live anywhere. So keep each
  `WI_` in the monitored folder; the groom and binding may sit in a subfolder. The library
  keeps bindings and `WI_` files flat side by side in
  `/MetaHumanCharacter/Optional/Grooms/Bindings/Hair`.
- **Auto-created items have no pipeline.** Each time a non-virtual section is populated,
  `CreateWardrobeItemsForCompatibleAssets` creates `WI_<AssetName>` in the same folder (via
  `UMetaHumanWardrobeItemFactory`) for every principal asset there that no `WI_` points at.
  The factory sets **no `Pipeline`**, so those items fail validation (next section). Do not
  leave raw bindings or meshes in a monitored folder unless you will fix their items.
- **Live changes:** editing `WardrobePaths` in Project Settings goes through
  `PostEditChangeProperty`, which broadcasts `OnWardrobePathsChanged` and refreshes the
  wardrobe. A hand edit of the ini is read when the editor starts. `FMetaHumanCharacterAssetsSection`
  has no Blueprint-visible fields, so Python does not expose it and cannot build entries;
  edit the ini or Project Settings.

---

## Wardrobe items need a pipeline

`ValidateWardrobeItem` runs `VerifyGroomWardrobeItem`, `VerifySkelMeshClothingWardrobeItem` or
`VerifyOutfitWardrobeItem` (`MetaHumanCharacterTypesVerification.cpp`). Each raises an error
unless `WardrobeItem->GetPipeline()` is valid and derives from `UMetaHumanGroomPipeline`,
`UMetaHumanSkeletalMeshPipeline` or `UMetaHumanOutfitPipeline` respectively, and the
`PrincipalAsset` matches. On failure `TestWardrobeItemCompatibilityWithSlot` does not return
`Add`: the tile shows as invalid and Wear (`ApplyWearRequest`, which always validates) skips
it. Build-time code (`UMetaHumanCharacterPalette::TryResolveItemPipeline`) would fall back to
`DefaultAssetPipelines` for a null pipeline, but validation does not.

Further checks:
- A `SkeletalMesh` principal fails `UVerifyMetaHumanSkeletalClothing` when its skeleton is not
  MetaHuman-body compatible (`IsMetaHumanBodyCompatibleSkeleton`). Observed in 5.8: card hair
  skinned to a third-party head skeleton is rejected for this reason.
- Outfit items get a warning when the pipeline has no `BodyHiddenFaceMapTexture` (the
  body-culling mask).
- Groom items run `UVerifyMetaHumanGroom` with the alignment and detailed grooming-mesh checks
  off, but its basic binding checks still raise **errors** that make the item unwearable: no
  `SourceSkeletalMesh` on the binding, no `TargetSkeletalMesh`, groom bounds that do not
  overlap the source mesh, or a group whose strand bounds miss it (see "Binding rules" below).
- `bEnableWardrobeItemValidation` (default true, project setting) turns all of this off and
  lets pipeline-less or incompatible items be worn. `bSuppressMessageLogWhenValidatingItems`
  only stops the Message Log popping up.

### Making a wardrobe item

The easiest correct item is a **duplicate of a library item with its `PrincipalAsset`
repointed**: the duplicate keeps the library `DefaultGroomPipeline` (or outfit / skeletal-mesh
pipeline) and its per-item settings. Alternatives: create a `UMetaHumanWardrobeItem` with
`UMetaHumanWardrobeItemFactory` and set the private `Pipeline` property through the editor
(property-change path runs `SetPipeline`, which also creates the default editor pipeline), or
drop the asset on the slot's "Individual Assets" box. Set `ThumbnailImage` /
`ThumbnailName` for the tile.

`PrincipalAsset` is an `FEditorOnlyAssetReference` (`BlueprintType`) whose fields are private:
`Asset` (`EditAnywhere` `TSoftObjectPtr`, the editor's authoritative value, read by
`ToSoftObjectPath()`) and `AssetIdentifier` (plain `UPROPERTY()`, refreshed from `Asset` in
`Serialize` on save). The struct is not Blueprint-visible on the item, so read it, edit `asset`
and write it back with `set_editor_property`:

```python
eal = unreal.EditorAssetLibrary
LIB = "/MetaHumanCharacter/Optional/Grooms/Bindings/Hair"
groom = unreal.load_asset("/Game/Characters/Wardrobe/Hair/Style01/GR_Hair_Style01")

binding = eal.duplicate_asset(f"{LIB}/Hair_S_Clean_Binding",
                              "/Game/Characters/Wardrobe/Hair/Style01/GR_Hair_Style01_Binding")
binding.groom = groom                                # SetGroom: moves the change subscription, no rebuild
binding.build(unreal.OnGroomBindingAssetBuildComplete())   # async; the Python overload needs the delegate

wi = eal.duplicate_asset(f"{LIB}/WI_Hair_S_Clean", "/Game/Characters/Wardrobe/Hair/WI_Hair_Style01")
pa = wi.get_editor_property("principal_asset")
pa.set_editor_property("asset", binding)             # soft-object property: pass the object
wi.set_editor_property("principal_asset", pa)
# In a later step, after the binding build has finished: save the binding and the WI
# (saving refreshes AssetIdentifier).
```

`pa.import_text(f'(Asset="{binding.get_path_name()}")')` also works. Save the binding only
after its build has finished (C++ `IsCompiling()` false; it is not a `UFUNCTION`, so from
Python wait for later editor frames or use `build()` with a completion delegate); see
"Binding rules".

---

## Custom grooms: author on the library template head

This section covers only what the wardrobe needs from a groom. Groom authoring itself (Alembic
import, `HairWidth_Override` and the library width/tip-scale values, material slot names, the
Python rules for groom group arrays, Auto LOD thinning, cards-to-strands conversion) belongs to
the `ue-hair-and-grooms` skill and its `references/metahuman-creator-hair.md`.

Library hair bindings are built against the template head
`/MetaHumanCharacter/Optional/Grooms/GroomMesh/SKM_Groom_Head_Legacy02` (`Hair_S_Clean_Binding`
references it and the groom `.../GroomAssets/Hair/Hair_S_Clean/Hair_S_Clean`). The groom
editor pipeline transfers each item onto the character: for every binding mesh it duplicates
the binding and calls `SetTargetSkeletalMesh(CharacterMesh)`; at Production quality it also
duplicates the groom, bakes RBF, clears the source mesh and calls `Build()`. It errors if the
binding has no `Groom`. Eyelashes match material section 8, other grooms section 0.

So a custom groom works on every face if it is **authored in `SKM_Groom_Head_Legacy02`
component space** and its binding uses that mesh. Observed in 5.8: a custom groom with a
binding duplicated from `Hair_S_Clean_Binding` (groom repointed) and a `WI_` duplicated from
`WI_Hair_S_Clean` is wearable as Creator hair and follows any sculpted face.

Binding rules that matter (`GroomBindingAsset.h` / `.cpp`, `VerifyMetaHumanGroom.cpp`):
- `SourceSkeletalMesh` is the mesh the groom was authored on; `TargetSkeletalMesh` is the one
  it attaches to. With a source set, the build maps the target onto the source by UV channel 0
  within `MatchingSection` (default 0). The engine treats the source as optional, but **wardrobe
  validation does not**.
- Wardrobe validation (`UVerifyMetaHumanGroom` with the alignment checks off) still raises
  errors, and the item becomes unwearable, when the binding has no `SourceSkeletalMesh` (3003)
  or no `TargetSkeletalMesh` (3020), when the groom bounds do not overlap the source mesh
  (3004), or when a group's strand bounds do not intersect it. The 4 mm root-to-surface check
  and the root-UV match run only in the full SDK verification (`bVerifyGroomToMeshAlignment`).
  A missing `groom_root_uv` (warning) or `groom_width` (info) is reported in both but does not
  fail validation.
- A binding is accepted by a groom component only when it references the same groom (compared
  by `PrimaryAssetId`) with the same group count and guide/strand counts, and its built root
  data has the same LOD count as the attached skeletal mesh.
- `SetGroom()` (Python `binding.groom = g`) moves the binding's change subscription to the new
  groom but does not rebuild: follow it with
  `binding.build(unreal.OnGroomBindingAssetBuildComplete())` (a bare `build()` is C++ only).
  `binding.set_editor_property("groom", g)` rebuilds via `PostEditChangeProperty`, but leaves the
  binding subscribed to the old groom (see `ue-hair-and-grooms`, Bindings).
- Bindings build **asynchronously** through `FGroomBindingCompilingManager` (`IsCompiling()`;
  `Build()` takes a completion delegate). Wait for it before saving or capturing. Observed in
  5.8: binding or transferring a very dense groom (tens of thousands of strands, about 40k)
  onto a character face mesh through RBF kept the CPU busy for 16 minutes or more, and a save
  during that build can hang the editor. Wait for the build to finish, or decimate the groom.
- `UGroomBlueprintLibrary::CreateNewGroomBindingAssetWithPath(InDesiredPackagePath,
  InGroomAsset, InSkeletalMesh, InNumInterpolationPoints = 100,
  InSourceSkeletalMeshForTransfer = nullptr, InMatchingSection = 0)` creates, builds and saves a
  fresh binding in one call (Python keywords drop the `In`: `desired_package_path`,
  `groom_asset`, `skeletal_mesh`, ...). For a Creator wardrobe item, pass
  `SKM_Groom_Head_Legacy02` as both `InSkeletalMesh` and `InSourceSkeletalMeshForTransfer`, or
  duplicate the library binding, which already carries the source mesh. The default
  `nullptr` source produces a binding that fails wardrobe validation.

---

## Scripting a character that is open in the Creator

While a character is registered for editing (`TryAddObjectToEdit`, which the Creator asset
editor does), the subsystem keeps `FMetaHumanCharacterEditorData::PreviewCollection`, a
`DuplicateObject` of the internal collection at Preview quality. `OnEditPreviewCollection`
copies it back with `GetMutableInternalCollection()->CopyContentsFrom(PreviewCollection)`, so
**direct edits to `character.internal_collection` are overwritten** on the next propagation.
Only the preview collection carries built data: `assemble_for_preview` builds and assembles
the preview collection alone, and the internal collection's built data is cleared on every
copy-back (`CopyContentsFrom` calls `ClearBuiltData`) and on every item change. Write and query
through the preview collection instead:

| C++ | Python | Notes |
|---|---|---|
| `TryAddObjectToEdit` / `IsObjectAddedForEditing` / `RemoveObjectToEdit` | `try_add_object_to_edit` / `is_object_added_for_editing` / `remove_object_to_edit` | `try_add` returns False if the character is already registered (for example the Creator is open) or invalid. Check `is_object_added_for_editing` first, and do not remove a session you did not add. |
| `GetPreviewCollection(Character)` | `get_preview_collection` | `nullptr` when not added for editing. |
| `OnEditPreviewCollection(Character)` | `on_edit_preview_collection` | Preview → asset. |
| `RunCharacterEditorPipelineForPreview` | `assemble_for_preview` | Builds the preview collection; instance parameters need `Collection->GetBuiltData()` valid ("Collection is not built" otherwise). |

```python
mh = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
added_here = False
if not mh.is_object_added_for_editing(character):
    if not mh.try_add_object_to_edit(character):
        raise RuntimeError("could not open an edit session (invalid character?)")
    added_here = True
try:
    preview = mh.get_preview_collection(character)
    ok, key = preview.try_add_item_from_wardrobe_item("Hair", item)
    if not ok:
        raise RuntimeError("item rejected by slot validation (pipeline / binding source mesh)")
    preview.default_instance.set_single_slot_selection("Hair", key)
    mh.on_edit_preview_collection(character)
    mh.assemble_for_preview(character)                # builds the preview -> parameters exist

    path = unreal.MetaHumanPaletteItemPath(item_key=key)
    for p in preview.default_instance.get_instance_parameters(item_path=path):
        if p.name == "Melanin":
            p.set_float(value=0.7)                    # -> UMetaHumanInstance::OverrideInstanceParameters
        elif p.name == "Redness":
            p.set_float(value=0.15)
    mh.on_edit_preview_collection(character)
finally:
    if added_here:
        mh.remove_object_to_edit(character)           # otherwise the Creator cannot open it
```

Without the `ok` check, a rejected item (no pipeline, a binding with no source mesh) leaves
`key` empty, and the following `set_single_slot_selection` silently clears the `Hair` slot.
`set_single_slot_selection` replaces the slot's selection; layer pieces on the multi-select
`SkeletalMesh` slot with `try_add_slot_selection`.

### Groom instance parameters

Names are the property names of `UMetaHumanDefaultGroomPipelineMaterialParameters`, each mapped
to a material parameter:

| Group | Parameters (→ material parameter) |
|---|---|
| Default | `Melanin` (hairMelanin), `Redness` (hairRedness), `Roughness` (HairRoughness), `Whiteness` (WhiteAmount), `Lightness` (LightAmount), `DyeColor` (HairDye) |
| Ombre | `bUseOmbre`, `OmbreU`, `OmbreV`, `OmbreColor`, `OmbreShift`, `OmbreContrast`, `OmbreIntensity` |
| Regions | `bUseRegions`, `RegionsU`, `RegionsV`, `RegionsColor` |
| Highlights | `bUseHighlights`, `HighlightsU`, `HighlightsV`, `HighlightsColor`, `HighlightsBlending`, `HighlightsIntensity`, `HighlightsVariation` |

The Ombre, Regions and Highlights groups appear only when that item's pipeline has
`bSupportsOmbre`, `bSupportsRegions`, `bSupportsHightlights` (Epic's spelling) set; all
default to true. Melanin/Redness and the `*U`/`*V` pairs are coordinates on the picker texture
`/MetaHumanCharacter/Tools/T_HairColorImage` (U = melanin, V = redness). Query with
`UMetaHumanCharacterInstanceBlueprintLibrary::GetInstanceParametersForItem` (`get_instance_parameters`)
and set with `UMetaHumanCharacterInstanceParameterBlueprintLibrary::SetFloatInstanceParameter`
(`set_float`) or the colour/bool equivalents. A converted groom keeps the default colour until
these are set per character.

Other per-item options on `UMetaHumanDefaultGroomPipeline`: `SlotTarget` / `SlotNames` /
`SlotIndices` (which material slots get the parameters), `HighlightsMask`,
`HighlightsRootDistance`, `LODTransition`, and `BakedGroomTexture` (baked onto the face from
`GroomTextureMinLOD`, default 5). A custom hair without `BakedGroomTexture` gets no face bake at
far LODs.

---

## Clothing: skeletal meshes vs Chaos outfits

- **`SkeletalMesh` slot:** the item pipeline does no refitting; it only handles
  `BodyHiddenFaceMapTexture`. Plain skeletal clothing clips on bodies that differ from the
  one it was modelled on.
- **`Outfits` slot:** the outfit editor pipeline makes a fitted `UChaosOutfitAsset` per
  character by running `OutfitResizeDataflowAsset` with `TargetBody = MergedHeadAndBody`
  (plus `TransferSkinWeights`, `GenerateLOD0Only`, `StripSimMesh`). Resizing to blendable
  bodies needs the outfit's Dataflow variable `SizedOutfitSource` to be non-empty with body
  parts (`bResizesWithBlendableBodies`). `VerifyOutfitAsset` errors on an empty
  `SourceBodyParts` and warns when the first body part name does not end in
  `CombinedSkelMesh`, so construct garments on a combined head+body mesh. Set a
  `BodyHiddenFaceMapTexture` on the item to avoid the validation warning.

Convert clothing that must fit arbitrary body shapes to Chaos outfits; keep skeletal meshes
for rigid accessories or a known body.

---

## Gotchas

- **Wardrobe edits do not need unrigging.** A Rigged / RigPending character deactivates the
  import, preset, blend, head-model, face move/sculpt, skin and body-model tools, but the Hair
  & Clothing, Pipeline and Export palettes stay active (`MetaHumanCharacterEditorMode.cpp`).
- **Observed in 5.8: Head Sculpt hides grooms** in the Creator viewport. No C++ in the plugin
  does this (the only `SetHairVisibilityState` callers are the viewport hide-hair toggle, the
  mesh-import contour capture and `AMetaHumanDefaultEditorPipelineActor::OnInstanceUpdated`),
  so it likely comes from Blueprint content or the groom rebind after each face edit (not
  traced). Judge hair in another tool or a level viewport.
- **A character a script holds cannot be opened in the Creator.** Opening the asset calls
  `TryAddObjectToEdit`, which fails while a script's registration is still active, and the
  Creator logs "failed to create editing state. The asset may be corrupted". Call
  `remove_object_to_edit` when the script is done (only for a session it added).
- **Observed in 5.8: Python cannot spawn actors into the Creator preview world.** Inspect
  hair in a normal level (a template-head `SkeletalMeshActor` with a `GroomComponent` attached
  and its binding set via `set_binding_asset` / `set_groom_asset(asset, binding)`).
- **Observed in 5.8: a groomed character in the sculpt preview can hang the editor** for
  minutes when its preview is spawned during face sculpting. Remove grooms before large
  sculpt or conform operations and re-add them after.
- **Viewports stop redrawing in the background.** With "Use Less CPU when in Background"
  (`bThrottleCPUWhenNotForeground`, default true) every editor viewport, the Creator's
  included, gets a non-realtime override while the editor lacks focus. Bring the editor to
  the front, or turn the setting off in Editor Preferences > Performance. Reported to work from
  Python in 5.8 (it is a `uint32:1` bitfield with no `BlueprintReadWrite`, so attribute
  assignment fails):
  `unreal.get_default_object(unreal.EditorPerformanceSettings).set_editor_property("throttle_cpu_when_not_foreground", False)`;
  a 5.9 project reported that `unreal.EditorPerformanceSettings` is not in the Python API, so
  treat the Python route as unverified.
- **Unbound groom renders nothing.** On a `GroomComponent`, LOD binding type `Skinning`
  without a valid binding asset (or `Rigid` without a parent mesh component) becomes
  `NoneBinding`. `BindingAsset` is `BlueprintReadOnly`; set it with `set_binding_asset`.

---

## Source references (UE 5.9)

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterEditor/`:
- `Public/MetaHumanCharacterEditorSettings.h`:35 — `UMetaHumanCharacterEditorSettings` (`BlueprintType, config = MetaHumanCharacter, defaultconfig`); 209 — `WardrobePaths`; 214 — `bEnableWardrobeItemValidation`; 218 — `bSuppressMessageLogWhenValidatingItems`.
- `Private/MetaHumanCharacterEditorSettings.cpp`:165 — `PostEditChangeProperty`; 192 — `OnWardrobePathsChanged.Broadcast()`.
- `Public/MetaHumanCharacterEditorWardrobeSettings.h`:16 — `UMetaHumanCharacterEditorWardrobeSettings::WardrobeSections`.
- `Private/MetaHumanCharacterAssetObserver.cpp`:28 — non-recursive `FARCompiledFilter`; 54 — `GetWardrobeItemsInDirectory` (filters `WI_` by principal class); 117 — `DirectoryWatcher` registration.
- `Private/UI/Views/SMetaHumanCharacterEditorWardrobeToolView.cpp`:302 — `CreateWardrobeItemsForCompatibleAssets`; 500 — section merge; 921 — section population; 533 — section filtering (non-virtual path, `SlotName == NAME_None` kept); 801 — `OnProcessDroppedFolders` (adds project `WardrobePaths`); 974 — item validation; 1207 — `ApplyWearRequest`.
- `Private/UI/Widgets/SMetaHumanCharacterEditorAssetViewsPanel.cpp`:1036 — drop ignored unless `bAllowDropping`; 1695 — "Individual Assets" section; 1807 — `AllowDropping(bHasVirtualFolder)`.
- `Private/Verification/MetaHumanCharacterValidation.cpp`:28 — `ValidateWardrobeItem`; 80 — groom alignment checks switched off; 130 — returns false on any error.
- `Private/Verification/MetaHumanCharacterTypesVerification.cpp`:67 — `CheckClothingMask`; 79 — `VerifyGroomWardrobeItem`; 100 — `VerifySkelMeshClothingWardrobeItem`; 121 — `VerifyOutfitWardrobeItem`; 143 — `VerifyOutfitAsset`.
- `Public/MetaHumanCharacterEditorSubsystem.h`:534 — `TryAddObjectToEdit`; 564 — `GetPreviewCollection`; 573 — `OnEditPreviewCollection`; 577 — `RunCharacterEditorPipelineForPreview`.
- `Private/MetaHumanCharacterEditorSubsystem.cpp`:851 — `CopyContentsFrom(PreviewCollection)`; 878 — `RunCharacterEditorPipelineForPreview` builds only the preview collection; 1181 — `TryAddObjectToEdit` (false when invalid or already added); 1246 — `PreviewCollection = DuplicateObject(...)`.
- `Private/MetaHumanCharacterEditorMode.cpp`:129 — tools disabled while rigged.
- `Private/MetaHumanCharacterEditorToolkit.cpp`:1739 — viewport hide-hair toggle.
- `Private/AssetDefinitions/AssetDefinition_MetaHumanCharacter.cpp`:394 — opening the asset calls `TryAddObjectToEdit` ("failed to create editing state").

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacter/Public/`:
- `MetaHumanCharacter.h`:39 — `FMetaHumanCharacterAssetsSection`; 438 — `WardrobePaths`; 442 — `WardrobeIndividualAssets`.

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterPalette/`:
- `Public/MetaHumanWardrobeItem.h`:14 — `UMetaHumanWardrobeItem` (`PrincipalAsset`, `ThumbnailImage`, `ThumbnailName`, private `Pipeline`).
- `Public/EditorOnlyAssetReference.h`:96 — `FEditorOnlyAssetReference::Asset`; 106 — `AssetIdentifier`.
- `Private/EditorOnlyAssetReference.cpp`:57 — `ToSoftObjectPath()` reads `Asset` in the editor; 115 — `Serialize` refreshes `AssetIdentifier` on save.
- `Public/MetaHumanCharacterPipelineSpecification.h`:154 — `bAllowsMultipleSelection = false`.
- `Public/MetaHumanCollectionBlueprintLibrary.h`:270 — `SetFloatInstanceParameter`; 456 — `GetInstanceParametersForItem`.
- `Private/MetaHumanCharacterPalette.cpp`:142 — `TryAddItemFromWardrobeItem` compatibility test; 416 — fallback item pipeline (`GetFallbackItemPipelineForAssetType`); 425 — `TryResolveItemPipeline`.
- `Private/MetaHumanCollection.cpp`:724 — `CopyContentsFrom` clears built data; 938 — `OnItemsModified` clears built data.
- `Private/MetaHumanInstance.cpp`:849 — `GetCurrentInstanceParametersForItem` ("Collection is not built").

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterPaletteEditor/`:
- `Private/MetaHumanWardrobeItemFactory.cpp`:16 — factory creates items with no pipeline.

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanDefaultPipeline/`:
- `Private/MetaHumanDefaultPipelineBase.cpp`:16 — slot names; 112 — `Outfits` slot spec; 123 — `Outfits` multi-select; 128/134 — garment `TargetSlot`; 150 — `SkeletalMesh` multi-select; 414 — `DefaultAssetPipelines` lookup.
- `Public/Item/MetaHumanDefaultGroomPipeline.h`:21 — `UMetaHumanDefaultGroomPipelineMaterialParameters`; 113 — `UMetaHumanDefaultGroomPipeline`; 127 — `SlotTarget`; 136 — `bSupportsOmbre` (then `bSupportsRegions`, `bSupportsHightlights`).
- `Private/Item/MetaHumanDefaultGroomPipeline.cpp`:87 — parameter groups filtered by support flags.

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanDefaultEditorPipeline/`:
- `Private/MetaHumanDefaultEditorPipelineBase.cpp`:239 — slot → principal asset classes; 2229 — `TestWardrobeItemCompatibilityWithSlot` runs `ValidateWardrobeItem`.
- `Private/Item/MetaHumanGroomEditorPipeline.cpp`:232/246 — Production transfer (`SetTargetSkeletalMesh`, RBF bake at 272-330, source cleared at 358); 377 — Preview transfer; 380 — eyelashes bound to section 8; 466 — error when the binding has no Groom.
- `Private/Item/MetaHumanSkeletalMeshEditorPipeline.cpp`:58 — no refit.
- `Private/Item/MetaHumanOutfitEditorPipeline.cpp`:55 — `OutfitResizeDataflowAsset` to `MergedHeadAndBody`.
- `Private/MetaHumanDefaultEditorPipelineActor.cpp`:91 — `SetHairVisibilityState`; 235 — `OnInstanceUpdated` (250 resets hair visibility).

Under `Engine/Plugins/MetaHuman/MetaHumanSDK/Source/MetaHumanSDKEditor/Private/Verification/`:
- `VerifyMetaHumanSkeletalClothing.cpp`:79 — MetaHuman-body-compatible skeleton check.
- `VerifyMetaHumanGroom.cpp`:176 — 4 mm root-to-mesh distance (inside `VerifyGroomToMeshAlignment`, full verification only); 234 — `VerifyGroomingMesh` (errors 3003 no source mesh, 3020 no target mesh, 3004 no overlap); 396 — `groom_width` info / `groom_root_uv` warning; 428 — strand bounds must intersect the grooming mesh (error); 442 — alignment gated by `bVerifyGroomToMeshAlignment`.

Under `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/`:
- `Public/GroomBindingAsset.h`:205 — `Groom` / `SetGroom`; 212 — `SourceSkeletalMesh`; 245 — `TargetSkeletalMesh`.
- `Private/GroomBindingAsset.cpp`:813 — `IsCompatible` (groom id, group, guide and strand counts); 1101 — async build via `FGroomBindingCompilingManager`.
- `Public/GroomBlueprintLibrary.h`:30 — `CreateNewGroomBindingAssetWithPath`.
- `Public/GroomBindingAsset.h`:480 — `IsCompiling()` (not a `UFUNCTION`); 536 — `Build(CompletionDelegate)`.
- `Private/GroomComponent.cpp`:3024 — binding type falls back to `NoneBinding`.

Editor (`Engine/Source/Editor/UnrealEd/`):
- `Classes/Editor/EditorPerformanceSettings.h`:74 — `bThrottleCPUWhenNotForeground` (`uint32:1`, `EditAnywhere, config`, not Blueprint-visible).
- `Private/EditorEngine.cpp`:1808 — "Background Process" realtime override.

Plugin config: `Engine/Plugins/MetaHuman/MetaHumanCharacter/Config/Editor.ini` — built-in wardrobe sections and slot category names.
