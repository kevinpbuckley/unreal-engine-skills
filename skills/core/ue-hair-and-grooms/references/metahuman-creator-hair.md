# Custom grooms as MetaHuman hair — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the groom side of making a custom groom wearable
in MetaHuman Creator: the template head it must be authored on, how the Creator transfers the
binding, the binding and wardrobe item to create, and the groom settings and material slots that
make it behave like library hair. Grounded in UE 5.8 and re-checked against 5.9 (`HairStrandsCore`,
`MetaHumanDefaultEditorPipeline`, `MetaHumanDefaultPipeline`, `MetaHumanCharacterPalette`).

The Creator side is documented in the `ue-metahuman-creator` skill and is not repeated here:
`WardrobePaths` folders, slot classes, item pipelines and validation, the preview-collection
trap, groom instance parameters, and the palette, pipeline and Python scripting topics
(collection, instance, slot selection, assembly).

---

## What a groom slot accepts

- `Hair`, `Eyebrows`, `Beard`, `Mustache`, `Eyelashes` and `Peachfuzz` take a
  `UMetaHumanWardrobeItem` whose principal asset is a **`UGroomBindingAsset`**. No slot accepts
  a `UGroomAsset` directly.
- Only the `SkeletalMesh` and `Outfits` slots allow multiple selection. `Hair` holds one item,
  so add-on pieces (fringes, bangs, tails) must be merged into the hair groom, for example as
  extra groups, rather than worn as a second hair item.

## How library hair is bound

- Library hair bindings (for example `Hair_S_Clean_Binding`) reference the template head
  `/MetaHumanCharacter/Optional/Grooms/GroomMesh/SKM_Groom_Head_Legacy02` and their groom.
- When a character wears a groom item, the groom editor pipeline duplicates the binding for each
  of the character's binding meshes and calls `SetTargetSkeletalMesh(characterMesh)`. At
  Production quality it also duplicates the groom, bakes RBF, clears the source mesh and calls
  `Build()`. The pipeline errors if the binding has no groom.
- Eyelashes bind to material section 8 of the head; every other groom to section 0.

So a groom authored around `SKM_Groom_Head_Legacy02`, in that mesh's component space, is
transferred onto each character's face by the Creator exactly like library hair. A groom
authored on any other head must first be fitted to the template (the cards-to-strands
reference in this skill describes a cranium fit that works).

## Making a custom groom wearable

1. **Author on the template head.** Write the strands in `SKM_Groom_Head_Legacy02` component
   space (centimetres, root first). Observed in 5.8: the template faces +Y in component space.
2. **Import** the `.abc` as a `UGroomAsset` and match library hair: `HairWidth_Override` on,
   a library-like width and tip scale, Skinning on every LOD, library materials (below).
3. **Binding:** finish every groom setting edit first, then duplicate `Hair_S_Clean_Binding`
   next to the groom, point it at the groom with `SetGroom` (Python `binding.groom = g`) and
   build it explicitly. `SetGroom` moves the change subscription to the new groom but does not
   rebuild; `set_editor_property("groom", g)` rebuilds but leaves the binding subscribed to
   `Hair_S_Clean` (see Bindings in the skill).
4. **Wardrobe item:** duplicate `WI_Hair_S_Clean`. This keeps its pipeline, the Blueprint
   `/MetaHumanCharacter/BuildPipeline/DefaultWardobePipeline/DefaultGroomPipeline` (a child of
   `UMetaHumanDefaultGroomPipeline`), which validation requires. Point `PrincipalAsset` at the
   new binding.
5. Make the item visible to the Creator through a project `WardrobePaths` folder or the slot's
   Individual Assets section (both in `ue-metahuman-creator`). Monitored folders are scanned
   non-recursively and auto-create pipeline-less items for bare bindings, so keep the `WI_` in
   the monitored folder and the groom and binding in a subfolder.

Observed in 5.8: a custom groom with a binding duplicated from `Hair_S_Clean_Binding` and a
`WI_` duplicated from `WI_Hair_S_Clean` worked as Creator hair and transferred to each face.

```python
import unreal

LIB = "/MetaHumanCharacter/Optional/Grooms/Bindings/Hair"
eal = unreal.EditorAssetLibrary
groom = unreal.load_asset("/Game/Characters/Wardrobe/Hair/Style01/GR_Hair_Style01")

binding = eal.duplicate_asset(f"{LIB}/Hair_S_Clean_Binding",
                              "/Game/Characters/Wardrobe/Hair/Style01/GR_Hair_Style01_Binding")
binding.groom = groom                                # SetGroom: delegates + async guard
binding.build(unreal.OnGroomBindingAssetBuildComplete())   # async; no-arg build() is C++ only

item = eal.duplicate_asset(f"{LIB}/WI_Hair_S_Clean", "/Game/Characters/Wardrobe/Hair/WI_Hair_Style01")
# .copy(): get_editor_property returns a reference into the item, so editing it in place and
# setting it back would be an identical value and send no Pre/PostEditChange.
ref = item.get_editor_property("principal_asset").copy()   # FEditorOnlyAssetReference
path = binding.get_path_name()
ref.import_text(f'(Asset="{path}",AssetIdentifier="{path}")')
item.set_editor_property("principal_asset", ref)
# In a later step, after the binding has finished building, save the binding and the item with
# only_if_is_dirty=False (Build() does not mark the binding dirty).
```

In C++, `FEditorOnlyAssetReference` has `operator=(const UObject*)`, so
`Item->PrincipalAsset = Binding;` sets it (`PrincipalAsset` is `EditAnywhere`, not Blueprint
visible). `Pipeline` is a private `Instanced` member.

## Materials, settings and colour

- Library groom materials live in `/MetaHumanCharacter/Materials/`: `MI_Hair` (strands),
  `MI_Hair_Cards` and `MI_Hair_Helmet`. Library grooms such as `Hair_S_Clean` also carry
  hair-card LOD meshes.
- `UMetaHumanDefaultGroomPipeline` writes the hair colour parameters (`hairMelanin`,
  `hairRedness`, ...) to the material slots chosen by `SlotTarget`/`SlotNames`/`SlotIndices`.
  Keep the library slot names on a custom groom so the colour reaches its material. A group
  whose hidden `MaterialSlotName` matches no slot falls back to slot 0.
- Observed in 5.8 (read from the assets, not confirmed in source): library scalp grooms use a
  width of about 0.011 cm, root scale 1, tip scale 0.4-0.65, and Skinning on every LOD.
- New items start at the pipeline defaults (`Melanin` 0.16, `Redness` 0); set colour per
  character through the item's instance parameters.
- `BakedGroomTexture` on the item pipeline is baked onto the face from LOD `GroomTextureMinLOD`
  (default 5). A custom item without one gets no far-LOD face bake.
- A converted strands-only groom has no cards LODs to fall back to. Wherever cards are forced
  (`UGroomComponent::SetUseCards`, which the Creator's "Always Use Hair Cards" viewport option
  calls) or the
  platform has strands disabled, a Strands LOD is turned into a Cards LOD, and a group with no
  cards data then draws nothing. Give a custom groom cards LODs (`HairGroupsCards`, imported or
  generated) as well as a `BakedGroomTexture` if it must show on low-end targets and far LODs.
- `ThumbnailImage` and `ThumbnailName` on the `WI_` set its wardrobe tile.

## Checks a custom groom should pass

Wardrobe validation runs the MetaHuman SDK groom verification (`UVerifyMetaHumanGroom`) with
the alignment and detailed grooming-mesh checks switched off. These still report **errors**,
and an error makes the wardrobe item invalid and unwearable:

- the binding has no `SourceSkeletalMesh` (3003) or no `TargetSkeletalMesh` (3020). A binding
  made with `CreateNewGroomBindingAssetWithPath` and the default `nullptr` source fails, so pass
  `SKM_Groom_Head_Legacy02` as both the skeletal mesh and the source mesh for transfer, or
  duplicate a library binding, which already carries the source mesh;
- the groom bounds do not overlap the source mesh (3004), or a group's strand bounds do not
  intersect it.

Reported without failing validation: a missing `groom_root_uv` (warning) or `groom_width`
(info), and groups over 255 points per curve or the per-group limits (warnings).

Only the full SDK verification (`bVerifyGroomToMeshAlignment`, default true) checks that each
strand root lies within 4 mm of the source mesh surface and that root UVs (V-flipped relative
to the mesh UVs) match the mesh UVs.

## Hair on an assembled MetaHuman without the Creator

A groom that was not authored on the template head can still go on an assembled MetaHuman
Blueprint as an extra `UGroomComponent` under the face or body component (hide the stock `Hair`
components):

- **Rigid:** set every LOD's `BindingType` to Rigid and the component's `AttachmentName` to the
  `head` **bone**. On tick the component attaches itself to that bone and applies the inverse
  reference-pose bone transform, so author the groom in the face mesh's component space and add
  no offset of your own. No binding asset is needed, but the hair does not follow facial
  deformation.
- **Skinning:** create a binding whose target is the face mesh. Observed in 5.8: binding a
  groom of about 40k strands to a MetaHuman face took more than 15 minutes of CPU.

## Rig state

Hair and other wardrobe edits work on a rigged character. When the character is rigged, the
editor mode deactivates only the import, preset, blend, face/body model, sculpt and skin
tools; wardrobe selection is not among them, so there is no need to remove the rig to change
hair.

## Observed editor behaviour (UE 5.8)

- Opening the Creator preview of a character that wears grooms during face sculpting stalled
  the editor for minutes.
- Grooms are not visible while the Creator's head sculpt tool is active. No C++ in the plugin
  hides them there; the cause may be Blueprint content or the rebind after each face edit.

## Source references (UE 5.9)

Engine source (UE 5.9, line numbers re-mapped from 5.8 — all paths under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/`):
- `MetaHumanDefaultEditorPipeline/Private/MetaHumanDefaultEditorPipelineBase.cpp`:239-290 —
  slot to principal class.
- `MetaHumanDefaultPipeline/Private/MetaHumanDefaultPipelineBase.cpp`:16-150 — slot spec and
  multiple selection.
- `MetaHumanDefaultEditorPipeline/Private/Item/MetaHumanGroomEditorPipeline.cpp`:232-362 —
  Production: duplicate binding and groom, set target, RBF bake (272-330), clear source,
  `Build()`; 365-425 — preview: duplicate binding, set target, eyelash `MatchingSection` reset,
  `Build()`; 466 — missing-groom error.
- `MetaHumanCharacterEditor/Private/MetaHumanCharacterEditorMode.cpp`:129-150 — tools
  deactivated in the rigged state.
- `MetaHumanCharacterEditor/Private/MetaHumanCharacterEditorSubsystem.cpp`:6683 — "Always Use
  Hair Cards" calls `SetUseCards`.
- `MetaHumanDefaultPipeline/Public/Item/MetaHumanDefaultGroomPipeline.h`:21-27 — material
  parameters; 113-122 — pipeline options (`SlotTarget`, `SlotNames`, `BakedGroomTexture`).
- `MetaHumanCharacterPalette/Public/MetaHumanWardrobeItem.h`:61-82 — `PrincipalAsset`,
  thumbnail fields, `Pipeline`.
- `MetaHumanCharacterPalette/Public/EditorOnlyAssetReference.h` — `FEditorOnlyAssetReference`.
- `MetaHumanCharacterEditor/Private/Verification/MetaHumanCharacterTypesVerification.cpp`:79-131
  — wardrobe item verification (pipeline required).
- `MetaHumanCharacterEditor/Private/Verification/MetaHumanCharacterValidation.cpp`:75-80 — groom
  checks used by wardrobe validation (alignment off); 130 — fails on any error.
- `MetaHumanCharacterEditor/Private/MetaHumanCharacterAssetObserver.cpp`:28-117 —
  non-recursive folder monitoring.

Hair Strands:
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Private/GroomComponent.cpp`:2731-2734 —
  Strands LODs become Cards when cards are forced or strands are disabled; 3800-3828 —
  `AttachmentName` bone attachment.
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Private/GroomManager.cpp`:2368-2379 —
  the same fallback at LOD selection (`ConvertLODGeometryType`).
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Private/GroomBindingAsset.cpp`:1864-1882 —
  `SetGroom`.

MetaHuman SDK:
- `Engine/Plugins/MetaHuman/MetaHumanSDK/Source/MetaHumanSDKEditor/Private/Verification/VerifyMetaHumanGroom.cpp`:176
  — root distance (full verification only); 183-186 — root UV flip; 234-280 — binding source/target
  mesh and overlap errors; 396-417 — width/root UV attributes; 428-475 — strand bounds and limits.

See also: `ue-metahuman-creator` for wardrobe folders, item validation, the preview collection,
groom instance parameters, slot selection and assembly.
