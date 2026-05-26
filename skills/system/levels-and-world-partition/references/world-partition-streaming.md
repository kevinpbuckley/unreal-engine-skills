# World Partition streaming — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the streaming lifecycle, spatial-hash
grid internals, runtime overrides, server streaming, and useful debug commands. Grounded
in UE 5.7 `Engine/Source/Runtime/Engine/Public/WorldPartition/`.

## Streaming lifecycle

1. The world opens. The persistent level loads immediately. `UWorldPartition` initializes
   its actor descriptor registry from on-disk OFPA packages (editor) or a cooked manifest
   (runtime).
2. Each frame, `UWorldPartitionSubsystem::Tick` collects the current set of active
   **streaming sources** (positions + radii) from registered `IWorldPartitionStreamingSourceProvider`
   implementors (player controllers, `UWorldPartitionStreamingSourceComponent`).
3. The runtime spatial-hash grid (`UWorldPartitionRuntimeSpatialHash`) computes which cells
   intersect any source's loading range. Cells transition:
   - **Unloaded → Loaded** (invisible): package is async-loaded, actors exist but are hidden.
   - **Loaded → Activated** (visible): actors become visible and gameplay-active.
   - **Activated → Loaded → Unloaded** when no source covers the cell.
4. Each cell maps to a `UWorldPartitionRuntimeLevelStreamingCell` which backs a
   `UWorldPartitionLevelStreamingDynamic` object — a `ULevelStreaming` subclass — so the
   standard level-streaming machinery drives the actual package load.

## Spatial-hash grid configuration

Grid settings live in `UWorldPartitionRuntimeSpatialHash`
(`Runtime/Engine/Public/WorldPartition/WorldPartitionRuntimeSpatialHash.h`). Key struct:

```
FSpatialHashRuntimeGrid
  GridName          FName      unique name for the grid
  CellSize          int32      cell side length in UE units (default 25 600 = 256 m)
  LoadingRange      float      streaming source radius in UE units
  bBlockOnSlowStreaming  bool  stall thread if cells lag behind
```

Multiple grids are possible but each additional grid carries a performance cost; the
single default 2D grid is recommended unless a second level of detail is required.

**Actor placement per cell**: each actor is placed into the cell that contains its
**actor bounds center** (or its registered pivot point). Actors with
`bIsSpatiallyLoaded = false` are placed in the "always loaded" cell and are never
unloaded.

## Streaming sources in detail

A streaming source is any object that implements `IWorldPartitionStreamingSourceProvider`
and is registered with `UWorldPartitionSubsystem`. Built-in providers:

| Provider | Notes |
|---|---|
| `APlayerController` | registered by default; disable with *Enable Streaming Source* |
| `UWorldPartitionStreamingSourceComponent` | attach to any actor; enable/disable at runtime |

Shapes: by default a sphere with radius equal to the grid's Loading Range. The
`UWorldPartitionStreamingSourceComponent::Shapes` array lets you define custom
`FStreamingSourceShape` entries (sphere sectors, scaled radii per shape).

`TargetGrids` on the component restricts the source to specific grids (by `FName`).
`TargetBehavior` chooses `Include` (only affect listed grids) or `Exclude` (affect all
except listed).

`EStreamingSourcePriority` (`Highest`=0 … `Lowest`=255): when cells have multiple sources,
the highest priority wins for target state and block-on-slow decisions.

Source: `Runtime/Engine/Public/WorldPartition/WorldPartitionStreamingSource.h`:329
(`FWorldPartitionStreamingSource`), :330 (`EStreamingSourcePriority`).

## Cell target states

`EStreamingSourceTargetState` has two values:
- `Loaded` — cell is loaded but actors are hidden (useful for pre-loading a teleport
  destination before the player arrives).
- `Activated` (default) — cell is loaded and visible.

Set on the component via `TargetState` or on a per-source basis via
`FWorldPartitionStreamingSource::TargetState`.

## Server-side streaming

By default World Partition does not stream on dedicated servers (all actors are loaded).
This is configurable per-level with `EWorldPartitionServerStreamingMode`
(`WorldPartition.h`:71):
- `ProjectDefault` — uses `wp.Runtime.EnableServerStreaming` CVar.
- `Disabled` / `Enabled` / `EnabledInPIE`.

## HLOD in World Partition

HLOD actors are automatically generated per cell via the HLOD builder commandlet. At
runtime, when a cell is unloaded, its HLOD proxy actor (stored in the always-loaded set)
renders in its place. HLOD layers are defined by `UHLODLayer` assets assigned per actor or
by the HLOD layer hierarchy. See [data-layers-and-hlod.md](data-layers-and-hlod.md) for
more details.

## Cooking

World Partition maps require the `-map=` cook commandlet. At cook time, the runtime
streaming generation process bakes the grid cells into streaming level packages.
Always-loaded actors remain in the persistent level package.

## Debug console commands

| Command | Description |
|---|---|
| `wp.Runtime.ToggleDrawRuntimeHash2D` | Overlay 2D streaming grid in viewport |
| `wp.Runtime.ToggleDrawRuntimeHash3D` | Overlay 3D streaming grid |
| `wp.Runtime.OverrideRuntimeSpatialHashLoadingRange -grid=0 -range=50000` | Override loading range at runtime |
| `wp.Runtime.MaxLoadingLevelStreamingCells N` | Cap concurrent cell loads |
| `wp.Runtime.HLOD 0` | Disable HLOD proxies |
| `wp.Runtime.EnableServerStreaming 1` | Enable server streaming (overrides project default) |

## Version notes

- `ECurrentState` on `ULevelStreaming` deprecated 5.2; use `ELevelStreamingState`.
- `TargetHLODLayers` on streaming source component deprecated 5.4; use `TargetGrids`.
- `UDataLayerSubsystem` deprecated 5.3; all C++ should use `UDataLayerManager`.
- The spatial-hash grid and cell architecture are stable across UE 5.x.
