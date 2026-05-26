---
name: landscape-and-foliage
description: Terrain, instanced vegetation, and procedural environment generation in Unreal C++
  — ALandscape / ALandscapeProxy / ULandscapeComponent (heightmap grid, material layers,
  edit layers, splines, Nanite landscape), UFoliageType / AInstancedFoliageActor /
  UHierarchicalInstancedStaticMeshComponent (HISM-backed instanced foliage, procedural
  foliage volumes), and the PCG framework (UPCGComponent / UPCGGraph, point data,
  landscape sampling, runtime generation). Use when creating or sculpting terrain,
  painting weight layers or foliage, adding landscape splines, batching vegetation with
  HISM, authoring PCG graphs, querying landscape data from C++, or debugging instancing
  and PCG generation issues.
metadata:
  engine-version: "5.7"
  category: world-building
---

# Landscape & foliage

Three complementary systems cover terrain and environment population:

| System | Actor / Component | Purpose |
|---|---|---|
| Landscape | `ALandscape` → `ULandscapeComponent` | Heightmap terrain with painted weight layers and splines |
| Foliage / HISM | `AInstancedFoliageActor` → HISM | Hand-painted instanced vegetation at low draw-call cost |
| PCG | `UPCGComponent` + `UPCGGraph` | Rule-based graph pipeline for procedural placement |

## When to use this skill

- Creating, sculpting, or importing a heightmap landscape; tuning component/section sizes.
- Authoring landscape materials with `Layer Blend` nodes and `ULandscapeLayerInfoObject`s.
- Painting foliage (`UFoliageType_InstancedStaticMesh`) onto terrain or meshes; tuning
  density, culling, collision, and scalability.
- Adding landscape splines (`ALandscapeSplineActor`) for roads/rivers/paths.
- Enabling Nanite on a landscape (`bEnableNanite`).
- Authoring or extending a PCG graph from C++ — subclassing `UPCGSettings`, querying
  `UPCGData`, calling `Generate()`/`Cleanup()` from code.
- Debugging foliage not rendering, PCG not generating, landscape layer info missing.

## Landscape

### Class hierarchy

`ALandscape` extends `ALandscapeProxy` (which itself extends `APartitionActor`). The proxy
holds the component grid, material, and dimension metadata. `ALandscape` is the authoritative
root; large landscapes in World Partition spawn `ALandscapeStreamingProxy` instances to load
per-region.

```
ALandscape : ALandscapeProxy : APartitionActor
                  └── TArray<ULandscapeComponent*> LandscapeComponents  (LandscapeProxy.h:663)
                  └── UMaterialInterface* LandscapeMaterial             (LandscapeProxy.h:574)
                  └── int32 ComponentSizeQuads                          (LandscapeProxy.h:898)
                  └── int32 SubsectionSizeQuads                         (LandscapeProxy.h:901)
                  └── int32 NumSubsections                              (LandscapeProxy.h:904)
                  └── bool  bEnableNanite                               (LandscapeProxy.h:458)
```

`ULandscapeComponent` (`LandscapeComponent.h`:413) extends `UPrimitiveComponent` — it is
the renderable, collidable unit of terrain.

### Heightmap dimensions

Landscape dimensions are not arbitrary. Each component contains `NumSubsections × NumSubsections`
sections, each `SubsectionSizeQuads` quads wide. Total landscape quads in one axis is
`NumComponents × ComponentSizeQuads`. The corresponding heightmap vertex count is
`(NumComponents × ComponentSizeQuads) + 1`. Common valid size: 8129 × 8129 vertices
(32 × 32 components, 4 sections/component, 63 quads/section). Heights are stored as 16-bit
values mapping to ±256 m at default Z scale 100.

### Material layers and `ULandscapeLayerInfoObject`

Each paintable weight layer requires a `ULandscapeLayerInfoObject` data asset
(`LandscapeLayerInfoObject.h`:59) paired with a `LandscapeLayerBlend` node in the landscape
material. Layer weights are stored per-component in weightmap textures.

```cpp
// Reading landscape layer weight at runtime (C++ — editor or runtime with proper setup):
// ULandscapeInfo::GetLayerWeightAtLocation is the key query path.
// ULandscapeLayerInfoObject holds PhysicalMaterial and layer blend settings.
```

**Edit Layers** (`LandscapeEditLayer.h`) allow non-destructive stacking of sculpt/paint
operations — each edit layer renders additively/subtractively into the final heightmap.

### Landscape splines

`ALandscapeSplineActor` (`LandscapeSplineActor.h`:14) owns a `ULandscapeSplinesComponent`
containing control points and segments. Splines deform terrain beneath them (raise/lower)
and optionally spawn static meshes along their length as decoration or road surfaces.

### Nanite landscape

Set `bEnableNanite = true` on the `ALandscapeProxy` to render the landscape as a Nanite
mesh on supported platforms. The engine generates and maintains a `ULandscapeNaniteComponent`
alongside the traditional LOD components. LOD settings under `NaniteLODIndex` control the
source LOD used for Nanite mesh generation (default 0). See `nanite-and-rendering`.

## Foliage (instanced placement)

### Class hierarchy

```
UFoliageType (abstract, UObject)              — FoliageType.h:105
  └── UFoliageType_InstancedStaticMesh        — FoliageType_InstancedStaticMesh.h:13
  └── UFoliageType_Actor                      — FoliageType_Actor.h
AInstancedFoliageActor : AISMPartitionActor   — InstancedFoliageActor.h:28
UHierarchicalInstancedStaticMeshComponent     — HierarchicalInstancedStaticMeshComponent.h:135
  (extends UInstancedStaticMeshComponent)
```

`AInstancedFoliageActor` stores a `TMap<UFoliageType*, FFoliageInfo>` and manages the
underlying HISM instances. One `AInstancedFoliageActor` per world-partition cell holds all
foliage painted in that cell.

### UFoliageType key properties (FoliageType.h)

| Property | Purpose |
|---|---|
| `Density` | Instances per 1000 × 1000 UU area |
| `Radius` | Minimum spacing between instances |
| `Scaling` / `ScaleX/Y/Z` | Random scale ranges per axis |
| `AlignToNormal` | Tilt instance to match surface normal |
| `GroundSlopeAngle` | Valid placement slope range |
| `LandscapeLayers` | Restrict painting to named weight layers |
| `CullDistance` | Per-instance screen-size cull |

### HISM internals

`UHierarchicalInstancedStaticMeshComponent` builds a BVH cluster tree over its instances
(`ClusterTreePtr`, `FClusterNode`). Rendering culls entire clusters with a single check.
Adding/removing instances invalidates the tree; `BuildTreeIfOutdated(bool Async, bool Force)`
triggers a rebuild (synchronous or async).

Key API (HierarchicalInstancedStaticMeshComponent.h):
- `AddInstance(Transform, bWorldSpace)`:305 — add one instance; returns index.
- `AddInstances(Transforms, bReturnIndices, bWorldSpace)`:306 — batch add.
- `RemoveInstance(Index)`:307 / `RemoveInstances(Indices)`:308 — remove by index.
- `UpdateInstanceTransform(Index, NewTransform, bWorldSpace, bMarkDirty, bTeleport)`:310.
- `BuildTreeIfOutdated(Async, ForceUpdate)`:332 — explicit rebuild trigger.

```cpp
// Batch-adding foliage instances from C++ (illustrative):
UHierarchicalInstancedStaticMeshComponent* HISM = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
HISM->SetStaticMesh(TreeMesh);
HISM->RegisterComponent();

TArray<FTransform> Transforms;
for (const FVector& Pos : SpawnPositions)
{
    FTransform T(FRotator(0, FMath::RandRange(0.f, 360.f), 0),
                 Pos,
                 FVector(FMath::RandRange(0.8f, 1.2f)));
    Transforms.Add(T);
}
HISM->AddInstances(Transforms, /*bShouldReturnIndices=*/false, /*bWorldSpace=*/true);
// Tree rebuilds async after the next tick; forcing sync:
HISM->BuildTreeIfOutdated(/*Async=*/false, /*ForceUpdate=*/true);
```

### Procedural foliage volumes

`UProceduralFoliageComponent` (`ProceduralFoliageComponent.h`:42) is placed on a volume
actor and references a `UProceduralFoliageSpawner`. The spawner holds an array of
`UFoliageType` entries with competition rules (spread radius, priority). Simulation runs
at cook/editor time and bakes instances into `AInstancedFoliageActor`s.

## PCG (Procedural Content Generation)

PCG is a shipped plugin at `Engine/Plugins/PCG/`. Enable it in `.uproject` if not present.

### Core types

| Type | Header | Role |
|---|---|---|
| `UPCGComponent` | `PCGComponent.h`:150 | Runs a graph on its actor; entry point for generate/cleanup |
| `UPCGGraph` | `PCGGraph.h`:266 | Asset containing nodes and edges |
| `UPCGGraphInterface` | `PCGGraph.h`:107 | Abstract base for graphs and graph instances |
| `UPCGData` | `PCGData.h` | Base for all spatial/attribute data flowing through the graph |
| `UPCGPointData` | `Data/PCGPointData.h` | Point cloud — the primary per-instance data type |
| `UPCGLandscapeData` | `Data/PCGLandscapeData.h` | Samples landscape height/normals/layers |

### `UPCGComponent` lifecycle

```
Generate()      — schedules an async graph execution, result baked as managed resources
Cleanup()       — removes all managed resources (ISM components, spawned actors)
GenerateLocal() — local-only generate (not replicated); use in editor automation
CleanupLocal()  — local-only cleanup
NotifyPropertiesChangedFromBlueprint() — dirty + re-generate from Blueprint
```

`GenerationTrigger` (`EPCGComponentGenerationTrigger`: `GenerateOnLoad`, `GenerateOnDemand`,
`GenerateAtRuntime`) controls when the graph runs automatically. Set `bIsComponentPartitioned`
to distribute generation across World Partition cells via `UPCGSubsystem`.

### Working with PCG from C++

To extend PCG, subclass `UPCGSettings` (defines node inputs/outputs/properties) and pair it
with a `UPCGElement` subclass (`Execute(FPCGContext*)`). For runtime queries:

```cpp
// Triggering PCG generation from gameplay code:
UPROPERTY(VisibleAnywhere)
TObjectPtr<UPCGComponent> PCGComp;

void AMyActor::BeginPlay()
{
    Super::BeginPlay();
    if (PCGComp)
    {
        // Force a fresh generation regardless of trigger type:
        PCGComp->Generate(/*bForce=*/true);
    }
}

// Listening to generation completion:
PCGComp->OnGraphGeneratedExternal.AddDynamic(this, &AMyActor::OnPCGDone);
```

PCG landscape data (`UPCGLandscapeData`) exposes layer weights as point attributes when
`bGetLayerWeights = true` (`PCGLandscapeData.h`). Filter points by attribute value in the
graph to, for example, restrict scatter to slope ranges below a threshold.

## Performance

- **Draw calls:** foliage HISM merges thousands of instances into one draw call per cluster.
  Actor foliage (`UFoliageType_Actor`) costs one draw call per instance — avoid at scale.
- **Cull distance:** set `CullDistance` (start + end) on each `UFoliageType`; far instances
  fade with `PerInstanceFadeAmount` in the material.
- **HISM tree rebuild:** batching `AddInstances` is far cheaper than repeated `AddInstance`;
  prefer a single batch call then one `BuildTreeIfOutdated`.
- **Nanite foliage/rocks:** Nanite eliminates LOD transitions on dense geometry; enable it on
  high-poly rocks and detailed meshes (see `nanite-and-rendering`).
- **PCG generate cost:** graph execution is async but can still spike on large volumes;
  trigger on load / pre-bake where possible; prefer `GenerateOnLoad` over `GenerateAtRuntime`
  for static content.
- **Landscape component count:** aim for ≤ 1024 components; each has a render-thread CPU
  cost. Prefer fewer, larger components over many small ones.
- **World Partition streaming:** landscape proxies stream by region; foliage uses a separate
  256 m grid (configurable in Project Settings → Instanced Foliage Grid Size).

## Gotchas

- **Invalid heightmap dimensions** — landscape widths/heights must follow
  `(N × ComponentQuads) + 1`; arbitrary resolutions will be rejected or silently resized.
  Use the recommended size table (Landscape Technical Guide).
- **Missing layer info objects** — painting a weight layer requires a `ULandscapeLayerInfoObject`
  asset assigned to the layer in the landscape material; without it the layer appears in the
  UI but cannot be painted.
- **Actor foliage at density** — `UFoliageType_Actor` instances spawn one actor per instance,
  not an HISM; high density is a performance cliff. Use `UFoliageType_InstancedStaticMesh`
  unless you need per-instance Blueprint logic.
- **HISM tree stale after edit** — `AddInstance` marks the tree dirty; until the async
  rebuild completes, the BVH is inconsistent; call `BuildTreeIfOutdated(false, true)` after
  bulk edits if you need it immediately.
- **Collision on all foliage** — enabling complex collision on dense grass/foliage is
  extremely expensive; disable collision or use simple sphere/capsule only for interactive
  foliage.
- **PCG generate at runtime carelessly** — calling `Generate()` mid-frame on a large volume
  can hitch; use the async path (`GenerateLocal`) and observe the delegate for completion.
- **Foliage in World Partition** — foliage instances live in `AInstancedFoliageActor`s that
  load per cell; painting across cell boundaries splits instances. Keep foliage within cells
  or use PCG for cross-cell content.
- **Nanite landscape + LOD materials** — per-LOD material overrides (`PerLODOverrideMaterials`
  on `ALandscapeProxy`) do not apply to the Nanite mesh; use a single material that works
  at all distances.

## Version notes

- `UFoliageType_InstancedStaticMesh.NaniteOverrideMaterials` was added in UE5 for Nanite
  foliage support.
- `CleanupLocal(bool bRemoveComponents, bool bSave)` was deprecated in 5.6; use the
  `bRemoveComponents`-only overload (`PCGComponent.h`:266).
- `UPCGComponent.GenerationTrigger = GenerateAtRuntime` enables the runtime generation
  scheduler (new in 5.3+; scheduler policy expanded in 5.6/5.7).
- Landscape Edit Layers are stable since UE5; the underlying renderer classes
  (`ULandscapeEditLayerBase`) are Engine/Editor-only and should not be referenced from
  runtime game code.

## References & source material

Engine source (UE 5.7):
- `Runtime/Landscape/Classes/Landscape.h` — `ALandscape`:276 (extends `ALandscapeProxy`).
- `Runtime/Landscape/Classes/LandscapeProxy.h` — `ALandscapeProxy`:417,
  `LandscapeComponents`:663, `LandscapeMaterial`:574, `ComponentSizeQuads`:898,
  `SubsectionSizeQuads`:901, `NumSubsections`:904, `bEnableNanite`:458.
- `Runtime/Landscape/Classes/LandscapeComponent.h` — `ULandscapeComponent`:413.
- `Runtime/Landscape/Classes/LandscapeLayerInfoObject.h` — `ULandscapeLayerInfoObject`:59.
- `Runtime/Landscape/Classes/LandscapeSplineActor.h` — `ALandscapeSplineActor`:14.
- `Runtime/Foliage/Public/FoliageType.h` — `UFoliageType`:105.
- `Runtime/Foliage/Public/FoliageType_InstancedStaticMesh.h` — `UFoliageType_InstancedStaticMesh`:13.
- `Runtime/Foliage/Public/InstancedFoliageActor.h` — `AInstancedFoliageActor`:28.
- `Runtime/Foliage/Public/ProceduralFoliageComponent.h` — `UProceduralFoliageComponent`:42.
- `Runtime/Engine/Classes/Components/HierarchicalInstancedStaticMeshComponent.h` —
  `UHierarchicalInstancedStaticMeshComponent`:135, `AddInstance`:305, `AddInstances`:306,
  `RemoveInstance`:307, `UpdateInstanceTransform`:310, `BuildTreeIfOutdated`:332.
- `Plugins/PCG/Source/PCG/Public/PCGComponent.h` — `UPCGComponent`:150,
  `Generate()`:246, `Cleanup()`:247, `GenerateLocal()`:251, `GenerationTrigger`:349.
- `Plugins/PCG/Source/PCG/Public/PCGGraph.h` — `UPCGGraph`:266, `UPCGGraphInterface`:107.
- `Plugins/PCG/Source/PCG/Public/Data/PCGLandscapeData.h` — `UPCGLandscapeData`,
  `FPCGLandscapeDataProps` (layer weights, height-only mode, GPU sampling).
- `Plugins/PCG/Source/PCG/Public/Data/PCGPointData.h` — `UPCGPointData`.

Official docs (UE 5.7):
- Landscape Outdoor Terrain — <https://dev.epicgames.com/documentation/unreal-engine/landscape-outdoor-terrain-in-unreal-engine>
- Landscape Technical Guide — <https://dev.epicgames.com/documentation/unreal-engine/landscape-technical-guide-in-unreal-engine>
- Landscape Materials — <https://dev.epicgames.com/documentation/unreal-engine/landscape-materials-in-unreal-engine>
- Landscape Edit Layers — <https://dev.epicgames.com/documentation/unreal-engine/landscape-edit-layers-in-unreal-engine>
- Using Nanite with Landscapes — <https://dev.epicgames.com/documentation/unreal-engine/using-nanite-with-landscapes-in-unreal-engine>
- Open World Tools (Foliage) — <https://dev.epicgames.com/documentation/unreal-engine/open-world-tools-in-unreal-engine>
- Foliage Mode — <https://dev.epicgames.com/documentation/unreal-engine/foliage-mode-in-unreal-engine>
- Procedural Foliage Tool — <https://dev.epicgames.com/documentation/unreal-engine/procedural-foliage-tool-in-unreal-engine>
- PCG Framework — <https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-framework-in-unreal-engine>
- PCG Overview — <https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-overview>

Deep-dive references in this skill:
- [references/landscape.md](references/landscape.md) — component/section math, material layer
  setup, edit layers, splines, Nanite landscape, runtime queries.
- [references/foliage-and-hism.md](references/foliage-and-hism.md) — HISM internals, foliage
  type hierarchy, procedural foliage volumes, scalability, World Partition foliage.
- [references/pcg.md](references/pcg.md) — PCG graph authoring, element/settings subclassing,
  landscape data queries, runtime generation, partitioned generation.

Related skills: `meshes-static-and-skeletal`, `levels-and-world-partition`, `nanite-and-rendering`.
