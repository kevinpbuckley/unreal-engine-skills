---
name: materials-and-shaders
description: Author and drive Unreal materials — UMaterial (the node graph), material instances
  (UMaterialInstanceConstant for asset variants, UMaterialInstanceDynamic for runtime), material
  domain/shading model/blend mode, parameters (scalar/vector/texture), and runtime parameter
  changes from C++. Use when creating materials, making parameterized variants, changing material
  parameters at runtime, or fixing material performance/instruction-count and translucency issues.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Materials & shaders

Unreal materials are node graphs compiled to shaders. The performance- and workflow-critical idea
is **parameters + instances**: author one parameterized base material, then make cheap variants
(constant instances) and runtime-tweakable copies (dynamic instances) instead of many unique materials.

## When to use this skill

- Creating a material or a family of material variants.
- Changing material parameters at runtime (damage tint, team color, dissolve).
- Choosing material domain/shading model/blend mode.
- Fixing material cost (instruction count, too many unique materials, translucency overdraw).

## The material class family

| Class | What it is | Use for |
|---|---|---|
| `UMaterial` | the base material with the node graph | the master shader; defines parameters |
| `UMaterialInstanceConstant` (MIC) | asset that overrides a parent's parameters | variants set in-editor (colors, textures) |
| `UMaterialInstanceDynamic` (MID) | runtime instance | parameters changed in C++/BP at runtime |
| `UMaterialInterface` | base type of all the above | the type you store/pass around |

Store/assign as `UMaterialInterface*` so any of them fits.

## Master material → instances

1. Build one `UMaterial` and expose **parameters** (Scalar/Vector/Texture parameter nodes) for
   anything you'll vary.
2. Create `MIC` assets (child instances) for static variants — they share the compiled shader and
   only override parameter values (cheap, no recompile).
3. Create a `MID` at runtime when a value must change while playing.

This keeps shader permutations and compile cost down versus authoring many separate materials.

## Key material settings

- **Material Domain**: `Surface` (most), `Deferred Decal`, `Light Function`, `Post Process`,
  `User Interface`, `Volume`.
- **Shading Model**: `Default Lit`, `Unlit`, `Subsurface`, `Clear Coat`, `Two Sided Foliage`, etc.
- **Blend Mode**: `Opaque` (cheapest), `Masked` (alpha test, e.g. foliage), `Translucent`,
  `Additive`, `Modulate`. Translucency is expensive and doesn't write depth normally — avoid for
  large overlapping surfaces.
- **Two Sided**, **Used with...** flags (Skeletal Mesh, Instanced Static Meshes, Niagara) — enable
  the usages your content needs or the material won't apply there.

## Runtime parameters (MID) in C++

```cpp
// Create a dynamic instance from the component's current material and tweak it
UMaterialInstanceDynamic* MID = MeshComp->CreateDynamicMaterialInstance(0, BaseMaterial);
MID->SetScalarParameterValue(TEXT("DamageAmount"), 0.7f);
MID->SetVectorParameterValue(TEXT("TeamColor"), FLinearColor::Blue);
MID->SetTextureParameterValue(TEXT("Detail"), DetailTexture);

// Or create standalone:
UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(BaseMaterial, this);
```
Parameter **names must match** the parameter nodes in the base material. `CreateDynamicMaterialInstance`
both creates the MID and assigns it to the given slot.

## Material parameter collections

`UMaterialParameterCollection` holds global parameters many materials read (e.g. global wetness,
time-of-day). Set once from C++/BP; all referencing materials update — good for world-wide effects.

## Performance guidance

- Prefer **instances** over unique materials; fewer base materials = fewer shader permutations.
- Watch **instruction count** and **texture samplers** (hard sampler limit per material).
- Keep translucency minimal; use **Masked** for cutouts instead of Translucent where possible.
- Enable only the **"Used with"** usages you need (each adds permutations).
- Use **Static Switch** parameters for feature toggles compiled per MIC (no runtime branch cost).

## Gotchas

- **Parameter name typos** in `Set*ParameterValue` silently no-op.
- **Changing the base material directly at runtime** affects every user; create a **MID** for
  per-instance changes.
- **Missing "Used with Skeletal Mesh / Niagara / ISM"** → material shows as default on that content.
- **Overusing Translucent** → overdraw/perf collapse; reconsider blend mode.
- **Editing a `UMaterialInstanceConstant` at runtime** — MICs are assets, not for runtime change; use MID.

## References & source material

Engine source (UE 5.7, `Runtime/Engine/Public/Materials/`):
- `Material.h` — `UMaterial` (base material).
- `MaterialInterface.h` — `UMaterialInterface` (common base).
- `MaterialInstanceConstant.h` — `UMaterialInstanceConstant` (MIC).
- `MaterialInstanceDynamic.h` — `UMaterialInstanceDynamic` (MID), `Set*ParameterValue`, `Create`.

Official docs (UE 5.7): Designing Visuals, Rendering, and Graphics —
<https://dev.epicgames.com/documentation/unreal-engine/designing-visuals-rendering-and-graphics-with-unreal-engine>
