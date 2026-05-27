# Data Layers & HLOD — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers Data Layer types, runtime states, load
filters, replication, HLOD layer setup and generation. Grounded in UE 5.7
`Engine/Source/Runtime/Engine/Public/WorldPartition/DataLayer/` and the official
[World Partition - Data Layers](https://dev.epicgames.com/documentation/unreal-engine/world-partition---data-layers-in-unreal-engine)
doc.

## Data Layer types

Two orthogonal axes:

1. **Scope**: `Runtime` (affects gameplay streaming) vs. (editor-only, `Editor` type acts
   as an organizational grouping — no runtime presence).
2. **Load filter** (`EDataLayerLoadFilter` on `UDataLayerAsset`):
   - `None` (default) — included by both client and server; runtime state is replicated
     from server to clients.
   - `ClientOnly` — state managed on the client; not replicated.
   - `ServerOnly` — state managed on the server; not visible to clients.

Source: `Runtime/Engine/Public/WorldPartition/DataLayer/DataLayerAsset.h`:29 (`UDataLayerAsset`),
:17 (`EDataLayerLoadFilter`).

## Runtime states

`EDataLayerRuntimeState` (from `DataLayerInstance.h`:25):
- `Unloaded` — actors are not loaded into memory.
- `Loaded` — actors loaded but not visible (e.g. pre-load for a quest trigger).
- `Activated` — actors loaded and visible; gameplay active.

Transitions can go in either direction. Actors in a Data Layer move between states as a
group; individual actors cannot be toggled independently via Data Layers (use actor
visibility/enabled flags for that).

## Setting Data Layer state from C++

```cpp
// Correct path for UE 5.3+
UDataLayerManager* DLM = GetWorld()->GetDataLayerManager();
if (DLM && MyDataLayerAsset)
{
    const UDataLayerInstance* Inst = DLM->GetDataLayerInstanceFromAsset(MyDataLayerAsset);
    if (Inst)
    {
        // Move layer and all children to Activated
        DLM->SetDataLayerInstanceRuntimeState(Inst, EDataLayerRuntimeState::Activated,
                                              /*bIsRecursive*/ true);
    }
}
```

Alternatively, use the asset-based shorthand:

```cpp
DLM->SetDataLayerRuntimeState(MyDataLayerAsset, EDataLayerRuntimeState::Loaded);
```

Source: `Runtime/Engine/Public/WorldPartition/DataLayer/DataLayerManager.h`:83
(`SetDataLayerInstanceRuntimeState`), :95 (`SetDataLayerRuntimeState`).

## Replication rules

- **Unfiltered** (`EDataLayerLoadFilter::None`) Runtime layers: state is authoritative on
  the server and replicated to all clients. **Only call `SetDataLayerInstanceRuntimeState`
  on the server-side authority** for these layers; client calls have no effect.
- **ClientOnly** layers: call on the client only; not replicated.
- **ServerOnly** layers: call on the server only; clients do not see them.

Violating these rules produces no crash but also no change — a common silent gotcha.

## Listening for Data Layer state changes

```cpp
if (UDataLayerManager* DLM = GetWorld()->GetDataLayerManager())
{
    DLM->OnDataLayerInstanceRuntimeStateChanged.AddDynamic(
        this, &AMyActor::OnDataLayerStateChanged);
}
```

`OnDataLayerInstanceRuntimeStateChanged` is a
`DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams` broadcasting `(UDataLayerInstance*, EDataLayerRuntimeState)`.

## Querying current state

```cpp
EDataLayerRuntimeState Current = DLM->GetDataLayerInstanceRuntimeState(Inst);
// "Effective" state accounts for parent layer state (child cannot be Activated
// if parent is Unloaded):
EDataLayerRuntimeState Effective = DLM->GetDataLayerInstanceEffectiveRuntimeState(Inst);
```

## Data Layers and Level Instances

Actors inside a `ALevelInstance` inherit the Data Layer assigned to the Level Instance
Actor. Actors within the instance can also carry additional Data Layers of their own
(e.g. a building Level Instance on a *Neighborhood* layer, with holiday decorations on
a *Holiday* layer inside the same instance).

## HLOD Layers

**Hierarchical Level of Detail (HLOD)** in World Partition provides stand-in proxy actors
for distant, unloaded grid cells. Each `UHLODLayer` asset defines how source actors are
merged or instanced into a proxy:

| Builder type | Output | Best for |
|---|---|---|
| Merged mesh | Single baked static mesh | varied geometry, city blocks |
| Instanced static meshes (ISM) | ISM component set | repeated meshes, foliage |
| Simplified mesh | Lower-poly version | organic shapes, terrain detail |
| Custom | `UHLODBuilder` subclass | project-specific pipelines |

HLOD proxies live in the *always-loaded* part of the world and are swapped out by the
actual actors when the corresponding cell activates.

**Assignment**: set the `HLOD Layer` property on each actor's *World Partition* section
in Details. Level Instances propagate the HLOD layer to their interior actors.

**Build**: `Build > World Partition > Build HLODs` in the editor, or the
`-run=WorldPartitionHLODsBuilderCommandlet` commandlet for CI pipelines.

Source:
- `Runtime/Engine/Public/WorldPartition/HLOD/HLODLayer.h`
- `Runtime/Engine/Public/WorldPartition/HLOD/HLODActor.h`
- `Runtime/Engine/Public/WorldPartition/HLOD/HLODBuilder.h`

Official doc: [World Partition — HLOD](https://dev.epicgames.com/documentation/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine)

## Version notes

- Data Layers were introduced in UE 5.0 as a replacement for World Composition's
  streaming level model.
- `UDataLayerSubsystem` deprecated 5.3; all C++ code should target `UDataLayerManager`.
- The `EDataLayerLoadFilter` enum (`ClientOnly`/`ServerOnly`) was added to provide
  per-layer replication control; prefer it over rolling your own RPC-based layer
  toggling.
