---
name: levels-and-world-partition
description: Structure and stream Unreal worlds in C++ — UWorld (persistent level +
  streaming levels), ULevel, ULevelStreaming; World Partition (UWorldPartition, runtime
  spatial-hash grid, UWorldPartitionRuntimeCell, streaming sources/UWorldPartitionStreamingSourceComponent);
  Data Layers (UDataLayerAsset, UDataLayerInstance, UDataLayerManager, EDataLayerRuntimeState);
  Level Instances (ALevelInstance, APackedLevelActor); One File Per Actor (OFPA); legacy
  sublevel streaming (UGameplayStatics::LoadStreamLevel / UnloadStreamLevel, Level Streaming
  Volumes). Use when organizing a level, building open-world or large-level streaming,
  toggling content sets (day/night, quest states) at runtime, creating reusable instanced
  level chunks, or choosing between World Partition and explicit sublevels.
metadata:
  engine-version: "5.7"
  category: world-building
---

# Levels & World Partition

A `UWorld` is the running game world. It always has one **persistent level** (`UWorld::PersistentLevel`)
and any number of streamed levels. For large worlds, World Partition — the default for new
projects in UE5 — replaces hand-managed sublevels with automatic spatial streaming around
**streaming sources**.

## When to use this skill

- Organizing world content across levels and keeping memory under control.
- Building an open world or large level that cannot be fully resident.
- Toggling sets of actors at runtime (day/night, story states, destruction phases).
- Making reusable, instanced level chunks (buildings, modular areas).
- Working with legacy explicit sublevels in a project that predates World Partition.

## Core mental model

```
UWorld
├── PersistentLevel (ULevel)          ← always loaded; world settings, managers
├── UWorldPartition                   ← present if WP is enabled
│   ├── runtime grid (spatial hash)   ← cells loaded/unloaded by streaming sources
│   ├── UDataLayerManager             ← controls Data Layer states
│   └── actor descriptor registry     ← OFPA: each actor = its own .uasset file
└── StreamingLevels [ ]               ← present when using legacy sublevels
    └── ULevelStreaming → ULevel       ← one per streamed sublevel
```

`UWorld` is accessible via `AActor::GetWorld()` anywhere in gameplay code.
`UWorld::GetWorldPartition()` returns the `UWorldPartition` object (null for non-WP worlds).
`UWorld::GetDataLayerManager()` returns the `UDataLayerManager` (World Partition only).

## Two streaming models

| Model | Best for | Mechanism |
|---|---|---|
| **World Partition** (modern) | open worlds, large levels | engine auto-streams grid cells around streaming sources |
| **Sublevels** (legacy/explicit) | small games, hand-authored zones | you load/unload named levels in code, Blueprint, or via Streaming Volumes |

World Composition (pre-UE5) is superseded by World Partition. Do not start new projects with it.

## World Partition

World Partition stores the entire world in a single persistent level. At runtime a
**spatial-hash grid** subdivides the world into cells. Cells load and unload automatically
as **streaming sources** (player controllers by default) move through the world.

### Runtime grid settings
Configured in World Settings → World Partition Setup. Key fields per grid:
- **Cell Size** — spatial footprint of one streaming cell (e.g. 25 600 cm = 256 m default).
- **Loading Range** — radius around a streaming source inside which cells are loaded.
- **Block on Slow Streaming** — stalls the game thread if cells are loading too slowly.

### Streaming sources

`APlayerController` is a streaming source by default (opt out via *Enable Streaming Source*
in its Details). For other viewpoints — cinematic cameras, portal previews, teleport
destinations — add `UWorldPartitionStreamingSourceComponent` to any actor:

```cpp
// Acquiring the component (it is added in the editor or at construction)
UWorldPartitionStreamingSourceComponent* Src =
    GetComponentByClass<UWorldPartitionStreamingSourceComponent>();

// Enable/disable at runtime
Src->EnableStreamingSource();
Src->DisableStreamingSource();

// Poll completion (e.g. before teleporting a player)
if (Src->IsStreamingCompleted())
{
    // cells are ready
}
```

Source: `Runtime/Engine/Classes/Components/WorldPartitionStreamingSourceComponent.h`:
`EnableStreamingSource`:28, `DisableStreamingSource`:32, `IsStreamingCompleted`:44.

### Checking WP state in C++

```cpp
if (UWorldPartition* WP = GetWorld()->GetWorldPartition())
{
    // World is a partitioned world
}
UDataLayerManager* DLM = GetWorld()->GetDataLayerManager(); // null for non-WP worlds
```

Source: `Runtime/Engine/Classes/Engine/World.h`:2850 (`GetWorldPartition`), :2858 (`GetDataLayerManager`).

## Data Layers

Data Layers group actors so entire sets can be enabled/disabled as a unit.

| Type | Purpose | Modifiable at runtime? |
|---|---|---|
| **Runtime** | gameplay toggling (day/night, destruction, quest states) | yes |
| **Editor** | organization in the editor | no |

Define a Data Layer as a `UDataLayerAsset` (a `UDataAsset` subclass). Each world creates
`UDataLayerInstance` objects owned by `UDataLayerManager`. Three runtime states:
`Unloaded` → `Loaded` → `Activated`.

**Changing Data Layer state from C++ (5.3+):**

```cpp
// Preferred: UDataLayerManager (replaces deprecated UDataLayerSubsystem)
UDataLayerManager* DLM = GetWorld()->GetDataLayerManager();
if (DLM)
{
    const UDataLayerInstance* Instance = DLM->GetDataLayerInstanceFromAsset(MyDataLayerAsset);
    DLM->SetDataLayerInstanceRuntimeState(Instance, EDataLayerRuntimeState::Activated);
}
```

`EDataLayerRuntimeState` values: `Unloaded`, `Loaded`, `Activated`
(`Runtime/Engine/Public/WorldPartition/DataLayer/DataLayerInstance.h`:25).

`UDataLayerSubsystem` exists for Blueprint compatibility but is deprecated since 5.3.
Prefer `UDataLayerManager` in new C++ code.

See [references/data-layers-and-hlod.md](references/data-layers-and-hlod.md) for HLOD
interaction, load-filter flags, replication rules, and extended examples.

## Level Instances & Packed Level Actors

**Level Instances** (`ALevelInstance`) embed a `.umap` as a reusable prefab. One edit
propagates to every instance in the world. At runtime, levels using OFPA are *embedded*
into the World Partition grid (default); levels without OFPA use *level-streaming mode*
at a higher runtime cost.

**Packed Level Actors** (`APackedLevelActor`, a subclass of `ALevelInstance`) bake all
Static Meshes from a Level Instance into a single ISM-backed actor — ideal for static
buildings or dense visual assemblies where instancing is valuable.

Both types participate in World Partition Data Layers: actors inside the Level Instance
inherit the Data Layer assigned to the Level Instance Actor.

Source:
- `Runtime/Engine/Public/LevelInstance/LevelInstanceActor.h`:18 — `ALevelInstance`
- `Runtime/Engine/Public/PackedLevelActor/PackedLevelActor.h`:25 — `APackedLevelActor`

See [references/level-instances.md](references/level-instances.md) for runtime-behavior
differences, in-context editing workflow, and property overrides.

## One File Per Actor (OFPA)

With World Partition enabled, every actor is serialized to its own file under
`__ExternalActors__/` alongside the level package. Consequences:

- Multiple developers can edit different actors without locking the level file.
- Source control changelists contain many small files with encoded names; use the
  in-editor **View Changelist** window for human-readable names.
- At cook time, all external actor files are embedded back into the level package.
- Non-OFPA actors inside a Level Instance fall back to Level Streaming mode at runtime.

OFPA is enabled automatically with World Partition; set `bUseExternalActors = true`
(`Runtime/Engine/Classes/Engine/Level.h`:445) to enable it on a non-partitioned level.

## Legacy sublevel streaming

For projects without World Partition, use `UGameplayStatics` to load/unload sublevels:

```cpp
#include "Kismet/GameplayStatics.h"

// Load async; bMakeVisible=true shows it immediately, bShouldBlockOnLoad=false = async
UGameplayStatics::LoadStreamLevel(this, TEXT("Zone_Forest"),
    /*bMakeVisible*/ true, /*bShouldBlockOnLoad*/ false, FLatentActionInfo());

// Unload async
UGameplayStatics::UnloadStreamLevel(this, TEXT("Zone_Forest"),
    FLatentActionInfo(), /*bShouldBlockOnUnload*/ false);
```

Source: `Runtime/Engine/Classes/Kismet/GameplayStatics.h`:306 (`LoadStreamLevel`), :314 (`UnloadStreamLevel`).

**Level Streaming Volumes** (`ALevelStreamingVolume`) trigger load/unload automatically
when the player enters/exits; wired via the Levels window. Best for smaller games with
discrete zones.

`ULevelStreaming` (`Runtime/Engine/Classes/Engine/LevelStreaming.h`:138) is the underlying
object that tracks each sublevel's load state; `UWorld::StreamingLevels` holds the array.

See [references/world-partition-streaming.md](references/world-partition-streaming.md) for
the full WP streaming lifecycle, console commands for debugging, and notes on server-side
streaming.

## Decision guide

| Scenario | Recommended approach |
|---|---|
| Small/linear game, explicit zones | Persistent level + legacy streaming sublevels |
| Open world or very large level | World Partition (default cell grid) |
| Variant world states | Runtime Data Layers |
| Reusable repeating structures | Level Instances / Packed Level Actors |
| Level Instance inside an open world | ALevelInstance with OFPA → Embedded Mode |

## Gotchas

- **Everything in one level** — memory blowout; add World Partition or explicit sublevels.
- **Hard pointer to an actor in another WP cell** — the pointer becomes stale when the
  cell unloads; use `TSoftObjectPtr` and re-acquire via `async-loading` / `asset-management`.
- **Blocking loads** (`bShouldBlockOnLoad = true`) on the game thread cause hitches; stream
  async and gate on the latent callback or `IsStreamingCompleted`.
- **OFPA + source control** — thousands of tiny files; configure VCS ignore rules for
  generated directories and never commit from outside the editor.
- **World Composition for new projects** — deprecated path; use World Partition instead.
- **`UDataLayerSubsystem` in 5.3+** — fully deprecated; all paths must use
  `UDataLayerManager` from `UWorld::GetDataLayerManager()`.
- **Level Blueprint actors in WP** — any actor referenced from a Level Blueprint is
  treated as Always Loaded, which defeats streaming; prefer Blueprint Classes.
- **Data Layer state replication** — states for unfiltered (server+client) Data Layers
  must be set on the server; Client-Only layers must be set on the client. Setting on the
  wrong side has no effect (see `UDataLayerManager::SetDataLayerInstanceRuntimeState`).

## Version notes

- World Partition and OFPA are the default for all Games-category project templates in
  UE 5.0+. Streaming *can* be disabled (World Settings → Enable Streaming) while keeping
  the WP architecture (useful for small games that still want OFPA).
- `UDataLayerSubsystem` deprecated 5.3; `UDataLayerManager` is the API for 5.3+.
- `TargetHLODLayers` on `UWorldPartitionStreamingSourceComponent` deprecated 5.4; use
  `TargetGrids` instead.
- `ECurrentState` on `ULevelStreaming` deprecated 5.2; use `ELevelStreamingState`.

## References & source material

Engine source (UE 5.7, `Engine/Source/`):
- `Runtime/Engine/Classes/Engine/World.h`:917 — `UWorld`; :939 `PersistentLevel`;
  :987 `StreamingLevels`; :2850 `GetWorldPartition`; :2858 `GetDataLayerManager`.
- `Runtime/Engine/Classes/Engine/Level.h`:422 — `ULevel`; :445 `bUseExternalActors` (OFPA).
- `Runtime/Engine/Classes/Engine/LevelStreaming.h`:138 — `ULevelStreaming`.
- `Runtime/Engine/Classes/Kismet/GameplayStatics.h`:306 — `LoadStreamLevel`; :314 `UnloadStreamLevel`.
- `Runtime/Engine/Public/WorldPartition/WorldPartition.h`:141 — `UWorldPartition`.
- `Runtime/Engine/Public/WorldPartition/WorldPartitionSubsystem.h`:51 — `UWorldPartitionSubsystem`.
- `Runtime/Engine/Public/WorldPartition/DataLayer/DataLayerAsset.h`:29 — `UDataLayerAsset`.
- `Runtime/Engine/Public/WorldPartition/DataLayer/DataLayerInstance.h`:61 — `UDataLayerInstance`; :25 `EDataLayerRuntimeState`.
- `Runtime/Engine/Public/WorldPartition/DataLayer/DataLayerManager.h`:47 — `UDataLayerManager`; :83 `SetDataLayerInstanceRuntimeState`.
- `Runtime/Engine/Public/WorldPartition/DataLayer/DataLayerSubsystem.h`:27 — `UDataLayerSubsystem` (deprecated 5.3).
- `Runtime/Engine/Classes/Components/WorldPartitionStreamingSourceComponent.h`:16 — `UWorldPartitionStreamingSourceComponent`.
- `Runtime/Engine/Public/LevelInstance/LevelInstanceActor.h`:18 — `ALevelInstance`.
- `Runtime/Engine/Public/PackedLevelActor/PackedLevelActor.h`:25 — `APackedLevelActor`.

Official docs (UE 5.7, all fetched and confirmed):
- World Partition — <https://dev.epicgames.com/documentation/unreal-engine/world-partition-in-unreal-engine>
- World Partition Data Layers — <https://dev.epicgames.com/documentation/unreal-engine/world-partition---data-layers-in-unreal-engine>
- Level Instancing — <https://dev.epicgames.com/documentation/unreal-engine/level-instancing-in-unreal-engine>
- One File Per Actor — <https://dev.epicgames.com/documentation/unreal-engine/one-file-per-actor-in-unreal-engine>
- Level Streaming — <https://dev.epicgames.com/documentation/unreal-engine/level-streaming-in-unreal-engine>
- Building Virtual Worlds — <https://dev.epicgames.com/documentation/unreal-engine/building-virtual-worlds-in-unreal-engine>

Deep-dive references in this skill:
- [references/world-partition-streaming.md](references/world-partition-streaming.md) — full
  streaming lifecycle, grid cells, runtime overrides, server streaming, debug console commands.
- [references/data-layers-and-hlod.md](references/data-layers-and-hlod.md) — Data Layer types,
  runtime states, load filters, replication, HLOD layers and generation.
- [references/level-instances.md](references/level-instances.md) — Level Instance runtime modes
  (Embedded vs Level Streaming), Packed Level Actors, property overrides.
