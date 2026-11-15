---
name: ue-auto-landscape-materials
description: Build asset-agnostic automatic landscape materials in Unreal Engine 5.8 and 5.9. Use for painted layers plus generated slope or height masks, macro variation, distance-aware detail, and triplanar projection on steep terrain.
metadata:
  engine-version: "5.9"
  category: world-building
---

# Automatic landscape materials

Use `ue-landscape-and-foliage` for landscape creation, heightmaps, and layer info objects, and `ue-materials-and-shaders` for general material APIs. This skill covers how a landscape material chooses and blends surface appearances. Source textures, terrain generators, and named biome layers are interchangeable; none is required.

## Layer model

Decide which surfaces need artist-painted control and which can be generated from terrain properties. Painted layers use a Landscape Layer Blend and matching `ULandscapeLayerInfoObject`s. Generated masks can blend surface functions by slope, elevation, or another project-specific rule. Keep the masks separate from the layer surface functions so one control can be tuned without rewriting the whole shader. Normalize or clamp masks before combining them; inspect the result as grayscale before evaluating the final color.

For a slope mask, compare an appropriate world-space geometric normal with world up. A dot product near one marks upward-facing terrain; smaller values identify steeper faces. Remap it with two adjustable thresholds and a smooth transition, then invert where the steep region should receive the alternate surface. Base the thresholds on desired angles rather than arbitrary color values. Check cliff geometry and the effect of normal-map detail so micro normals do not unintentionally change biome placement.

For elevation, remap world position Z between project-appropriate low and high limits. Define whether those limits are absolute world heights or relative to a landscape origin, especially if terrain is moved or multiple landscapes share the material. Combine slope and height masks deliberately: multiplication restricts a layer to both conditions, while a blend can preserve either condition. Avoid a hard, repeating contour unless that is the intended art direction.

## Break visible repetition

Start with ordinary landscape UVs or world coordinates and tune texel density at gameplay scale. Use broad macro variation or selective texture bombing when tiling is visible. Distance-aware blending can keep nearby detail while softening far repetition; compare the result from the actual camera range. On steep faces, triplanar or world-aligned projection can reduce stretched UVs, but it adds texture samples. Limit it to the layers and surfaces that benefit, and check projection seams and normal orientation.

Material functions are useful for repeated surface controls such as color, roughness, and normal adjustments. Keep expensive optional branches out of layers that never use them. Measure the resulting shader and landscape draw cost rather than assuming a larger master graph or a virtual texture is automatically faster.

## Reusing a landscape material in another level or project

Identify the material on the actual landscape and streaming proxies, rather than choosing a
similarly named master by filename. Migrate the instance's parent chain, functions, textures,
grass types, and their transitive dependencies. Layer-info objects belong to the landscape and
may not appear in the material's dependency tree; account for those separately. Plugin-mounted
references also need their owning content available in the destination.

Preserve the original and adapt a project-owned copy. Match the destination's existing paint
layer names in Landscape Layer Blend and any Layer Sample/Weight expressions to retain its
weightmaps. Choose one suitable base layer that remains defined when height-blend contributions
are all zero. Remove or replace Landscape Grass Output when the new setting must not spawn
the source biome's plants. Material appearance, terrain geometry, painted weights, and runtime
virtual-texture volume setup are separate concerns; copying a material does not transfer all four.

For paint-driven grass, feed a Landscape Layer Sample for the intended layer into Landscape
Grass Output. Configure density, scale intervals, random rotation, surface alignment, and
culling in its Landscape Grass Type. A manually painted Foliage Type does not control these
automatically generated instances. Give layer-info assets valid object names even when the
paint-layer name contains spaces.

When simplifying a copied material, inspect custom outputs as additional graph roots: an old
Runtime Virtual Texture Output can keep every former biome branch reachable after the visible
material has been reduced. Remove an unused output or reconnect it to the retained layers before
pruning. Back up both the material instance and its parent when the backup must remain visually
independent of subsequent graph edits.

## Review

Check painted and generated layers together on flat ground, gentle slopes, cliffs, lowlands, and peaks. Test transition widths at a distance and after changing landscape scale. If terrain is imported from an external tool, verify height scale and layer alignment, but do not depend on one generator or its exported textures.

## References & source material

- UE 5.9 source: `Engine/Source/Runtime/Landscape/Classes/Materials/MaterialExpressionLandscapeLayerBlend.h` (`UMaterialExpressionLandscapeLayerBlend`).
- UE 5.9 source: `Engine/Source/Runtime/Landscape/Classes/LandscapeLayerInfoObject.h` (`ULandscapeLayerInfoObject`).
- UE 5.9 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionVertexNormalWS.h` (`UMaterialExpressionVertexNormalWS`).
- UE 5.9 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionWorldPosition.h` (`UMaterialExpressionWorldPosition`).
