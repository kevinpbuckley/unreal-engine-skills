---
name: materials-and-shaders
description: Author and drive Unreal materials — UMaterial (the node graph asset), material
  instances (UMaterialInstanceConstant for editor-authored variants, UMaterialInstanceDynamic
  for runtime parameter changes), material domain (Surface/Deferred Decal/Light Function/Post
  Process/UI/Volume), shading models (Default Lit/Unlit/Subsurface/Clear Coat/Hair/Cloth/Eye),
  blend modes (Opaque/Masked/Translucent/Additive), scalar/vector/texture parameters,
  material functions, material parameter collections (global scene-wide values), and
  the material C++ API (CreateDynamicMaterialInstance, SetScalarParameterValue,
  SetVectorParameterValue, SetTextureParameterValue, UKismetMaterialLibrary). Use when
  creating materials, making parameterized variants, changing material parameters at runtime,
  setting global weather or world-state parameters, fixing material shader permutation count
  or translucency overdraw, or cross-referencing the material class hierarchy.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Materials & shaders

UE materials are node graphs that compile to HLSL shaders. The central
workflow idea is **parameters + instances**: one parameterized base material,
cheap asset variants (constant instances), and runtime-tweakable copies
(dynamic instances). Understanding where to put logic — parameter vs. static
switch vs. separate material — determines both quality and compile cost.

## When to use this skill

- Creating a material or family of material variants from a shared base.
- Changing material parameters at runtime (damage tint, team color, wetness,
  dissolve amount).
- Choosing domain, shading model, or blend mode for a material.
- Fixing shader permutation counts or translucency overdraw performance issues.
- Setting world-wide values through a material parameter collection.
- Cross-referencing `UMaterial`, `UMaterialInstance`, `UMaterialInstanceDynamic`,
  or `UMaterialParameterCollection` in C++.

## The material class hierarchy

```
UObject
└── UMaterialInterface          (abstract base; common API for all material types)
    ├── UMaterial               (the base node-graph asset — "the shader")
    └── UMaterialInstance       (abstract; instance overriding a parent)
        ├── UMaterialInstanceConstant  (MIC — editor-authored static variants)
        └── UMaterialInstanceDynamic   (MID — runtime-writable copy)
```

Store and pass materials as `UMaterialInterface*` so any concrete type fits.

Source locations (UE 5.7 `Engine/Source/Runtime/Engine/Public/Materials/`):
- `MaterialInterface.h` — `UMaterialInterface`:295 (common interface, `GetMaterial`,
  `GetRenderProxy`, property getters).
- `Material.h` — `UMaterial`:431 (`MaterialDomain`:465, `BlendMode`:469,
  `ShadingModel`:494, `bUsedWithSkeletalMesh`:685, `GetDefaultMaterial`:1388).
- `MaterialInstance.h` — `UMaterialInstance`:626 (shared parameter storage and
  hierarchy traversal).
- `MaterialInstanceConstant.h` — `UMaterialInstanceConstant`:20 (editor-only setters;
  read-only at runtime).
- `MaterialInstanceDynamic.h` — `UMaterialInstanceDynamic`:14, `Create`:176,
  `SetScalarParameterValue`:24, `SetVectorParameterValue`:109,
  `SetTextureParameterValue`:65.
- `MaterialParameterCollection.h` — `UMaterialParameterCollection`:78.

See [references/material-instances-and-parameters.md](references/material-instances-and-parameters.md)
for a full parameter-type breakdown and a worked C++ example.

## Key material settings (UMaterial properties)

### Material domain (`EMaterialDomain`, `MaterialDomain.h`:12)

| Enum value | Use |
|---|---|
| `MD_Surface` | geometry surfaces — the default for meshes |
| `MD_DeferredDecal` | decal projectors on surfaces |
| `MD_LightFunction` | modifies a light's intensity/color pattern |
| `MD_PostProcess` | custom post-process pass |
| `MD_UI` | UMG/Slate widgets |
| `MD_Volume` | volumetric materials (Heterogeneous Volumes) |

### Blend mode (`EBlendMode`, `Engine/Classes/Engine/EngineTypes.h`:244)

| Enum value | Cost | Notes |
|---|---|---|
| `BLEND_Opaque` | cheapest | depth-writes; no sorting needed |
| `BLEND_Masked` | low | alpha-test cutout; no overdraw; uses clip instruction |
| `BLEND_Translucent` | expensive | no depth-write by default; sorting required |
| `BLEND_Additive` | moderate | adds to scene; good for glow/sparks |
| `BLEND_Modulate` | rare | multiplies into scene |

Prefer `BLEND_Masked` over `BLEND_Translucent` for foliage and fences. Use
translucency only where physically required.

### Shading model (`EMaterialShadingModel`, `EngineTypes.h`:704)

`MSM_DefaultLit`, `MSM_Unlit`, `MSM_Subsurface`, `MSM_SubsurfaceProfile`,
`MSM_ClearCoat`, `MSM_TwoSidedFoliage`, `MSM_Hair`, `MSM_Cloth`, `MSM_Eye`,
`MSM_SingleLayerWater`, `MSM_ThinTranslucent`.

Each shading model enables different material inputs; not all inputs are
meaningful for every model.

## Master material → instances — the authoring pattern

1. Author one `UMaterial` with **parameter nodes** (Scalar Parameter, Vector
   Parameter, Texture Parameter) for everything that varies across surfaces.
2. Create `UMaterialInstanceConstant` assets (child instances) in the Content
   Browser for static art variants — they share the compiled shader, adding no
   recompile cost and almost no memory overhead.
3. At runtime, call `CreateDynamicMaterialInstance` on a component to get a
   `UMaterialInstanceDynamic` when a value must change during play.

This limits shader permutations versus authoring many separate materials.

See [references/material-graph-and-domains.md](references/material-graph-and-domains.md)
for material graph authoring concepts: PBR inputs, material functions, material
attributes, static switches, and custom HLSL nodes.

## Runtime parameters (MID) in C++

```cpp
// PrimitiveComponent.h:1546 — creates a MID from SourceMaterial and assigns it
// to slot ElementIndex; returns the new MID.
UMaterialInstanceDynamic* MID =
    MeshComp->CreateDynamicMaterialInstance(0, BaseMaterial);

// MaterialInstanceDynamic.h — three core setters (thread-safe game-thread calls)
MID->SetScalarParameterValue(TEXT("DamageAmount"), 0.75f);
MID->SetVectorParameterValue(TEXT("TeamColor"), FLinearColor(0.f, 0.f, 1.f, 1.f));
MID->SetTextureParameterValue(TEXT("DetailTex"), MyTexture);
```

`CreateDynamicMaterialInstance` creates the MID **and** assigns it to the slot
in one call. Parameter names must match the Parameter nodes in the base material
exactly (case-sensitive `FName` comparison). Typos silently no-op.

To create a standalone MID without assigning it to a slot:

```cpp
UMaterialInstanceDynamic* MID =
    UMaterialInstanceDynamic::Create(BaseMaterial, this);
// Assign later with SetMaterial / CreateDynamicMaterialInstance
MeshComp->SetMaterial(0, MID);
```

High-frequency calls on the same MID can use the index-cache API
(`InitializeScalarParameterAndGetIndex` + `SetScalarParameterByIndex`) to
avoid repeated name lookups.

## Material parameter collections (global parameters)

`UMaterialParameterCollection` is a data asset holding up to 1024 scalar and
1024 vector parameters readable by **any** material in the project. One write
propagates to every referencing material in the same frame — useful for
world-state values (wetness, time-of-day tint, wind strength).

```cpp
// Kismet/KismetMaterialLibrary.h:30
// Set a scalar parameter on a collection from C++ game-thread code:
UKismetMaterialLibrary::SetScalarParameterValue(
    this, WetnessCollection, TEXT("GlobalWetness"), 0.8f);

UKismetMaterialLibrary::SetVectorParameterValue(
    this, TODCollection, TEXT("SunColor"),
    FLinearColor(1.f, 0.85f, 0.6f, 1.f));
```

A material can reference at most **two** collections. Adding parameters to a
collection re-triggers a recompile of all referencing materials; add parameters
in bulk in an empty map to avoid repeated hitching.

See [references/material-cpp-and-collections.md](references/material-cpp-and-collections.md)
for the `UKismetMaterialLibrary` API, `CopyScalarAndVectorParameters`, and
index-cache optimization.

## Usage flags

Each unique `UMaterial` must have its **"Used with ..."** flags enabled for every
content type it will be applied to (`bUsedWithSkeletalMesh`, `bUsedWithNiagaraSprites`,
`bUsedWithInstancedStaticMeshes`, etc.). Missing flags cause the engine to use a
default material instead. Each enabled flag adds one or more shader permutations.

Enable only what the content actually uses; extra usages silently grow compile time.

## Performance guidance

- **Prefer instances**: fewer base materials = fewer shader permutations = less
  compile time and PSO count.
- **Static Switch parameters**: feature toggles compiled per MIC — zero runtime
  branch cost. Minimize the total number of static switch combinations in use.
- **Instruction count**: visible in the material stats panel; keep pixel shaders
  well under a few hundred instructions for mobile.
- **Texture samplers**: each material stage has a hard platform limit (typically
  16 per shader stage). Shared sampler nodes help.
- **Translucent overdraw**: large overlapping translucent surfaces stall the GPU.
  Consider `BLEND_Masked` for cutouts and dithered LOD transitions.
- Use the **Material Analyzer** (Windows → Material Analyzer) to find redundant
  materials and duplicate parameter overrides.

## Gotchas

- **Parameter name typos** in `Set*ParameterValue` silently no-op — verify names
  match the parameter nodes exactly.
- **Changing a `UMaterial` directly at runtime** (e.g. swapping its texture
  references) triggers a recompile and hitches. Create a MID instead.
- **Editing a `UMaterialInstanceConstant` at runtime** — MICs are editor assets;
  only `Set*EditorOnly` functions exist. Use MID for any runtime mutation.
- **Missing usage flag** — the mesh shows the default material with no error in
  the log by default. Enable the flag and re-save the material.
- **Two-collection limit**: a single material graph can reference at most two
  `UMaterialParameterCollection` assets.
- **Static switch combinations**: each unique combination is a separate compiled
  shader. With N static switches you can have 2^N permutations.
- **MID lifetime**: hold the returned `UMaterialInstanceDynamic*` in a
  `UPROPERTY()` member or it will be garbage-collected.

## Version notes — Substrate materials

UE 5.7 ships with the **Substrate** material framework (opt-in project setting).
Substrate replaces the single shading model and blend mode selectors with a layered
slab-based authoring model. The C++ instance API (`UMaterialInstanceDynamic`,
`Set*ParameterValue`) is unchanged. Some `EMaterialShadingModel` enum values
are Substrate-only (`MSM_Strata`, hidden from the non-Substrate editor). The
`BLEND_TranslucentColoredTransmittance` and `BLEND_ColoredTransmittanceOnly`
blend modes are also Substrate-only. Non-Substrate projects should ignore these.

See [references/material-graph-and-domains.md](references/material-graph-and-domains.md)
for a Substrate overview.

## Cross-references

- `meshes-static-and-skeletal` — assigning materials to mesh components and
  slots; `UStaticMeshComponent::SetMaterial`, skeletal mesh material slots.
- `actors-and-components` — component lifecycle; when to call
  `CreateDynamicMaterialInstance` (after component is registered / in `BeginPlay`).

## References & source material

Engine source (UE 5.7, `Engine/Source/Runtime/Engine/`):
- `Public/Materials/MaterialInterface.h` — `UMaterialInterface`:295.
- `Public/Materials/Material.h` — `UMaterial`:431; `MaterialDomain`:465;
  `BlendMode`:469; `ShadingModel`:494; usage flags from :685.
- `Public/Materials/MaterialInstance.h` — `UMaterialInstance`:626.
- `Public/Materials/MaterialInstanceConstant.h` — `UMaterialInstanceConstant`:20.
- `Public/Materials/MaterialInstanceDynamic.h` — `UMaterialInstanceDynamic`:14;
  `Create`:176; `SetScalarParameterValue`:24; `SetVectorParameterValue`:109;
  `SetTextureParameterValue`:65.
- `Public/Materials/MaterialParameterCollection.h` — `UMaterialParameterCollection`:78.
- `Public/MaterialDomain.h` — `EMaterialDomain`:12 (all domain enum values).
- `Classes/Engine/EngineTypes.h` — `EBlendMode`:244; `EMaterialShadingModel`:704.
- `Classes/Kismet/KismetMaterialLibrary.h` — `UKismetMaterialLibrary`:22;
  `SetScalarParameterValue`:30; `SetVectorParameterValue`:34.
- `Classes/Components/PrimitiveComponent.h` — `SetMaterial`:1517;
  `CreateDynamicMaterialInstance`:1546.

Official docs (UE 5.7):
- Materials overview —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-materials>
- Material Properties (domain, blend mode, shading model) —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-material-properties>
- Instanced Materials (MIC / MID concepts) —
  <https://dev.epicgames.com/documentation/unreal-engine/instanced-materials-in-unreal-engine>
- Material Parameter Collections —
  <https://dev.epicgames.com/documentation/unreal-engine/using-material-parameter-collections-in-unreal-engine>
- Material Functions —
  <https://dev.epicgames.com/documentation/unreal-engine/material-functions-in-unreal-engine>
- Substrate Materials —
  <https://dev.epicgames.com/documentation/unreal-engine/substrate-materials-in-unreal-engine>
- Designing Visuals, Rendering, and Graphics —
  <https://dev.epicgames.com/documentation/unreal-engine/designing-visuals-rendering-and-graphics-with-unreal-engine>

Deep-dive references in this skill:
- [references/material-instances-and-parameters.md](references/material-instances-and-parameters.md) —
  parameter types, MIC vs MID in detail, C++ worked example, index-cache API.
- [references/material-graph-and-domains.md](references/material-graph-and-domains.md) —
  PBR inputs, material functions, static switches, material attributes, custom HLSL,
  Substrate overview.
- [references/material-cpp-and-collections.md](references/material-cpp-and-collections.md) —
  full C++ API reference: `UKismetMaterialLibrary`, `CopyScalarAndVectorParameters`,
  MID gotchas, collection constraints.
