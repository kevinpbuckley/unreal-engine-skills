---
name: blueprint-fundamentals
description: Understand Blueprints as Unreal's visual scripting and asset-class system — what a
  Blueprint class is, how it relates to its C++ parent, the graph types (Event Graph, Functions,
  Construction Script), variables and components, and the C++-base + Blueprint-subclass workflow.
  Use when reasoning about Blueprint vs C++ responsibilities, designing a class hierarchy that
  spans both, or explaining how Blueprint logic maps onto the underlying C++/UObject model.
metadata:
  engine-version: "5.7"
  category: blueprints
---

# Blueprint fundamentals

A **Blueprint** is a `UObject` class authored as an asset instead of in C++. It compiles to a
`UBlueprintGeneratedClass` that behaves like any other `UClass`. Understanding how Blueprints map
onto the C++/UObject model lets you decide what belongs in C++ vs. a Blueprint and design clean
hierarchies that span both.

## When to use this skill

- Deciding what should be C++ vs. a Blueprint.
- Designing a class that has a C++ base and a Blueprint subclass.
- Reasoning about how Blueprint variables/functions/events correspond to UPROPERTY/UFUNCTION.
- Explaining Blueprint behavior in terms of the underlying engine objects.

## What a Blueprint actually is

- A Blueprint asset defines a **new class** deriving from a parent (often a C++ class like
  `ACharacter`, or another Blueprint). On compile it produces a `UBlueprintGeneratedClass`.
- Blueprint **variables** are `FProperty`s (the same reflection system as `UPROPERTY`).
- Blueprint **functions/events** are `UFunction`s; Blueprint can implement C++ `BlueprintImplementableEvent`/
  `BlueprintNativeEvent` functions and call any `BlueprintCallable` C++ function.
- A Blueprint can add **components** and set **default values** on inherited properties.

So a Blueprint is not a separate runtime — it's data + bytecode for a normal `UClass`, fully
interoperable with C++.

## Graph types

| Graph | Purpose |
|---|---|
| **Event Graph** | event-driven logic (`BeginPlay`, `Tick`, input, custom events) |
| **Functions** | reusable, collapsible logic with inputs/outputs (can be pure or impure) |
| **Construction Script** | runs in-editor and on spawn to build/configure the actor (maps to C++ `OnConstruction`) |
| **Macros** | inline graph snippets (no separate call frame) |
| **Interfaces** | implement a Blueprint/C++ interface's functions |

Execution flow runs along the white **exec** wires; data flows along typed colored wires. Pure
nodes (no exec pins) are evaluated on demand.

## Variables, components, defaults

- Variables have a type, default value, category, and flags (Instance Editable = `EditAnywhere`,
  Expose on Spawn, Replicated, etc.) that mirror `UPROPERTY` specifiers.
- The **Components** panel composes scene/actor components (same model as `actors-and-components`),
  with a Blueprint-set hierarchy and per-component defaults.
- **Class Defaults** set values for inherited C++/Blueprint properties without code.

## The intended workflow: C++ base + Blueprint subclass

The idiomatic Unreal pattern (and what these skills assume):
- **C++** holds logic, performance-critical code, replicated state, and the stable API
  (functions/events/properties exposed with the right specifiers).
- **Blueprint subclass** sets designer-facing defaults, assigns asset references (meshes, sounds,
  input assets, data assets), and wires light, iteration-heavy logic and visuals.

This gives programmers a testable, versionable core and designers fast iteration, while keeping
binary-merge-unfriendly Blueprint assets thin. See `blueprint-cpp-integration` for the exact
specifiers that expose C++ to Blueprints.

## Blueprint vs C++ — choosing

- **C++**: heavy computation, tight loops, networking/replication internals, large/branching
  systems, anything needing unit tests or precise control, base classes.
- **Blueprint**: per-asset configuration, designer tuning, simple event responses, prototyping,
  UI/animation glue, content references.
- **Avoid**: large, deeply nested Blueprint graphs for complex logic — move that to C++ and expose
  a clean surface.

## How Blueprint calls relate to C++

- Blueprint can call any `UFUNCTION(BlueprintCallable/BlueprintPure)`.
- Blueprint can override `BlueprintNativeEvent`/implement `BlueprintImplementableEvent`.
- Blueprint can read/write `UPROPERTY(BlueprintReadWrite)` and read `BlueprintReadOnly`.
- C++ can call into Blueprint-implemented events by calling the C++ function (the engine routes to
  the Blueprint implementation) or via interfaces.

## Gotchas

- **Logic-heavy Blueprints** become unmaintainable and slower than C++; refactor into C++.
- **Blueprint assets are binary** — they don't text-merge; keep them thin and coordinate edits
  (see `unreal-project-structure`).
- **Reparenting** a Blueprint to a different C++ base can break node connections — plan hierarchies.
- **Casting nodes** that hard-reference other Blueprints create asset dependencies (load cost);
  prefer interfaces or C++ base types to decouple.
- **Tick in Blueprints** is easy to leave on accidentally — prefer events/timers.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Engine/Blueprint.h` — `UBlueprint` (the editor asset).
- `Runtime/Engine/Classes/Engine/BlueprintGeneratedClass.h` — `UBlueprintGeneratedClass` (the runtime class).
- `Runtime/Engine/Classes/Kismet/GameplayStatics.h` — common Blueprint-callable statics.

Related: `blueprint-cpp-integration`, `actors-and-components`, `unreal-cpp-fundamentals`.
Official docs (UE 5.7): Blueprints Visual Scripting —
<https://dev.epicgames.com/documentation/unreal-engine/blueprints-visual-scripting-in-unreal-engine>
