# Instanced meshes (ISM / HISM) — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the ISM vs. HISM decision, bulk
instance APIs, per-instance custom data, Nanite interaction, and runtime-add patterns.
Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Components/InstancedStaticMeshComponent.h`,
`Engine/Source/Runtime/Engine/Classes/Components/HierarchicalInstancedStaticMeshComponent.h`).

## Why instanced meshes?

Each `UStaticMeshActor` or non-instanced `UStaticMeshComponent` has a dedicated
`UPrimitiveComponent` with its own scene proxy (~672 bytes GPU memory) and generates
one draw call set per material section per frame. At thousands of copies this
overwhelms CPU and GPU state management.

`UInstancedStaticMeshComponent` collapses all transforms into a single GPU buffer,
issuing one draw call per material section for the **entire** batch. The per-instance
GPU footprint drops to ~64 bytes.

## ISM vs. HISM decision guide

| Question | ISM | HISM |
|---|---|---|
| Instances move frequently? | Yes (no stale tree) | No (tree rebuild is expensive) |
| Count > ~1000 fully static? | Possible | Better (hierarchical culling) |
| Nanite enabled on the mesh? | Always (Nanite owns culling) | Fallback meshes |
| Need per-instance LOD matching static mesh? | Yes (supported since 5.3) | Yes |
| Used by Foliage tool / PCG? | No | Yes (HISM internally) |

The hierarchical BVH inside HISM accelerates CPU-side frustum culling and LOD
selection for large static instance counts. For dynamic instances (added/removed
each frame) the BVH rebuild cost negates the benefit — use plain ISM.

## Core C++ API

`UInstancedStaticMeshComponent` inherits from `UStaticMeshComponent`, so all
`SetStaticMesh` / `SetMaterial` calls apply to the entire component.

### Adding instances

```cpp
// Single instance (local space by default):
int32 Idx = ISMC->AddInstance(FTransform(Rot, Loc, Scale));  // line 261

// Batch add (preferred for large counts — avoids per-add render state rebuild):
TArray<FTransform> Transforms;
Transforms.Reserve(1000);
for (int32 i = 0; i < 1000; ++i)
    Transforms.Add(FTransform(FVector(i * 200.f, 0, 0)));

TArray<int32> Indices = ISMC->AddInstances(
    Transforms,
    /*bShouldReturnIndices=*/true,   // false if you don't need indices
    /*bWorldSpace=*/false,
    /*bUpdateNavigation=*/true);
```

`AddInstances` batches the render state update — prefer it for bulk operations.
After adding many instances at once, the component rebuilds its GPU buffer once.

### Updating and removing

```cpp
// Move instance 5 to a new transform:
ISMC->UpdateInstanceTransform(
    5,
    NewTransform,
    /*bWorldSpace=*/false,
    /*bMarkRenderStateDirty=*/true,  // true = immediate GPU upload
    /*bTeleport=*/false);

// Remove by index (swaps with last, so indices can shift):
ISMC->RemoveInstance(5);   // line 407

// Query count:
int32 N = ISMC->GetInstanceCount();   // line 425
```

Calling `UpdateInstanceTransform` with `bMarkRenderStateDirty = false` batches
updates — call `MarkRenderStateDirty()` once after bulk updates to flush.

### ID-based API (5.x)

Newer code should prefer the stable `FPrimitiveInstanceId`-based API to avoid
index-shifting problems:

```cpp
FPrimitiveInstanceId Id = ISMC->AddInstanceById(FTransform(Loc));
ISMC->UpdateInstanceTransformById(Id, NewTransform);
ISMC->RemoveInstancesById(MakeArrayView(&Id, 1));
```

`FPrimitiveInstanceId` is stable across `RemoveInstance` operations because removal
no longer swaps with the last element when using the ID API.

## Per-instance custom data

Each instance can carry a fixed number of `float` values readable in the material
graph via the `PerInstanceCustomData` material node. This allows varying color, damage
state, or any scalar per-instance without spawning separate material instances.

```cpp
// Set the custom data float count (must be done before adding instances):
ISMC->NumCustomDataFloats = 4;   // 4 floats per instance

// After adding an instance, set its custom data:
ISMC->SetCustomDataValue(
    InstanceIdx,   // instance index
    0,             // float channel index (0..NumCustomDataFloats-1)
    0.75f,         // value
    /*bMarkRenderStateDirty=*/true);
```

Combine with **Custom Primitive Data** (`SetCustomPrimitiveDataFloat`) for
component-level (shared) float data that doesn't vary per instance. Both can be read
from the same material via different nodes.

## Runtime-add pattern (procedural spawning)

When procedurally spawning instances in `BeginPlay`:

```cpp
void AMyFoliageActor::BeginPlay()
{
    Super::BeginPlay();

    // Batch-populate without per-add rebuild:
    TArray<FTransform> Batch;
    for (const FVector& Pt : SpawnPoints)
        Batch.Add(FTransform(FMath::RandRotator(), Pt));

    ISMC->AddInstances(Batch, /*bShouldReturnIndices=*/false, /*bWorldSpace=*/true);
}
```

Avoid adding instances one-by-one inside a loop without batching — each
`AddInstance` in isolation triggers a render state rebuild.

## Collision on ISM

Collision is configured at the component level, not per instance. All instances share
the same collision profile:

```cpp
ISMC->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
ISMC->SetCollisionProfileName(TEXT("BlockAll"));
```

Individual instance collision cannot be toggled. If you need instances with different
collision responses, use separate ISMC components.

## Nanite interaction

When the mesh assigned to an ISM has Nanite enabled, Nanite handles culling and LOD
internally — the HISM hierarchy is bypassed. In this case there is no performance
reason to prefer HISM over ISM. When some instances use non-Nanite fallback meshes
(e.g. unsupported platform), HISM still applies its culling tree to those.

## HISM-specific notes

`UHierarchicalInstancedStaticMeshComponent` (inherits ISM) adds:
- A BVH-accelerated cluster tree rebuilt when instances are marked dirty.
- `bDisableCollision` bulk flag for read-heavy foliage scenarios.
- `EHISMViewRelevanceType` tagging (`Grass`, `Foliage`, `HISM`) for render relevance.

The tree rebuild is triggered on the game thread during `EndOfFrameUpdates` after
instances are added/removed. Avoid frequent HISM mutations during play; prefer ISM or
use the tree-rebuild cost as a budget item.

## Version notes

- `AddInstanceWorldSpace(Transform)` is deprecated since 5.0; use
  `AddInstance(Transform, /*bWorldSpace=*/true)` instead.
- Per-instance LOD (previously HISM-only) was added to ISM in UE 5.3.
- The `FPrimitiveInstanceId` API was added in UE 5.x for stable instance references.

## See also

- [Instanced Static Mesh Component](https://dev.epicgames.com/documentation/unreal-engine/instanced-static-mesh-component-in-unreal-engine)
- [Nanite Virtualized Geometry](https://dev.epicgames.com/documentation/unreal-engine/nanite-virtualized-geometry-in-unreal-engine)
- Sibling skills: `nanite-and-rendering`, `landscape-and-foliage`, `physics-and-chaos`
