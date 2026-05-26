# Virtual Textures & Virtual Shadow Maps — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers Runtime Virtual Textures (RVT), Streaming
Virtual Textures (SVT), and Virtual Shadow Maps (VSM) internals, page allocation, Nanite
integration, and practical configuration. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/RendererSettings.h`,
`Engine/Source/Runtime/Renderer/Private/VirtualShadowMaps/VirtualShadowMapArray.h`).

## Virtual Texturing overview

Virtual Textures replace traditional fully-resident textures with a page-streaming system.
The GPU requests only the texels actually needed for visible surface area, similar to how
Nanite requests only visible geometry clusters.

UE supports two VT types that serve different purposes:

### Streaming Virtual Textures (SVT)

The standard VT form for regular textures: large textures (e.g., 16k or 32k terrain
albedo) stream pages on demand rather than loading the full mip chain. Enabled globally
with `r.VirtualTextures 1` (project restart required; `RendererSettings.h`:385).

SVT is most beneficial for:
- Terrain layers with very high source resolution.
- Large-scale environment textures with localized detail.
- Projects where texture memory is the primary constraint.

SVT is **not** required by Nanite, but Epic recommends pairing them — both address
the same axis (memory for large-scale detail) at their respective data types.

Key project settings (`RendererSettings.h`):

| Setting | cvar | Effect |
|---|---|---|
| `bVirtualTextures` | `r.VirtualTextures` | Master enable (restart) |
| `bVirtualTexturedLightmaps` | `r.VirtualTexturedLightmaps` | Stream lightmaps via VT |
| `VirtualTextureTileSize` | `r.VT.TileSize` | Tile size in pixels (power-of-2, default 128) |
| `VirtualTextureTileBorderSize` | `r.VT.TileBorderSize` | Border for anisotropic filtering |
| `bVirtualTextureAnisotropicFiltering` | `r.VT.AnisotropicFiltering` | Enable aniso on VT (adds shader cost) |
| `bMobileVirtualTextures` | `r.Mobile.VirtualTextures` | VT on mobile (requires base VT enabled) |

### Runtime Virtual Textures (RVT)

RVTs are rendered into at runtime by materials — typically used for landscape blending
(blending foliage/decals onto landscape), road/path materials that need to project onto
terrain, or any effect that requires the scene to "paint" information into a texture.

The landscape writes base color and normal into an RVT; road meshes sample the RVT for
blended material transitions without expensive material layering.

RVTs are configured per-primitive: a `URuntimeVirtualTextureComponent` defines the world-
space region and resolution; landscape, static meshes, and Nanite meshes with the right
material output write into it. Consumers sample it via the `RuntimeVirtualTextureSample`
material node.

## Virtual Shadow Maps internals

Virtual Shadow Maps (`VirtualShadowMapArray.h`) address the traditional shadow map
resolution problem: a fixed-resolution shadow map must cover the entire light frustum,
making near surfaces look blurry while wasting texels on far unseen geometry.

VSM uses a **virtual address space** of 16k × 16k for directional lights (a clipmap
covering multiple view-centered cascades) and per-light pages for local lights. Only pages
that correspond to visible shadow-receiving surfaces are allocated and rendered each frame.

### Page structure (`VirtualShadowMapArray.h`:72–77)

| Constant | Value | Meaning |
|---|---|---|
| `PageSize` | 128 (pixels) | Physical page resolution |
| `Level0DimPagesXY` | 128 pages | Virtual space is 128 × 128 pages = 16k virtual res |
| `MaxMipLevels` | 7 | Mip hierarchy depth for directional light cascades |
| `VirtualMaxResolutionXY` | 16384 | Total virtual address space edge length in pixels |

In practice, a scene with few unique shadow receivers and good Hi-Z occlusion may only
allocate a few hundred physical pages, regardless of the 16k virtual space.

### Nanite + VSM interaction

Nanite geometry renders into VSM shadow pages using the same GPU-driven cluster rasterizer
used for the main view, meaning:
- High-detail Nanite meshes cast pixel-accurate shadows without needing a separate shadow
  LOD or simplified shadow mesh.
- The VSM page requests for shadowing are driven by the camera view's visible surface set;
  only pages needed to shadow visible receivers are allocated.
- The `FNaniteVirtualShadowMapRenderPass` struct (`VirtualShadowMapArray.h`:47) collects
  Nanite shadow draws for batched execution.

For non-Nanite meshes, VSM uses the conventional shadow mesh pass (fallback mesh if
Nanite is enabled on the asset). The visual quality difference between Nanite and non-Nanite
shadow casting can be significant for very detailed geometry (e.g., a Nanite pillar casts
sub-pixel shadow detail; its LOD fallback may show faceted shadow edges).

### VSM caching

VSM maintains a cache of physical pages across frames (`FVirtualShadowMapArrayCacheManager`,
`VirtualShadowMapCacheManager.h`). When a shadow-casting primitive or light does not move,
its pages are reused from the cache. Static geometry with no dynamic lights benefits
substantially — effectively free shadowing once the cache is warm.

`r.Shadow.Virtual.Cache.StaticSeparate 1` keeps static and dynamic shadow pages in separate
caches, allowing static pages to persist even when dynamic objects invalidate nearby pages.

### VSM performance tuning

- `r.Shadow.Virtual.ResolutionLodBiasDirectional` — positive values reduce directional
  light shadow resolution (larger LOD steps = fewer, coarser pages). Use to cut shadow
  cost for large open worlds.
- `r.Shadow.Virtual.ResolutionLodBiasLocal` — same for point/spot lights.
- `r.Shadow.Virtual.MaxPhysicalPages` — hard cap on physical page pool size (VRAM).
- `stat VirtualShadowMaps` — shows page count, cache hit rate, and per-light cost.

If VSM page count is unexpectedly high:
1. Check for unnecessary dynamic shadow casters (use `bCastDynamicShadow = false` on
   static decorative meshes).
2. Verify that static meshes are marked as Static mobility — Stationary/Movable objects
   invalidate VSM static cache pages.
3. Use `r.Shadow.Virtual.Cache.StaticSeparate 1` to protect static pages.

## Practical configuration checklist

For a Nanite-heavy open world scene (recommended defaults):

```ini
[/Script/Engine.RendererSettings]
r.VirtualTextures=1
r.VirtualTexturedLightmaps=0         ; unless using baked lighting
r.Shadow.Virtual.Enable=1
r.Shadow.Virtual.Cache.StaticSeparate=1
r.AntiAliasingMethod=4               ; TSR
r.ScreenPercentage=75                ; adjust per target hardware
```

For VR (forward renderer):

```ini
r.ForwardShading=1
r.AntiAliasingMethod=3               ; MSAA (forward only)
r.MSAACount=4
; Nanite is disabled automatically in forward mode
; VSM is compatible with forward but with reduced feature set
```

## Version notes

- **RVT + Nanite**: Nanite meshes can write to RVTs in 5.7 when the material has the
  correct RVT output nodes.
- **VSM + Nanite skeletal mesh**: skeletal mesh Nanite shadow rendering via VSM is
  supported in 5.7; check the Nanite skeletal mesh documentation for limitations on
  complex animations.
- **Mobile VT**: requires base `r.VirtualTextures=1` and `r.Mobile.VirtualTextures=1`;
  feature set is more limited than desktop (no RVT on all mobile paths).
- **VSM with path tracer**: the path tracer uses its own shadow model and does not use VSM.
