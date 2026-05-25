---
name: blueprint-fundamentals
description: Understand Blueprints as Unreal's visual scripting and asset-class system — what a
  Blueprint class is, the UBlueprint editor asset vs. UBlueprintGeneratedClass runtime class,
  how it relates to its C++ parent, the graph types (Event Graph, Functions, Construction Script,
  Macros, Interfaces), variables and categories, components in Blueprint, and the C++-base +
  Blueprint-subclass workflow. Use when reasoning about Blueprint vs C++ responsibilities,
  designing a class hierarchy that spans both, explaining how Blueprint logic maps onto the
  underlying C++/UObject model, or debugging Blueprint compilation and class-relationship issues.
metadata:
  engine-version: "5.7"
  category: blueprints
---

# Blueprint fundamentals

A **Blueprint** is a `UObject`-derived class authored as an asset. When compiled it produces a
`UBlueprintGeneratedClass` — a fully first-class `UClass` that the engine treats identically to
any C++ class at runtime. Understanding this two-object architecture (editor asset vs. runtime
class) is the foundation for all Blueprint + C++ work.

## When to use this skill

- Deciding what logic belongs in C++ vs. a Blueprint.
- Designing a C++ base class with a Blueprint subclass.
- Reasoning about how Blueprint variables/functions/events correspond to `UPROPERTY`/`UFUNCTION`.
- Explaining Blueprint behavior in terms of the engine's UObject/reflection model.
- Debugging Blueprint compilation errors, reparenting issues, or class-hierarchy problems.

## The two-object split

Every Blueprint has two cooperating objects:

| Object | Header | Role |
|---|---|---|
| `UBlueprint` | `Engine/Blueprint.h`:402 | Editor-only asset; holds graphs, variable metadata, component templates, compile options |
| `UBlueprintGeneratedClass` | `Engine/BlueprintGeneratedClass.h`:432 | Runtime `UClass`; contains `FProperty`s, `UFunction`s, timelines, SCS tree |

`UBlueprint` derives from `UBlueprintCore` (`Engine/BlueprintCore.h`:13), which stores:

- `SkeletonGeneratedClass` (`:21`) — lightweight editor-only class for autocomplete; has no bytecode.
- `GeneratedClass` (`:25`) — the fully compiled runtime class.

At runtime only `UBlueprintGeneratedClass` exists; `UBlueprint` is editor-only. The generated
class is named `<BlueprintName>_C`; its CDO is `Default__<BlueprintName>_C`.

Full details: [references/blueprint-class-and-generated-class.md](references/blueprint-class-and-generated-class.md)

## Blueprint types

`EBlueprintType` (`Blueprint.h`:61) controls which kind of asset is created:

| Type | Enum | Purpose |
|---|---|---|
| Blueprint Class | `BPTYPE_Normal` | Standard gameplay class; has all graph types |
| Level Blueprint | `BPTYPE_LevelScript` | Level-wide event graph; one per level, not reusable |
| Blueprint Interface | `BPTYPE_Interface` | Declares function signatures only (no implementation) |
| Blueprint Macro Library | `BPTYPE_MacroLibrary` | Shared inline macro graphs |
| Blueprint Function Library | `BPTYPE_FunctionLibrary` | Static utility functions callable from any BP |

## Graph types

| Graph | Maps to | Runs when |
|---|---|---|
| **Event Graph** | Uber-graph `UFunction` | Events fire at runtime (BeginPlay, Tick, input, custom) |
| **Functions** | Individual `UFunction`s | Called explicitly; can override parent BPs |
| **Construction Script** | `OnConstruction(Transform)` | Actor spawn + editor property change |
| **Macros** | Inlined at compile time | No separate call frame; evaluated inline |
| **Interfaces** | `UFunction`s via dispatch | Calls routed through interface thunks |

Execution travels along white **exec wires**; data flows along typed colored wires. **Pure nodes**
(no exec pins) have no side effects and are evaluated lazily when their output is consumed.

Functions and macros differ critically: functions get a call frame and support override in child
Blueprints; macros are copy-pasted into the graph at compile time and can have multiple exec
in/out pins plus latent nodes.

Full details: [references/graphs-variables-and-components.md](references/graphs-variables-and-components.md)

## Variables

Blueprint variables compile to `FProperty`s on `UBlueprintGeneratedClass`. Their flags map
directly to `UPROPERTY` specifiers:

| Blueprint flag | UPROPERTY specifier |
|---|---|
| Instance Editable | `EditAnywhere` |
| Blueprint Read/Write | `BlueprintReadWrite` |
| Blueprint Read Only | `BlueprintReadOnly` |
| Expose on Spawn | `ExposeOnSpawn` |
| Replicated | `Replicated` |
| Transient | `Transient` |

**Categories** (the "Category" field) are purely organizational strings — they control grouping
in the Details panel. They have no runtime effect but must be set for any `BlueprintReadWrite`
property to appear in the editor details by default.

Local variables in functions have no instance storage; they exist only on the call stack for the
duration of that function call.

## Components in a Blueprint

The Components panel in the Blueprint editor corresponds to a `USimpleConstructionScript` (SCS)
tree. On actor construction, `USimpleConstructionScript::ExecuteScriptOnActor` (`SimpleConstructionScript.h`:46)
instantiates each component template and attaches it per the authored hierarchy. Native C++
components (created in the actor's C++ constructor) are already present when the SCS runs; SCS
components can parent to them.

Component templates live on both `UBlueprint` (editor templates) and `UBlueprintGeneratedClass`
(runtime templates). Timeline nodes in the Event Graph compile to
`UBlueprintGeneratedClass::Timelines` (`BlueprintGeneratedClass.h`:473) and become
`UTimelineComponent`s on instances.

## The Construction Script

The Construction Script maps to `AActor::OnConstruction(Transform)` (`Actor.h`:3448), called
by `ExecuteConstruction` (`Actor.h`:3442). It runs on:

- Every **actor spawn** (including PIE).
- Every **property edit** on a placed instance in the editor.
- Every editor **drag** (if `bRunConstructionScriptOnDrag`, `Blueprint.h`:448).

Design it to be **idempotent** — it can run many times without accumulating state. Never assume
it runs only once. Expensive world queries or asset loads in the CS slow down property editing.

## C++ base + Blueprint subclass pattern

The idiomatic Unreal architecture:

- **C++ base class** — core logic, replicated state, stable API; exposed with the right specifiers.
- **Blueprint subclass** — designer-facing defaults, asset assignments (meshes, sounds, data
  assets), simple event wiring, per-variant configuration.

Minimal C++ base with Blueprint-facing surface:

```cpp
// WeaponBase.h
UCLASS(Blueprintable, BlueprintType)
class MYGAME_API AWeaponBase : public AActor
{
    GENERATED_BODY()
public:
    // Designer tunes this per-Blueprint variant.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Weapon")
    float Damage = 25.f;

    // Callable node in BP graphs.
    UFUNCTION(BlueprintCallable, Category="Weapon")
    void Fire();

    // C++ calls this; Blueprint provides the visual/audio response.
    UFUNCTION(BlueprintImplementableEvent, Category="Weapon")
    void OnFired();

    // C++ default; Blueprint can override per-variant.
    UFUNCTION(BlueprintNativeEvent, Category="Weapon")
    float GetDamageMultiplier() const;

protected:
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Weapon")
    TObjectPtr<UStaticMeshComponent> Mesh;
};
```

The Blueprint subclass `BP_Rifle` then:
- Sets `Damage`, assigns `Mesh` asset — no C++ recompile needed.
- Implements `OnFired` to play audio/VFX.
- Optionally overrides `GetDamageMultiplier` to return a scope multiplier.

`TSubclassOf<AWeaponBase>` lets designers pick which BP variant to spawn:

```cpp
UPROPERTY(EditAnywhere, Category="Spawning")
TSubclassOf<AWeaponBase> WeaponClass;

// Spawning WeaponClass applies the chosen BP's defaults and Construction Script.
AWeaponBase* W = GetWorld()->SpawnActor<AWeaponBase>(WeaponClass, Transform);
```

Full specifier reference: [references/cpp-blueprint-boundary.md](references/cpp-blueprint-boundary.md)

## Blueprint vs. C++ — choosing

**C++**: performance-critical paths, tight loops, replication internals, large branching systems,
logic needing unit tests, stable base class APIs.

**Blueprint**: per-asset configuration, designer tuning, simple event responses, prototyping,
UI/animation glue, content references (meshes, sounds, curves).

**Avoid**: large deeply nested Blueprint graphs for complex logic — they become unmaintainable,
harder to debug, and slower. Move complex logic to C++ and expose a clean surface.

## Gotchas

- **Logic-heavy Blueprints** — Blueprint VM is slower than C++ for arithmetic and tight loops.
  A single "Tick" Blueprint doing heavy math per frame is a common performance sink.
- **Binary assets don't text-merge** — two people editing the same BP simultaneously will lose
  one set of changes. Keep BPs thin; coordinate edits or split into child BPs.
- **Reparenting a Blueprint** — changing a BP's C++ parent can break node connections if the new
  parent lacks the same properties/functions. Plan hierarchies before shipping.
- **Cast nodes create hard references** — `Cast To BP_Foo` loads `BP_Foo` into memory when the
  casting Blueprint loads. Prefer interfaces or C++ base types for loose coupling. See
  `asset-management` for soft-reference patterns.
- **Tick left on by default** — Blueprint actors have `bCanEverTick = true` by default (unlike
  C++ actors where you opt in). Disable it in Class Defaults for actors that don't need per-frame
  work.
- **Construction Script runs in editor** — world queries, spawning, and gameplay calls don't work
  there. Only use idempotent setup (set component properties, adjust scale, assign materials).
- **Uncompiled Blueprint warning in PIE** — the generated class is stale; changes to graphs since
  last compile are not reflected at runtime. Always compile before testing.

## Version notes

- `TObjectPtr<T>` is the modern idiom (UE5+) for member `UPROPERTY` pointers; raw `T*` still
  works but loses access tracking. See `memory-and-gc`.
- Blueprint nativization (BP → C++ conversion) was removed in UE 5.0. Do not reference it.
- The `UBlueprint` / `UBlueprintGeneratedClass` split, SCS, and graph types are stable across UE5.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/Engine/Classes/Engine/BlueprintCore.h`:13 — `UBlueprintCore`; `SkeletonGeneratedClass`:21,
  `GeneratedClass`:25.
- `Runtime/Engine/Classes/Engine/Blueprint.h`:402 — `UBlueprint`; `EBlueprintType`:61,
  `ParentClass`:412, `UbergraphPages`:539, `FunctionGraphs`:543, `MacroGraphs`:551,
  `SimpleConstructionScript`:534, `bRunConstructionScriptOnDrag`:448.
- `Runtime/Engine/Classes/Engine/BlueprintGeneratedClass.h`:432 — `UBlueprintGeneratedClass`;
  `Timelines`:473, `SimpleConstructionScript`:487, `UberGraphFunction`:496.
- `Runtime/Engine/Classes/Engine/SimpleConstructionScript.h`:17 — `USimpleConstructionScript`;
  `ExecuteScriptOnActor`:46.
- `Runtime/Engine/Classes/GameFramework/Actor.h`:3448 — `OnConstruction(Transform)`;
  `ExecuteConstruction`:3442.
- `Runtime/CoreUObject/Public/UObject/ObjectMacros.h`:950 — `BlueprintImplementableEvent`,
  `BlueprintNativeEvent`:955, `BlueprintPure`:984, `BlueprintCallable`:987.

Official docs (UE 5.7):
- Blueprints Visual Scripting — <https://dev.epicgames.com/documentation/unreal-engine/blueprints-visual-scripting-in-unreal-engine>
- Types of Blueprints — <https://dev.epicgames.com/documentation/unreal-engine/types-of-blueprints-in-unreal-engine>
- Construction Script — <https://dev.epicgames.com/documentation/unreal-engine/construction-script-in-unreal-engine>
- Blueprint Compiler Overview — <https://dev.epicgames.com/documentation/unreal-engine/compiler-overview-for-blueprints-visual-scripting-in-unreal-engine>
- Blueprint Best Practices — <https://dev.epicgames.com/documentation/unreal-engine/blueprint-best-practices-in-unreal-engine>

Deep-dive references in this skill:
- [references/blueprint-class-and-generated-class.md](references/blueprint-class-and-generated-class.md) —
  `UBlueprint` vs. `UBlueprintGeneratedClass`, skeleton class, compilation pipeline, Blueprint types.
- [references/graphs-variables-and-components.md](references/graphs-variables-and-components.md) —
  graph types in depth, variable flags, Construction Script, SCS component model, macros vs. functions.
- [references/cpp-blueprint-boundary.md](references/cpp-blueprint-boundary.md) —
  `UCLASS`/`UPROPERTY`/`UFUNCTION` specifiers for Blueprint exposure, event dispatch, `TSubclassOf`.

Related skills: `blueprint-cpp-integration`, `actors-and-components`, `cpp-fundamentals`,
`asset-management`.
