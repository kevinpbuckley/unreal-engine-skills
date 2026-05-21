---
name: landscape-and-foliage
description: Build terrain and vegetation in Unreal — the Landscape system (heightmap terrain,
  layers/material painting, splines), foliage (instanced foliage, FoliageType, the HISM backing),
  and PCG (Procedural Content Generation) for graph-driven scatter/placement. Use when creating or
  sculpting terrain, painting materials/foliage, placing large numbers of meshes efficiently, or
  generating environments procedurally.
metadata:
  engine-version: "5.7"
  category: world-building
---

# Landscape & foliage

Terrain is an `ALandscape` (heightmap-based, with paintable material layers and splines).
Vegetation and scattered props use **instanced foliage** (batched via HISM) or **PCG** for
graph-driven procedural placement. All three are about covering large areas without tanking
performance.

## When to use this skill

- Creating/sculpting terrain and painting material layers onto it.
- Placing trees/grass/rocks at scale (thousands of instances).
- Roads/rivers/paths along terrain (landscape splines).
- Procedurally generating environment content (PCG).

## Landscape

- `ALandscape` is a grid of `ULandscapeComponent`s built from a heightmap. Sculpt with the
  Landscape tools (sculpt/smooth/erosion), or import a heightmap.
- **Layers & material painting:** the landscape material uses `Landscape Layer Blend` nodes;
  each weight layer (grass, rock, dirt) is painted to blend textures across the terrain. Set up
  layer info objects per paint layer.
- **Edit Layers:** non-destructive sculpt/paint layers you can reorder/blend.
- **Landscape Splines:** spline-based roads, cliffs, rivers that deform/decorate the terrain.
- **World Partition:** large landscapes stream by region; works with the grid (see
  `levels-and-world-partition`).
- **Nanite landscape / virtual heightfield mesh** options exist in 5.x for higher detail — verify
  what your build supports.

## Foliage (instanced placement)

- The **Foliage** editor mode paints `UFoliageType` instances into an `AInstancedFoliageActor`.
  Under the hood these are **Hierarchical Instanced Static Meshes (HISM)** — many instances, few
  draw calls (see `meshes-static-and-skeletal`).
- `UFoliageType` controls density, random scale/rotation, alignment to surface normal, collision,
  and cull distances.
- **Procedural Foliage** (procedural foliage volumes/spawners) can auto-populate based on rules.
- Foliage can paint onto landscape and static meshes.

## PCG (Procedural Content Generation)

- The **PCG** plugin builds content from **graphs**: sample surfaces (landscape/meshes), apply
  rules/filters/noise, and spawn meshes/actors/instances. A `UPCGComponent` runs a PCG graph on an
  actor/volume.
- Use PCG for rule-based environment building (scatter rocks avoiding paths, place props by slope),
  which is more controllable and regenerable than hand-painting.
- PCG complements foliage: foliage for hand-art density painting, PCG for systemic generation.

## Performance

- Instancing (foliage/PCG → ISM/HISM) is essential at scale; avoid one actor per plant.
- Tune **cull distances** and use HLODs for distant content.
- Consider **Nanite** for dense foliage/rock meshes where supported (`nanite-and-rendering`).
- Keep landscape component count and material layer count reasonable; many layers cost shader perf.

## Gotchas

- **Placing many individual actors** for vegetation → draw-call/perf collapse; use foliage/PCG.
- **Missing layer info objects** → can't paint that landscape layer.
- **Foliage with collision everywhere** → physics/query cost; enable collision only where needed.
- **Huge single landscape without streaming** → memory/perf; use World Partition regions.
- **Regenerating PCG at runtime carelessly** can hitch; bake/generate at the right time.

## References & source material

Engine source (UE 5.7):
- `Runtime/Landscape/Classes/Landscape.h` — `ALandscape` (+ landscape components/splines nearby).
- `Runtime/Foliage/Public/FoliageType.h` — `UFoliageType`.
- `Runtime/Foliage/Public/InstancedFoliageActor.h` — `AInstancedFoliageActor`.
- `Engine/Plugins/PCG/Source/PCG/Public/PCGComponent.h` — `UPCGComponent`.

Official docs (UE 5.7): Building Virtual Worlds —
<https://dev.epicgames.com/documentation/unreal-engine/building-virtual-worlds-in-unreal-engine>

Related: `meshes-static-and-skeletal`, `levels-and-world-partition`, `nanite-and-rendering`.
