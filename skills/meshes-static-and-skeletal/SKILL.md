---
name: meshes-static-and-skeletal
description: Work with static and skeletal meshes in Unreal C++ — UStaticMesh +
  UStaticMeshComponent, USkeletalMesh + USkeletalMeshComponent + USkinnedMeshComponent,
  instanced meshes (ISM/HISM), material slots (SetMaterial/GetMaterial), sockets
  (static and skeletal), collision setup (UBodySetup, ECollisionTraceFlag, simple vs
  complex), the Skeleton/PhysicsAsset relationship, Nanite enable flag on static and
  skeletal meshes, LODs, and mesh sections. Use when assigning or swapping meshes in
  C++, configuring collision, enabling Nanite, choosing ISM vs HISM vs individual
  components, attaching to mesh sockets, overriding material slots, querying LOD data,
  or debugging missing materials, wrong skeleton, or silent socket attachment failures.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Static & skeletal meshes

Static meshes are rigid geometry rendered via `UStaticMeshComponent`. Skeletal meshes
deform through a bone hierarchy driven by `USkeletalMeshComponent`. Choosing the right
mesh/component type and the right collision, LOD, and instancing strategy drives both
visual quality and runtime performance.

## When to use this skill

- Assigning or swapping mesh assets on components in C++.
- Overriding material slots per-component or creating a `UMaterialInstanceDynamic`.
- Attaching actors/components to named sockets on static or skeletal meshes.
- Configuring collision complexity (`UBodySetup`, `ECollisionTraceFlag`).
- Deciding between `UStaticMeshComponent`, `UInstancedStaticMeshComponent` (ISM), and
  `UHierarchicalInstancedStaticMeshComponent` (HISM) for repeated meshes.
- Enabling Nanite on static or skeletal meshes at runtime or understanding its limits.
- Debugging "no material on slot", "animation won't play", or "silent socket miss".

## Assets vs. components

Every mesh is an **asset** (loaded once) rendered by a **component** (one instance per actor):

| Asset | Component | Use for |
|---|---|---|
| `UStaticMesh` | `UStaticMeshComponent` | Rigid props and environment geometry |
| `USkeletalMesh` | `USkeletalMeshComponent` | Animated/deforming characters and objects |
| `UStaticMesh` | `UInstancedStaticMeshComponent` | Many identical meshes, shared draw call set |
| `UStaticMesh` | `UHierarchicalInstancedStaticMeshComponent` | Same + per-instance culling tree (foliage, large counts) |

The asset holds the geometry, skeleton, and material slot definitions. The component
manages the transform, collision, per-component material overrides, and visibility.

## Setting up mesh components in C++

```cpp
// StaticMesh component on a custom actor
UPROPERTY(VisibleAnywhere)
TObjectPtr<UStaticMeshComponent> Mesh;

// In constructor:
Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
SetRootComponent(Mesh);

// Assign mesh asset (also callable at runtime):
Mesh->SetStaticMesh(MyStaticMesh);       // UStaticMesh*
Mesh->SetMaterial(0, MyMaterial);        // override slot index 0
```

```cpp
// Skeletal mesh component on a custom actor
UPROPERTY(VisibleAnywhere)
TObjectPtr<USkeletalMeshComponent> SkMesh;

// In constructor:
SkMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("SkMesh"));
SetRootComponent(SkMesh);

// Assign mesh asset:
SkMesh->SetSkeletalMesh(MySkeletalMesh);         // USkeletalMesh*
SkMesh->SetAnimInstanceClass(MyAnimBPClass);     // wire animation BP
```

Expose the asset pointer as `UPROPERTY(EditAnywhere) TObjectPtr<UStaticMesh>` so
designers can assign it in the editor without recompiling. For large/rare assets,
prefer a soft reference (`TSoftObjectPtr`) loaded on demand — see `asset-management`.

## Material slots

A mesh divides its geometry into **sections**, each mapped to a named material slot.
`SetMaterial`/`GetMaterial` on any `UMeshComponent` subclass work in terms of slot
**index**, not name.

```cpp
// Override slot 1 with a dynamic material instance:
UMaterialInstanceDynamic* MID =
    UMaterialInstanceDynamic::Create(BaseMaterial, this);
MID->SetScalarParameterValue(TEXT("Glow"), 2.f);
Mesh->SetMaterial(1, MID);

// Query how many slots a component currently exposes:
int32 Count = Mesh->GetNumMaterials();     // UMeshComponent

// Look up a slot index by name (StaticMeshComponent):
int32 Idx = Mesh->GetMaterialIndex(TEXT("Body"));

// Read back the active material on slot 0:
UMaterialInterface* Active = Mesh->GetMaterial(0);
```

Slot defaults are set on the **asset**. Per-component overrides written via
`SetMaterial` take precedence. See `materials-and-shaders` for `UMaterialInterface`
hierarchy and parameter types.

## Sockets

**Sockets** are named attachment points baked into a mesh asset.

- **Static mesh sockets** (`UStaticMeshSocket`) — set in the Static Mesh Editor;
  stored as `FVector RelativeLocation`, `FRotator RelativeRotation`, `FVector RelativeScale`.
- **Skeletal mesh sockets** (`USkeletalMeshSocket`) — parented to a bone; follow
  animation automatically.

```cpp
// Attach a weapon actor to a skeletal socket at runtime:
WeaponActor->AttachToComponent(
    SkMesh,
    FAttachmentTransformRules::SnapToTargetIncludingScale,
    TEXT("hand_r"));   // socket or bone name

// Query a socket's world transform from a static mesh component:
FTransform ST = Mesh->GetSocketTransform(TEXT("MuzzleFlash"));

// Verify the socket exists before attaching (returns nullptr on miss):
if (SkMesh->GetSocketByName(TEXT("hand_r")))
{
    WeaponActor->AttachToComponent(SkMesh,
        FAttachmentTransformRules::SnapToTargetIncludingScale,
        TEXT("hand_r"));
}
```

A missing socket name silently attaches at the component origin — always validate.

## Instanced meshes (ISM / HISM)

For hundreds or thousands of identical meshes (rocks, trees, modular tiles), use
`UInstancedStaticMeshComponent` or its hierarchical subclass instead of spawning
separate actors. One component holds all transforms; the renderer batches them into
a fraction of the draw calls of individual actors.

```cpp
UPROPERTY(VisibleAnywhere)
TObjectPtr<UInstancedStaticMeshComponent> ISMC;

// In constructor:
ISMC = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("ISMC"));
ISMC->SetStaticMesh(RockMesh);
SetRootComponent(ISMC);

// At runtime — add transforms (local space by default):
ISMC->AddInstance(FTransform(FRotator::ZeroRotator, FVector(0, 500, 0)));
ISMC->AddInstance(FTransform(FRotator::ZeroRotator, FVector(0, 1000, 0)));

// Remove or update a specific instance by index:
ISMC->UpdateInstanceTransform(0, NewTransform, /*bWorldSpace=*/false,
                               /*bMarkRenderStateDirty=*/true);
ISMC->RemoveInstance(1);
int32 N = ISMC->GetInstanceCount();
```

Choose ISM vs. HISM based on count and update frequency:

| Factor | ISM | HISM |
|---|---|---|
| Culling | Per-instance on GPU | Hierarchical tree on CPU+GPU |
| Best for | < ~1000 dynamic instances | Thousands of static instances |
| Nanite meshes | Use ISM (Nanite owns culling) | Fallback meshes without Nanite |
| LOD per instance | Now supported in both | Original differentiator of HISM |

Foliage painted via the Foliage tool and PCG-spawned meshes use HISM internally.
See [references/instanced-meshes.md](references/instanced-meshes.md) for per-instance
custom data, `AddInstances` bulk API, and runtime-add workflow.

## Collision

Each static or skeletal mesh carries a `UBodySetup` that defines both **simple**
(convex primitive) and **complex** (per-triangle) collision. The collision-trace flag
controls which geometry is used for which query types:

| `ECollisionTraceFlag` value | Meaning |
|---|---|
| `CTF_UseDefault` | Follow Project Settings default (usually `UseSimpleAsComplex`) |
| `CTF_UseSimpleAndComplex` | Simple for physics simulation; complex for traces |
| `CTF_UseSimpleAsComplex` | Simple geometry answers both physics and trace queries |
| `CTF_UseComplexAsSimple` | Per-triangle mesh answers physics — expensive, static only |

The flag lives on `UBodySetupCore::CollisionTraceFlag` (inherited by `UBodySetup`).
Override per-component collision with `SetCollisionEnabled` / `SetCollisionProfileName`.
Never enable `CTF_UseComplexAsSimple` on simulated bodies — use it only for static
environment geometry that needs accurate trace results.

See [references/materials-lods-collision.md](references/materials-lods-collision.md)
for `UBodySetup` setup, adding convex shapes, and the `physics-and-chaos` cross-ref.

## LODs

- **Static meshes**: author multiple LOD levels in the Static Mesh Editor or use
  automatic LOD generation. `UStaticMeshComponent::ForcedLodModel` (>0) pins a
  specific LOD for debugging.
- **Skeletal meshes**: per-LOD bone reduction and section toggles in the Skeletal
  Mesh Editor. LOD transitions use screen size thresholds.
- **Nanite static meshes**: no traditional LOD required — Nanite streams and renders
  only the visible-pixel detail. Keep a fallback mesh at a reasonable error setting
  for ray tracing and unsupported platforms.

## Nanite

Nanite is enabled per-mesh via `FMeshNaniteSettings::bEnabled` on the `UStaticMesh`
asset. In 5.7 skeletal meshes also expose a Nanite settings panel in the editor.

```cpp
// Enable Nanite on a static mesh asset at runtime (editor / cooking context):
FMeshNaniteSettings Settings = MyStaticMesh->GetNaniteSettings();
Settings.bEnabled = true;
MyStaticMesh->SetNaniteSettings(Settings);
// Note: triggers a rebuild; call from editor utilities, not gameplay code.
```

Nanite supports Opaque and Masked materials; Translucent and two-sided foliage have
per-frame fallback paths. Verify support before relying on Nanite in shipping content.
Ray tracing uses the fallback mesh by default (lower `FallbackRelativeError` for
fidelity). See `nanite-and-rendering` for the full rendering pipeline.

## Skeletal mesh ecosystem

```
USkeletalMesh ──► USkeleton (shared bone hierarchy)
                ──► UPhysicsAsset (ragdoll bodies / constraints)
                ──► USkeletalMeshSocket[] (named attach points on bones)
                ──► FSkeletalMaterial[] (per-section material slots)
```

- Reuse one `USkeleton` across compatible meshes (body, hair, armor) so animation
  sequences are interchangeable without retargeting.
- `UPhysicsAsset` drives ragdoll and physical animation; set with
  `SetPhysicsAsset` on `USkeletalMeshComponent`.
- Modular characters: multiple `USkeletalMeshComponent`s on one actor, each set to
  **Leader Pose Component** (`SetLeaderPoseComponent`) so they all follow the same
  animation without independent skinning cost.

See [references/skeletal-meshes.md](references/skeletal-meshes.md) for the full
ecosystem, leader-pose setup, bone queries, and `animation-system` cross-reference.

## Gotchas

- **Many actors for repeated identical meshes** instead of ISM/HISM — draw call and
  memory blowup. At runtime a primitive uses ~10x more GPU memory than an ISM instance.
- **Complex collision on simulated bodies** — `CTF_UseComplexAsSimple` on a physics
  body causes expensive per-triangle collision and can destabilize simulation.
- **Wrong skeleton** on a skeletal mesh — animations will not apply and may crash;
  check `USkeletalMesh::GetSkeleton()` matches the animation asset's skeleton.
- **Silent socket miss** — attaching to a non-existent socket name attaches at the
  component origin with no error. Call `GetSocketByName` first to validate.
- **Forgot `SetMaterial` slot index** — slot 0 is the first section; mismatched index
  applies the material to the wrong section or is silently ignored.
- **Nanite on unsupported material blend mode** — Translucent materials fall back to
  a default material with a log warning; test in the renderer's Nanite visualization.
- **`SetSkeletalMesh` resets pose** — pass `bReinitPose = false` to preserve the
  current animation state when hot-swapping mesh assets at runtime.
- **ISM materials are component-level** — you cannot set a different material per
  instance; use Per-Instance Custom Data to vary appearance in the material.

## Version notes

- In UE 5.7, `NaniteSettings` on `UStaticMesh` is deprecated for direct access
  (`UE_DEPRECATED(5.7, ...)`). Use `GetNaniteSettings()` / `SetNaniteSettings()`.
- Skeletal mesh Nanite (full Nanite skinning) is production-ready in 5.7 with a single
  draw call per character and Virtual Shadow Map support; animation LODs still apply.
- ISM LOD-per-instance (previously a HISM differentiator) is now also available on ISM
  since 5.3+. HISM retains its hierarchical culling tree advantage for very large static
  instance counts without Nanite.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/`):
- `Engine/Classes/Engine/StaticMesh.h` — `UStaticMesh`, `NaniteSettings`:736,
  `GetNaniteSettings()`:836, `SetNaniteSettings()`:845.
- `Engine/Classes/Engine/SkeletalMesh.h` — `USkeletalMesh`, `GetSkeleton()`:740,
  `GetPhysicsAsset()`:1514, `FindSocket()`:2637, `GetMaterials()`:913.
- `Engine/Classes/Components/StaticMeshComponent.h` — `UStaticMeshComponent`:102,
  `SetStaticMesh()`:431, `GetStaticMesh()`:434, `GetMaterial()`:636,
  `GetSocketByName()`:892.
- `Engine/Classes/Components/SkeletalMeshComponent.h` — `USkeletalMeshComponent`:317,
  `SetSkeletalMesh()`:2052, `SetPhysicsAsset()`:2051, `SetAnimInstanceClass()`:1010.
- `Engine/Classes/Components/SkinnedMeshComponent.h` — `USkinnedMeshComponent`,
  `GetSocketByName()`:1849.
- `Engine/Classes/Components/MeshComponent.h` — `UMeshComponent`, `SetMaterial()`:116,
  `GetMaterial()`:114, `GetNumMaterials()`:113.
- `Engine/Classes/Components/InstancedStaticMeshComponent.h` —
  `UInstancedStaticMeshComponent`:157, `AddInstance()`:261, `RemoveInstance()`:407,
  `UpdateInstanceTransform()`:365, `GetInstanceCount()`:425.
- `Engine/Classes/Components/HierarchicalInstancedStaticMeshComponent.h` — `UHISMC`.
- `Engine/Classes/Engine/EngineTypes.h` — `FMeshNaniteSettings`:3039, `bEnabled`:3045.
- `Engine/Classes/Engine/StaticMeshSocket.h` — `UStaticMeshSocket`:15.
- `Engine/Classes/PhysicsEngine/BodySetup.h` — `UBodySetup`.
- `PhysicsCore/Public/BodySetupCore.h` — `UBodySetupCore`, `CollisionTraceFlag`:37.
- `PhysicsCore/Public/BodySetupEnums.h` — `ECollisionTraceFlag`:10,
  `CTF_UseSimpleAsComplex`:17, `CTF_UseComplexAsSimple`:19.
- `Engine/Classes/PhysicsEngine/PhysicsAsset.h` — `UPhysicsAsset`.

Official docs (UE 5.7, fetched and confirmed):
- Static Meshes — <https://dev.epicgames.com/documentation/unreal-engine/static-meshes>
- Skeletal Mesh assets — <https://dev.epicgames.com/documentation/unreal-engine/skeletal-mesh-assets-in-unreal-engine>
- Instanced Static Mesh Component — <https://dev.epicgames.com/documentation/unreal-engine/instanced-static-mesh-component-in-unreal-engine>
- Nanite Virtualized Geometry — <https://dev.epicgames.com/documentation/unreal-engine/nanite-virtualized-geometry-in-unreal-engine>
- Setting Up Collisions With Static Meshes — <https://dev.epicgames.com/documentation/unreal-engine/setting-up-collisions-with-static-meshes-in-unreal-engine>
- Using Sockets With Static Meshes — <https://dev.epicgames.com/documentation/unreal-engine/using-sockets-with-static-meshes-in-unreal-engine>

Deep-dive references in this skill:
- [references/static-meshes.md](references/static-meshes.md) — asset structure,
  mesh sections, Nanite settings, LOD internals, static sockets.
- [references/skeletal-meshes.md](references/skeletal-meshes.md) — skeleton/physics
  asset relationship, leader-pose component, bone queries, modular characters.
- [references/materials-lods-collision.md](references/materials-lods-collision.md) —
  material slots, `UBodySetup` collision setup, `ECollisionTraceFlag` usage.
- [references/instanced-meshes.md](references/instanced-meshes.md) — ISM vs. HISM
  decision tree, bulk `AddInstances`, per-instance custom data, Nanite interaction.

Related skills: `animation-system`, `materials-and-shaders`, `nanite-and-rendering`,
`physics-and-chaos`, `actors-and-components`, `asset-management`.
