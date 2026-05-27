# Foliage & HISM — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the foliage type hierarchy, HISM cluster
tree internals, procedural foliage volumes, scalability settings, and World Partition foliage.
Grounded in UE 5.7 (`Engine/Source/Runtime/Foliage/Public/`,
`Engine/Source/Runtime/Engine/Classes/Components/`) and the official
[Foliage Mode](https://dev.epicgames.com/documentation/unreal-engine/foliage-mode-in-unreal-engine)
and [Procedural Foliage Tool](https://dev.epicgames.com/documentation/unreal-engine/procedural-foliage-tool-in-unreal-engine)
docs.

## Foliage type hierarchy

```
UObject
  └── UFoliageType (abstract)                           FoliageType.h:105
        ├── UFoliageType_InstancedStaticMesh             FoliageType_InstancedStaticMesh.h:13
        └── UFoliageType_Actor                           FoliageType_Actor.h
```

`UFoliageType` is the data asset that describes one category of foliage — its placement
rules, density, scale, collision, culling, and which surface types it paints onto. It does
not hold geometry directly; geometry comes from the concrete subclass.

`UFoliageType_InstancedStaticMesh` (`FoliageType_InstancedStaticMesh.h`:13) adds:
- `Mesh` (`TObjectPtr<UStaticMesh>`) — the geometry to instance.
- `OverrideMaterials` / `NaniteOverrideMaterials` — per-foliage material overrides.
- `ComponentClass` (`TSubclassOf<UFoliageInstancedStaticMeshComponent>`) — override the HISM
  subclass for custom per-component logic.

`UFoliageType_Actor` spawns full actor instances — one actor per foliage instance. Use only
when each instance needs independent Blueprint logic or collision-shape customization;
avoid at high density (no HISM batching).

## `AInstancedFoliageActor` and `FFoliageInfo`

```
AInstancedFoliageActor : AISMPartitionActor         InstancedFoliageActor.h:28
  └── TMap<UFoliageType*, TUniqueObj<FFoliageInfo>>  FoliageInfos
```

One `AInstancedFoliageActor` exists per World Partition cell (256 m grid by default). It
manages all ISM/HISM component instances for every `UFoliageType` painted in that cell.
`FFoliageInfo` stores instance transforms, component pointer, and paint history metadata.

Iterating foliage from C++:

```cpp
// Enumerate all foliage types and their instance counts on an actor:
AInstancedFoliageActor* IFA = ...; // obtained from world or subsystem
IFA->ForEachFoliageInfo([](UFoliageType* FoliageType, FFoliageInfo& Info) -> bool
{
    UE_LOG(LogTemp, Log, TEXT("Type %s: %d instances"),
        *FoliageType->GetDisplayFName().ToString(),
        Info.GetInstanceCount());
    return true; // continue iteration
});
```

## HISM cluster tree

`UHierarchicalInstancedStaticMeshComponent` (`HierarchicalInstancedStaticMeshComponent.h`:135)
builds a bounding-volume hierarchy (BVH) over its instances as an array of `FClusterNode`
entries (`ClusterTreePtr`). Each node covers a spatial range of instances; during rendering
the GPU tests each cluster's bounding box against the frustum/occlusion and draws only
visible clusters, reducing CPU overhead to near-zero for off-screen foliage.

**Rebuild lifecycle:**
1. Any `AddInstance` / `RemoveInstance` / `UpdateInstanceTransform` invalidates the tree
   (increments an internal dirty counter).
2. On the next tick, the engine schedules an async rebuild (`BuildTreeAndBufferAsync`).
3. Until the rebuild completes, rendering falls back to sequential instance culling.
4. Call `BuildTreeIfOutdated(/*Async=*/false, /*Force=*/true)` to force a synchronous
   rebuild immediately after bulk edits.

**Translated instance space** (`bUseTranslatedInstanceSpace`): foliage actors far from the
world origin can overflow single-float precision. HISM offsets its cluster space by
`TranslatedInstanceSpaceOrigin` to preserve precision for distant instances.

**Density scaling:** `foliage.DensityScale` (a CVar) globally scales the number of rendered
instances for scalability presets. Enable per-foliage-type via `bEnableDensityScaling` in
the foliage type's Scalability section.

### Adding instances at runtime (C++ pattern)

```cpp
// Runtime HISM instance management — illustrative pattern:
void AEnvironmentPopulator::PopulateMeshes(UStaticMesh* InMesh, const TArray<FVector>& Sites)
{
    // Create and register a HISM at runtime:
    UHierarchicalInstancedStaticMeshComponent* HISM =
        NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
    HISM->SetStaticMesh(InMesh);
    HISM->SetupAttachment(GetRootComponent());
    HISM->RegisterComponent();

    // Build transforms with random yaw and scale jitter:
    TArray<FTransform> Transforms;
    Transforms.Reserve(Sites.Num());
    for (const FVector& Site : Sites)
    {
        float Yaw = FMath::RandRange(0.f, 360.f);
        float Scale = FMath::RandRange(0.75f, 1.25f);
        Transforms.Add(FTransform(FRotator(0, Yaw, 0), Site, FVector(Scale)));
    }

    // Batch-add all instances in one call to minimize tree invalidation:
    HISM->AddInstances(Transforms, /*bShouldReturnIndices=*/false, /*bWorldSpace=*/true);
}
```

## Procedural foliage volumes

**Components involved:**

| Class | Header | Role |
|---|---|---|
| `UProceduralFoliageComponent` | `ProceduralFoliageComponent.h`:42 | Drives simulation; references a spawner |
| `UProceduralFoliageSpawner` | `ProceduralFoliageSpawner.h` | Asset; holds foliage type entries with competition rules |
| `UProceduralFoliageVolume` | `ProceduralFoliageVolume.h` | Volume actor that holds the component |

**Simulation model:** the spawner tiles the volume and runs a competitive placement
simulation — seeds spread radially until competition prevents further growth. Each
`UFoliageType` entry in the spawner specifies density, spread radius, priority, and age
range. The result is baked into `AInstancedFoliageActor` instances.

Procedural foliage is an **editor-time** operation. Baked results persist to disk and are
not re-simulated at runtime (unlike PCG, which can generate at runtime). Use PCG if you
need runtime regeneration.

## Culling and LOD

Foliage instances are culled per-cluster, not per-instance. The cull distance flow:

1. `CullDistance` start/end on `UFoliageType` sets the range (in UU) at which instances
   begin fading and are removed from rendering.
2. In the foliage mesh material, connect the `PerInstanceFadeAmount` material expression to
   the opacity or dithered LOD mask to smoothly fade leaves at distance before hard culling.
3. Nanite-enabled foliage meshes ignore cull distances — Nanite manages LOD internally.

LOD transition: all instances in one cluster share the same LOD level simultaneously (the
cluster is culled or rendered as a unit). Individual per-instance LOD fading is not
supported for HISM foliage clusters.

## World Partition foliage

In World Partition maps, `AInstancedFoliageActor` actors are partitioned into a grid whose
cell size defaults to 256 m (25600 cm). The cell size is separate from the World Partition
HLOD grid. To resize existing maps, use the `WorldPartitionFoliageBuilder` commandlet:

```
UnrealEditor.exe MyProject MyMap -run=WorldPartitionBuilderCommandlet
    -Builder=WorldPartitionFoliageBuilder -NewGridSize=51200
```

Foliage instances that straddle a cell boundary are assigned to one cell; they are not
split. Keep dense foliage painting within cell bounds to avoid unexpected unloading.

## Key source paths (UE 5.7)

All under `Engine/Source/Runtime/Foliage/Public/` unless noted:
- `FoliageType.h`:105 — `UFoliageType`; placement properties (Density, Radius, ScaleX/Y/Z,
  AlignToNormal, GroundSlopeAngle, LandscapeLayers, CullDistance).
- `FoliageType_InstancedStaticMesh.h`:13 — `UFoliageType_InstancedStaticMesh` (Mesh,
  OverrideMaterials, NaniteOverrideMaterials, ComponentClass).
- `InstancedFoliageActor.h`:28 — `AInstancedFoliageActor`, `ForEachFoliageInfo`.
- `ProceduralFoliageComponent.h`:42 — `UProceduralFoliageComponent`.
- `Engine/Classes/Components/HierarchicalInstancedStaticMeshComponent.h`:135 —
  `UHierarchicalInstancedStaticMeshComponent`; `AddInstance`:305, `AddInstances`:306,
  `RemoveInstance`:307, `UpdateInstanceTransform`:310, `BuildTreeIfOutdated`:332.
