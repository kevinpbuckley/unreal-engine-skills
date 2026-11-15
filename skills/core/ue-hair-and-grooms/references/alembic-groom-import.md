# Alembic groom import — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers how an `.abc` file becomes a `UGroomAsset`:
factory selection, conversion settings, the attributes the translator reads, widths, guides,
curve types and the limits the builder enforces. Grounded in UE 5.8 and re-checked against 5.9 (`HairStrandsEditor`,
`AlembicHairTranslator`, `HairStrandsCore`).

---

## Which factory gets the file

- `UHairStrandsFactory` (HairStrandsEditor) has `ImportPriority = DefaultImportPriority + 1`
  (101). `UAlembicImportFactory` (geometry caches, static and skeletal meshes) has 100. Automatic
  selection sorts by priority, so the groom factory wins **if** it accepts the file.
- It accepts an `.abc` only when the Alembic hair translator reports it can import: at least
  one `ICurves` object and **no** `IPolyMesh`. Any mesh in the file (a scalp, a reference head)
  sends it to the geometry importer.
- Neither the Groom plugin (`HairStrands`) nor the Alembic Groom Importer
  (`AlembicHairImporter`) is enabled by default. Without the importer plugin, `.abc` always goes
  to the geometry importer.
- An explicit factory on a `UAssetImportTask` is used only when the task is **automated**, and
  only if its `FactoryCanImport` passes. A mixed curves+mesh file fails `CanTranslate`, so it is
  never imported as a groom through an `AssetImportTask`, explicit factory or not: strip the
  meshes. With `automated=False` the factory object you pass (and anything set on it) is not
  used; a fresh instance of its class only joins the priority-sorted candidate list.
- The task path uses Interchange only when no factory is set; Interchange has no Alembic
  translator in 5.8 or 5.9.

## Import options

`UGroomImportOptions` (`config = EditorPerProjectUserSettings`):

| Property | Meaning |
|---|---|
| `ConversionSettings.Rotation` | Euler degrees applied after scale. Default (0,0,0). |
| `ConversionSettings.Scale` | File units to centimetres. Default (1,1,1). Widths are multiplied by `abs(Scale.X)`. |
| `InterpolationSettings` | One `FHairGroupsInterpolation` per group; reset to defaults when the count does not match the file. |

- The dialog opens unless the import is automated or unattended. Confirming it calls
  `SaveConfig()`, so the next `unreal.GroomImportOptions()` inherits those values. Set rotation
  and scale explicitly in scripts.
- With default conversion settings each Alembic point lands in UE unchanged: no Y-up to Z-up
  swap, 1 Alembic unit = 1 cm. Points are transformed by the accumulated `IXform` matrices,
  then `Scale`, then `Rotation`.
- Writing the file directly in the target mesh's component space (Z-up, centimetres) is the
  simplest convention: defaults then need no correction.

## Attributes the translator reads

Arbitrary Alembic `GeomParams` are imported only if their name starts with `groom_`. Scope is
inferred from the value count (one per strand or one per vertex).

| Attribute | Scope | Use |
|---|---|---|
| `position` (the curve points) | vertex | Strand points, root first |
| `widths` (standard `ICurves` param) | constant/uniform → strand, vertex → vertex | Width, scaled by `abs(Scale.X)` |
| `groom_width` | strand or vertex | Width |
| `uvs` (standard param) / `groom_root_uv` | strand (vertex scope uses the root vertex) | Root UV |
| `groom_guide` | strand, int | 1 = guide curve |
| `groom_group_id`, `groom_group_name` | strand | Group assignment and name |
| `groom_id`, `groom_clumpid` | strand | Strand and clump IDs |
| `groom_color`, `groom_roughness`, `groom_ao` | strand or vertex | Per-strand shading data |
| `groom_closest_guides`, `groom_guide_weights` | strand | Precomputed guide interpolation |
| `groom_basis_type`, `groom_curve_type`, `groom_knots` | strand | Recorded only |
| `groom_version_major/minor`, `groom_tool`, `groom_properties` | groom | Metadata |

**Curve type is not evaluated.** The translator records `kCubic`/`kLinear`/`kVariableOrder` and
the basis as attributes, but nothing in HairStrandsCore reads them: control points are used
directly as polyline points. Write dense, already-evaluated polylines.

## Widths and guides

- No widths in the file → every strand gets 0.01 cm (point radius = width / 2). Set
  `HairWidth` with `HairWidth_Override` on the groom afterwards.
- No `groom_guide = 1` curves → the builder generates guides by decimating the render strands
  at `HairToGuideDensity` (default 0.1). `GuideType` defaults to Imported and falls back to
  Generated.
- `FHairInterpolationSettings` defaults: `GuideType` Imported, `HairToGuideDensity` 0.1,
  `InterpolationQuality` High, `InterpolationDistance` Parametric, `RiggedGuideNumCurves` 10,
  `RiggedGuideNumPoints` 4.

## Limits and conventions for generated files

- The **first point of each curve is the root** (the curve offset). Write points root to tip;
  bindings project the first point onto the mesh.
- At most **255 points per curve**; extra points are trimmed with a warning. Resampling every
  strand to a fixed count (for example 16-32) keeps memory predictable.
- At most **4,194,303 curves per group**.
- Groups: assign them with `groom_group_id` (and optionally `groom_group_name`).
  Each group gets its own rendering, LOD, interpolation and physics entry and can take its own
  material slot.
- Exporter observation (Blender 5.2's Alembic exporter): a Curves object exported positions only
  (no radius, no surface UVs, no custom `groom_` attributes), as POLY curves. Plan to set width
  in UE and accept generated guides and root UVs, or write the file with a library that
  supports `GeomParams`.

---

## Source references (UE 5.9)

Engine source (UE 5.9, line numbers re-mapped from 5.8 — all paths under `Engine/Plugins/`):
- `Runtime/HairStrands/Source/HairStrandsEditor/Private/HairStrandsFactory.cpp`:197 — import
  priority; 239-243 — automated/unattended; 253-258 — task options; 290-293 — interpolation
  reset; 331-356 — dialog and `SaveConfig`; 435-458 — `FactoryCanImport`, `GetTranslator`.
- `Runtime/HairStrands/Source/HairStrandsCore/Public/GroomImportOptions.h`:15-22 —
  `UGroomImportOptions`.
- `Runtime/HairStrands/Source/HairStrandsCore/Public/GroomSettings.h`:14-25 —
  `FGroomConversionSettings`.
- `Importers/AlembicHairImporter/Source/AlembicHairTranslator/Private/AlembicHairTranslator.cpp`:41-45,
  490-500 — `groom_` GeomParams; 706-739 — transforms; 744-835 — widths and UVs; 939, 995-998 —
  conversion; 1078-1144 — `CanTranslate`.
- `Importers/AlembicImporter/Source/AlembicImporter/Private/AlembicImportFactory.cpp`:73-77 —
  geometry importer priority.
- `Runtime/HairStrands/Source/HairStrandsCore/Private/HairAttributes.cpp`:10-38 — attribute names.
- `Runtime/HairStrands/Source/HairStrandsCore/Private/GroomBuilder.cpp`:2330-2394 — default
  width; 2585-2611 — generated guides.
- `Runtime/HairStrands/Source/HairStrandsCore/Private/GroomAssetInterpolation.cpp`:13-24 —
  interpolation defaults.
- `Runtime/HairStrands/Source/HairStrandsCore/Private/GroomBindingBuilder.cpp`:164-172 — root
  is the first point.
- `Runtime/HairStrands/Source/HairStrandsEditor/Private/GroomImportOptionsWindow.cpp`:178 —
  point-count warning.

Shaders and engine:
- `Engine/Shaders/Shared/HairStrandsDefinitions.h`:28-30 — per-curve point and curve limits.
- `Engine/Source/Editor/UnrealEd/Private/Factories/Factory.cpp`:37, 406-416 — `ImportPriority`.
- `Engine/Source/Developer/AssetTools/Private/AssetTools.cpp`:3009-3010, 3597-3600, 4038-4069 —
  factory selection and the Interchange bypass; 3702-3742 — non-automated specified factory.
- `Engine/Plugins/Importers/AlembicHairImporter/AlembicHairImporter.uplugin` and
  `Engine/Plugins/Runtime/HairStrands/HairStrands.uplugin` — `EnabledByDefault: false`.
