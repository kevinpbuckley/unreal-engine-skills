---
name: ue-hair-and-grooms
description: >
  Hair Strands grooms in UE 5.9: UGroomAsset groups, geometry settings (HairWidth,
  HairWidth_Override, HairRootScale, HairTipScale), LODs and LOD mode, guides and interpolation,
  groom materials (MSM_Hair, bUsedWithHairStrands, slot names); Alembic groom import through
  UHairStrandsFactory and UGroomImportOptions (FGroomConversionSettings, groom_ attributes, units
  and axes); UGroomBindingAsset (source/target skeletal mesh, Rigid vs Skinning, async build,
  retargeting); UGroomComponent setup; editor Python patterns; converting hair cards to strands;
  making a custom groom usable as MetaHuman Creator hair. Use when importing an .abc groom, the
  .abc imports as a geometry cache or static mesh, hair is invisible, bald, ghostly or too thin,
  hair renders with the default material, a binding will not build or is rejected, hair thins
  with distance or in small captures, scene captures of grooms come out empty, or Python edits
  to groom settings do nothing.
metadata:
  engine-version: "5.9"
  category: content-assets
  aliases: "hair, groom, hair strands, hair cards, eyebrows, beard, alembic hair, groom binding, bald at distance, r.HairStrands"
---

# Hair and grooms

For turning a card-hair pack into strands, read
[converting hair cards to strands](references/cards-to-strands.md). For wearing a custom groom
in MetaHuman Creator, read [custom grooms as MetaHuman hair](references/metahuman-creator-hair.md).

A groom is three assets that must agree: the `UGroomAsset` (the strands and how they render),
the `UGroomBindingAsset` (where the roots sit on a particular skeletal mesh), and the
`UGroomComponent` that pairs the two under a skeletal mesh component. Most "the hair is missing"
problems are one of these three disagreeing, or a groom setting that was edited in a way the
asset never noticed.

## When to use this skill

- Importing an Alembic (`.abc`) groom, or setting width, LODs, guides or materials on a
  `UGroomAsset` by hand, from Python or from C++.
- Building or retargeting a `UGroomBindingAsset`, choosing Rigid or Skinning attachment, and
  adding a `UGroomComponent` to a character.
- Debugging invisible, bald, ghostly or thinning hair, including in scene captures.
- Converting card hair to strands, or preparing a groom for MetaHuman Creator.

## Mental model

| Concept | Type | Role |
|---|---|---|
| Groom | `UGroomAsset` | Strand data split into **groups**. Each group has parallel entries in `HairGroupsRendering`, `HairGroupsLOD`, `HairGroupsInterpolation`, `HairGroupsPhysics`, `HairGroupsCards`, `HairGroupsMeshes`, plus the asset-wide `HairGroupsMaterials` slots. |
| Group rendering | `FHairGroupsRendering` | `GeometrySettings` (`FHairGeometrySettings`: width, root/tip scale), shadow and advanced settings, and a hidden `MaterialSlotName`. |
| Group LODs | `FHairGroupsLOD` → `TArray<FHairLODSettings>` | Per LOD: decimation, `ScreenSize`, `GeometryType` (Strands/Cards/Meshes), `BindingType` (Rigid/Skinning). |
| Guides | `FHairGroupsInterpolation` | Imported or generated guides that drive the render strands for simulation and skinning. |
| Binding | `UGroomBindingAsset` | Root projection of one groom onto one target skeletal mesh (optionally transferred from a source mesh). Built asynchronously into derived data. |
| Component | `UGroomComponent` | Renders the groom; binds to its **attach parent's** mesh component. |
| Importer | `UHairStrandsFactory` + `UGroomImportOptions` | Legacy `UFactory` that reads `.abc` curves through the Alembic hair translator. |

Rules that drive almost every gotcha:

1. **Binding type lives on the groom, not the binding.** `FHairLODSettings::BindingType`
   (`EGroomBindingType`: Rigid or Skinning, default **Skinning**) is set per group per LOD on the
   `UGroomAsset`. `UGroomBindingAsset::GroomBindingType` is a different enum
   (`EGroomBindingMeshType`: SkeletalMesh or GeometryCache).
2. **A missing binding detaches the hair, it does not hide it.** At registration the component
   downgrades a Skinning LOD with no binding asset, or a Rigid LOD with no parent mesh
   component, to `NoneBinding`. The groom then renders in the component's own space at its
   rest shape and does not follow the mesh (a `GroomActor` dropped in a level renders this way).
3. **Width comes from the file unless you override it.** Without `HairWidth_Override`, the
   strand width is the imported width, and a file without widths gets 0.01 cm.
4. **Group settings are arrays behind Blueprint getters and setters.** In Python, an edit is
   only noticed when `set_editor_property` receives an array that differs from the asset's
   current one (see the Python struct rules).

## Core workflow

1. Enable the **Groom** (`HairStrands`) and **Alembic Groom Importer** (`AlembicHairImporter`)
   plugins. Both are `EnabledByDefault: false`, and `unreal.HairStrandsFactory` and
   `UGroomComponent` do not exist until they are on.
2. Import the `.abc` (curves only, no meshes) with `UHairStrandsFactory` named explicitly, an
   explicit `UGroomImportOptions` (set `ConversionSettings` rotation and scale), and automated
   mode.
3. On the groom, per group: set `HairWidth_Override` and `HairWidth`, `HairRootScale`,
   `HairTipScale`; check guides; decide `BindingType` per LOD; set `LODMode`.
4. Assign hair materials in `HairGroupsMaterials` (shading model Hair, Used with Hair Strands).
5. For Skinning, create a `UGroomBindingAsset` against the target skeletal mesh and let it
   finish building. For Rigid, no binding is needed; optionally set the component's
   `AttachmentName` to a **bone** name (see Rigid vs Skinning).
6. Add a `UGroomComponent` attached to the skeletal mesh component, then set binding and groom.

## Groom settings that matter

| Setting (Python name) | Effect | Common mistake |
|---|---|---|
| `GeometrySettings.HairWidth` (`hair_width`) | Strand width in cm | Has no effect until `hair_width_override` is true |
| `GeometrySettings.HairWidth_Override` (`hair_width_override`) | Use the asset width instead of the imported width | Left false on a file with no widths, so strands are 0.01 cm and read as a faint ghost |
| `GeometrySettings.HairRootScale` / `HairTipScale` (`hair_root_scale`, `hair_tip_scale`) | Width multipliers at root and tip; no asset-level override flag (the component instance can still override them) | Tip scale 1 gives blunt, cylinder-like strands |
| `FHairLODSettings.BindingType` (`binding_type`) | Rigid (follow the parent mesh component or bone) or Skinning (follow the skin) | Skinning on an unbound component, so the hair sits at rest and does not follow the mesh |
| `FHairLODSettings.ScreenSize` (`screen_size`) | Chooses between discrete LODs | Expecting it to stop thinning; with one LOD it has no effect |
| `LODMode` (`lod_mode`), `AutoLODBias` (`auto_lod_bias`) | Auto mode scales the active curve count with screen size; Default resolves to Auto unless the project setting is off | Hair thins or vanishes in small views; set Manual or raise the bias |
| `FHairInterpolationSettings.GuideType` | Imported, Generated or Rigged guides | Falls back to Generated when the file has no `groom_guide` curves |
| `HairToGuideDensity` | Generated guide ratio (default 0.1) | Too low for long, simulated hair |

Width resolution order (`UGroomComponent`): instance override on the component group
description wins; otherwise the asset `HairWidth` if `HairWidth_Override`; otherwise the
imported width (max radius × 2). `UGroomAsset::SetHairWidth` writes `HairWidth` on every group but
does not set the override flag. Older groom assets loaded from disk get `HairWidth_Override`
forced true for backward compatibility, so an old and a new import of the same file can differ.

`FHairLODSettings` defaults: `CurveDecimation` 1, `VertexDecimation` 1, `AngularThreshold` 1,
`ScreenSize` 1, `ThicknessScale` 1, `bVisible` true, `GeometryType` Strands, `BindingType`
Skinning, `Simulation` Auto, `GlobalInterpolation` Auto. An import creates one LOD per group.

**LOD and distance.** Auto LOD is on by default: `r.HairStrands.LODMode` defaults to 1 (Project
Settings > Rendering > Hair Strands > "Enable Hair Strands 'Auto' LOD mode", restart required),
so a groom left at `LODMode` Default uses Auto LOD. In Auto, the active curve count follows
screen coverage plus `AutoLODBias` plus a global `r.HairStrands.AutoLOD.Bias` (default 0.1), and
the LOD list is ignored for strands. To keep full density in close-ups and small captures, set
`LODMode` Manual per groom, raise `AutoLODBias`, or turn the project setting off.
`r.HairStrands.AutoLOD.Force=1` forces Auto on every groom, overriding Manual. Setting
`ScreenSize` 0 on a single-LOD groom does not change any of this.

## Materials

Groom materials resolve by slot name: each group's hidden `MaterialSlotName` is looked up in
`HairGroupsMaterials[].SlotName`. If no slot matches, the group uses slot 0. If that slot has no
material, or the material is incompatible, the component falls back to the plugin default
(`/HairStrands/Materials/HairDefaultMaterial` for strands).

- Component `OverrideMaterials` win first: `UGroomComponent::GetMaterial` asks the base
  primitive component before it reads the groom's slots.
- Cards and meshes LODs resolve through their own description's `MaterialSlotName`
  (`HairGroupsCards[]`, `HairGroupsMeshes[]`), not the hidden strands `MaterialSlotName`.

A strands material is compatible only if it has the **Hair** shading model (`MSM_Hair`), the
**Used with Hair Strands** usage, and an opaque or masked blend mode. Cards and meshes LODs
accept any material. Version note: in 5.8 C++ the `UMaterial::bUsedWithHairStrands` bitfield is
deprecated; use `GetUsageByFlag(MATUSAGE_HairStrands)` and `SetMaterialUsage(MATUSAGE_HairStrands)`.
The editor checkbox is still "Used with Hair Strands".

Because `MaterialSlotName` is not editable, copying `HairGroupsMaterials` from another groom
gives every group that groom's first material unless the slot names happen to match.

## Bindings

- `Groom` is the groom; `TargetSkeletalMesh` is the mesh the groom attaches to;
  `SourceSkeletalMesh` (optional) is the mesh the groom was authored on.
- With a source mesh, the build transfers: it matches target positions onto the source through
  **UV channel 0** of material section `MatchingSection` (default 0). The groom must be authored
  in the source mesh's component space, and the two meshes must share a UV layout on that section.
- `NumInterpolationPoints` (default 100) sets the RBF sample count.
- The component accepts a binding only if it points at the **same groom asset** (compared by
  `PrimaryAssetId`) with the same group count, and its built root data has the **same LOD
  count** as the attached skeletal mesh. Mesh names are not compared.
- **Retargeting** to another mesh: duplicate the binding and set `TargetSkeletalMesh` (keep or
  set `SourceSkeletalMesh` when the target's rest pose differs from the groom's).
- Bindings build asynchronously through `FGroomBindingCompilingManager`; `IsCompiling()` is true
  while the task runs. They build synchronously for GeometryCache bindings or when
  `r.HairStrands.Streaming` is on.
- Changing `Groom`: use `SetGroom` (Python `binding.groom = g`), then build explicitly. `SetGroom`
  waits for any in-flight build to release the property and moves the binding's
  `OnGroomAssetChanged` subscription to the new groom, but does not rebuild. Python
  `binding.set_editor_property("groom", g)` does rebuild (`PostEditChangeProperty` →
  `BeginCacheDerivedDatas`), but it writes the field directly: the binding stays subscribed to
  the **old** groom, so later edits to the new groom do not invalidate it until reload, and the
  write is not guarded against a running build.
- Building: in C++ call `Build()` (optionally with a native completion delegate). The only
  Blueprint/Python overload takes a dynamic delegate with no default, so from Python call
  `binding.build(unreal.OnGroomBindingAssetBuildComplete())`, or bind a callable with
  `d = unreal.OnGroomBindingAssetBuildComplete(); d.bind_callable(fn)` to learn when it ends.
  `Build()` does not mark the package dirty; save with `only_if_is_dirty=False`.

Rigid vs Skinning: Rigid needs no binding asset, only a parent mesh component. It is cheap and
fine for helmets, short hair and props. Skinning follows the skin surface and needs a built
binding. Observed in 5.8: building a Skinning binding for a groom of about 40k strands against a
full face mesh kept the editor busy for more than 15 minutes, so test with Rigid first on large
grooms.

`AttachmentName` names a **bone**, not a socket (the header comment says socket). On tick, when
the parent is a skeletal mesh component, the component looks the name up with `GetBoneIndex`,
attaches itself to that bone with KeepRelative, and sets its relative transform to the inverse
of the bone's reference-pose transform. So keep the groom in the skeletal mesh's component
space and add no manual offset; adding your own inverse bone or socket transform applies it
twice. A name that is not a bone does nothing, and nothing happens until the component ticks.

## C++ pattern

Module dependency: `HairStrandsCore` (add `"HairStrandsCore"` to `PublicDependencyModuleNames`).

```cpp
// MyCharacter.h
#include "GroomComponent.h"

UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Hair")
TObjectPtr<UGroomComponent> Hair;

// MyCharacter.cpp
AMyCharacter::AMyCharacter()
{
    Hair = CreateDefaultSubobject<UGroomComponent>(TEXT("Hair"));
    Hair->SetupAttachment(GetMesh());      // binds to the attach parent's mesh
    // Optional, any binding type: Hair->AttachmentName = TEXT("head");   // a bone name
}

void AMyCharacter::SetHair(UGroomAsset* Groom, UGroomBindingAsset* Binding)
{
    Hair->SetGroomAsset(Groom, Binding);   // C++-only overload; Blueprint/Python use the two setters
}
```

Creating a binding in editor code (`WITH_EDITOR` only; returns null in cooked builds):

```cpp
#include "GroomBlueprintLibrary.h"

UGroomBindingAsset* Binding = UGroomBlueprintLibrary::CreateNewGroomBindingAssetWithPath(
    TEXT("/Game/Characters/Hair/GR_Hair_Binding"), Groom, TargetMesh,
    /*InNumInterpolationPoints*/ 100, /*InSourceSkeletalMeshForTransfer*/ nullptr,
    /*InMatchingSection*/ 0);              // creates, starts an async Build(), then saves at once
```

`CreateNewGroomBindingAssetWithPath` saves the package immediately after starting the async
build, which is the save-while-compiling case the gotchas warn about. That is fine for small
grooms. For large ones, create the binding without saving (duplicate an existing binding, or
create a `UGroomBindingAsset` and set its properties), build it, and save from the build
completion delegate.

## Python worked example

```python
import unreal

ABC, DEST, NAME = "D:/Grooms/hair.abc", "/Game/Characters/Hair", "GR_Hair"

opts = unreal.GroomImportOptions()          # config class: starts from last dialog values
conv = opts.get_editor_property("conversion_settings")
conv.set_editor_property("rotation", unreal.Vector(0, 0, 0))
conv.set_editor_property("scale", unreal.Vector(1, 1, 1))
opts.set_editor_property("conversion_settings", conv)

task = unreal.AssetImportTask()
for k, v in (("filename", ABC), ("destination_path", DEST), ("destination_name", NAME),
             ("automated", True), ("replace_existing", True), ("save", False),
             ("factory", unreal.HairStrandsFactory()), ("options", opts)):
    task.set_editor_property(k, v)
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
groom = unreal.load_asset(f"{DEST}/{NAME}")

# list(...) gives element COPIES, detached from the asset. Edit the copies, then set the list:
# it differs from the asset's array, so Pre/PostEditChange fire and the groom rebuilds.
rendering = list(groom.get_editor_property("hair_groups_rendering"))
for group in rendering:
    gs = group.get_editor_property("geometry_settings")   # reference into this copy
    gs.set_editor_property("hair_width_override", True)
    gs.set_editor_property("hair_width", 0.011)
    gs.set_editor_property("hair_tip_scale", 0.5)
groom.set_editor_property("hair_groups_rendering", rendering)
groom.set_editor_property("lod_mode", unreal.GroomLODMode.MANUAL)

mat = unreal.HairGroupsMaterial()
mat.set_editor_property("material", unreal.load_asset("/Game/Characters/Hair/MI_Hair"))
mat.set_editor_property("slot_name", "Hair")
groom.set_editor_property("hair_groups_materials", [mat])

mesh = unreal.load_asset("/Game/Characters/SK_Head")
binding = unreal.GroomLibrary.create_new_groom_binding_asset_with_path(
    f"{DEST}/{NAME}_Binding", groom, mesh, 100, None, 0)   # builds async, saves at once
unreal.EditorAssetLibrary.save_loaded_asset(groom, only_if_is_dirty=False)
```

On a component, `groom_asset` is `BlueprintReadWrite` but `BindingAsset` is
`BlueprintReadOnly`: call `comp.set_binding_asset(binding)` and `comp.set_groom_asset(groom)`.

Python struct rules (`UGroomAsset` group arrays use `BlueprintGetter`/`BlueprintSetter`):

- Reading `groom.hair_groups_rendering` as an attribute goes through the `BlueprintGetter` and
  returns a **copy**; edits to it are lost.
- `get_editor_property("<array>")` returns an array wrapper that **aliases** the asset's own
  `TArray`, but indexing or iterating it returns **copies** of the elements. So
  `arr[0].get_editor_property("geometry_settings").set_editor_property("hair_width", x)` edits
  a temporary. In 5.8 the change was silently lost; 5.9 marks element copies and raises
  `RuntimeError: Cannot set 'hair_width' on a temporary value as the change would be lost`
  when nothing else holds the copy (`PyWrapperStruct.cpp`, `GetTemporaryCopySource`).
- `arr[i] = elem` on that aliasing wrapper writes straight into the asset's memory and sends
  **no** change notification.
- A nested struct read with `get_editor_property` is a reference into its parent. When the
  chain reaches an object (a struct property directly on the asset), `set_editor_property` on
  the nested struct notifies that object; array elements break the chain because they are copies.
- `set_editor_property` with the default notify mode sends Pre/PostEditChange **only if the
  value passed differs** from the current value. Writing back an array you already edited
  through the aliasing wrapper is a no-op: nothing rebuilds and the package is not marked dirty,
  so `save_asset` with the default `only_if_is_dirty=True` skips it.
- The reliable recipe is the one above: `list(get_editor_property(...))`, edit the copies, then
  `set_editor_property` the list. Alternatively pass
  `notify_mode=unreal.PropertyAccessChangeNotifyMode.ALWAYS` on the final set.
- **New in 5.9 (read in source, not run):** containers have `edit(index)` (a context manager
  whose `value` is a copy written back on exit, with change notification) and
  `modify(index, func)`; objects and structs have `edit_property(name)` /
  `modify_property(name, func)`. For example
  `with groom.edit_property("hair_groups_rendering") as e: ...` then edit `e.value` and let the
  block write it back. These are what the 5.9 "temporary value" error message recommends.
- Inner structs that are `EditAnywhere` only (`GeometrySettings`, the `FHairLODSettings` fields,
  `FHairGroupsMaterial.Material`/`SlotName`) are not attributes; use `get_editor_property`.

## Cards, helmets and LOD holes (low-end, web, distance)

Strands are a high-end representation. On scalability levels or platforms without strands (the
mobile renderer, including the UE 5.9 WebGPU tiers) and wherever cards are forced, each LOD
draws its **cards** or **meshes** data instead, and a LOD with neither draws nothing.

- **Which switch does what** (5.9 console variables, all `ECVF_Scalability`):

  | CVar | Effect |
  |---|---|
  | `r.HairStrands.Strands=0` | Strands off only. A Strands LOD falls back to that group's **cards** (`GetEffectiveGeometryType`, `ConvertLODGeometryType`). This is the cards-only switch. |
  | `r.HairStrands.Enable=0` | The **whole** groom system off: "This affects all geometric representations (i.e., strands, cards, and meshes)". Every character loses hair, brows and beard. |
  | `r.HairStrands.UseCardsInsteadOfStrands=1` | Force cards on every groom; "If no cards data is available, nothing will be displayed". |
  | `r.HairStrands.Cards` / `r.HairStrands.Meshes` | Cards / meshes rendering; read when the engine starts. |
  | `r.HairStrands.MinLOD` | Clamp the minimum groom LOD. Step it 0..7 to inspect every LOD. |
  | `r.HairStrands.Simulation=0` | Hair simulation off (pair it with cards-only on low-end targets). |

- **MetaHuman grooms from an Optimized build have holes in their LOD table.** Measured in a
  48-hour UE 5.9 game-jam project (2026-11), Optimized Medium build: strands at LOD 0-1, cards
  only at LOD 3, helmet meshes only at LOD 5 and 7, brows hidden at LOD 5-7. With strands off,
  LOD 0-3 drew the LOD 3 cards, **LOD 4 and 6 drew no hair at all** (bald heads in any wide shot:
  LOD 4 started at screen size 0.0625), and brows vanished from LOD 4 on.
- **Fix: give every LOD something to draw.** For each group, set each empty LOD to the nearest
  cards or meshes LOD data (`HairGroupsLOD[g].LODs[i].GeometryType`, plus the matching
  `HairGroupsCards` / `HairGroupsMeshes` entries with `LODIndex`), and make the brow LODs
  visible cards (`bVisible`). Measured cost: about 4 MB cooked for 15 grooms. The bindings
  rebuild by themselves afterwards ("Waiting for groom bindings" in the log, about a minute).
- **Check it:** `r.HairStrands.Strands 0`, then `r.HairStrands.MinLOD 0` ... `7`, looking at
  each step through the game's real cameras. Judge hair in PIE or a packaged build: an editor
  scene capture drew no hair on five of six characters in one session with untouched assets.
- **A MetaHuman Creator rebuild rewrites the grooms**, so the LOD fill and any card or brow
  edits are lost: keep them as a re-runnable script.
- On the web the cook drops strand data for the mobile tiers, so strand LODs fall back to
  cards there whatever the device profile says (jam observation, not traced in source).

## Rendering and capture

- **Background throttling.** When the editor lacks focus and Editor Preferences > Performance >
  "Use Less CPU when in Background" (`bThrottleCPUWhenNotForeground`, default true) is on,
  `UEditorEngine::Tick` adds a non-realtime override to every viewport and throttles the tick,
  so viewports (the MetaHuman Creator's included) stop redrawing and tick-driven captures stall.
  Bring the editor to the front, or turn it off in Editor Preferences (it is saved per user in
  `EditorSettings.ini`, `[/Script/UnrealEd.EditorPerformanceSettings]`). From Python the route
  is uncertain: `UEditorPerformanceSettings` is not `BlueprintType` and the field is a
  `uint32:1` bitfield with no Blueprint access; a 5.8 session reported that
  `unreal.get_default_object(unreal.EditorPerformanceSettings).set_editor_property("throttle_cpu_when_not_foreground", False)`
  worked, while a 5.9 project reported that `unreal.EditorPerformanceSettings` is not in the
  Python API. Treat it as unverified.
- **Async binding builds.** A binding created or changed in the same script is still compiling
  when the next line runs. Pass a completion delegate to `Build()` (from Python, a bound
  `unreal.OnGroomBindingAssetBuildComplete`), or wait for real editor frames (a Slate post-tick
  callback) before capturing.
- **`UKismetRenderingLibrary::ExportRenderTarget` is synchronous**: it flushes rendering
  commands, encodes and writes the file before returning. Missing hair in an exported frame
  means the groom or capture was not ready, not that the write lagged.
- **Transient actors.** `EditorActorSubsystem.get_all_level_actors()` skips `RF_Transient`
  actors; keep the Python handles of any transient capture rigs you spawn.
- Observed in 5.8: the first frames of the first groom in a freshly spawned capture rig came out
  bald even after long waits; recapturing it at the end of a batch fixed it.
- Observed in 5.8: against a black background, auto exposure blew out hair highlights. Set
  `override_auto_exposure_min_brightness`/`max_brightness` to the same value with
  `post_process_blend_weight` 1 on the capture for consistent frames.

## Gotchas & edge cases

- **The `.abc` imports as a geometry cache or static mesh.** Factory auto-selection prefers
  `UHairStrandsFactory` (priority 101 over the Alembic importer's 100), but it only claims a file
  that has at least one `ICurves` and **no** `IPolyMesh`, and only when the Alembic Groom
  Importer plugin is enabled. Remove meshes from the file and enable the plugin. Naming the
  factory on the task matters only with `automated=True`, and even then it is used only if its
  `FactoryCanImport` passes, so it does not rescue a mixed curves+mesh file.
- **The import dialog changed my script's import.** `UGroomImportOptions` is a
  `config = EditorPerProjectUserSettings` class; confirming the dialog saves its conversion
  settings, and a new `unreal.GroomImportOptions()` starts from them. Always set rotation and
  scale explicitly.
- **Per-group import options were ignored.** If `InterpolationSettings` does not match the
  file's group count, the factory resets it to one default entry per group.
- **Hair is invisible or does not follow the mesh.** A missing binding (Skinning) or parent
  mesh component (Rigid) does not hide the groom; it downgrades to `NoneBinding`, so the hair
  renders at rest in the component's space and ignores the mesh. For truly invisible hair, check
  `bVisible` per LOD, that the binding was accepted (same groom, same group count, same LOD count
  as the mesh), that the binding has finished building, the bounds, and the material (below).
- **Hair is a faint ghost.** No widths in the file and `HairWidth_Override` off; strands are
  0.01 cm. Enable the override and set a width. Observed in 5.8: the MetaHuman library scalp
  grooms use roughly 0.011 cm with a tip scale of about 0.4-0.65.
- **Hair renders flat grey or default.** Material lacks the Hair shading model, the Used with
  Hair Strands flag, or an opaque/masked blend mode; or the slot name does not match.
- **Hair thins with distance or in small captures.** Auto LOD, which is on by default for
  `LODMode` Default. Set `LODMode` Manual or raise `AutoLODBias`.
- **Python edits did nothing.** The array was edited through an attribute copy, through an
  element copy, or in place through the aliasing `get_editor_property` wrapper and then written
  back unchanged (no notify). See the Python struct rules.
- **Binding did not update after `binding.groom = g`.** Attribute assignment calls `SetGroom`,
  which does not rebuild. Follow it with
  `binding.build(unreal.OnGroomBindingAssetBuildComplete())`. The Python overload's delegate
  parameter has no default, so a bare `binding.build()` is a missing-argument call.
- **Saving a binding mid-build.** Observed in 5.8: saving a binding while it was still compiling
  could stall the editor. Save in a later step, after the build finishes.
  `CreateNewGroomBindingAssetWithPath` saves mid-build by design.

## Version notes

- 5.9 Python: element copies of a container now raise "Cannot set ... on a temporary value"
  instead of silently dropping the write, and `edit`/`modify`/`edit_property`/`modify_property`
  were added (see the Python struct rules).

- Direct access to `UGroomAsset` group arrays and most `UGroomBindingAsset` members was
  deprecated in 5.3 (5.5 for the binding LOD fields); use the accessors (`GetHairGroupsRendering`,
  `SetGroom`, ...). Python names are unchanged.
- In 5.8 the `AssetImportTask` path uses Interchange only when no factory is set, and Interchange
  has no Alembic translator, so `.abc` always goes through the legacy factories.
- 5.8 deprecates the `UMaterial` usage bitfields (`bUsedWithHairStrands` included) in favour of
  `GetUsageByFlag` / `SetMaterialUsage`.

## References & source material

Engine source (UE 5.9, line numbers re-mapped from the 5.8 originals — all paths under `Engine/Plugins/Runtime/HairStrands/Source/`):
- `HairStrandsCore/Public/GroomAsset.h`:468 — `UGroomAsset`; 98 — `FHairGroupsMaterial`; 481-485 —
  `LODMode`, `AutoLODBias`; 509-537 — group arrays; 619-651 — Blueprint getters/setters.
- `HairStrandsCore/Public/GroomAssetRendering.h`:24-35 — `FHairGeometrySettings`; 91-99 —
  `FHairGroupsRendering` (`MaterialSlotName`, `GeometrySettings`).
- `HairStrandsCore/Public/GroomAssetInterpolation.h`:39-45 — `EGroomBindingType`; 64 —
  `EGroomLODMode`; 71-112 — `FHairLODSettings`.
- `HairStrandsCore/Private/GroomAssetInterpolation.cpp`:13-24 — interpolation defaults.
- `HairStrandsCore/Public/GroomBindingAsset.h`:181 — `UGroomBindingAsset`; 205-326 — build
  settings; 535-538 — `Build()`.
- `HairStrandsCore/Private/GroomBindingAsset.cpp`:700-748, 813-843 — binding validity checks;
  955-980 — `Build` overloads; 985-990 — `PostEditChangeProperty`; 1101-1165 — async build;
  1817-1832 — groom delegates; 1864-1882 — `SetGroom`.
- `HairStrandsCore/Private/GroomBindingBuilder.cpp`:2392-2408, 3063-3093 — UV-based transfer.
- `HairStrandsCore/Public/GroomComponent.h`:29 — `UGroomComponent`; 36-52 — `GroomAsset`,
  `BindingAsset`; 95 — `AttachmentName`; 203-208 — setters; 249 — two-argument `SetGroomAsset`.
- `HairStrandsCore/Private/GroomComponent.cpp`:263-277 — width resolution (instance root/tip
  overrides at 275-276); 385-413 — material compatibility; 576-621 — cards and meshes slot
  names; 2311-2345 — `GetMaterial`, override materials and fallback; 3019-3028 — binding type
  downgrade; 3050 — `bAutoLOD`; 3800-3828 — `AttachmentName` bone attachment.
- `HairStrandsCore/Public/GroomBlueprintLibrary.h`:30-37 — `CreateNewGroomBindingAssetWithPath`.
- `HairStrandsCore/Private/GroomBlueprintLibrary.cpp`:27-31 — async `Build()` then immediate save.
- `HairStrandsCore/Public/GroomImportOptions.h`:15-22 — `UGroomImportOptions`.
- `HairStrandsCore/Public/GroomSettings.h`:14-25 — `FGroomConversionSettings`.
- `HairStrandsCore/Private/GroomAsset.cpp`:97-100, 4279-4282 — `LODMode` Default resolves
  through `r.HairStrands.LODMode`; 909-916 — legacy width override; 2384-2390 — `SetHairWidth`.
- `HairStrandsCore/Private/GroomManager.cpp`:67-70 — `r.HairStrands.AutoLOD.Force`/`.Bias`;
  2334-2365 — discrete LOD index from `ScreenSize`; 2644-2652, 2753-2758 — Auto LOD curve reduction.
- `HairStrandsEditor/Public/HairStrandsFactory.h`:57 — `UHairStrandsFactory`.
- `HairStrandsEditor/Private/HairStrandsFactory.cpp`:239-243 — automated import; 290-293 —
  interpolation reset; 435-445 — `FactoryCanImport`.

Editor and engine:
- `Engine/Source/Editor/UnrealEd/Private/EditorEngine.cpp`:1867-1879 — background viewport override.
- `Engine/Source/Editor/UnrealEd/Classes/Editor/EditorPerformanceSettings.h`:72-74 — `bThrottleCPUWhenNotForeground`.
- `Engine/Source/Runtime/Engine/Private/KismetRenderingLibrary.cpp`:233-294 — `ExportRenderTarget`.
- `Engine/Source/Editor/UnrealEd/Private/Subsystems/EditorActorSubsystem.cpp`:370-393 — actor listing filters.
- `Engine/Source/Developer/AssetTools/Private/AssetTools.cpp`:3597-3600, 4038-4069 — factory choice.
- `Engine/Source/Runtime/Engine/Public/Materials/Material.h`:839-841 — `bUsedWithHairStrands`
  (deprecated in 5.8); 1330-1331 — `GetUsageByFlag`, `SetMaterialUsage`.
- `Engine/Source/Runtime/RenderCore/Private/RenderUtils.cpp`:2101-2105 — `r.HairStrands.LODMode` (default 1).
- `Engine/Source/Runtime/Engine/Classes/Engine/RendererSettings.h`:1403-1410 — "Enable Hair Strands 'Auto' LOD mode".
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyUtil.cpp`:1858 —
  `get_editor_property` returns a reference.
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyWrapperArray.cpp`:291-295 —
  aliasing array; 564 — element read is a copy; 576-631 — element write, no notify.
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyWrapperStruct.cpp`:564 —
  `GetTemporaryCopySource`; 601-610 — "Cannot set ... on a temporary value" (5.9).
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyWrapperArray.cpp`:1858-1860 —
  `edit` / `modify` (5.9).
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyWrapperObject.cpp`:1302-1303 —
  `edit_property` / `modify_property` (5.9).
- `Engine/Source/Runtime/Engine/Private/GroomVisualizationData.cpp`:13-15 — `r.HairStrands.Enable` (all representations).
- `Engine/Source/Runtime/Renderer/Private/HairStrands/HairStrandsInterface.cpp`:32-55 — `r.HairStrands.Strands`,
  `.Cards`, `.Meshes`, `.Binding`, `.Simulation`.
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Private/GroomManager.cpp`:47-50 — `r.HairStrands.MinLOD`,
  `r.HairStrands.UseCardsInsteadOfStrands`; 2368-2379 — `ConvertLODGeometryType` (strands fall back to cards).
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Private/GroomComponent.cpp`:2731-2734 —
  `GetEffectiveGeometryType`.
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Public/GroomAssetCards.h`:107 —
  `FHairGroupsCardsSourceDescription` (`LODIndex` 144); `GroomAssetMeshes.h`:19.
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyWrapperOwnerContext.cpp`:55-125 —
  nested struct change notify reaches the owning object.
- `Engine/Plugins/Experimental/PythonScriptPlugin/Source/PythonScriptPlugin/Private/PyConversion.cpp`:1221-1237 —
  array set compares with the current value.
- `Engine/Source/Runtime/CoreUObject/Private/UObject/PropertyAccessUtil.cpp`:753-790 — notify
  skipped for identical values unless `Always`.

Deep-dive references in this skill:
- [references/alembic-groom-import.md](references/alembic-groom-import.md) — factory selection,
  conversion, `groom_` attributes, widths, guides, curve types and engine limits.
- [references/cards-to-strands.md](references/cards-to-strands.md) — converting a card-hair
  pack to strand grooms: cards from UV islands, alpha and root maps, head fitting, face-zone
  cuts, dreadlocks, density, and the Alembic UE expects.
- [references/metahuman-creator-hair.md](references/metahuman-creator-hair.md) — making a custom
  groom wearable in MetaHuman Creator: template head, binding transfer, binding and wardrobe
  item, material slots, SDK groom checks, hair on an assembled MetaHuman.

Related skills: `ue-metahuman-creator`, `ue-importing-content`, `ue-meshes-static-and-skeletal`,
`ue-materials-and-shaders`, `ue-editor-scripting-and-python`.
