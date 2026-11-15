---
name: ue-gameplay-architecture-planning
description: Design and plan Unreal Engine gameplay systems before implementation. Turns an
  ambiguous feature or game idea into an Unreal-native architecture with explicit ownership,
  lifetime, Actor/Component/UObject/Subsystem choices, Game Framework placement, C++ versus
  Blueprint boundaries, communication and replication flows, data and asset models, trade-off
  analysis, and an ordered implementation plan. Use when brainstorming a new mechanic or system,
  comparing architectural approaches, deciding where logic or state should live, mapping a
  feature across gameplay classes, or preparing a safe task list for an implementation agent.
metadata:
  engine-version: "5.9"
  category: cross-cutting-meta
---

# Gameplay architecture planning

Convert a feature request into a concrete Unreal Engine design before code or asset work begins.
The result should reduce implementation ambiguity without inventing abstractions the project does
not need.

This is an architecture and planning skill, not a mandatory gate. If the user asked only for a
design, stop at the design. If the user also asked for implementation, perform the design pass
briefly and continue within the authorized scope.

## When to use this skill

- Brainstorming a gameplay feature, game system, prototype, or project architecture.
- Deciding between Actor, Component, UObject, Subsystem, Game Framework, or asset-based designs.
- Mapping ownership, lifetime, persistence, authority, replication, and communication.
- Defining the C++/Blueprint boundary and designer-facing asset workflow.
- Comparing viable approaches and producing an ordered implementation plan.

Do not activate it for a localized bug fix or a mechanical edit whose architecture is already
settled.

## The Unreal planning model

Do not translate another engine's scene tree literally. An Unreal design usually spans several
independent structures:

1. **World hierarchy** — Actors and attached Scene Components.
2. **Behavior composition** — Actor Components owned by Actors.
3. **Gameplay ownership** — GameMode, GameState, PlayerController, PlayerState, Pawn/Character,
   and GameInstance.
4. **Services** — Engine, GameInstance, World, and LocalPlayer Subsystems.
5. **Data and assets** — Data Assets, Data Tables, config, soft references, and SaveGame objects.
6. **Communication** — direct calls, interfaces, delegates/Event Dispatchers, Gameplay Messages,
   replicated properties, and RPCs.

Treat these as separate decisions. A feature can have an Actor hierarchy, state owned by a
PlayerState component, definitions stored in Primary Data Assets, and UI notified through a local
delegate at the same time.

Read [references/decision-matrices.md](references/decision-matrices.md) when choosing among these
types or when the feature crosses networking, persistence, UI, or level travel.

## Workflow

### 1. Establish the decision-changing constraints

Inspect the existing project first when it is available. Reuse its modules, base classes,
subsystems, naming, asset patterns, and networking model unless there is a concrete reason to
change them.

Clarify only facts that would materially change the architecture. If safe assumptions allow
progress, state them and continue. High-value questions usually concern:

- Target UE version and platforms.
- Single-player, listen server, dedicated server, or peer-hosted multiplayer.
- Who owns authority and which state every client must observe.
- Whether state survives pawn replacement, level travel, reconnects, or application restarts.
- Expected scale: player count, active instances, update frequency, and world size.
- Whether designers need Blueprint extension, data-only tuning, or runtime authoring.
- Existing framework commitments such as GAS, CommonUI, Gameplay Messages, Mass, or a project
  plugin architecture.

Do not ask for preferences that can be derived from the project or resolved by a clearly superior
default.

### 2. Define responsibilities before selecting classes

Break the feature into responsibilities such as:

- authoritative rules and validation;
- replicated or local runtime state;
- world representation and collision;
- reusable behavior;
- static definitions and designer-authored tuning;
- persistence;
- presentation and UI;
- asynchronous loading or background work.

Give each responsibility one clear owner. Avoid using the same class merely because it is easy to
access globally.

### 3. Compare real alternatives

When multiple approaches are genuinely viable, present two or three. Compare them against the
feature's actual constraints:

- lifetime and ownership fit;
- authority and replication cost;
- coupling and testability;
- Blueprint/design workflow;
- performance and scale;
- save/load and travel behavior;
- implementation complexity and migration cost.

Recommend one option and explain why it wins here. Do not manufacture alternatives when the
correct Unreal pattern is unambiguous.

### 4. Produce the architecture maps

Map the chosen design across the dimensions that apply:

**Responsibility and lifetime map**

| Responsibility | Unreal owner/type | Lifetime | Authority/replication | Reason |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

**Object and component map**

Show Actor ownership and Scene Component attachment as a compact tree. List non-scene UObjects,
Actor Components, Subsystems, widgets, and assets separately so the tree does not imply ownership
that does not exist.

**Communication map**

For every important flow, state sender, receiver, mechanism, payload, authority, and timing. An
RPC crosses the network; a delegate notifies local listeners; a replicated property represents
durable shared state. They are not interchangeable.

**Data map**

Separate immutable definitions, mutable runtime state, replicated state, saved state, and
presentation-only state. Identify hard versus soft asset references when loading behavior matters.

**C++/Blueprint boundary**

Put stable rules, authority checks, replication, reusable primitives, and performance-sensitive
logic in C++. Use Blueprint for composition, presentation, asset assignment, designer extension,
and intentionally exposed events. State the exact extension seams rather than saying "hybrid."

### 5. Sequence implementation as vertical slices

Produce an ordered task list that leaves the project in a coherent, testable state after each
phase. Prefer a thin end-to-end path before breadth.

A useful sequence is:

1. Define data contracts, interfaces, tags, and module/plugin dependencies.
2. Implement the smallest authoritative runtime path.
3. Add one representative asset or Blueprint composition.
4. Connect presentation through a local notification boundary.
5. Add replication and persistence deliberately, if required.
6. Cover failure paths, cleanup, and lifecycle transitions.
7. Add automation, multiplayer PIE scenarios, profiling, and packaging checks proportional to
   risk.

For every task, name the expected files or Unreal asset types, prerequisites, observable result,
and verification. Mark decisions that must be validated in a prototype before downstream work.

## Required output quality

A complete architecture response should contain, when relevant:

1. **Goal, constraints, and assumptions.**
2. **Recommended architecture** in a short decision summary.
3. **Alternatives and trade-offs.**
4. **Responsibility/lifetime and object/component maps.**
5. **Communication, authority, and replication flow.**
6. **Data, asset, persistence, and loading model.**
7. **Explicit C++/Blueprint boundary.**
8. **Ordered implementation plan with verification checkpoints.**
9. **Risks, open decisions, and conditions that would change the recommendation.**

Scale the response to the feature. A small mechanic may need a one-page design; a cross-level
multiplayer system may need all nine sections.

## Architectural guardrails

- Do not turn GameInstance into a global gameplay-state container. It is local and does not
  replicate.
- Do not place durable player state on a Pawn if it must survive death or repossession.
- Do not use GameMode for client-visible state; GameMode exists only on the authority.
- Do not introduce a Subsystem only to avoid passing a reference. Its lifetime must match the
  service it owns.
- Do not make every domain object an Actor. Use Actors for world identity, transform, networking,
  or ticking that genuinely needs world participation.
- Do not use Tick as the default communication mechanism. Prefer events, timers, or explicit
  state transitions.
- Do not use RPCs as local event dispatchers or delegates as network transport.
- Do not duplicate authoritative state in widgets. UI observes gameplay state and derives display
  state.
- Do not recommend GAS, Mass, Gameplay Messages, or a plugin boundary solely because they are
  scalable. Adopt them when their capabilities match demonstrated requirements.
- Do not design only the happy path. Include teardown, unbinding, travel, disconnect, respawn,
  asset-load failure, and authority rejection where applicable.

## Version notes

Target UE 5.8 APIs and terminology. Flag any recommendation that depends on an experimental
plugin or on behavior that differs across UE 5.x. Do not fall back to UE4-era defaults such as
legacy input, PhysX, World Composition, or raw UObject member pointers when the modern UE5 pattern
is relevant.

## Related skills

Use the relevant domain skills to substantiate the final design, especially:
`ue-gameplay-framework`, `ue-actors-and-components`, `ue-subsystems`, `ue-delegates-and-events`,
`ue-networking-and-replication`, `ue-data-driven-design`, `ue-asset-management`, `ue-save-and-load`,
`ue-blueprint-fundamentals`, `ue-blueprint-cpp-integration`, `ue-project-structure`, and
`ue-automation-and-testing`.

## References & source material

UE 5.8 engine source:

- `Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h` — `AActor` world identity,
  lifecycle, ownership, replication, and ticking.
- `Engine/Source/Runtime/Engine/Classes/Components/ActorComponent.h` and
  `Components/SceneComponent.h` — behavior composition versus transform hierarchy.
- `Engine/Source/Runtime/Engine/Classes/GameFramework/GameModeBase.h`, `GameStateBase.h`,
  `PlayerController.h`, `PlayerState.h`, and `Pawn.h` — gameplay ownership and network roles.
- `Engine/Source/Runtime/Engine/Classes/Engine/GameInstance.h` — application and travel lifetime.
- `Engine/Source/Runtime/Engine/Public/Subsystems/Subsystem.h` — subsystem base and lifecycle.
- `Engine/Source/Runtime/Engine/Classes/Engine/DataAsset.h` — `UDataAsset` and
  `UPrimaryDataAsset` definitions.
- `Engine/Source/Runtime/Engine/Classes/GameFramework/SaveGame.h` — persistent save object.
- `Engine/Source/Runtime/Net/Core/Classes/Net/Serialization/FastArraySerializer.h` — delta
  serialization option for replicated collections.

Detailed selection guidance: [references/decision-matrices.md](references/decision-matrices.md).
