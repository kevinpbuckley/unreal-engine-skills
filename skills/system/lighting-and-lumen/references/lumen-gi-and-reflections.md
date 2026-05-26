# Lumen GI and reflections — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the Lumen architecture, the two
tracing modes, the full settings table from `FPostProcessSettings`, emissive GI,
sky light integration, and hardware ray tracing notes. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/Scene.h` — `FPostProcessSettings`:692)
and the official
[Lumen Global Illumination and Reflections](https://dev.epicgames.com/documentation/unreal-engine/lumen-global-illumination-and-reflections-in-unreal-engine)
doc.

## What Lumen solves

Lumen computes two things:
1. **Diffuse GI (Final Gather)** — indirect lighting with infinite bounces, colour
   bleed, sky shadowing, and volumetric fog contribution.
2. **Specular reflections** — screen and scene ray traces that resolve all roughness
   values, including clear coat and translucency.

Both are solved using the **Lumen Scene**: a reduced-resolution proxy of the world
(mesh SDFs + surface cache) that is updated asynchronously and cached between frames.
Screen-space traces then refine the result at full resolution.

## Enabling Lumen

In Project Settings → Engine → Rendering:
- **Dynamic Global Illumination Method** → `Lumen`
- **Reflection Method** → `Lumen`
- **Generate Mesh Distance Fields** → on (auto-enabled; engine restart required)

To disable static lighting interference:
- **Allow Static Lighting** → off (frees a GBuffer slot for Material AO)
- Set **Force No Precomputed Lighting** in World Settings then rebuild lighting
  to discard any residual lightmaps from the level.

## Tracing modes

### Software Ray Tracing (SRT)
- Traces against per-mesh Signed Distance Fields (SDFs) and the Global Distance Field.
- Supported on any DX11/DX12 GPU (no RT hardware required).
- SDF quality depends on mesh import settings; complex meshes may need increased
  `Distance Field Resolution Scale` on the Static Mesh.
- Two sub-modes: **Detail Tracing** (per-SDF, highest quality) and
  **Global Tracing** (Global DF, fastest; `r.Lumen.TracingMode`).

### Hardware Ray Tracing (HRT)
- Uses the GPU BVH. Enabled in Project Settings → Hardware Ray Tracing → Support HRT.
- Allows **Hit Lighting for Reflections** (`LumenRayLightingMode` in PPV):
  evaluates the full material at the ray hit point, producing correct reflections of
  dynamic geometry that has not yet updated the surface cache.
- HRT scene update cost scales with instance count; scenes with >100k instances see
  significant update overhead — use SRT for open worlds at that scale.

## Post Process Volume settings (FPostProcessSettings, Scene.h:692)

All Lumen-related overrides require the corresponding `bOverride_*` bit to be set;
the editor's checkbox does this automatically.

### Global Illumination category

| Field | Line | Default | Purpose |
|---|---|---|---|
| `LumenSceneLightingQuality` | 1718 | 1.0 | Fidelity of the Lumen scene cache; larger → better quality at higher GPU cost |
| `LumenSceneDetail` | 1722 | 1.0 | Minimum instance size represented in Lumen scene; increase for small props |
| `LumenSceneViewDistance` | 1726 | — | Max distance Lumen maintains for GI/sky shadowing |
| `LumenSceneLightingUpdateSpeed` | 1730 | 1.0 | Propagation speed of lighting changes; higher = faster but more cost |
| `LumenFinalGatherQuality` | 1734 | 1.0 | Sample count for the final gather; higher reduces noise |
| `LumenFinalGatherLightingUpdateSpeed` | 1738 | 1.0 | How quickly final gather tracks lighting changes |
| `LumenFinalGatherScreenTraces` | 1742 | on | Add screen-space traces to the final gather for extra detail |
| `LumenMaxTraceDistance` | 1746 | — | Maximum ray length; too small → GI leaks into large enclosed spaces |
| `LumenDiffuseColorBoost` | 1750 | 1.0 | Non-physical boost to indirect; useful for dark-material scenes |
| `LumenSkylightLeaking` | 1754 | 0.0 | Fraction of skylight to bleed indoors (artistic, non-physical) |
| `LumenSurfaceCacheResolution` | 1766 | 0.5 | Cache resolution scale for scene captures |

### Reflections category

| Field | Line | Default | Purpose |
|---|---|---|---|
| `LumenReflectionQuality` | 1777 | 1.0 | Reflection ray sample count |
| `LumenReflectionsScreenTraces` | 1781 | on | Screen-space refinement pass for reflections |
| `LumenFrontLayerTranslucencyReflections` | 1785 | off | Mirror reflections on front translucency layer |
| `LumenMaxRoughnessToTraceReflections` | 1789 | — | Max roughness for dedicated reflection rays; higher = glossy on rough surfaces but costly |
| `LumenMaxReflectionBounces` | 1793 | 1 | Recursive reflection bounces (up to 8 in PPV, up to 64 via `r.Lumen.Reflections.MaxBounces`; requires HRT hit lighting) |
| `LumenMaxRefractionBounces` | 1797 | 0 | Refraction ray bounces through translucency; >0 requires HRT hit lighting |
| `LumenRayLightingMode` | 1714 | SurfaceCache | `SurfaceCache` (fast) or `HitLightingForReflections` (quality, requires HRT) |

## Sky light integration

The `USkyLightComponent` feeds Lumen's Final Gather as part of the same pass;
sky shadowing (sky light blocked by geometry) works automatically. This means indoor
areas become realistically darker than outdoor ones without any extra setup.

With `bRealTimeCapture = true` the sky is convolved every frame, keeping the ambient
IBL in sync with a moving sun or changing atmosphere. For performance-constrained
targets, set it to false and call `RecaptureSky()` only when the sky changes
(time-of-day transitions, weather events).

## Emissive material GI

Emissive materials feed GI through Lumen's Final Gather automatically, at no
additional cost beyond the GI pass itself. Constraints:
- Very small, very bright emissive areas produce noise (firefly artefacts); add a
  small real light source near critical emissive patches to supplement.
- Emissive-only GI is inherently lower quality than placed lights; it works well for
  large area sources (glowing ceilings, lava, neon signs).

## Lumen limitations and workarounds

| Limitation | Workaround |
|---|---|
| Static lights not supported | Change to Movable; baked indirect requires Lightmass |
| Subsurface and hair quality | Enable HRT hit lighting for better sampling |
| Very small SDFs missed | Increase `LumenSceneDetail`; raise mesh DF resolution scale |
| GI slow to update after light change | Raise `LumenSceneLightingUpdateSpeed` (costs GPU) |
| Translucency reflections are glossy only | Enable `LumenFrontLayerTranslucencyReflections` in PPV |
| Lumen reflections + static baked GI | Possible but requires HRT mode (no SRT fallback) |

## Version notes

- Lumen is default in new UE5 projects. UE4 projects converted to UE5 do not auto-enable
  it to avoid disrupting baked workflows.
- `LumenMaxReflectionBounces` > 1 requires HRT + hit lighting (`r.Lumen.HardwareRayTracing=1`).
- The `r.Lumen.*` CVar namespace provides fine-grained overrides for per-platform
  scalability settings beyond what the PPV exposes.
