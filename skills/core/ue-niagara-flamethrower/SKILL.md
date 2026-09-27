---
name: ue-niagara-flamethrower
description: Build a continuous flamethrower visual effect in Unreal Engine 5.8 Niagara. Use when making a weapon flame jet, fuel plume, fire breath, or similar nozzle-attached effect with smoke, embers, heat distortion, runtime controls, and gameplay hit detection.
metadata:
  engine-version: "5.8"
  category: vfx-audio
---

# Niagara flamethrower

Use this skill for a sustained flame emitted from a moving muzzle. Use `ue-niagara-vfx` for the general Niagara system, emitter, and component model. This skill covers the design decisions specific to a flame jet: a stable origin, particles that detach into the world, a readable hot core and cooler edges, and a clean boundary between visuals and damage.

Work with the project's existing Niagara systems, materials, textures, meshes, and weapon setup when they fit the request. The layers and parameter names below are design options, not required assets or a required content pack. Create or replace assets only when the user's actual effect calls for them.

## Effect structure

For a layered effect, use separate emitters for the flame body, sparse embers, and smoke when those layers serve the desired look. Add heat distortion only if the project has a suitable material and the target platform can afford it. Tune each included emitter's spawn rate, lifetime, size, color, and scalability budget; a single dense emitter can be hard to tune and expensive to overdraw. A continuous jet needs an indefinitely looping emitter with a spawn rate; a one-shot burst template is only a starting point.

| Layer | Visual purpose | Practical setup |
|---|---|---|
| Hot core | Immediate, directional flame at the nozzle | Short-lived bright sprites with a narrow velocity cone and a high initial speed |
| Outer flame | Broken, turbulent silhouette | Wider cone, varied size and lifetime, animated flame texture, color and alpha over normalized age |
| Embers | Individual sparks that outlive the jet | Low spawn rate, longer lifetime, drag and gravity; avoid a solid wall of sparks |
| Smoke | Cooling and decay | Delayed or offset start, longer lifetime, darker translucent sprites that expand and fade |
| Heat distortion | Air shimmer close to the source | Separate, tightly bounded material layer; disable first on constrained platforms |

Use the system component or emitter origin at the weapon muzzle. Confirm that the emitter's forward axis matches the mesh socket's forward axis. For a moving weapon, particles should spawn at the current nozzle transform and then continue in world space. A local-space emitter makes existing particles rotate and translate with the weapon, which often bends the whole plume unnaturally. A nozzle flash may intentionally use local space as a separate layer.

For an animated flame atlas, set the Sprite Renderer subimage grid to the atlas's actual rows and columns. Drive SubUV Animation over particle age, randomize the starting frame when repeated frames look synchronized, and enable subimage blending when interpolation helps the particular texture. Rotate sprites independently so individual flame cards do not reveal a uniform orientation. These choices depend on the texture already available; no specific atlas is required.

Author the flame's length as a combination of particle speed and lifetime, then tune the spread angle and drag. A narrow cone velocity along the muzzle axis is usually the main directional control. For example, a faster core and slower outer flame produce a bright leading direction with an irregular edge. Use color and size curves over normalized age so particles begin hot and small, broaden, cool, and fade. Add modest random ranges to lifetime, speed, size, and initial rotation so the jet does not repeat visibly. Keep the overall effect legible from the intended gameplay camera before increasing particle count.

Smoke can inherit the flame emitter's basic movement, then diverge: use a translucent material when dark smoke must show against the scene, reduce or recolor its initial tint, offset its spawn region toward the cooling end of the jet, and fade alpha over lifetime. A second, shorter, tighter flame near the nozzle can suggest a hotter core without forcing the whole plume to the same brightness or speed. Sparse embers benefit from their own shape location, drag, curl-noise motion, size curve, and optional brightness flicker. Evaluate each layer in isolation and again with the full system; tune offsets relative to the effect's scale, not to fixed tutorial numbers.

Heat shimmer is primarily a material effect on a restrained sprite layer. A translucent, unlit material can pan a normal map to drive refraction. Mask the scrolling normal toward a neutral normal outside the desired shape so the rectangular sprite edge disappears. Control scroll speed, mask contrast, and refraction strength separately; start subtle because refraction and overlapping transparency are easy to overdo. Align the sprite pivot and size with the heat region, and check it from multiple camera angles. Material setup and renderer support vary by project and target platform, so treat this as an optional visual layer.

Expose only the values gameplay must change as Niagara **User** parameters. Length, width, rate, intensity, and color are common examples, but use the names and types already authored in the project's system. A stop should turn off emission while allowing existing particles to expire; `Deactivate()` provides that behavior for a persistent component. Use `DeactivateImmediate()` only when the existing plume must disappear at once, such as a weapon teardown or teleport cleanup.

## Gameplay integration

Attach one persistent `UNiagaraComponent` to the weapon or character muzzle. Keep it inactive until firing, activate on fire start, and deactivate on fire stop. Avoid spawning a new system every frame while the trigger is held. If the muzzle moves, update attachment or aim at the source, not each already spawned particle. Set user parameters when the relevant gameplay value changes rather than on every tick without need.

Niagara particles are visual state. Resolve damage, range, obstruction, and friendly fire in gameplay code using the weapon's trace, shape sweep, or overlap model. Align that model with the visual cone, but do not assume Niagara GPU collisions are authoritative hit detection. Server-side gameplay should decide hits; clients can run the visual locally from replicated firing state. Make the damage geometry and visual range tunable together so the visible flame does not promise hits beyond its actual reach.

For a C++ component that already exists and has its system asset assigned, the lifecycle is:

```cpp
#include "NiagaraComponent.h"

// Start and stop at fire state transitions, not once per frame.
FlameFX->SetVariableFloat(IntensityParameterName, FuelIntensity); // Match the system's User parameter.
FlameFX->Activate(true);
// On fire stop:
FlameFX->Deactivate();
```

Store the component in a reflected `TObjectPtr<UNiagaraComponent>` member if it is dynamically created and needs persistent control. Add the `Niagara` module dependency in the owning C++ module. For a Blueprint-only weapon, expose the same User parameters and component lifecycle; the effect design is unchanged.

## Collision, bounds, and cost

- Decide whether particle collision serves a visible response. Flame and smoke often look convincing without every particle colliding; embers or ground licking can use collision sparingly. Gameplay damage remains a separate query.
- GPU emitters suit large cosmetic particle counts, but do not depend on reading individual GPU particles back into gameplay. CPU emitters are appropriate when a small number of particles must raise events.
- Set bounds that contain the plume at its maximum supported length and spread. Too-small bounds make it disappear as the camera or weapon moves; oversized bounds hurt culling.
- Budget translucent overdraw at the target camera distance. Reduce large overlapping sprites, shorten unnecessary lifetimes, and apply Niagara scalability/culling before stripping away the shape-defining hot core.
- Compare the effect while starting, holding, sweeping the aim, stopping, and firing close to a wall. A good static preview can reveal seams or lag once attached to a moving weapon.

## References & source material

Verified UE 5.8 source paths under `E:\Program Files\Epic Games\UE_5.8\Engine\`:

- `Plugins/FX/Niagara/Source/Niagara/Public/NiagaraComponent.h` — `UNiagaraComponent`, activation, deactivation, and typed variable setters.
- `Plugins/FX/Niagara/Source/Niagara/Public/NiagaraFunctionLibrary.h` — system spawn and attachment options.
- `Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraSystem.h` — Niagara System asset and exposed parameters.

See the existing `ue-niagara-vfx` skill for emitter architecture, data interfaces, and performance details. Epic's [Niagara effects overview](https://dev.epicgames.com/documentation/unreal-engine/overview-of-niagara-effects-for-unreal-engine) and [Niagara debugging and optimization](https://dev.epicgames.com/documentation/unreal-engine/debugging-and-optimization-in-niagara-effects-for-unreal-engine) provide the general reference.
