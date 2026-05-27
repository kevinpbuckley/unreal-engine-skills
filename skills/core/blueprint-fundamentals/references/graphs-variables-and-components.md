# Blueprint graphs, variables, and components — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers graph types (Event Graph, Functions, Construction
Script, Macros), variable storage and flags, the component model inside a Blueprint, and the
Construction Script's relationship to `OnConstruction`. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/Blueprint.h`,
`Engine/Source/Runtime/Engine/Classes/Engine/SimpleConstructionScript.h`,
`Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h`).

## Graph types and their purposes

A Blueprint can contain multiple graph types. Each type compiles differently.

### Event Graph (Uber-graph)

The Event Graph is a collection of pages (`UBlueprint::UbergraphPages`, `Blueprint.h`:539) that
the compiler merges into a single `UFunction` called the **uber-graph** stored in
`UBlueprintGeneratedClass::UberGraphFunction`. All events — `BeginPlay`, `Tick`, input events,
custom events, and component-bound events — share this merged function, dispatched by a jump
table at the top. The persistent frame that holds local variables across latent calls
(`FPointerToUberGraphFrame`, `BlueprintGeneratedClass.h`:85) lives on each instance.

Execution flow travels along white exec wires. The runtime evaluates pure nodes (no exec pins)
on demand as their outputs are consumed, rather than in a fixed linear order.

### Functions

Function graphs live in `UBlueprint::FunctionGraphs` (`Blueprint.h`:543). Each compiles to a
separate `UFunction` with its own call frame. Functions:

- Can have inputs (parameters) and outputs (return values).
- Can be **pure** (no side effects; no exec pins; evaluated lazily) or **impure** (exec wires in/out).
- Can be declared `const`, `static`, or with `BlueprintCallable`/`BlueprintPure` access from
  other BPs.
- Support local variables scoped to that function call.
- Can override a parent class's `BlueprintCallable` function in child Blueprints.
- Cannot contain latent nodes (use a macro or the Event Graph for latent actions).

### Construction Script

The Construction Script (`UBlueprint::SimpleConstructionScript`, `Blueprint.h`:534) runs during
`AActor::ExecuteConstruction` (`Actor.h`:3442), which calls `OnConstruction(Transform)`
(`Actor.h`:3448). It runs:

- Whenever the actor is **spawned** (including in PIE).
- Whenever a **property is changed** on a placed instance in the editor.
- When the actor is **dragged** in the editor (if `bRunConstructionScriptOnDrag` is set, `Blueprint.h`:448).

This makes the Construction Script the right place for procedural setup that depends on
properties — layout-sensitive component configuration, runtime parameter setup, spawning child
actors. It must be **idempotent** because it can run many times (each property edit triggers a
re-run). Never rely on persistent state accumulated across multiple Construction Script runs.

The SCS is executed via `USimpleConstructionScript::ExecuteScriptOnActor`
(`SimpleConstructionScript.h`:46), which instantiates component templates in the SCS tree and
attaches them. Native (C++) components created in the actor's C++ constructor are already present
when the SCS runs; the SCS components are parented to them per the authored hierarchy.

### Macros

Macro graphs live in `UBlueprint::MacroGraphs` (`Blueprint.h`:551). Unlike functions, macros
are **inlined** at the call site at compile time — the macro graph's nodes are copy-pasted into
the calling graph. Consequences:

- No separate call frame; no function call overhead.
- Can contain multiple exec in/out pins (unlike functions).
- Can contain latent nodes.
- Cannot be overridden in child Blueprints.
- Changes to a macro only take effect when the consuming Blueprint is recompiled.

Macros are best for small shared patterns where inlining is acceptable and overriding is not
needed. Use functions when you need override-ability, targeting across Blueprints, or want a
proper call frame for debugging.

### Blueprint Interfaces

A Blueprint Interface (`BPTYPE_Interface`) defines function signatures with no implementation.
Any Blueprint or C++ class that "implements" the interface must provide the function bodies.
Calling through an interface avoids hard references to specific Blueprint types — the call
resolves to whichever implementation is present at runtime. This is the preferred pattern for
loose coupling between Blueprints (for example, calling `Interact` on whatever object the player
points at, without casting to a specific type).

## Variables

Blueprint variables are stored as `FBPVariableDescription` entries in `UBlueprint::NewVariables`
(in `Blueprint.h`). During compilation, each `FBPVariableDescription` is turned into an
`FProperty` on the `UBlueprintGeneratedClass`. The field flags in `FBPVariableDescription`
(`PropertyFlags`, `Blueprint.h`:227) map directly to `EPropertyFlags` (the same flags used by
`UPROPERTY` specifiers).

Common flag → specifier mappings:

| Blueprint UI label | UPROPERTY specifier | EPropertyFlags bit |
|---|---|---|
| Instance Editable | `EditAnywhere` | `CPF_Edit` |
| Blueprint Read/Write | `BlueprintReadWrite` | `CPF_BlueprintVisible` |
| Blueprint Read Only | `BlueprintReadOnly` | `CPF_BlueprintReadOnly` |
| Expose on Spawn | `ExposeOnSpawn` | `CPF_ExposeOnSpawn` |
| Replicated | `Replicated` | `CPF_Net` |
| Transient | `Transient` | `CPF_Transient` |

Variable **categories** (`FBPVariableDescription::Category`, `Blueprint.h`:219) organize
variables in the Details panel and Blueprint editor. There is no enforcement of category names;
they are purely organizational. The category is serialized and survives Blueprint recompile.

### Local variables

Local variables declared inside a function graph are stack-allocated on the function's call frame
and are not stored in `NewVariables`. They do not appear in the Details panel and have no instance
storage — they exist only for the duration of a single call.

## Components in a Blueprint

The Components panel in the Blueprint editor represents the `USimpleConstructionScript` (SCS)
tree. Each entry corresponds to a `USCS_Node`, which stores a component template and its
attachment parent. When an instance of the Blueprint is created, `ExecuteScriptOnActor` walks
the tree, instantiates each component template via `CreateComponentFromTemplate`, and attaches
it per the authored hierarchy.

Important nuances:

- **Native components** (declared in C++ with `CreateDefaultSubobject`) are created before the
  SCS runs. SCS components can attach to native components by referencing them as parents.
- **Inherited components** from a parent Blueprint can be overridden in a child Blueprint via
  `UInheritableComponentHandler` (stored on `UBlueprintGeneratedClass`). The child's override
  replaces the parent's template at construction time.
- **Component templates** on both `UBlueprint` (editor) and `UBlueprintGeneratedClass` (runtime)
  must stay in sync during compilation. Cooked builds use
  `FBlueprintCookedComponentInstancingData` (one entry per SCS node) for a fast binary instancing
  path that avoids full archetype serialization.
- **Timeline nodes** in the Event Graph compile to `UTimelineTemplate` objects stored in
  `UBlueprintGeneratedClass::Timelines` (`BlueprintGeneratedClass.h`:473). At runtime, each
  timeline becomes a `UTimelineComponent` on the actor.

## Version notes

- The SCS model (`USimpleConstructionScript` / `USCS_Node`) is stable across UE5.
- `bRunConstructionScriptInSequencer` (`Blueprint.h`:453) was added in UE4 and controls CS
  execution during Sequencer playback; it is present and stable in UE 5.7.
- Line numbers cited above are from the UE 5.7 headers; verify with a Grep if a patch release
  shifts them.
