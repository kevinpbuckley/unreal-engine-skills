# PCG (Procedural Content Generation) — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers PCG graph authoring, custom node
implementation, landscape data queries, runtime generation, and partitioned generation.
Grounded in UE 5.7 (`Engine/Plugins/PCG/Source/PCG/Public/`) and the official
[PCG Framework](https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-framework-in-unreal-engine)
and [PCG Overview](https://dev.epicgames.com/documentation/unreal-engine/procedural-content-generation-overview)
docs.

## Architecture overview

PCG is a shipped plugin (`Engine/Plugins/PCG/`). The data flow:

```
Actor + UPCGComponent ──▶ UPCGGraph (nodes/edges) ──▶ UPCGData outputs
                                                        └── ISM components / Actors (resources)
```

Each node in the graph is a `UPCGNode` with a `UPCGSettings` object that defines the node's
type, properties, and I/O pin types. At execution time, a `UPCGElement` subclass processes
an `FPCGContext` (containing input `UPCGData` collections) and produces outputs.

## Core types

| Type | Path | Notes |
|---|---|---|
| `UPCGComponent` | `PCGComponent.h`:150 | Runs a graph; attached to any actor |
| `UPCGGraph` | `PCGGraph.h`:266 | Editable graph asset (nodes + edges) |
| `UPCGGraphInterface` | `PCGGraph.h`:107 | Abstract; `UPCGGraph` and `UPCGGraphInstance` both implement |
| `UPCGGraphInstance` | `PCGGraph.h`:674 | Graph + local parameter overrides |
| `UPCGNode` | `PCGNode.h` | A node in the graph; has a `UPCGSettings` |
| `UPCGSettings` | `PCGSettings.h` | Defines node type, properties, pin descriptors |
| `UPCGElement` | `PCGElement.h` | Stateless executor; `Execute(FPCGContext*)` produces outputs |
| `UPCGData` | `PCGData.h` | Base for all data flowing through the graph |
| `UPCGPointData` | `Data/PCGPointData.h` | Point cloud — primary per-instance data |
| `UPCGLandscapeData` | `Data/PCGLandscapeData.h` | Landscape surface + layer weights |
| `UPCGManagedResource` | `PCGManagedResource.h` | Wrapper around a generated resource (ISM, actor) |
| `UPCGSubsystem` | (not in Public/) | World subsystem that dispatches graph execution |

## `UPCGComponent` generation lifecycle

```
UPCGComponent::Generate(bForce)       — schedules graph execution (replicated, netmulticast)
UPCGComponent::GenerateLocal(bForce)  — local-only, delayed, not replicated (Blueprint-callable)
UPCGComponent::Cleanup(bRemoveComponents) — destroys all managed resources
UPCGComponent::CleanupLocal(...)          — local-only cleanup
UPCGComponent::CancelGeneration()         — abort in-progress generation
```

**Delegates for completion:**
```cpp
// Registered before calling Generate():
PCGComp->OnGraphGeneratedExternal.AddDynamic(this, &AMyActor::OnPCGGenerated);
PCGComp->OnGraphCleanedExternal.AddDynamic(this, &AMyActor::OnPCGCleaned);
```

**Generation trigger** (`EPCGComponentGenerationTrigger`, `PCGComponent.h`:71):

| Enum | When generation runs |
|---|---|
| `GenerateOnLoad` | Once when the component loads; standard for static content |
| `GenerateOnDemand` | Only when `Generate()` is called explicitly from code/Blueprint |
| `GenerateAtRuntime` | Scheduled by `UPCGSubsystem` runtime scheduler as the player moves |

**Partitioned generation** (`bIsComponentPartitioned = true`): the component is split into
a grid of local PCG components dispatched per World Partition cell. The grid size is set
on the `APCGWorldActor` (or by the graph's Hierarchical Generation setting). Partitioned
generation enables async streaming of generated content alongside the world.

## Landscape data in PCG

`UPCGLandscapeData` (`Data/PCGLandscapeData.h`) is populated by the graph's `Landscape`
input pin when `EPCGComponentInput::Landscape` is set, or via an explicit `Get Landscape
Data` node. It exposes:

- **Height** — Z position at each sample point.
- **Normal / Tangent** — surface normal (controlled by `bGetHeightOnly`; disable to get
  normals, enable for height-only speed optimization).
- **Layer weights** — per-landscape-layer float attributes on each point; enabled by
  `bGetLayerWeights = true` (`FPCGLandscapeDataProps`).
- **Physical material** — surface material per point (`bGetPhysicalMaterial`).
- **GPU sampling** — `bSampleVirtualTextures` uses virtual textures for faster GPU-side
  landscape sampling (requires virtual textures to be baked on the landscape).

Typical pattern — filter scatter points to slope and grass-layer weight:

```
[Landscape Surface Sampler] → [Attribute Filter: Normal.Z > 0.85] →
[Attribute Filter: GrassLayer > 0.5] → [Static Mesh Spawner: Tree mesh]
```

From C++, access landscape data on the component:

```cpp
UPCGData* LandscapeData = PCGComp->GetLandscapePCGData();     // sampled as surface
UPCGData* HeightData    = PCGComp->GetLandscapeHeightPCGData(); // height-only variant
```

## Authoring a custom PCG node (C++)

1. **Settings class** — subclass `UPCGSettings`. Override `GetInputPinProperties`,
   `GetOutputPinProperties`, and `CreateElement()`. Properties on the settings class appear
   in the graph node's Details panel.

2. **Element class** — subclass `UPCGElement`. Implement `Execute(FPCGContext* Context)`.
   The context provides input collections; produce outputs via `Context->OutputData`.

```cpp
// Minimal custom PCG element skeleton (illustrative):
class MYGAME_API UMyScatterSettings : public UPCGSettings
{
    GENERATED_BODY()
public:
    UPROPERTY(EditAnywhere, Category = Settings)
    float MinSlope = 0.f;

    UPROPERTY(EditAnywhere, Category = Settings)
    float MaxSlope = 30.f;

protected:
    virtual TArray<FPCGPinProperties> InputPinProperties() const override;
    virtual TArray<FPCGPinProperties> OutputPinProperties() const override;
    virtual FPCGElementPtr CreateElement() const override;
};

class FMyScatterElement : public FSimplePCGElement
{
protected:
    virtual bool ExecuteInternal(FPCGContext* Context) const override;
};
```

`FSimplePCGElement` provides default loop boilerplate for single-input → single-output
nodes. For multi-input/complex graphs, implement `UPCGElement` directly.

## Runtime generation pattern

For environments that stream at runtime (open world), use `GenerateAtRuntime` with a
partitioned PCG component on a persistent actor. The `UPCGSubsystem` scheduler handles
loading/unloading cells as the player moves.

```cpp
// Setting up a runtime-generating PCG component in C++:
UPROPERTY(VisibleAnywhere)
TObjectPtr<UPCGComponent> PCGComp;

AMyWorldManager::AMyWorldManager()
{
    PCGComp = CreateDefaultSubobject<UPCGComponent>(TEXT("PCGComponent"));
    PCGComp->GenerationTrigger = EPCGComponentGenerationTrigger::GenerateAtRuntime;
    PCGComp->bIsComponentPartitioned = true;
}

void AMyWorldManager::BeginPlay()
{
    Super::BeginPlay();
    if (PCGComp && PCGComp->GetGraph())
    {
        // Runtime scheduler handles generation automatically;
        // manual trigger only needed for on-demand changes:
        PCGComp->NotifyPropertiesChangedFromBlueprint(); // dirty → regenerate
    }
}
```

## Managed resources

PCG tracks every ISM component and spawned actor it creates as a `UPCGManagedResource`
(subclasses: `UPCGManagedComponent`, `UPCGManagedActors`). On `Cleanup()`, all managed
resources are destroyed. If you want to detach generated content from the PCG component
(so `Cleanup` no longer affects it), call `ClearPCGLink(TemplateActorClass)` which moves
managed resources to a new standalone actor.

## Common pitfalls

- **Large-volume synchronous generation** — calling `Generate()` on a 1 km² PCG volume at
  runtime blocks the game thread; use async paths and `GenerateAtRuntime` with the scheduler.
- **Graph parameter type mismatch** — overriding a graph parameter with the wrong type in a
  `UPCGGraphInstance` is silently ignored; verify types match in the graph's parameter
  definitions.
- **Landscape tracking** — if your graph samples a landscape, the component automatically
  tracks landscape changes and regenerates. Disable with `bIgnoreLandscapeTracking` if you
  want to control regeneration manually.
- **No cleanup before re-generate** — calling `Generate()` when the graph is already
  generated appends more resources instead of replacing them; call `Cleanup()` first or
  set `bForce = true`.
- **PCG in packaged builds** — confirm the PCG plugin is added to `.uproject` with
  `"Enabled": true`; it is a shipped plugin but not enabled by default in all templates.

## Key source paths (UE 5.7)

All under `Engine/Plugins/PCG/Source/PCG/Public/`:
- `PCGComponent.h`:150 — `UPCGComponent`; `Generate`:246, `Cleanup`:247,
  `GenerateLocal`:251, `CleanupLocal`:262, `NotifyPropertiesChangedFromBlueprint`:294,
  `GenerationTrigger`:349, `bIsComponentPartitioned`:346,
  `OnGraphGeneratedExternal`:57, `OnGraphCleanedExternal`:58.
- `PCGGraph.h`:266 — `UPCGGraph`; `:107` — `UPCGGraphInterface`; `:674` — `UPCGGraphInstance`.
- `PCGSettings.h` — `UPCGSettings` (node settings base).
- `PCGElement.h` — `UPCGElement`, `FSimplePCGElement`.
- `PCGContext.h` — `FPCGContext` (input/output data collections).
- `Data/PCGLandscapeData.h` — `UPCGLandscapeData`, `FPCGLandscapeDataProps`
  (bGetHeightOnly, bGetLayerWeights, bGetPhysicalMaterial, bSampleVirtualTextures).
- `Data/PCGPointData.h` — `UPCGPointData`.
- `PCGManagedResource.h` — `UPCGManagedResource`.
- `Elements/Landscape/PCGWaitLandscapeReady.h` — utility element for landscape readiness.
