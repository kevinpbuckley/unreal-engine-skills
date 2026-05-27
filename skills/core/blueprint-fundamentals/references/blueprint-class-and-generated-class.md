# Blueprint class and generated class — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `UBlueprint` editor asset, the
`UBlueprintGeneratedClass` runtime class, the skeleton class, the compilation pipeline, and
what the compiled output actually contains. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/Blueprint.h`,
`Engine/Source/Runtime/Engine/Classes/Engine/BlueprintCore.h`,
`Engine/Source/Runtime/Engine/Classes/Engine/BlueprintGeneratedClass.h`) and the official
[Blueprint Compiler Overview](https://dev.epicgames.com/documentation/unreal-engine/compiler-overview-for-blueprints-visual-scripting-in-unreal-engine).

## The two-object split: editor asset vs. runtime class

Every Blueprint involves two cooperating objects:

| Object | Header | Role |
|---|---|---|
| `UBlueprint` | `Engine/Blueprint.h`:402 | Editor-only asset; holds graphs, variable metadata, component templates, compile settings |
| `UBlueprintGeneratedClass` | `Engine/BlueprintGeneratedClass.h`:432 | Runtime `UClass`; contains `FProperty`s, `UFunction`s, component template arrays, timelines |

`UBlueprint` inherits from `UBlueprintCore` (`Engine/BlueprintCore.h`:13), which holds two
critical pointers:

- `SkeletonGeneratedClass` (`BlueprintCore.h`:21) — a lightweight class regenerated on every save
  used by the editor for autocomplete and type resolution. It is incomplete (no bytecode).
- `GeneratedClass` (`BlueprintCore.h`:25) — the fully compiled class used at runtime.

At runtime, only `UBlueprintGeneratedClass` exists (the `UBlueprint` is editor-only data). When
you place or spawn a Blueprint actor, the engine instantiates the `UBlueprintGeneratedClass` just
like any other `UClass`.

## Blueprint types

`EBlueprintType` (`Blueprint.h`:61) enumerates the asset kinds:

| Enum value | Editor name | Purpose |
|---|---|---|
| `BPTYPE_Normal` (`:64`) | Blueprint Class | Standard gameplay class |
| `BPTYPE_LevelScript` (`:72`) | Level Blueprint | Level-wide event graph; one per level |
| `BPTYPE_MacroLibrary` (`:68`) | Blueprint Macro Library | Shared macro graphs, editor-only |
| `BPTYPE_Interface` (`:70`) | Blueprint Interface | Function signatures only (no implementation) |
| `BPTYPE_FunctionLibrary` (`:74`) | Blueprint Function Library | Static utility functions |
| `BPTYPE_Const` (`:65`) | Const Blueprint Class | All methods treated as const; no state mutation |

The `EBlueprintType` is stored in `UBlueprint::BlueprintType` (`Blueprint.h`:416).

## What UBlueprint stores

Key fields of `UBlueprint` (all `WITH_EDITORONLY_DATA` where noted):

- `ParentClass` (`:412`) — the C++ or Blueprint parent this BP derives from.
- `UbergraphPages` (`:539`) — the event graph pages that get merged into a single uber-graph.
- `FunctionGraphs` (`:543`) — user-authored function graphs.
- `MacroGraphs` (`:551`) — macro graphs.
- `SimpleConstructionScript` (`:534`) — the component tree authored in the Components panel.
- `ComponentTemplates` (`:568`) — component template objects (also stored on `UBlueprintGeneratedClass`).
- `bRunConstructionScriptOnDrag` (`:448`) — whether the Construction Script reruns while dragging
  the actor in the editor (can be expensive for heavy scripts).
- `CompileMode` (`:500`) — `EBlueprintCompileMode`: Default, Development, or FinalRelease.

## What UBlueprintGeneratedClass stores

Key fields added by `UBlueprintGeneratedClass` on top of the inherited `UClass`:

- `ComponentTemplates` — actor component templates instantiated during construction.
- `Timelines` — `UTimelineTemplate` objects compiled from Timeline nodes.
- `SimpleConstructionScript` — the SCS tree that `ExecuteScriptOnActor` runs when an instance is created.
- `DynamicBindingObjects` — delegate bindings created by the compiler.
- `NumReplicatedProperties` — cached count for replication system queries.
- `UberGraphFunction` — the single merged `UFunction` that implements all Event Graph logic.

## The compilation pipeline

The Blueprint compiler (`FKismetCompilerContext`, in `Editor/Kismet`) turns the graph data in
`UBlueprint` into a live `UBlueprintGeneratedClass`. The broad steps:

1. **Clean the class** — `CleanAndSanitizeClass()` moves the old class's properties and functions
   to a transient trash class so existing object pointers stay valid while the class is rebuilt.
2. **Create class properties** — iterates `NewVariables` and other sources, calling
   `CreateClassVariablesFromBlueprint()` to produce `UProperty`s on the class scope.
3. **Create function list** — event graphs are merged into a single uber-graph; each event node
   gets a function stub. Regular function graphs get individual `UFunction`s. All pass through
   `PrecompileFunction()`.
4. **Bind and link** — fills property chain, property sizes, and function map; creates the CDO.
5. **Compile functions** — `FKismetCompiledStatement` objects are generated per node and
   translated by `FKismetCompilerVMBackend` into UnrealScript VM bytecode serialized into the
   function's script array.
6. **Copy CDO properties** — values from the old CDO are transferred to the new CDO via
   `CopyPropertiesForUnrelatedObjects()`.
7. **Re-instance** — all existing instances of the class are re-instanced so live objects reflect
   any layout changes.

The "compile in place" design is why a Blueprint's `UBlueprintGeneratedClass` object identity
stays stable across recompiles — pointers to the class don't need to be fixed up after each edit.

## Skeleton vs. generated class

The skeleton class is regenerated on property/function changes without full compilation. It gives
the editor enough type information for pin connections and autocompletion but contains no
bytecode. The generated class (from a full compile) is what actually runs. When you encounter
an "uncompiled Blueprint" warning, it means the generated class may be stale relative to the
current graph state.

## Naming convention

The generated class is named `<BlueprintName>_C`. Its CDO is `Default__<BlueprintName>_C`.
These names appear in log output and are used by redirectors. The pattern is baked into
`UBlueprint::GetBlueprintClassNames()` (`Blueprint.h`:812).

## Version notes

- `UBlueprint` and `UBlueprintGeneratedClass` are stable across UE5. The field layout above is
  from the UE 5.7 headers; line numbers drift across patch releases but class/field names are stable.
- Blueprint nativization (converting BPs to C++) was removed starting in UE 5.0. The
  `EKismetCompileType::Cpp` entry in the compile type enum was also removed at that point.
