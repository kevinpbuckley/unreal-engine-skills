# Organic surface imports: seams, scale and material sections

Use this for traversable anatomy, caves or similar generated surfaces, especially
when reimport changes their appearance. Preserve approved assets and authored
lighting while working on the affected asset. Red interior lighting may be an
intentional choice; neutral asset-preview lighting is a separate inspection aid.

## A correct component override can still render a missing material

Static mesh material slots and LOD sections are separate data. `GetMaterial(0)`
does not prove a section uses slot 0. `ImportLOD` can append a material slot;
restoring an old `static_materials` array does not remap section indices. A mesh
with one remaining slot and sections referencing index 1 can render default gray.

Before reimport, retain slot names/imported names, each LOD/section's slot index,
actor overrides, LOD screen sizes, complex collision mesh/trace mode and transforms.
After reimport, resolve slots by stable, unique names. Restore the slot array and
then explicitly remap sections. Stop if names or section correspondence are
ambiguous. Use a universal slot-0 mapping only for an intentionally single-material
mesh, never as a general repair for multi-material assets.

```python
import unreal
s = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
# Run after Play mode has ended. PIE can cause these APIs to return empty/failure.
for lod in range(s.get_lod_count(mesh)):
    for section in range(mesh.get_num_sections(lod)):
        slot = s.get_lod_material_slot(mesh, lod, section)
        print(lod, section, slot)
        # For an explicitly intended single-material mesh only:
        # s.set_lod_material_slot(mesh, 0, lod, section)
# Save only the edited asset after applying the intended remapping.
```

Engine source: `Editor/StaticMeshEditor/Public/StaticMeshEditorSubsystem.h`,
`GetLODMaterialSlot`/`SetLODMaterialSlot`; implementation reads/writes
`UStaticMesh::GetSectionInfoMap()`. Source/build section data and component
overrides must agree with the desired appearance. A client timeout is not proof
an import failed; inspect its operation result/log before repeating a mutation.

## Diagnose the seam before selecting the repair

| Symptom/evidence | Relevant repair |
|---|---|
| Different atlas colors across UV islands | Repair/rebake atlas, or use a suitable UV-independent surface; disclose loss of atlas-specific regions |
| Repeating image-edge discontinuities | Make maps periodic or keep every sample footprint inside their borders |
| Sharp lighting band remains with continuous color | Inspect corner normals at shared vertices and hard-edge flags |
| Gray/default surface after LOD reimport | Inspect every LOD section's material index, not just component slot 0 |
| Actual holes, intersecting or disconnected shells | Geometry diagnosis; material smoothing cannot close them |

Imported custom corner normals can differ even where positions/topology are shared.
Simply setting smooth shading on faces does not necessarily remove custom normals
or sharp-edge splits. For an intended continuous organic surface, explicitly
assign consistent shared-vertex normals while preserving positions, UVs, triangle
connectivity and winding. Apply before tangent-normal baking and to every LOD.
Preserve deliberate hard edges on mechanical meshes. Do not weld disconnected
shells or recalculate outside winding as a blanket shading repair.

## Physical detail density and projection

Baking actor scale into mesh dimensions does not increase atlas resolution. Layer
generated PBR detail at a documented physical scale for close traversal. Use a
mesh-local frame for rigidly moving or uniformly breathing objects; world-space
projection swims through motion. Nonuniform/skeletal deformation needs explicit
coordinate and normal handling.

Use the same mapping for albedo, roughness and normal detail. Projection weights
must not depend on a seamed UV-atlas normal. Front/back color switches can produce
patches across mixed winding. Triplanar blending cannot repair discontinuous mesh
normals and does not make a non-periodic bitmap tileable.

For stochastic patches, ensure rotated samples stay inside the source image:
`uv=.5+offset+rotate(d)*.28`, with `d in [-1,1]^2` and
`offset in [-.04,.04]^2`, stays within approximately `[.064,.936]`.
Use weights that smoothly reach zero at support edges, and transform sampling
gradients/normal vectors consistently. Adjust physical spacing for the inset
footprint. Account for filtering and mip bleed; generated images with baked
shadows can still look overly folded even with subtle normal strength.

Albedo is sRGB; normals and masks are linear. For RGB albedo plus alpha roughness,
alpha remains linear under sRGB sampling and must survive compression. Match the
normal convention: UE's usual tangent-space setup needs green inversion for
OpenGL +Y maps and generally none for DirectX -Y maps. Custom decoding uses its
own declared projection basis. Do not infer this solely from texture filenames.

Keep DCC/GLB and Unreal appearances distinct in delivery notes: engine-only
projection shaders are not automatically represented by an atlas-textured GLB.
Report installation separately from visual acceptance. Respect the target
repository's limits on automated testing, screenshots, PIE and paid generation.
