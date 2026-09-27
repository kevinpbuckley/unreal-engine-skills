---
name: ue-niagara-custom-modules
description: Build Niagara scratch-pad modules and emitter interactions in Unreal Engine 5.8. Use for custom particle attributes, attribute readers, collision-driven secondary effects, texture sampling, or reusable rain and waterfall behaviors.
metadata:
  engine-version: "5.8"
  category: vfx-audio
---

# Niagara custom modules

Use `ue-niagara-vfx` for the system/emitter model. Add a custom module when a built-in module cannot express the required behavior clearly, or when a repeated graph deserves one consistent interface. A scratch-pad module is useful for local exploration; promote stable, shared behavior to a reusable Niagara module only when more than one effect needs it.

## Stage and parameter map

Choose the stage by when the value must change: emitter setup for emitter-level state, Particle Spawn for each new particle, Particle Update for per-frame motion, and an event handler for event-driven secondary particles. Inputs should state units and meaning; outputs should write the intended namespace and attribute. Inspect upstream and downstream writes to the same attribute. Niagara stack order matters: a later module can replace position, velocity, size, or color and make an earlier calculation appear broken.

Keep a custom graph narrow. For example, a follower module can read leader-particle position through a Particle Attribute Reader, combine it with a per-particle offset, and write the follower position. Define the leader emitter binding and behavior when no valid leader exists. Ensure both emitters use compatible simulation targets and that the data is available at the stage where it is read. Do not assume an emitter name, particle ID, or event stream is valid merely because the graph compiles.

## Event-driven secondary effects

For rain splashes or other contact effects, a collision event can spawn a smaller secondary emitter at the contact position. Confirm the selected event handler, source emitter, persistent-ID requirements where applicable, and CPU/GPU support in the current UE version and emitter setup. Bound events per frame and particles per event; dense rain should not create an unbounded splash system. Use collision position and normal to orient a splash or ripple, then let size and opacity decay independently. If GPU simulation or platform constraints make events unsuitable, use an alternate visual method rather than depending on an unsupported event path.

For a waterfall, separate large-scale flowing shape from falling droplets, foam, splashes, and optional caustic or refraction details only where each contributes to the intended view. A moving UV material may carry most of the flow at lower particle cost. Collision-driven accents belong near contact surfaces; their spawn rate should reflect visible water contact, not the entire waterfall area.

Texture sampling is another data source, not a required asset pipeline. Map particle position or authored UV into the texture's coordinate space, sample the intended channel, and decide whether it drives spawn density, color, size, or motion. Verify UV origin, wrapping, filtering, and missing-texture behavior. Prefer a simple analytic mask when it serves the same purpose.

## Verification

Test the module at zero and high spawn rates, with missing inputs and changing emitter transforms. Watch both the written attributes and the rendered result. If particles stop moving after adding a mesh-following or location module, look for a later position or velocity write before retuning forces.

## References & source material

- UE 5.8 source: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraScript.h` (`UNiagaraScript`).
- UE 5.8 source: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceParticleRead.h` (`UNiagaraDataInterfaceParticleRead`).
- UE 5.8 source: `Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraDataInterfaceTexture.h` (`UNiagaraDataInterfaceTexture`).
