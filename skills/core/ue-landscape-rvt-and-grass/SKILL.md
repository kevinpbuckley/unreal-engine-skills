---
name: ue-landscape-rvt-and-grass
description: Integrate runtime virtual textures and material-driven landscape grass in Unreal Engine 5.8. Use for terrain-to-mesh color blending, RVT write/sample setup, grass masks, vegetation culling, or reducing visible grass pop-in.
metadata:
  engine-version: "5.8"
  category: world-building
---

# Landscape RVT and grass

Use `ue-auto-landscape-materials` for terrain surface masks and `ue-landscape-and-foliage` for general foliage placement and instance management. RVT and Landscape Grass Output are separate options: add either only when it serves the requested landscape. No particular grass mesh, landscape texture, or external terrain asset is required.

## Runtime virtual texture contract

A runtime virtual texture needs a compatible asset, landscape write path, volume covering the intended area, and sample path on the receiving material. Choose which material attributes the RVT stores before wiring writers and readers; a sample expecting color and normal cannot recover attributes that were never written. Keep the volume aligned with the terrain and test outside its bounds. When using a sampled landscape result to blend a static mesh into the ground, build the blend from an explicit contact mask so the whole object does not inherit ground color.

Check project virtual-texturing support and target-platform behavior in UE 5.8. RVT resolution, tile settings, update behavior, and memory use affect sharpness and runtime cost. It can amortize a complex landscape result or improve cross-material consistency, but it is not an automatic performance gain. Compare shader, memory, and visual quality with a simpler direct material before committing to it. Avoid read paths that expect data before a writer has populated the relevant area.

## Material-driven grass

Landscape Grass Output uses one or more `ULandscapeGrassType` assets and a scalar density mask. A painted Landscape Layer Sample can provide the mask; a generated combination of slope, height, and exclusion areas can provide automatic placement. Inspect the mask before spawning grass and clamp it to its intended range. Grass Output is suited to dense, cosmetic ground cover. For sparse trees, individually interactive plants, or collision-critical actors, choose a placement system that supports their required behavior.

Set density, variety, scale, and cull distance against the expected camera and platform. Increase density only after checking silhouette and coverage. To reduce visible pop-in, coordinate cull distances with a compatible per-instance fade or dithered masked material; verify shadows and temporal artifacts during camera movement. Do not switch all foliage to translucency merely to fade it. Profile instance count, overdraw, and shadow cost in the actual level.

## Review

Test terrain and receiving meshes in daylight and low light, at RVT tile boundaries, outside volume bounds, and after landscape edits. For grass, inspect near and far camera movement, painted and generated mask transitions, and the cost of shadows and collisions. Confirm any gameplay-critical foliage is placed by a system that actually provides the needed interaction.

## References & source material

- UE 5.8 source: `Engine/Source/Runtime/Engine/Classes/VT/RuntimeVirtualTexture.h` (`URuntimeVirtualTexture`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Classes/VT/RuntimeVirtualTextureVolume.h` (`ARuntimeVirtualTextureVolume`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionRuntimeVirtualTextureOutput.h` (`UMaterialExpressionRuntimeVirtualTextureOutput`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionRuntimeVirtualTextureSample.h` (`UMaterialExpressionRuntimeVirtualTextureSample`).
- UE 5.8 source: `Engine/Source/Runtime/Landscape/Classes/Materials/MaterialExpressionLandscapeGrassOutput.h` (`UMaterialExpressionLandscapeGrassOutput`).
- UE 5.8 source: `Engine/Source/Runtime/Landscape/Classes/LandscapeGrassType.h` (`ULandscapeGrassType`).
