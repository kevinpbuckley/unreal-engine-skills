# Landscape — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers component/section dimension math, material
layer setup, edit layers, landscape splines, Nanite landscape, and runtime C++ queries.
Grounded in UE 5.7 (`Engine/Source/Runtime/Landscape/Classes/`) and the official
[Landscape Outdoor Terrain](https://dev.epicgames.com/documentation/unreal-engine/landscape-outdoor-terrain-in-unreal-engine)
and [Landscape Technical Guide](https://dev.epicgames.com/documentation/unreal-engine/landscape-technical-guide-in-unreal-engine)
docs.

## Component / section / quad math

The landscape is a uniform grid of `ULandscapeComponent`s. Each component contains
`NumSubsections × NumSubsections` sections, each `SubsectionSizeQuads` quads on a side.

```
ComponentSizeQuads = NumSubsections × SubsectionSizeQuads
Total landscape quads (one axis) = NumComponentsX × ComponentSizeQuads
Heightmap vertex count (one axis) = Total quads + 1
```

Common recommended setup (32 × 32 components, 4 sections/component, 63 quads/section):
- `ComponentSizeQuads` = 2 × 63 = 126
- Total quads = 32 × 126 = 4032
- Heightmap size = **4033 × 4033 vertices**

Key rule: each section must be a power-of-two number of quads (63 = 64 − 1 for 2×2
subsections; 127 = 128 − 1 for single-section components) so LOD mipmaps fit cleanly.
The engine targets ≤ 1024 components for performance (one render-thread CPU cost per
component, one draw call per section).

Height precision: 16-bit values map to ±256 m at `Z Scale = 100`. Import formats: 16-bit
grayscale PNG, `.r8`, `.r16`, or `.raw` with companion JSON (width/height/bpp).

## Class architecture

```
ALandscape : ALandscapeProxy : APartitionActor
```

`ALandscapeProxy` (abstract, `LandscapeProxy.h`:417) is the runtime class. All streaming
landscape cells are `ALandscapeStreamingProxy` instances pointing back to their parent
`ALandscape` via `LandscapeGuid`. The proxy holds:

- `LandscapeComponents` — `TArray<ULandscapeComponent*>` (index into the component grid).
- `LandscapeMaterial` — the `UMaterialInterface` applied to all components.
- `ComponentSizeQuads`, `SubsectionSizeQuads`, `NumSubsections` — dimension metadata.
- `bEnableNanite`, `NaniteLODIndex`, `bNaniteSkirtEnabled` — Nanite generation settings.
- `bUseDynamicMaterialInstance` — creates per-component `UMaterialInstanceDynamic` at
  runtime; required if you modify landscape material parameters from code.
- `bUsedForNavigation` — opt out for distant/background landscapes to avoid navmesh cost.

`ULandscapeComponent` (`LandscapeComponent.h`:413) extends `UPrimitiveComponent`. It owns
the heightmap texture and weightmap textures for its tile of terrain, drives the LOD
selection per-component, and contributes to the landscape's collision.

## Material layers and `ULandscapeLayerInfoObject`

A landscape material uses one or more `LandscapeLayerBlend` material nodes, each referencing
a named layer. For each such layer:

1. Create a `ULandscapeLayerInfoObject` data asset (`LandscapeLayerInfoObject.h`:59).
   - Assign a `UPhysicalMaterial` (optional) for surface-type queries at runtime.
   - `Hardness` influences paint blending; `bNoWeightBlend` forces binary 0/1 weight.
2. Open the landscape's **Target Layers** panel and assign the created asset to the matching
   layer name.
3. The weightmap (a texture stored per component) records the blended weights at runtime.

Without the `ULandscapeLayerInfoObject` asset, the layer entry appears in the editor UI but
painting is disabled and the material blend node receives zero weight for that layer.

**Landscape grass types:** `ULandscapeGrassType` assets referenced from the landscape
material cause the engine to spawn grass HISM instances procedurally as the camera moves.
Grass uses `UHierarchicalInstancedStaticMeshComponent` under `ALandscapeProxy`
(see `LandscapeProxy.h` — `UHierarchicalInstancedStaticMeshComponent` is forward-declared
at line 30). Runtime grass generation is controlled by `bDisableRuntimeGrassMapGeneration`.

## Edit layers

Edit Layers (`LandscapeEditLayer.h`) are non-destructive sculpt/paint stacks authored in
the editor. Each layer is either a **Height** layer, a **Weight** layer, or a **Blueprint
Brush** layer (`ALandscapeBlueprintBrushBase`). The engine merges them in order at bake
time into the final heightmap and weightmap textures. At runtime, only the baked result
is used — there is no runtime merge cost.

Blueprint brushes provide a C++/Blueprint hook (`AddBrushToLayer`, `RemoveBrush` on
`ALandscape`) for tools that generate heightmap edits procedurally at edit time.

## Landscape splines

`ALandscapeSplineActor` (`LandscapeSplineActor.h`:14) owns a `ULandscapeSplinesComponent`
(forward-declared in `LandscapeProxy.h`:38 as `SplineComponent`). Splines consist of:

- `ULandscapeSplineControlPoint` — a positioned point with tangent handles.
- `ULandscapeSplineSegment` — connects two control points; stores the painted falloff shape.

At cook/build time, the spline deforms terrain beneath it (raise terrain to spline height
within the falloff) and optionally stamps static mesh instances along the segment
(`ControlPointMeshActor.h`, `LandscapeSplineMeshesActor.h`).

World Partition landscapes partition splines into `ALandscapeSplineActor` actors per region;
the `ShouldPartitionSpline()` method on the spline actor controls this.

## Nanite landscape

Enable with `bEnableNanite = true` on the proxy. The engine:
1. Generates a `ULandscapeNaniteComponent` (`LandscapeNaniteComponent.h`) at the LOD
   specified by `NaniteLODIndex` (usually 0 for highest detail).
2. Renders the landscape as a Nanite virtualized mesh on supported hardware.
3. Falls back to standard LOD rendering on non-Nanite hardware.

Caveats:
- Per-LOD material overrides (`PerLODOverrideMaterials`) do not apply to the Nanite mesh.
- A skirt (`bNaniteSkirtEnabled`, `NaniteSkirtDepth`) hides gaps at landscape edges.
- Nanite meshes are regenerated when the heightmap changes; rebuild is an editor operation.
- See [Using Nanite with Landscapes](https://dev.epicgames.com/documentation/unreal-engine/using-nanite-with-landscapes-in-unreal-engine)
  for platform support and known constraints.

## Runtime C++ queries

Direct landscape data access from gameplay code uses `ULandscapeInfo`, retrieved via
`ALandscapeProxy::GetLandscapeInfo()` or the `ULandscapeInfoMap` subsystem.

```cpp
// Querying landscape height and layer weight at a world location (editor/runtime):
if (ALandscapeProxy* Proxy = Cast<ALandscapeProxy>(LandscapeActor))
{
    ULandscapeInfo* Info = Proxy->GetLandscapeInfo();
    if (Info)
    {
        // Height query requires landscape coord conversion:
        FVector LandscapePos = Proxy->LandscapeActorToWorld().InverseTransformPosition(WorldLoc);
        // Layer weight sampling requires ULandscapeInfo::GetLayerWeightAtLocation
        // (available in editor; limited at runtime without cook-time bake).
        float Weight = Info->GetLayerWeightAtLocation(WorldLoc, LayerInfoObj);
    }
}
```

For pure runtime slope/height queries (without editor-only APIs), trace against the
landscape's collision (a `ULandscapeHeightfieldCollisionComponent`) using
`GetWorld()->LineTraceSingleByChannel`.

## Key source paths (UE 5.7)

All under `Engine/Source/Runtime/Landscape/Classes/`:
- `Landscape.h` — `ALandscape`:276
- `LandscapeProxy.h` — `ALandscapeProxy`:417; key fields at lines 458, 574, 663, 898–904
- `LandscapeComponent.h` — `ULandscapeComponent`:413
- `LandscapeLayerInfoObject.h` — `ULandscapeLayerInfoObject`:59
- `LandscapeSplineActor.h` — `ALandscapeSplineActor`:14
- `LandscapeInfo.h` — `ULandscapeInfo`
- `LandscapeGrassType.h` — `ULandscapeGrassType`
- `LandscapeNaniteComponent.h` — `ULandscapeNaniteComponent`
