---
name: niagara-vfx
description: Create and drive visual effects with Unreal's Niagara system — systems, emitters, and
  modules; spawning effects in C++ (UNiagaraComponent, UNiagaraFunctionLibrary); setting user/
  system parameters at runtime; CPU vs GPU simulations; and data interfaces. Use when spawning
  particle/VFX (fire, smoke, magic, impacts), attaching effects to actors, parameterizing effects
  from gameplay, or reasoning about VFX performance.
metadata:
  engine-version: "5.7"
  category: vfx-audio
---

# Niagara VFX

Niagara is Unreal's visual-effects system (it replaced Cascade). Effects are authored as
**Systems** composed of **Emitters** built from **Modules**, then spawned and parameterized from
gameplay. Your job from C++ is usually: spawn a system, attach it, set its parameters, and manage
its lifetime.

## When to use this skill

- Spawning particle/VFX at a location or attached to an actor/socket.
- Driving an effect from gameplay (color, intensity, target position, spawn rate).
- Choosing CPU vs GPU simulation; budgeting VFX performance.
- Triggering effects from anim notifies or gameplay events.

## Structure

- **System** (`UNiagaraSystem`) — the whole effect (e.g. `NS_Explosion`); contains emitters.
- **Emitter** — one particle behavior set (sparks, smoke); built from stacked **Modules**
  (Spawn, Initialize, Update, Render).
- **User Parameters** (exposed on the system) — the inputs you set from gameplay.

Enable the **Niagara** plugin (on by default) and add `"Niagara"` to Build.cs to use the C++ API.

## Spawning from C++

```cpp
#include "NiagaraFunctionLibrary.h"
#include "NiagaraComponent.h"

// One-shot at a world location:
UNiagaraComponent* FX = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
    GetWorld(), ExplosionSystem /*UNiagaraSystem*/, Location, Rotation);

// Attached to a component/socket (follows the actor):
UNiagaraComponent* Muzzle = UNiagaraFunctionLibrary::SpawnSystemAttached(
    MuzzleSystem, WeaponMesh, TEXT("Muzzle"), FVector::ZeroVector, FRotator::ZeroRotator,
    EAttachLocation::SnapToTarget, /*bAutoDestroy*/ true);
```
Expose `UNiagaraSystem*` as `UPROPERTY(EditAnywhere)` (or a soft ref for heavy effects —
`asset-management`).

## Setting parameters at runtime

User parameters connect gameplay to the effect:
```cpp
FX->SetFloatParameter(TEXT("SpawnRate"), 200.f);
FX->SetColorParameter(TEXT("Color"), FLinearColor::Red);
FX->SetVectorParameter(TEXT("BeamEnd"), HitLocation);
FX->SetVariableActor(TEXT("Target"), TargetActor);     // via UNiagaraFunctionLibrary helpers too
```
Parameter **names must match** the User Parameters defined in the system. Static (non-component)
helpers exist on `UNiagaraFunctionLibrary` (e.g. `SetVectorParameter`).

## Lifetime

- `bAutoDestroy = true` for fire-and-forget bursts (impacts) — the component cleans itself up after
  the effect completes.
- For persistent/looping effects (an aura, a fire), keep the `UNiagaraComponent*` and call
  `Activate()`/`Deactivate()`/`DestroyComponent()` yourself.
- Created components are UObjects — store persistent ones in a `UPROPERTY` (`unreal-memory-and-gc`).

## CPU vs GPU simulation

- **CPU** emitters: can interact with gameplay (read positions, spawn from gameplay events) and do
  collision via traces; lower particle counts.
- **GPU** emitters: massive counts (millions), but limited collision (distance-field/depth-buffer)
  and no per-particle gameplay callbacks.
Choose per emitter based on count and whether gameplay needs to read back.

## Data interfaces

Niagara **Data Interfaces** let emitters sample external data: static/skeletal meshes (emit from a
surface), spline paths, collision (distance fields), and gameplay-provided arrays. Use these to
make effects follow meshes/skeletons or react to the world.

## Triggering from animation/gameplay

Fire effects at the right moment with **anim notifies** (`animation-system`) for footstep dust or
weapon trails, and from gameplay events for impacts/abilities (`gameplay-ability-system` uses
Gameplay Cues which often spawn Niagara).

## Gotchas

- **Parameter name mismatch** → `Set*Parameter` silently no-ops; match the User Parameter names.
- **Forgetting `bAutoDestroy`** on bursts → leaked components accumulate.
- **GPU emitter expecting CPU-style collision/gameplay readback** — not supported; use CPU.
- **Heavy CPU particle counts** → game-thread cost; move to GPU or reduce counts.
- **Persistent component not stored in a `UPROPERTY`** → GC'd unexpectedly.

## References & source material

Engine source (UE 5.7, `Engine/Plugins/FX/Niagara/Source/Niagara/`):
- `Public/NiagaraComponent.h` — `UNiagaraComponent` (Activate/Deactivate, Set*Parameter).
- `Classes/NiagaraSystem.h` — `UNiagaraSystem`.
- `Public/NiagaraFunctionLibrary.h` — `UNiagaraFunctionLibrary` (Spawn*, Set* statics).

Official docs (UE 5.7): Creating Visual Effects (Niagara) —
<https://dev.epicgames.com/documentation/unreal-engine/creating-visual-effects-in-niagara-for-unreal-engine>

Related: `animation-system`, `gameplay-ability-system`, `materials-and-shaders`.
