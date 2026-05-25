# Material graph, domains, and authoring concepts — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the material graph structure,
PBR input slots, material functions, static switches, material attributes, the
Custom (HLSL) node, layered materials, and a note on Substrate. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Public/Materials/Material.h`,
`MaterialFunctionInterface.h`, `MaterialDomain.h`) and the official
[Material Properties](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-material-properties)
and [Material Functions](https://dev.epicgames.com/documentation/unreal-engine/material-functions-in-unreal-engine)
docs.

## The material result node (PBR inputs)

Every `UMaterial` has a single root **Material Result** node with input pins.
The set of active pins depends on the chosen domain, shading model, and blend
mode. The primary PBR inputs for `MD_Surface` + `MSM_DefaultLit`:

| Input pin | Data type | Purpose |
|---|---|---|
| Base Color | float3 (RGB) | albedo / diffuse reflectance |
| Metallic | float (0–1) | dielectric (0) to conductor (1) |
| Specular | float (0–1) | non-metal specular adjustment (default 0.5) |
| Roughness | float (0–1) | micro-surface roughness |
| Emissive Color | float3 (HDR) | self-illumination; drives bloom |
| Normal | float3 (tangent-space) | per-pixel normal perturbation |
| World Position Offset | float3 | vertex displacement in world space |
| Opacity / Opacity Mask | float (0–1) | translucency or alpha-cut weight |
| Ambient Occlusion | float (0–1) | static AO baked into mesh or textures |
| Refraction | float | IOR for `BLEND_Translucent` |
| Custom Data 0 / 1 | float | shading-model-specific extra data |

Only `MSM_Unlit` removes lighting calculations entirely (only Base Color and
Emissive are meaningful). Subsurface/SkinProfile models add scatter radius
inputs. Hair and Eye models expose strand/limbus-specific inputs.

## Material domains in depth

`EMaterialDomain` (defined in `Public/MaterialDomain.h`:12) controls what the
material is evaluated for:

- **`MD_Surface`** — the default. Evaluated per-pixel on meshes via the G-buffer
  (deferred) or directly (forward). All PBR inputs apply.
- **`MD_DeferredDecal`** — projected onto surfaces. Blend mode is controlled by
  `DecalBlendMode` (`Material.h`:472), not `BlendMode`. Decals can write to
  specific G-buffer channels.
- **`MD_LightFunction`** — multiplied into a light's output. Only `Emissive Color`
  is used. Attach to a `ULightComponent` as a light function.
- **`MD_PostProcess`** — used by `FPostProcessSettings::AddBlendable`. Reads the
  scene color via `SceneTexture` expressions. Domain must be Post Process.
- **`MD_UI`** — evaluated in screen-space for UMG/Slate widgets. No lighting.
  Only Base Color / Emissive / Opacity are meaningful.
- **`MD_Volume`** — evaluated inside a volume primitive for heterogeneous effects
  (smoke, fire). Pairs with `USparseVolumeTexture` sampling.

Changing domain changes which G-buffer writes and render passes the material
participates in.

## Material functions (`UMaterialFunctionInterface`)

A **Material Function** (`Public/Materials/MaterialFunctionInterface.h`:58) is a
saved subgraph that appears as a single node in any material graph. Use them to:
- Share complex node networks (e.g. a triplanar projection, a Fresnel calculation,
  a PBR blend) across many materials.
- Reduce per-material maintenance — a bug fix in the function propagates to all
  materials using it.
- Abstract advanced HLSL or multi-step math behind a named interface.

Functions expose **FunctionInput** and **FunctionOutput** pins. They are stored as
`.uasset` files and referenced via `Material Functions → Add Function Call` in the
graph. The engine ships with a large library of built-in functions (Blends,
Gradients, Math, Texturing, World Position Offset, etc.).

Source: `Public/Materials/MaterialFunctionInterface.h` — `UMaterialFunctionInterface`:58
(stores the function graph; `GetInputs`, `GetOutputs`).

## Static Switch parameters

A `StaticSwitchParameter` node chooses between two input paths at **compile
time**. The chosen branch is inlined into the shader; the other is eliminated
entirely — zero runtime branch cost.

```
[If TRUE path]  →|
                  StaticSwitch → downstream
[If FALSE path] →|
```

Each unique combination of static parameter values across all child MICs produces
a separate compiled shader variant (permutation). With N independent static
switches you can have up to 2^N permutations. Keep the set of actually-used
combinations small — even a dozen unused permutations waste compile time and disk.

**Static Component Mask Parameter** is a similar node that selects which RGBA
channel(s) to pass through, also resolved at compile time.

## Material attributes — layer-friendly wiring

The `MakeMatAttributes` and `BreakMatAttributes` nodes pack/unpack all surface
input slots into a single `FMaterialAttributes` struct pin. Benefits:
- Pass a full attribute set between material functions in a single wire.
- Use `BlendMaterialAttributes` to lerp between two attribute sets (e.g. dry
  and wet surfaces).
- Required by layered materials (Material Layers) when building layer functions.

Material attributes do not change the compiled output — they are a graph-topology
convenience.

## Custom (HLSL) node

The **Custom** expression node lets you write inline HLSL. Use it for:
- Algorithms with no built-in node equivalents.
- Optimized math that collapses many nodes into fewer instructions.
- Interfacing with custom shader includes (`.ush` files in a plugin's Shaders/
  directory).

Each Custom node input is a named HLSL parameter. The return type matches the
node's output. The code runs inside the pixel shader's generated function and
has access to standard HLSL types but not to global state outside what UE passes
in.

Custom node code is not validated by the material compiler until it is compiled.
Syntax errors produce a compile failure at shader compile time, not at save.

Avoid using Custom nodes for trivial math — node-graph equivalents are better
optimized by the material translator.

## Layered materials and Substrate (UE 5.7)

**Material Layers** (non-Substrate path) allow stacking multiple material
functions, each providing a full attribute set, blended by a Layer Blend function.
This is the predecessor to Substrate.

**Substrate** (opt-in project setting in UE 5.7) replaces the shading model and
blend mode selectors with a physically-based **slab** model. Each slab node
describes one material layer with its own scattering and transmittance properties.
Slabs are combined with operators (over, add, mix). The C++ runtime parameter
API (`UMaterialInstanceDynamic::Set*ParameterValue`) is identical — Substrate
only changes the graph-authoring model, not the instance API.

When Substrate is enabled:
- `EMaterialShadingModel::MSM_Strata` (hidden in non-Substrate mode) becomes
  the active shading model.
- `BLEND_TranslucentColoredTransmittance` and related Substrate-only blend modes
  are exposed.
- Existing non-Substrate materials can be migrated using the provided conversion
  utilities.

For most C++ gameplay code that only calls `Set*ParameterValue`, Substrate is
transparent — the same calls work on either path.

## Shader compilation overview

The material graph is translated to HLSL by the Material Compiler
(`Public/MaterialCompiler.h`). Compilation:
1. The graph is traversed; each expression node emits HLSL code fragments.
2. The translator assembles per-shader-frequency (vertex/pixel/compute) programs.
3. The HLSL is compiled per render backend (D3D12, Vulkan, Metal, etc.) by
   `FShaderCompilerWorker` (offline, asynchronous).
4. Compiled bytecode is stored in the Derived Data Cache (DDC) and on disk in
   the shader cache.

Each unique combination of (base material × static parameter values × enabled
usage flags × target platform) is one shader permutation. The permutation count
multiplies across all dimensions — the biggest practical source of long compile
times.

The **PSO Precache** system (UE 5.4+, present in 5.7) precompiles Pipeline State
Objects at load time instead of on first draw, eliminating in-game hitches.
Materials can opt into precaching via `PSOPrecacheMaterial.h`.
