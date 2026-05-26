# Niagara system/emitter model — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the asset hierarchy, stack groups, namespaces,
execution order, emitter inheritance, and module authoring concepts. Grounded in UE 5.7
(`Engine/Plugins/FX/Niagara/Source/Niagara/Classes/NiagaraSystem.h`,
`Classes/NiagaraEmitterHandle.h`) and the official
[Niagara Key Concepts](https://dev.epicgames.com/documentation/unreal-engine/key-concepts-in-niagara-effects-for-unreal-engine)
and [Niagara Overview](https://dev.epicgames.com/documentation/unreal-engine/overview-of-niagara-effects-for-unreal-engine)
docs.

## Asset hierarchy

```
UNiagaraSystem  (NS_MyEffect.uasset)
 └── FNiagaraEmitterHandle[]   — one handle per emitter in the system
      └── UNiagaraEmitter      — emitter asset (may be shared across systems)
           └── UNiagaraScript[] — one script per stack stage
                └── UNiagaraNodeFunctionCall[] — module graph nodes
```

`UNiagaraSystem::GetEmitterHandles()` returns the handle array. Each `FNiagaraEmitterHandle`
carries a name, enabled flag, and a versioned reference to the `UNiagaraEmitter` asset.
`UNiagaraSystem::GetExposedParameters()` returns the `FNiagaraUserRedirectionParameterStore`
that maps User namespace parameter names to their current values; this is what the C++
`Set*Parameter`/`SetVariable*` calls write into.

At runtime a single `UNiagaraComponent` owns one `FNiagaraSystemInstance` (accessed through
`FNiagaraSystemInstanceController`), which in turn owns one `FNiagaraEmitterInstance` per
emitter in the system.

## Stack groups and execution order

Every emitter's module stack is divided into **groups** (run in this order per frame):

| Group | Stage variants | Runs | Scope |
|---|---|---|---|
| Emitter Spawn | — | Once, on emitter activation | Setup and initial defaults |
| Emitter Update | — | Every frame while emitter is active | Spawn rate, lifetime, burst triggers |
| Particle Spawn | — | Once per new particle | Initialize position, color, size, velocity |
| Particle Update | — | Every frame per alive particle | Forces, drag, color-over-life, size curves |
| Event Handler | Generate / Listen | Conditional; same or next frame | Cross-emitter or particle-to-particle events |
| Render | — | Every frame (render thread) | Defines how particles are drawn |
| Simulation Stage (GPU only) | — | Multiple ordered passes | Fluid, grids, custom iterative algorithms |

Modules within a group run **top-to-bottom** in the stack. Earlier modules write to the
parameter map; later modules can read those values.

## Namespaces and data flow

Niagara uses a namespace scheme so modules know what data they can read or write:

| Namespace | Contents | Readable by | Writable by |
|---|---|---|---|
| `Engine.*` | Time, delta, quality, platform | all | engine only |
| `User.*` | Exposed User Parameters | all | C++ / Blueprint |
| `System.*` | System-level variables | System group, Emitter, Particle | System group only |
| `Emitter.*` | Emitter-level variables | Emitter, Particle groups | Emitter group only |
| `Particle.*` | Per-particle attributes (Position, Velocity, Color, Age…) | Particle group | Particle group only |
| `Output.*` | Renderer inputs | Render group | Particle/Render groups |
| `Transient.*` | Temporary per-module values | same module | same module |

User Parameters (your C++ interface) live in `User.*`. Modules in any group can read User
namespace; no module can write to it (only C++ or Blueprint can via the component API).

## Emitter inheritance

Niagara uses parent/child emitter inheritance: a child emitter can **override** a parent's
module parameters, enable/disable individual modules, add new modules, or revert to the parent
value. This is the preferred alternative to duplicating emitters.

From C++ you can toggle individual emitters within a running system:

```cpp
// Enable or disable a named emitter (e.g. to turn off sparks at end of game):
FX->SetEmitterEnable(TEXT("Sparks"), false);   // NiagaraComponent.h:75
```

The string is the emitter's name as set in the Niagara Editor.

## Lightweight Emitters (5.5+)

Lightweight Emitters are a stripped-down emitter type optimized for simple single-burst effects
(impacts, hit sparks) where the full stack overhead is unnecessary. They have reduced memory and
CPU overhead. In 5.7, Lightweight Emitters support a subset of modules; see the
[Niagara Lightweight Emitters](https://dev.epicgames.com/documentation/unreal-engine/niagara-lightweight-emitters)
doc for current feature coverage.

## Events

Events let one emitter drive another within the same system:

1. A **Generate Event** module in Emitter A writes particle data into an event payload.
2. An **Event Handler** group in Emitter B listens for that event and runs its modules in
   response — either on matching particles, all particles, or by spawning new particles.

Events run on the game thread (CPU emitters only) and are useful for collision ripple effects,
death-burst secondary emitters, and daisy-chained behaviors. Event handlers fire within the same
frame when possible, or in the next frame when ordering constraints prevent same-frame execution.

## Custom modules

Custom modules are authored in the Niagara Script Editor using HLSL nodes, with optional
inline HLSL via `CustomHLSL` nodes. Custom modules compile to HLSL for GPU and to VectorVM
bytecode for CPU. The pattern:

1. Read from the parameter map (inputs declared on the module).
2. Perform math (transforms, noise, physics).
3. Write results back to the parameter map (outputs, including to the `Transient` namespace).
4. Downstream modules in the same group read those transient values.

Modules stack — if two modules write to `Particle.Velocity`, the second **adds** by default
(accumulation model). Use `OutputModule` to finalize and prevent further accumulation.
