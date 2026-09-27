---
name: ue-material-graph-effects
description: Author animated and interactive Unreal Engine 5.8 material graph effects. Use for scrolling UVs, periodic motion, vertex animation, masked dissolve, emissive edges, or per-actor material changes driven by gameplay.
metadata:
  engine-version: "5.8"
  category: content-assets
---

# Material graph effects

Use `ue-materials-and-shaders` for material domains, blend modes, instances, and C++ parameter APIs. This skill covers the graph decisions behind animated effects. Work with any suitable textures or procedural masks already in the project; no course texture, mesh, or example level is required.

## Choose the quantity to animate

| Desired change | Material input or graph data | Key distinction |
|---|---|---|
| Moving pattern | Texture UVs | Panning changes sampling, not mesh position or collision. |
| Sway or floating shape | World Position Offset | Vertex motion changes rendered geometry; bounds and collision may need separate treatment. |
| Hard disappearance | Masked material's Opacity Mask | Prefer a controlled cutout when partial transparency is unnecessary. |
| Soft transparency | Translucent opacity | Use only when the look needs it; layering and overdraw cost rise. |
| Bright transition edge | Emissive Color | Derive a narrow band from the same mask and threshold as the disappearance. |

For UV motion, start from the chosen texture coordinates, apply tiling, then add an offset driven by `Time × speed` or a Panner. Keep U and V controls separate only when the effect needs them. A Sine driven by time is periodic; remap its signed output into the range needed by the target input and expose amplitude and rate separately. Verify whether the material is using local, world, or screen coordinates before mixing masks and offsets.

For a dissolve, use a stable scalar progress value and a mask with a clearly defined range. Compare the mask to progress for the opacity cutout; derive the emissive edge from a small interval around the same comparison. Clamp or saturate the band so extremes do not create a permanently glowing surface. A noise mask is one option, not a required asset. If the effect should move across the object, combine progress with an appropriate local- or world-space gradient and check how it behaves when the actor moves.

When the dissolve also releases mesh-sampled particles, use `ue-niagara-mesh-disintegration` to coordinate particle emission with the material threshold.

## Gameplay-driven parameters

Create a dynamic material instance per affected component or actor, retain it, and change its exposed parameters at meaningful state transitions or along a gameplay timeline. Initialize values before the first visible frame. Use a Material Parameter Collection only for a value that truly should affect all consumers. Material animation does not change gameplay collision or physics; coordinate those separately if an object becomes intangible or disappears.

For World Position Offset, test maximum displacement against mesh bounds, shadows, and any attached effects. Material-driven movement does not move the collision shape. Avoid making the visual rise or dissolve while gameplay still treats the old shape as present unless that mismatch is intentional.

## Review

Check start, end, and interrupted states; fast and slow parameter changes; different mesh scales; and the intended camera distance. Confirm a reused actor starts from clean parameter values and that material instances do not cause other actors to change.

## References & source material

- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionTextureCoordinate.h` (`UMaterialExpressionTextureCoordinate`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionPanner.h` (`UMaterialExpressionPanner`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialExpressionSine.h` (`UMaterialExpressionSine`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialInstanceDynamic.h` (`UMaterialInstanceDynamic`).
