---
name: ue-niagara-sequenced-effects
description: Compose timed Niagara portal, impact, beam, projectile, and attack effects in Unreal Engine 5.8. Use when multiple emitters must coordinate anticipation, climax, travel, and dissipation with gameplay events.
metadata:
  engine-version: "5.8"
  category: vfx-audio
---

# Sequenced Niagara effects

Use `ue-niagara-vfx` for spawning, attachment, and User parameters, and `ue-niagara-renderers-and-materials` for sprite, mesh, and ribbon choices. This skill covers temporal composition and gameplay ownership. Effect examples are patterns, not required meshes, textures, or starter content.

## Design the event before the layers

Define the gameplay event and its visible phases: anticipation, action or travel, impact or climax, and decay. Build only the phases the requested effect needs. For a portal, a persistent center plus intermittent debris may be enough; for a hit, a brief contact flash, directional streak, and fading residue may be clearer than many simultaneous emitters. Keep silhouettes, colors, and motion distinct enough that each layer has a purpose.

Place related phases in one Niagara system when they share a trigger and lifecycle. Use emitter start time, loop delay, burst timing, and lifetime to align them. Test the effect at normal game speed and after repeated activation; a delayed flash must still occur when the system is reused. Where timing must coincide with authoritative gameplay, trigger or parameterize Niagara from the gameplay event rather than inferring the event from particle age.

| Effect | Main design decision |
|---|---|
| Impact | Orient to hit normal, vary by surface or hit strength if relevant, and finish quickly. |
| Beam or laser | Establish origin and endpoint ownership; update those inputs as aim moves, and keep collision or damage in gameplay code. |
| Projectile | Let the actor or movement component own trajectory and hit detection; attach travel VFX, then spawn a separate impact effect from the hit result. |
| Large attack | Stagger buildup, peak, and dissipation so the peak reads clearly without keeping every emitter active throughout. |

## Runtime integration

Expose only inputs gameplay actually changes, such as beam endpoints, hit normal, charge, or color. Initialize those inputs before activation or the first simulation tick. If an actor's Niagara component needs spawn-time values, use properties exposed on spawn or deferred actor spawning before `BeginPlay`; assigning them after ordinary `SpawnActor` may arrive too late for its initial effect. Reuse a persistent component for sustained travel or channeling. Spawn short-lived one-shot systems for discrete impacts, and ensure they can complete and clean up.

Location and collision events can coordinate emitters, but check the chosen Niagara simulation target and event support before relying on them. Treat a collision event as visual data, not as the authoritative gameplay hit. Set explicit event budgets and visible fallbacks so dense effects do not cause uncontrolled secondary particle spawning.

## Verification

Check short and long activations, rapid retriggering, moving origin and target, impact on different orientations, and actor destruction before the effect ends. Confirm the peak occurs at the intended event, old particles disappear naturally, and no trail stretches across a teleport or recycled projectile.

## References & source material

- UE 5.8 source: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraSystem.h` (`UNiagaraSystem`).
- UE 5.8 source: `Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraComponent.h` (`UNiagaraComponent`).
- UE 5.8 source: `Engine/Source/Runtime/Engine/Classes/GameFramework/ProjectileMovementComponent.h` (`UProjectileMovementComponent`).
