---
name: ue-master-material-authoring
description: Design reusable Unreal Engine 5.8 master materials and material instances. Use for PBR texture controls, material functions, UV options, static switches, channel-packed masks, or maintaining a family of related materials.
metadata:
  engine-version: "5.8"
  category: content-assets
---

# Master material authoring

Use `ue-materials-and-shaders` for the underlying material and instance APIs. Build a master only when several assets share the same shading model and meaningful controls. A material instance should expose useful artistic variation without turning every graph branch into a parameter. Use project textures or procedural values; no specific texture set, packing convention, or source application is required.

## Structure and parameters

Start with the common PBR inputs, then group related controls in small material functions when the same logic recurs. Give parameters names and groups that reveal what the instance artist changes: base color tint, UV scale, normal intensity, roughness range, and optional mask sources are examples. Keep defaults visually valid when a texture is absent. Distinguish global UV controls from per-texture scale or offset; forcing every texture to share one UV transform can break packed masks or detail normals.

Use scalar, vector, and texture parameters for values that change among instances. Use a Static Switch Parameter only for a feature whose compiled shader path should differ, such as enabling an optional normal-map branch. Every independent switch can multiply shader permutations; avoid a switch for each minor artistic adjustment. Evaluate instruction count and compilation cost across the combinations actually used.

## Texture data contracts

- Treat base color as color data, while roughness, metalness, ambient occlusion, height, and packed masks are linear data. Verify texture import, sRGB, compression, and sample type rather than correcting a bad input with arbitrary graph math.
- Normal maps need normal-map compression and sampling compatible with the chosen texture. Blend or adjust normals using normal-aware functions; naïvely scaling RGB can destroy a valid normal.
- For channel-packed textures, write down the channel mapping at the sample: for example, which channel supplies AO, roughness, or metalness. Use Component Mask to route scalar channels and do not assume every pack follows the same convention. Packing reduces texture fetch and memory overhead only when it matches actual asset use.
- Expose roughness and metalness ranges where useful. Leave Specular near the physically based default unless the material calls for a deliberate dielectric adjustment; avoid using it as a substitute for roughness.

Displacement needs a specific geometry and platform plan. World Position Offset moves existing vertices and needs sufficient geometry and bounds; other displacement or tessellation paths vary with project renderer and UE version. Choose the supported path for the target rather than treating a height texture as automatic geometric detail.

## Review

Create a few representative instances from the master: one with only defaults, one with all intended optional features, and one with the most different texture set. Check shader compilation, visual output, texture streaming, and whether the instance interface makes invalid combinations too easy. Split a master when unrelated feature families make it hard to understand or expensive to compile.

## References & source material

- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/Material.h` (`UMaterial`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialInstance.h` (`UMaterialInstance`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialFunction.h` (`UMaterialFunction`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionStaticSwitchParameter.h` (`UMaterialExpressionStaticSwitchParameter`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionComponentMask.h` (`UMaterialExpressionComponentMask`).
