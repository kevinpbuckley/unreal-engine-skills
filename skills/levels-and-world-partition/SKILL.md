---
name: levels-and-world-partition
description: Structure and stream Unreal worlds — UWorld/ULevel, the persistent level plus
  streaming sublevels (legacy) vs World Partition (the 5.x automatic spatial streaming system),
  Data Layers, Level Instances/Packed Level Actors, and One File Per Actor. Use when organizing a
  level, setting up open-world or large-level streaming, toggling content sets at runtime, building
  reusable level chunks, or deciding between sublevels and World Partition.
metadata:
  engine-version: "5.7"
  category: world-building
---

# Levels & World Partition

A `UWorld` is the running game world; it contains one **persistent level** and any number of
streamed levels. For large worlds, UE5's **World Partition** replaces hand-managed sublevels with
automatic, grid-based spatial streaming. Pick the right approach for the world's size.

## When to use this skill

- Organizing content across levels; keeping memory in check.
- Building an open world or a large level that can't all be resident at once.
- Toggling sets of actors at runtime (day/night, story states, destruction).
- Making reusable, instanced level chunks (modular building blocks).

## Two streaming models

| Model | Best for | How it streams |
|---|---|---|
| **Sublevels (level streaming)** | smaller games, hand-authored zones | you load/unload named sublevels via volumes, Blueprint, or C++ |
| **World Partition** (5.x default for big worlds) | open worlds, large levels | engine auto-streams grid cells around *streaming sources* (players) |

### Sublevels (legacy/explicit)
A persistent level references streaming levels (`ULevelStreaming`). Load/unload with Level
Streaming Volumes, the Levels window, or code:
```cpp
UGameplayStatics::LoadStreamLevel(this, TEXT("Zone_Forest"), /*bMakeVisible*/ true, /*bShouldBlock*/ false, FLatentActionInfo());
UGameplayStatics::UnloadStreamLevel(this, TEXT("Zone_Forest"), FLatentActionInfo(), /*bShouldBlock*/ false);
```
Good when you control exactly when zones appear. Note: legacy **World Composition** is superseded
by World Partition — don't start new open worlds with it.

### World Partition (modern)
- One persistent level; the world is divided into a streaming **grid**. Cells load/unload around
  **streaming sources** (the player by default) — no manual sublevels.
- Actors are stored **One File Per Actor (OFPA)** — each actor is its own file under the level,
  which makes multi-user editing/source control granular (but produces many small files).
- **HLODs** provide cheap stand-ins for distant, unloaded cells.
- Add a streaming source to non-player viewpoints with `UWorldPartitionStreamingSourceComponent`.

## Data Layers (toggle content sets)

Data Layers group actors so you can enable/disable whole sets:
- **Runtime Data Layers** — change state at runtime (e.g. `Activated`/`Loaded`/`Unloaded`) for
  day/night versions, pre/post-destruction, quest states.
- **Editor Data Layers** — organization only.
Defined by `UDataLayerAsset`; instanced per world. Switch runtime layers via the Data Layer
subsystem from gameplay.

## Level Instances & Packed Level Actors (reusable chunks)

- **Level Instance** — embed a level as an instance in another level (a prefab-like reusable
  building/room you can edit in one place and reuse).
- **Packed Level Actor** — bakes a Level Instance of static meshes into a single ISM-backed actor
  for performance.
Use these instead of copy-pasting groups of actors.

## Accessing world/levels in C++

- `GetWorld()` from any actor; `UWorld` exposes the persistent level and streaming levels.
- Spawn into the current world with `SpawnActor` (see `actors-and-components`).
- World teardown destroys per-world state (timers, World Subsystems — see `subsystems`).

## Choosing

- **Small/linear game, explicit zones** → persistent level + streaming sublevels.
- **Open world / very large level** → World Partition (with Data Layers + HLOD).
- **Repeated structures** → Level Instances / Packed Level Actors.
- **Variant world states** → Runtime Data Layers.

## Gotchas

- **Everything in one level** → memory blowout and slow load; stream it.
- **OFPA + source control** — many tiny files; ensure your VCS/ignore rules handle them and avoid
  committing generated dirs (`project-structure`).
- **Referencing actors across streaming boundaries** with hard pointers breaks when a cell unloads;
  use soft references / re-acquire on load (`asset-management`).
- **World Composition for new projects** — deprecated path; use World Partition.
- **Blocking level loads** on the game thread → hitches; stream async.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Engine/World.h`, `Engine/Level.h`, `Engine/LevelStreaming.h`.
- `Runtime/Engine/Public/WorldPartition/WorldPartition.h` — `UWorldPartition`.
- `Runtime/Engine/Public/WorldPartition/DataLayer/DataLayerAsset.h` — Data Layers.

Official docs (UE 5.7): Building Virtual Worlds —
<https://dev.epicgames.com/documentation/unreal-engine/building-virtual-worlds-in-unreal-engine>
