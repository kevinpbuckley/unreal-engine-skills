---
name: ue-niagara-mesh-disintegration
description: Build mesh-sampled Niagara dissolve and disintegration effects in Unreal Engine 5.8. Use when particles reproduce a static or animated skeletal mesh, peel away from its surface, or coordinate a material dissolve with particle emission.
metadata:
  engine-version: "5.8"
  category: vfx-audio
---

# Niagara mesh disintegration

Use `ue-niagara-vfx` for component and User parameter integration, `ue-niagara-custom-modules` for nonstandard attribute logic, and `ue-niagara-renderers-and-materials` for particle presentation. This skill covers the transition from intact mesh to particles and back. It does not require a particular character, mesh, noise texture, or material asset.

## Choose a sampling model

For a static mesh, sample surface position and, if useful, normal, color, or UV from the source mesh. For an animated skeletal mesh, sample the skinned pose at the time particles should originate; use a continuing mesh-reproduction update only while particles must remain attached to the animated surface. Confirm the chosen data interface, sampling mode, simulation target, and mesh access requirements in UE 5.8. A texture can provide a spatial mask or color, but first verify that the sampled UVs correspond to the source mesh's UV channel.

Decide whether particles stay on the surface, break away immediately, or detach along a progressing front. Spawn a controlled number of particles in the affected area. A dissolve mask, world-space field, or distance-based front can determine which region emits. Treat distance fields as an optional mask source whose availability and coverage depend on the mesh and project configuration; they are not a universal replacement for skeletal pose sampling.

## Preserve motion after detachment

Mesh reproduction and force modules may both write particle position or velocity. If reproduction runs after forces every update, it can pin particles to the mesh and erase their simulated motion. Keep an attachment weight or detach time per particle and blend from sampled surface position/velocity toward free particle motion. After detachment, let drag, noise, gravity, or directional velocity advance the particle without another unconditional mesh-position write. Check transitions at both slow and fast animation speeds.

## Coordinate material and gameplay state

Drive the source mesh material's dissolve threshold and Niagara's emission region from a shared gameplay progress value, in compatible coordinate spaces. Create a per-instance dynamic material where runtime changes are needed; changing a shared material instance can alter unrelated actors. Assign initial material and Niagara values before the effect becomes visible. At completion, explicitly choose the mesh visibility, collision, and particle cleanup state. For restoration, reverse or reset the material progress and spawning behavior, then restore visibility and collision at the intended point. Handle interruption and actor destruction so a half-dissolved object is not left behind.

The material transition is visual. Gameplay code owns whether the character can move, take damage, or collide throughout the effect; do not derive those rules from Niagara particle count.

## Verification

Test a static object and, where relevant, an animated pose. Inspect the dissolve front from several camera angles, including when the actor moves during the effect. Confirm particle birth aligns with the visible disappearing surface, detached particles keep moving, and replay or restoration starts from clean state.

## References & source material

- UE 5.8 source: `Engine/Plugins/FX/Niagara/Source/Niagara/Internal/DataInterface/NiagaraDataInterfaceStaticMesh.h` (`UNiagaraDataInterfaceStaticMesh`).
- UE 5.8 source: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceSkeletalMesh.h` (`UNiagaraDataInterfaceSkeletalMesh`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Public/Materials/MaterialInstanceDynamic.h` (`UMaterialInstanceDynamic`).
