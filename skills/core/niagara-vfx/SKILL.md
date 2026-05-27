---
name: niagara-vfx
description: Create and control visual effects using Unreal's Niagara system — UNiagaraSystem,
  UNiagaraComponent, UNiagaraFunctionLibrary; the system/emitter/module/parameter hierarchy;
  spawning effects at a world location or attached to an actor/socket (SpawnSystemAtLocation,
  SpawnSystemAttached); setting User Parameters from C++ (SetVariableFloat, SetVariableVec3,
  SetVariableActor, SetFloatParameter, SetColorParameter); CPU vs GPU simulation trade-offs;
  Data Interfaces (skeletal mesh, static mesh, collision); component lifetime management
  (bAutoDestroy, Activate/Deactivate, OnSystemFinished); and Niagara Data Channels. Use when
  spawning particle or VFX (fire, smoke, impacts, trails, magic), attaching effects to actors
  or sockets, driving an effect from gameplay parameters, choosing CPU vs GPU emitters, or
  migrating from Cascade (deprecated).
metadata:
  engine-version: "5.7"
  category: vfx-audio
---

# Niagara VFX

Niagara is Unreal's visual-effects system. It replaced **Cascade** (legacy — avoid for new work;
a converter plugin exists). Effects are authored in the Niagara Editor as **Systems** composed of
**Emitters** built from **Modules**, then spawned and parameterized from gameplay C++. Your role
in C++ is: spawn a system, attach it, set its User Parameters, and manage its lifetime.

## When to use this skill

- Spawning particle/VFX at a world location or attached to an actor or socket.
- Driving an effect from gameplay (color, intensity, beam target, spawn rate).
- Choosing between CPU and GPU emitters and budgeting their performance cost.
- Triggering effects from animation notifies or ability system cues.
- Integrating Data Interfaces (skeletal mesh surface, collision, splines).

## System/emitter/module hierarchy

| Level | Asset type | Runtime type | Role |
|---|---|---|---|
| System | `UNiagaraSystem` | `FNiagaraSystemInstance` (internal) | Top-level container; one per "effect" (e.g. `NS_Explosion`) |
| Emitter | `UNiagaraEmitter` | `FNiagaraEmitterInstance` (internal) | One particle behavior set (sparks, smoke, decal); several per system |
| Module | script asset | compiled HLSL | Single behavior (Add Velocity, Curl Noise, Sphere Location) |
| Parameter | `FNiagaraVariable` | `FNiagaraParameterStore` | Typed data (float, vector, bool, actor, DI) flowing through the stack |

Execution flows top-to-bottom within each **stack group**: Emitter Spawn → Emitter Update →
Particle Spawn → Particle Update → Event Handlers → Render. Each stage carries a **namespace**
(System, Emitter, Particle, User, Engine) that controls read/write access.

**User Parameters** live in the User namespace and are the interface between C++ and the effect.
Expose a parameter in the Niagara Editor, then set it at runtime.

Enable the Niagara plugin (on by default) and add `"Niagara"` to your module's `Build.cs`
`PublicDependencyModuleNames` before using the C++ API.

## Spawning from C++

```cpp
#include "NiagaraFunctionLibrary.h"   // UNiagaraFunctionLibrary
#include "NiagaraComponent.h"         // UNiagaraComponent

// Fire-and-forget at a world location. bAutoDestroy=true (default) cleans up after completion.
UNiagaraComponent* Blast = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
    this,           // world-context object
    BlastSystem,    // UPROPERTY(EditAnywhere) TObjectPtr<UNiagaraSystem>
    ImpactLocation,
    ImpactRotation);

// Attached to a component/socket — follows the actor, respects attachment rules.
UNiagaraComponent* Muzzle = UNiagaraFunctionLibrary::SpawnSystemAttached(
    MuzzleSystem, WeaponMesh, TEXT("MuzzleSocket"),
    FVector::ZeroVector, FRotator::ZeroRotator,
    EAttachLocation::SnapToTarget,
    /*bAutoDestroy*/ true);
```

Both functions return a `UNiagaraComponent*` (null if pre-cull check rejects it). Hold it in a
`UPROPERTY` only when you need persistent control; for bursts, let `bAutoDestroy` handle cleanup.

For a persistent looping effect (aura, engine exhaust), create the component yourself:

```cpp
// In actor constructor:
FX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("FX"));
FX->SetupAttachment(GetRootComponent());
FX->SetAsset(AuraSystem);
FX->bAutoActivate = true;

// To toggle:
FX->Activate(/*bReset*/ true);
FX->Deactivate();                // stops emitting, lets existing particles finish
FX->DeactivateImmediate();       // kills particles immediately
```

## Setting User Parameters at runtime

User parameters must be declared in the Niagara System editor (User namespace, exposed). Names
must match exactly (case-sensitive, no namespace prefix needed via the `Set*` helpers):

```cpp
// UFXSystemComponent base-class helpers (inherited by UNiagaraComponent):
FX->SetFloatParameter(TEXT("SpawnRate"),    500.f);
FX->SetColorParameter(TEXT("Color"),        FLinearColor::Red);
FX->SetVectorParameter(TEXT("BeamEnd"),     TargetLocation);
FX->SetActorParameter(TEXT("TargetActor"),  EnemyActor);

// UNiagaraComponent's own typed setters (use FName; preferred in 5.7):
FX->SetVariableFloat(TEXT("Intensity"),     1.5f);
FX->SetVariableVec3(TEXT("WindDir"),        FVector(1, 0, 0));
FX->SetVariableBool(TEXT("bIsActive"),      true);
FX->SetVariableInt(TEXT("BurstCount"),      5);
FX->SetVariableLinearColor(TEXT("BeamColor"), FLinearColor::Blue);
FX->SetVariableActor(TEXT("Target"),        TargetActor);

// Read back a parameter:
bool bValid = false;
float Rate = FX->GetVariableFloat(TEXT("SpawnRate"), bValid);
```

The `SetNiagaraVariable*` string-based variants (e.g. `SetNiagaraVariableFloat`) are deprecated
since 5.3 — use the `SetVariable*` or `Set*Parameter` forms.

## Component lifetime

| Pattern | When to use |
|---|---|
| `bAutoDestroy = true` (default) | One-shot bursts (impacts, hit sparks) — component destroys itself |
| Persistent `UPROPERTY` component | Looping or toggle-able effects (aura, engines) |
| Pool via `ENCPoolMethod` | High-frequency spawning; pool reuse reduces allocation cost |

```cpp
// Subscribe to completion for custom cleanup or chaining:
FX->OnSystemFinished.AddDynamic(this, &AMyActor::OnFXFinished);

UFUNCTION()
void AMyActor::OnFXFinished(UNiagaraComponent* PSystem)
{
    // PSystem is finishing; if bAutoDestroy is false, destroy or return to pool here
}
```

Store persistent `UNiagaraComponent*` pointers in `UPROPERTY` members — bare pointers will be
garbage collected (`memory-and-gc`).

## CPU vs GPU simulation

| Feature | CPU emitters | GPU emitters |
|---|---|---|
| Max particle count | ~tens of thousands | millions |
| Gameplay read-back | yes (position queries, events) | not supported |
| Collision | depth-buffer, distance-field, ray-trace (5.7), or none | distance-field/scene-depth only |
| Per-particle callbacks | yes | no |
| Game-thread cost | scales with count | near-zero on game thread |

Choose **CPU** when gameplay logic needs to read particle data or react to collisions. Choose
**GPU** for massive counts (explosions, rain, ambient particles) where gameplay read-back is
not required. Each emitter in a system chooses independently; a system can mix CPU and GPU
emitters.

## Data Interfaces

Niagara **Data Interfaces** (`UNiagaraDataInterface`, base class in `NiagaraDataInterface.h`)
let emitters sample external data:

- **Skeletal Mesh DI** — emit from surface triangles, bones, or sockets; sample bone positions.
- **Static Mesh DI** — emit from static geometry; environment scatter.
- **Collision Query DI** — distance-field or ray-traced collision per-particle.
- **Curve DI** — sample a float/vector/color curve by time or particle age.
- **Spline DI** — distribute particles along a `USplineComponent`.
- **Texture DI** — sample a 2D texture for position/color masks.
- **Render Target DI** — read or write a `UTextureRenderTarget2D` on the GPU.
- **Niagara Data Channel** (5.3+) — cross-system particle communication via shared channels.

Set a mesh-based DI from C++ using the function library helpers:

```cpp
// Bind a skeletal mesh component to a DI named "BodyMesh":
UNiagaraFunctionLibrary::OverrideSystemUserVariableSkeletalMeshComponent(
    FX, TEXT("BodyMesh"), GetMesh());

// Bind a static mesh component to a DI named "GroundMesh":
UNiagaraFunctionLibrary::OverrideSystemUserVariableStaticMeshComponent(
    FX, TEXT("GroundMesh"), StaticMeshComp);
```

## Triggering from animation / gameplay events

- **Anim Notifies** (`animation-system`) — add a `ANS_PlayNiagaraEffect` notify to a montage
  or animation; it fires `SpawnSystemAttached` for you without C++.
- **Gameplay Cues** (`gameplay-ability-system`) — GAS spawns Niagara effects through `UGameplayCueNotify`
  subclasses; the cue handle targets the right location/effect automatically.
- **Custom events/delegates** — call `SpawnSystemAtLocation` or `Activate` from any `UFUNCTION`
  wired to a delegate.

## Component pool

`UNiagaraFunctionLibrary::SpawnSystemAtLocation` accepts `ENCPoolMethod::AutoRelease` or
`ENCPoolMethod::ManualRelease` to pull from a world-level `UNiagaraComponentPool`. Pooling is
beneficial when the same system is spawned at high frequency (gunshots, footsteps). Avoid pooling
for rare or once-per-level effects.

## Gotchas

- **Parameter name mismatch** → `Set*Parameter`/`SetVariable*` silently no-ops; confirm names
  in the Niagara System editor (User namespace, exposed checkbox).
- **Calling `Set*` before the asset is assigned** → parameters are queued but may not apply;
  set the asset first (`SetAsset()`), then set parameters.
- **Leaked persistent component** — if `bAutoDestroy = false` and nothing destroys the
  component, it accumulates. Bind `OnSystemFinished` or call `DestroyComponent()`.
- **Persistent component not in a `UPROPERTY`** → GC'd mid-effect; store it as a member.
- **GPU emitter with gameplay read-back** — not supported; the game thread cannot read per-GPU-
  particle data. Switch the emitter to CPU, or use `NiagaraDataChannel` for indirect communication.
- **Heavy CPU particle counts** → game-thread cost scales linearly; move to GPU or reduce counts.
  Use `stat Niagara` and the Niagara Debugger for live budgeting.
- **Scalability culling** — `UNiagaraComponent` integrates with the scalability manager; very-
  distant or budget-capped effects are pre-culled and `SpawnSystemAtLocation` returns null.
  Check for null before calling `Set*`.
- **Cascade assets** — `UParticleSystem` and `UParticleSystemComponent` are legacy; new work
  should use Niagara. The Cascade-to-Niagara Converter plugin (editor-only) assists migration.

## Version notes

- `SetNiagaraVariable*` (string overloads) deprecated since 5.3; use `SetVariable*` (FName).
- `GetSystemInstance()` deprecated since 5.0; use `GetSystemInstanceController()`.
- `NiagaraDataChannel` (cross-system communication) introduced in 5.3, expanded in 5.4/5.5.
- Lightweight Emitters (reduced overhead for simple effects) are in active development; see
  the Niagara Lightweight Emitters doc for current status.

## References & source material

Engine source (UE 5.7, `Engine/Plugins/FX/Niagara/Source/Niagara/`):
- `Public/NiagaraComponent.h` — `UNiagaraComponent`: `Activate`:223, `Deactivate`:224,
  `SetFloatParameter`:69, `SetColorParameter`:71, `SetVectorParameter`:70, `SetActorParameter`:72,
  `SetVariableFloat`:520, `SetVariableVec3`:493, `SetVariableActor`:545,
  `SetVariableBool`:538, `SetVariableInt`:529, `OnSystemFinished`:716, `bAutoDestroy`:173,
  `SetAsset`:292, `SetEmitterEnable`:75.
- `Classes/NiagaraSystem.h` — `UNiagaraSystem` (derives `UFXSystemAsset`):234,
  `GetExposedParameters`:364, `GetEmitterHandles`:309.
- `Public/NiagaraFunctionLibrary.h` — `UNiagaraFunctionLibrary`:
  `SpawnSystemAtLocation`:42, `SpawnSystemAttached`:45,
  `OverrideSystemUserVariableSkeletalMeshComponent`:61,
  `OverrideSystemUserVariableStaticMeshComponent`:54.
- `Classes/NiagaraDataInterface.h` — `UNiagaraDataInterface` base class.
- `Classes/NiagaraDataInterfaceSkeletalMesh.h` — `UNiagaraDataInterfaceSkeletalMesh`.
- `Public/NiagaraActor.h` — `ANiagaraActor` (actor wrapper, `SetDestroyOnSystemFinish`).

Official docs (UE 5.7):
- Creating Visual Effects (Niagara) —
  <https://dev.epicgames.com/documentation/unreal-engine/creating-visual-effects-in-niagara-for-unreal-engine>
- Niagara Overview —
  <https://dev.epicgames.com/documentation/unreal-engine/overview-of-niagara-effects-for-unreal-engine>
- Niagara Key Concepts —
  <https://dev.epicgames.com/documentation/unreal-engine/key-concepts-in-niagara-effects-for-unreal-engine>
- Collisions in Niagara —
  <https://dev.epicgames.com/documentation/unreal-engine/collisions-in-niagara-for-unreal-engine>
- Niagara Data Channels —
  <https://dev.epicgames.com/documentation/unreal-engine/data-channels-in-niagara-for-unreal-engine>
- Debugging and Optimization in Niagara —
  <https://dev.epicgames.com/documentation/unreal-engine/debugging-and-optimization-in-niagara-effects-for-unreal-engine>
- Cascade to Niagara Converter Plugin —
  <https://dev.epicgames.com/documentation/unreal-engine/cascade-to-niagara-effects-converter-plugin-for-unreal-engine>

Deep-dive references in this skill:
- [references/system-and-emitter-model.md](references/system-and-emitter-model.md) — full
  system/emitter/module hierarchy, stack groups, namespaces, execution order, and inheritance.
- [references/spawning-and-parameters.md](references/spawning-and-parameters.md) — spawn
  variants, parameter store internals, pooling, and worked example.
- [references/data-interfaces-and-performance.md](references/data-interfaces-and-performance.md) —
  Data Interface catalog, CPU/GPU trade-off details, scalability, and the Niagara Debugger.

Related skills: `animation-system`, `gameplay-ability-system`, `materials-and-shaders`,
`asset-management`, `memory-and-gc`.
