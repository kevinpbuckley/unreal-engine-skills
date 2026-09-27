---
name: ue-auto-landscape-materials
description: Build asset-agnostic automatic landscape materials in Unreal Engine 5.8. Use for painted layers plus generated slope or height masks, macro variation, distance-aware detail, and triplanar projection on steep terrain.
metadata:
  engine-version: "5.8"
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

## Review

Check painted and generated layers together on flat ground, gentle slopes, cliffs, lowlands, and peaks. Test transition widths at a distance and after changing landscape scale. If terrain is imported from an external tool, verify height scale and layer alignment, but do not depend on one generator or its exported textures.

## References & source material

- UE 5.8 source: `Engine/Source/Runtime/Landscape/Classes/Materials/MaterialExpressionLandscapeLayerBlend.h` (`UMaterialExpressionLandscapeLayerBlend`).
- UE 5.8 source: `Engine/Source/Runtime/Landscape/Classes/LandscapeLayerInfoObject.h` (`ULandscapeLayerInfoObject`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionVertexNormalWS.h` (`UMaterialExpressionVertexNormalWS`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionWorldPosition.h` (`UMaterialExpressionWorldPosition`).
