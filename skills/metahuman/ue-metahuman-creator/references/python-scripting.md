# Python scripting for MetaHuman Creator — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the Python-visible surface of the
`MetaHumanCharacter` plugin (everything `BlueprintCallable` / `BlueprintType`), naming rules,
Epic's shipped example scripts, and recipes for wardrobe, conforming, export, spawning and
batch runs. Grounded in UE 5.8: the headers under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source`
and Epic's own scripts in `Content/Python/examples/` plus the `MetaHumanGenerator` toolset.

---

## Naming rules (how the C++ names appear in `unreal`)

- Classes drop the prefix: `UMetaHumanCharacter` → `unreal.MetaHumanCharacter`,
  `FMetaHumanCharacterSkinSettings` → `unreal.MetaHumanCharacterSkinSettings`,
  `EMetaHumanRigType` → `unreal.MetaHumanRigType` (values upper snake: `JOINTS_ONLY`,
  `JOINTS_AND_BLEND_SHAPES`). `ScriptName` metadata wins: `EAlignmentOptions` is
  `unreal.MetaHumanAlignmentOptions`; `RunCharacterEditorPipelineForPreview` is
  `assemble_for_preview`.
- Functions and properties are snake_case with Hungarian prefixes removed:
  `TryAddObjectToEdit(InCharacter)` → `try_add_object_to_edit(character)`,
  `bInMatchVerticesByUVs` → `match_vertices_by_u_vs`, `bInLogError` → `log_error`,
  `bKeepTransient` → `keep_transient`, `bBlocking` → `blocking`, `bReportProgress` → `report_progress`.
- `UPROPERTY(... ScriptName="Pattern")` on `IrisPattern` → `iris.pattern`; `IrisRotation` → `iris.rotation`.
- Out-parameters become return tuples: `get_mesh_for_body_conforming_from_template(...)`
  returns `(result, vertices)`; `get_joints_for_body_conforming_from_template(mesh)` returns
  `(result, translations, rotations)`; `get_face_landmarks(character)` returns the array.
- Struct-typed UPROPERTY reads (`character.skin_settings`) hand back a struct you can modify;
  the asset only changes when you pass it to the matching `commit_*`. `BlueprintReadOnly`
  properties (`skin_settings`, `head_model_settings`, `face_evaluation_settings`) are
  readable but must be written through the subsystem.
- Subsystem access: `unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)`.

Everything in this file was checked against the 5.8 headers: a function is listed only if it
carries `UFUNCTION(BlueprintCallable...)` and a struct only if it is `USTRUCT(BlueprintType)`
with `BlueprintReadWrite`/`BlueprintReadOnly` members.

---

## Session helpers (from Epic's `metahuman_character_test_utils.py`)

```python
import unreal

class MetaHumanEditSession:
    """try_add_object_to_edit on enter, remove_object_to_edit on exit."""
    def __init__(self, character):
        self.character = character
        self.mh = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
    def __enter__(self):
        if not self.mh.try_add_object_to_edit(self.character):
            raise RuntimeError(f"{self.character.get_name()} is already open for edit")
        return self.mh
    def __exit__(self, *exc):
        if self.mh.is_object_added_for_editing(self.character):
            self.mh.remove_object_to_edit(self.character)
        return False

def create_character(package_path: str, name: str) -> unreal.MetaHumanCharacter:
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    _, unique = tools.create_unique_asset_name(base_package_name=f"{package_path}/{name}", suffix="")
    asset = tools.create_asset(asset_name=unreal.Paths.get_base_filename(unique),
                               package_path=package_path,
                               asset_class=unreal.MetaHumanCharacter,
                               factory=unreal.new_object(type=unreal.MetaHumanCharacterFactoryNew))
    if asset is None:
        raise RuntimeError("create_asset failed")
    return asset
```

If the character is open in the asset editor, `try_add_object_to_edit` returns False but the
subsystem already holds a session — call the edit functions anyway (Epic's
`example_live_edit.py` does exactly this after `AssetEditorSubsystem.open_editor_for_assets`).

---

## Grooms and clothing (wardrobe items)

Slot names: `Hair`, `Eyebrows`, `Beard`, `Mustache`, `Eyelashes`, `Peachfuzz`, `Outfits`
(plus top/bottom garment and skeletal-mesh slots). Wardrobe item assets live in the optional
content, e.g. `/MetaHumanCharacter/Optional/Grooms/Bindings/Hair/WI_Hair_L_StraightBangs`
and `/MetaHumanCharacter/Optional/Clothing/WI_DefaultGarment`, or in your own project
(`UMetaHumanWardrobeItem` assets whose Principal Asset is a groom binding / outfit).

```python
character = unreal.load_asset("/Game/Characters/MetaHumans/MH_Pilot.MH_Pilot")
hair_item = unreal.load_asset("/MetaHumanCharacter/Optional/Grooms/Bindings/Hair/WI_Hair_L_StraightBangs.WI_Hair_L_StraightBangs")

with MetaHumanEditSession(character) as mh:
    collection = mh.get_preview_collection(character)              # the session's built collection
    ok, item_key = collection.try_add_item_from_wardrobe_item("Hair", hair_item)   # -> (bool, FMetaHumanPaletteItemKey)
    if not ok:
        raise RuntimeError("item not compatible with slot Hair")
    collection.default_instance.set_single_slot_selection("Hair", item_key)   # or try_add_slot_selection(...)
    mh.on_edit_preview_collection(character)                       # preview -> character asset

    mh.assemble_for_preview(character=character)                   # builds the preview collection only
    item_path = unreal.MetaHumanPaletteItemPath(item_key=item_key)
    params = collection.default_instance.get_instance_parameters(item_path=item_path)  # UMetaHumanCharacterInstanceBlueprintLibrary ScriptMethod
    melanin = next((p for p in params if p.name == "Melanin"), None)
    if melanin:
        melanin.set_float(value=0.5)                               # UMetaHumanCharacterInstanceParameterBlueprintLibrary ScriptMethod
    mh.on_edit_preview_collection(character)
```

Query and set instance parameters on the **preview collection**
(`get_preview_collection(character).default_instance`), not on `character.internal_collection`.
`assemble_for_preview` (`RunCharacterEditorPipelineForPreview`) builds and assembles only the
preview collection; the internal collection's built data is cleared whenever an item is added
and on every copy-back (`UMetaHumanCollection::CopyContentsFrom` calls `ClearBuiltData`), so
`get_instance_parameters` on it fails with "Collection is not built". Epic's
`example_add_grooms.py` adds the item to and queries `internal_collection`; by the 5.8 and
5.9 source that query has no built data to read. The internal collection is also overwritten from
the preview on the next `on_edit_preview_collection` while a session is open. Details, the
Creator-open case and the full groom parameter list:
[custom-wardrobe-content.md](custom-wardrobe-content.md#scripting-a-character-that-is-open-in-the-creator).

**5.9: standalone Collection and Instance assets are session-only for scripts.** On a
`UMetaHumanCollection` or `UMetaHumanInstance` that is an asset in its own right (or an editing
session's staged copy), `try_add_item_from_wardrobe_item` and setting an instance parameter (`set_float`, ...)
raise a script error ("... is an asset, which scripts edit only through an editing
session"). Use `unreal.get_editor_subsystem(unreal.MetaHumanCollectionEditingSubsystem)
.open_collection_session(collection, "my-script")`, then on the handle `add_wardrobe_item(slot,
item)`, `build_preview()` then `get_instance_parameters(...)` for parameters (or
`open_instance_session` for an Instance asset), and `apply_changes()` (which closes the handle). A
character's internal collection and the Creator's preview collection are sub-objects, not
assets, so the flow above is unaffected (`MetaHumanScriptEditPolicy.cpp`,
`MetaHumanCollectionSessionHandle.h`; read in 5.9 source, not run).

Epic's `example_add_clothing.py` sets `PrimaryColorShirt` with
`set_color(value=unreal.LinearColor.GREEN)`.

Listing what is in a palette: `unreal.MetaHumanCollectionBlueprintLibrary.get_slot_names(collection)`,
`get_item_keys_for_slot(collection, "Hair")`, `get_item_display_name(collection, key)`;
`unreal.MetaHumanCharacterInstanceBlueprintLibrary.get_allowed_item_keys_for_slot(instance, "Hair")`.

---

## Conforming a head

From a `.dna` file (whole-rig import makes a fixed, non-editable body; `import_whole_rig=False`
uses the head DNA only for neck alignment):

```python
params = unreal.ImportFromDNAParams()
params.import_whole_rig = False
params.alignment_options = unreal.MetaHumanAlignmentOptions.SCALING_ROTATION_TRANSLATION
result = mh.import_from_face_dna(character=character, dna_file_path="D:/scans/head.dna", import_params=params)
if result != unreal.ImportErrorCode.SUCCESS:
    raise RuntimeError(result)
```

From a template skeletal/static mesh in MetaHuman topology (eyes/teeth optional):

```python
params = unreal.ImportFromTemplateParams()
params.use_eye_meshes = True
params.use_teeth_mesh = True
params.match_vertices_by_u_vs = True
params.alignment_options = unreal.MetaHumanAlignmentOptions.SCALING_ROTATION_TRANSLATION
result = mh.import_from_template(character, head_mesh, left_eye_mesh, right_eye_mesh, teeth_mesh, params)
```

From raw vertices (any source that gives you MetaHuman-ordered head vertices):

```python
fit = unreal.MetaHumanCharacterFitToVerticesParams()
fit.options.alignment_options = unreal.MetaHumanAlignmentOptions.SCALING_ROTATION_TRANSLATION
fit.options.adapt_neck = True
fit.options.disable_high_frequency_delta = True
fit.head_vertices = head_vertices            # list[unreal.Vector]; eyes/teeth lists optional
mh.fit_state_to_target_vertices(character=character, params=fit)
mh.commit_face_state(character)
```

From a MetaHuman Animator Identity: `mh.import_from_identity(character, identity_asset, unreal.ImportFromIdentityParams())`.
Arbitrary-topology meshes go through `conform_to_target_meshes(character, target_mesh_key, conform_params)`
with keypoints (`commit_target_mesh_keypoints`) — the Mesh Import tool's headless path.

Any of these leave the face **unrigged**; run auto-rigging afterwards.

## Conforming a body from a template

```python
res, verts = mh.get_mesh_for_body_conforming_from_template(character, body_mesh, face_mesh, match_vertices_by_u_vs=False)
res2, joint_t, joint_r = mh.get_joints_for_body_conforming_from_template(body_mesh)
if res != unreal.ImportErrorCode.SUCCESS or res2 != unreal.ImportErrorCode.SUCCESS:
    raise RuntimeError("template not in MetaHuman body topology")
mh.conform_body_to_target(character, verts, joint_r, target_is_in_a_pose=True, estimate_joints_from_mesh=False)
# alternatives: mh.set_body_mesh(character, verts, reposition_helper_joints=True)
#               mh.set_body_joints(character, joint_t, joint_r, import_helper_joints=True)
#               mh.import_body_whole_rig(character, "D:/body.dna", "D:/head.dna")   # fixed body
```

---

## Export (`UMetaHumanCharacterExportBlueprintLibrary`, editor module)

All static, take the character plus a params struct; the character must be open for edit,
rigged, and (for DCC/materials) have high-resolution textures.

```python
lib = unreal.MetaHumanCharacterExportBlueprintLibrary

dcc = unreal.MetaHumanDCCExportParams(); dcc.external_path = "D:/Export/MH_Pilot"; dcc.bake_make_up = True
dcc.compress_in_zip_file = True; dcc.archive_name = "MH_Pilot"
lib.export_dcc(character, dcc)                                   # Maya/DCC package (needs Optional/DCC content)

dna = unreal.MetaHumanDNAExportParams(); dna.project_path = "/Game/MetaHumans"; dna.external_path = "D:/Export/DNA"
dna.dna_head = True; dna.dna_body = True; dna.overwrite_existing_assets = True
lib.export_dna(character, dna)                                   # UDNA assets and/or .dna files

geo = unreal.MetaHumanGeometryExportParams(); geo.project_path = "/Game/MetaHumans"
geo.head_skeletal_mesh = True; geo.body_skeletal_mesh = True; geo.full_body_skeletal_mesh = True
lib.export_geometry(character, geo)                              # standalone skeletal meshes

mat = unreal.MetaHumanMaterialsExportParams(); mat.project_path = "/Game/MetaHumans"; mat.apply_as_overrides = True
lib.export_materials(character, mat)                             # persistent MICs, optionally set as overrides

posed = unreal.MetaHumanPosedDNAExportParams(); posed.project_path = "/Game/MetaHumans"; posed.target_mesh_key = key
lib.export_posed_dna(character, posed)                           # after conform_to_target_meshes
```

---

## Spawning in a level

```python
asset_editor = unreal.get_editor_subsystem(unreal.AssetEditorSubsystem)
asset_editor.open_editor_for_assets(assets=[character])          # opens the MetaHuman editor (registers the session)
mh = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
actor = mh.spawn_meta_human_actor(character=character)           # AMetaHumanCharacterEditorActor in the current level
```

The actor mirrors live edits and is owned by the subsystem; it is destroyed when the editor
window closes (Epic's `example_spawn_metahuman_actor.py`). `keep_transient=True` keeps the
`RF_Transient` flag so it can never be saved into the map. For a persistent actor, build the
character and spawn the generated Blueprint:

```python
bp = unreal.load_asset("/Game/MetaHumans/MH_Pilot/BP_MH_Pilot.BP_MH_Pilot")
cls = bp.generated_class()
unreal.get_editor_subsystem(unreal.EditorActorSubsystem).spawn_actor_from_class(cls, unreal.Vector(0, 0, 100))
```

---

## Batch / headless notes

- Cloud calls must be `blocking = True`, `report_progress = False` (Epic: "Required for
  running in batch"). The blocking path pumps the auth client
  (`ServiceAuthentication::TickAuthClient`) and HTTP until the service answers or fails; a
  failure is a notification plus a log line, not an exception — check
  `can_build_meta_human(character, log_error=True)` afterwards.
- A logged-in Epic account is required in the editor session running the script. There is no
  Python API to log in; `test_cloud_requests.py` simply assumes it.
- Texture synthesis (skin preview) and the presets/wardrobe library need the optional
  content; `FMetaHumanCharacterEditorModule::IsOptionalMetaHumanContentInstalled` is not
  exposed to Python — check for the folder
  `<Engine>/Plugins/MetaHuman/MetaHumanCharacter/Content/Optional/TextureSynthesis` yourself.
- `build_meta_human` is synchronous from Python's point of view and writes many packages;
  save with `unreal.EditorAssetLibrary.save_directory("/Game/MetaHumans")` or
  `save_loaded_asset(character)`.
- `remove_face_rig(character)` returns the face to the archetype DNA; `has_face_dna` and the
  rig state are native-only, so track rig success through `can_build_meta_human`.
- Face sculpt data: `get_face_model_coefficients(character)` → `list[float]`,
  `set_face_model_coefficients(character, coeffs)`; landmarks via `get_face_landmarks` /
  `translate_face_landmarks(character, indices, deltas)`; then `commit_face_state`.
- Testing helpers: `compare_face_state(a, b, tolerance)`, `compare_body_state`,
  `compare_face_textures(a, b, pixel_tolerance)`.

---

## Epic's `MetaHumanGenerator` toolset (experimental)

`Engine/Plugins/Experimental/Toolsets/MetaHumanGenerator/Content/Python/metahuman_toolset/metahuman.py`
wraps the same subsystem for AI agents: `begin_edit(object_path)` / `end_edit(session)`
(a session that registers the character and `finalize()`s), `create(asset_path)` (AssetTools
+ `MetaHumanCharacterFactoryNew`), `get_body_shape` / `set_body_shape` (maps 0..1
`masculine_feminine`, `fat`, `muscularity` onto the `Masculine/Feminine`, `Fat`,
`Muscularity` constraints via `lerp(min_measurement, max_measurement, v)`, `height_cm`
directly; then `set_body_constraints` + `commit_body_state` and a native
`MetaHumanGeneratorSubsystemWrapper.reset_neck_to_body`), `get_skin_tone` / `set_skin_tone`
(`skin.u` = lightness, `skin.v` = redness → `commit_skin_settings`), `get_eye_color` /
`set_eye_color` (`iris.primary_color_u/v` and `secondary_color_u/v` on both eyes →
`commit_eyes_settings`). Its docstrings carry useful calibration examples: pale skin
`[0.10, 0.45]`, medium neutral `[0.50, 0.45]`, very dark warm `[0.93, 0.75]`; light blue eyes
`(0.1, 0.9)`, dark brown `(0.9, 0.1)`; athletic woman `masculine_feminine=0.80, fat=0.25,
muscularity=0.70, height_cm=169`.

---

## Source references (UE 5.9)

Under `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/`:
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:534 — `TryAddObjectToEdit`; 538 — `IsObjectAddedForEditing`; 546 — `RemoveObjectToEdit`; 577 — `RunCharacterEditorPipelineForPreview` (`ScriptName="AssembleForPreview"`).
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:690 — `SpawnMetaHumanActor`; 782 — `CanBuildMetaHuman`; 793 — `BuildMetaHuman`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:1361 — `RequestAutoRigging`; 1370 — `RemoveFaceRig`; 922 — `RequestTextureSources`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:1420 — `FitStateToTargetVertices`; 1442 — `ImportFromIdentity`; 1460 — `ImportFromFaceDna`; 1479 — `ImportFromTemplate`; 1816 — `ConformToTargetMeshes`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterEditorSubsystem.h`:1690 — `GetMeshForBodyConformingFromTemplate`; 1728 — `GetJointsForBodyConformingFromTemplate`; 1898 — `ConformBodyToTarget`; 1902 — `SetBodyJoints`; 1906 — `SetBodyMesh`; 1913 — `ImportBodyWholeRig`; 1932 — `GetBodyConstraints`; 1943 — `SetBodyConstraints`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterExportBlueprintLibrary.h`:14 — `FMetaHumanDCCExportParams`; 37 — `FMetaHumanDNAExportParams`; 76 — `FMetaHumanGeometryExportParams`; 108 — `FMetaHumanPosedDNAExportParams`; 157 — `FMetaHumanMaterialsExportParams`; 184 — `UMetaHumanCharacterExportBlueprintLibrary`.
- `MetaHumanCharacterEditor/Public/MetaHumanCharacterFactoryNew.h`:10 — `UMetaHumanCharacterFactoryNew`.
- `MetaHumanCharacterEditor/Public/Subsystem/MetaHumanCharacterBuild.h`:25 — `FMetaHumanCharacterEditorBuildParameters` (`BlueprintReadWrite` members only are Python-visible).
- `MetaHumanCharacterPalette/Public/MetaHumanCharacterPalette.h`:93 — `TryAddItemFromWardrobeItem`.
- `MetaHumanCharacterPalette/Public/MetaHumanInstance.h`:243 — `SetSingleSlotSelection`; 263 — `TryAddSlotSelection`.
- `MetaHumanCharacterPalette/Public/MetaHumanCollection.h`:379 — `DefaultInstance` (`BlueprintReadOnly`).
- `MetaHumanCharacterPalette/Public/MetaHumanCollectionBlueprintLibrary.h`:255 — instance-parameter ScriptMethods; 346 — `MakeSlotSelection`; 456 — `GetInstanceParametersForItem` (`ScriptMethod="GetInstanceParameters"`).
- `MetaHumanCharacter/Public/MetaHumanCharacter.h`:386–399 — `FaceEvaluationSettings`, `HeadModelSettings`, `SkinSettings`, `EyesSettings`, `MakeupSettings`; 515 — `InternalCollection` (`BlueprintReadOnly`).
- `MetaHumanCharacter/Public/MetaHumanCharacterEyes.h`:39 — `IrisPattern` (`ScriptName="Pattern"`); 43 — `IrisRotation` (`ScriptName="Rotation"`).

Under `Engine/Plugins/MetaHuman/MetaHumanCoreTechLib/Source/MetaHumanCoreTechLib/Public/`:
- `MetaHumanCharacterIdentity.h`:40 — `EAlignmentOptions` (`ScriptName="MetaHumanAlignmentOptions"`); 52 — `FFitToTargetOptions`.
- `MetaHumanCharacterBodyIdentity.h`:89 — `FMetaHumanCharacterBodyConstraint`.

5.9 script edit policy for Collection and Instance assets:
- `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterPalette/Private/MetaHumanScriptEditPolicy.cpp`:14 — `CanScriptDirectlyEdit`.
- `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterPalette/Public/MetaHumanCharacterPalette.h`:104 — `K2_TryAddItemFromWardrobeItem` (script name `TryAddItemFromWardrobeItem`).
- `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterPaletteEditor/Public/MetaHumanCollectionEditingSubsystem.h`:38 — `OpenCollectionSession`; 42 — `OpenInstanceSession`.
- `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterPaletteEditor/Public/MetaHumanCollectionSessionHandle.h`:41 — `AddWardrobeItem`; `ApplyChanges`, `BuildPreview`.
- `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacterPaletteEditor/Public/MetaHumanSessionHandleBase.h`:122 — `GetInstanceParameters`.

Epic scripts (UE 5.8, `Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Python/`):
`examples/example_create_asset.py`, `examples/example_auto_rig.py`, `examples/example_assembly.py`,
`examples/example_modify_skin.py`, `examples/example_sculpt_body.py`, `examples/example_sculpt_face.py`,
`examples/example_live_edit.py`, `examples/example_add_grooms.py`, `examples/example_add_clothing.py`,
`examples/example_conform_head.py`, `examples/example_conform_body_from_template.py`,
`examples/example_download_textures.py`, `examples/example_export_tools.py`,
`examples/example_spawn_metahuman_actor.py`, `metahuman_character_test_utils.py`,
`test_cloud_requests.py`; and `Engine/Plugins/Experimental/Toolsets/MetaHumanGenerator/Content/Python/metahuman_toolset/metahuman.py`.
