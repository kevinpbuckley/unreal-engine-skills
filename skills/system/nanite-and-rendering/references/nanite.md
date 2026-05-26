# Nanite — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the cluster hierarchy and streaming model,
static vs runtime displacement, the fallback mesh, visualization modes, and build/runtime
diagnostics. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/EngineTypes.h`,
`Engine/Source/Runtime/Engine/Public/Rendering/NaniteResources.h`).

## How Nanite stores geometry

At build time, Nanite analyzes each mesh and produces a hierarchical cluster tree:

1. **Clusters** — groups of 64–128 triangles. Each cluster has its own bounds and an
   error estimate that controls when a coarser cluster can substitute for it on screen.
2. **Hierarchy nodes** (`FPackedHierarchyNode`) — form a BVH over clusters. The GPU
   traverses this hierarchy per frame to select visible clusters at the right LOD.
3. **Pages** — clusters are packed into streaming pages. Root pages reside in memory at
   all times (`FResources::RootData`, `NaniteResources.h`:412); the remainder are streamed
   on demand from the `StreamablePages` bulk store (`:413`).
4. **Imposter** — a billboard fallback used for very distant instances when even the
   coarsest cluster is too expensive.

`Nanite::FResources` (`NaniteResources.h`:409) is the runtime handle:

| Field | Meaning |
|---|---|
| `RootData` | Always-resident root page bytes |
| `StreamablePages` | On-demand bulk data (SSD recommended) |
| `HierarchyNodes` | BVH over clusters |
| `NumInputTriangles` / `NumInputVertices` | Original mesh complexity |
| `NumClusters` | Nanite cluster count after build |
| `PositionPrecision` | Quantization step size (`2^(-N)` cm) |
| `NormalPrecision` / `TangentPrecision` | Angular bit count |

Position and normal precision can be tuned in `FMeshNaniteSettings` to trade accuracy for
memory: `PositionPrecision = MIN_int32` (auto) lets the builder choose based on mesh size;
`NormalPrecision = -1` (auto) similarly.

## GPU-driven rendering flow

Each frame, Nanite runs its own rendering pass independent of the traditional
mesh draw path:

1. **Instance culling** — `FGPUScene` data is used to frustum/occlusion-cull instances.
2. **BVH traversal** — the GPU walks the hierarchy, computing screen-space error for each
   node. Nodes whose error is below the pixel threshold (controlled by
   `r.Nanite.MaxPixelsPerEdge`, default 1.0) are expanded to finer children; leaves
   emit cluster draw commands.
3. **Cluster rasterization** — clusters above a triangle-count threshold go through the
   hardware rasterizer; micro-triangle clusters use a software rasterizer for sub-pixel
   accuracy. Both write to the Visibility Buffer (a 64-bit per-pixel record of
   instance + triangle ID).
4. **Shading** — a final compute pass evaluates materials from the Visibility Buffer,
   one thread per on-screen pixel, eliminating overdraw for opaque surfaces.

This pipeline bypasses draw calls entirely; `r.Nanite.MaxPixelsPerEdge` is the main quality
knob (lower = more clusters visible = higher quality at higher cost).

## Displacement types

### Static (offline) displacement

Configured via `FMeshNaniteSettings::DisplacementMaps` (array of `FMeshDisplacementMap`)
and `DisplacementUVChannel` (which UV set to sample). The offline tessellator:

1. Subdivides the source mesh adaptively based on displacement magnitude.
2. Displaces vertices along the normal using the sampled map.
3. Builds the Nanite cluster hierarchy from the displaced, tessellated result.

The output is baked into the mesh DDC and is a one-time build cost. Result: a high-fidelity
Nanite mesh with no runtime cost beyond normal Nanite rendering.

### Runtime (dynamic) tessellation

Runtime tessellation uses a displacement material node that the Nanite shading pass
evaluates per-pixel each frame. The CPU-side cluster bounds are not updated, so large
displacements must be accommodated by increasing `MaxEdgeLengthFactor` so cluster bounds
are conservative enough to survive culling.

Enable via Project Settings → Engine → Rendering → Nanite → Enable Tessellation (or
`r.Nanite.Tessellation 1`). This is a per-project global; individual materials opt in by
using the Displacement material output.

Trade-off: runtime tessellation is flexible and animatable but adds per-pixel cost in the
Nanite shading pass. Static displacement is a build-time cost with zero runtime overhead.

## Fallback mesh

The fallback mesh is a conventional LOD0 mesh built alongside the Nanite cluster data.
It is used for:
- **Platforms without Nanite support** (DX11, most mobile hardware).
- **Ray-tracing passes** — by default, RT uses the fallback. Enable experimental native
  RT Nanite with `r.RayTracing.Nanite.Mode 1`.
- **Forward rendering contexts** — Nanite is incompatible with forward shading.
- **Translucent materials** — Nanite cannot shade transparency; the fallback renders it.

Fallback quality is controlled by `FallbackPercentTriangles` (triangle budget) and
`FallbackRelativeError` (error-based simplification). For ray-tracing fidelity, lower
`FallbackRelativeError` toward 0 (less simplification). For runtime memory savings,
increase it (more aggressive simplification).

`UStaticMesh::HasNaniteFallbackMesh(EShaderPlatform)` (`StaticMesh.h`:2170) returns
`true` if a fallback was built for the given platform.

## Nanite visualization modes

In the editor, the Nanite visualization modes are accessible from the viewport's View Mode
dropdown under Nanite Visualization:

| Mode | What it shows |
|---|---|
| Triangles | Per-pixel triangle density (bright = high density) |
| Clusters | Cluster boundaries overlaid on screen |
| Primitives | Unique primitives (instances colored uniquely) |
| Overdraw | Non-Nanite overdraw from transparent/non-Nanite geometry |
| Material Complexity | Shader complexity from Nanite shading pass |

These modes are invaluable for verifying that content is actually rendering through the
Nanite path (not the fallback) and for diagnosing cluster budget issues.

Console: `r.Nanite.Visualize <mode>` (e.g., `r.Nanite.Visualize Triangles`).

## Component-level overrides

On `UStaticMeshComponent` (`StaticMeshComponent.h`):

| Field | Line | Effect |
|---|---|---|
| `bDisallowNanite` | :161 | Force fallback for this instance |
| `bForceNaniteForMasked` | :157 | Allow Nanite even for masked materials when project setting disables it |
| `WorldPositionOffsetDisableDistance` | :153 | Stop WPO evaluation beyond screen distance (0 = always on) |
| `bEvaluateWorldPositionOffset` | :171 | Per-instance WPO toggle |

## Common diagnostics

- **`stat Nanite`** — shows cluster counts, visible triangles, rasterizer pass breakdown.
- **`r.Nanite.ShowMaskedMaterialWarnings 1`** — logs meshes falling back due to material
  issues.
- **`r.Nanite.Validate 1`** — enables additional GPU-side validation (development builds).
- **Primitive Debugger** (editor) — shows per-primitive Nanite status and fallback reason.
- Missing root data in a cooked build: check DDC availability; Nanite root pages must be
  cooked into the package for the target platform.

## Version notes

- **Skeletal mesh Nanite** (production): UE 5.5+. In 5.7, skeletal meshes use animation LODs
  only; geometry LODs are not used. One draw call per skeletal mesh instance.
- **Spline mesh Nanite**: fully supported in 5.7 (landscape splines, blueprint splines).
  Set `MaxEdgeLengthFactor` for significantly curved splines to prevent simplification
  artifacts near the deformation apex.
- **Foliage Nanite**: uses voxelization and WPO animation. Foliage with small WPO offsets
  is fine without `MaxEdgeLengthFactor`; large-scale wind requires it.
- **Nanite tessellation**: experimental in 5.5–5.6, production-track in 5.7.
- **`UE_DEPRECATED(5.7)` on `UStaticMesh::NaniteSettings`** direct field access: always
  use `GetNaniteSettings()`/`SetNaniteSettings()`.
