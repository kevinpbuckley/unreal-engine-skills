---
name: meshes-static-and-skeletal
description: Work with static and skeletal meshes in Unreal — UStaticMesh vs USkeletalMesh, the
  USkeleton/PhysicsAsset relationship, mesh components (static, skeletal, instanced/HISM), LODs,
  collision (simple vs complex), Nanite for static meshes, material slots, and sockets. Use when
  setting up or assigning meshes in C++, choosing instancing, configuring collision/LODs, or
  deciding static vs skeletal and Nanite vs traditional LODs.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Static & skeletal meshes

Static meshes are rigid geometry; skeletal meshes deform via a skeleton for animation. Picking the
right mesh/component type — and the right collision, LOD, and instancing strategy — drives both
correctness and performance.

## When to use this skill

- Assigning or swapping meshes in C++ / setting up mesh components.
- Choosing instancing for many repeated meshes (foliage, modular kits).
- Configuring collision and LODs, or enabling Nanite.
- Deciding static vs skeletal, and Nanite vs traditional LODs.

## Assets vs components

| Asset | Component | For |
|---|---|---|
| `UStaticMesh` | `UStaticMeshComponent` | rigid props/environment |
| `USkeletalMesh` | `USkeletalMeshComponent` | animated/deforming characters & objects |
| `UStaticMesh` | `UInstancedStaticMeshComponent` (ISM) / `UHierarchicalInstancedStaticMeshComponent` (HISM) | many copies of one mesh, one draw call set |

The **asset** is the data; the **component** places/renders an instance of it on an actor.

## Skeletal mesh ecosystem

- `USkeletalMesh` references a shared **`USkeleton`** (bone hierarchy). Reuse one skeleton across
  compatible meshes so animations are interchangeable (see `animation-system`).
- A **`UPhysicsAsset`** defines collision bodies/constraints for ragdoll and physical animation.
- Skeletal meshes have **sockets** (named attach points relative to bones) for weapons, effects, etc.

## Assigning meshes in C++

```cpp
// Static
UStaticMeshComponent* SMC = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
SMC->SetStaticMesh(MyStaticMesh);                  // UStaticMesh*
SMC->SetMaterial(0, MyMaterialInterface);          // override slot 0

// Skeletal
USkeletalMeshComponent* SK = GetMesh();            // on ACharacter
SK->SetSkeletalMesh(MySkeletalMesh);               // USkeletalMesh*
SK->SetAnimInstanceClass(MyAnimBPClass);           // see animation-system

// Attach to a socket
WeaponMesh->AttachToComponent(SK,
    FAttachmentTransformRules::SnapToTargetIncludingScale, TEXT("hand_r"));
```
Expose the `UStaticMesh*`/`USkeletalMesh*` as `UPROPERTY(EditAnywhere)` (or soft refs for heavy
assets — `asset-management`) so designers assign them.

## Instancing (many identical meshes)

For thousands of repeats (rocks, grass, modular pieces), use ISM/HISM instead of many actors:
```cpp
UInstancedStaticMeshComponent* ISMC = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("ISMC"));
ISMC->SetStaticMesh(RockMesh);
ISMC->AddInstance(FTransform(Location));            // per-instance transforms, batched rendering
```
HISM adds per-instance culling/LOD. For vegetation specifically, the Foliage tools / PCG build on
this (see `landscape-and-foliage`).

## Collision

- **Simple collision**: boxes/spheres/capsules/convex hulls — cheap; used for physics & most queries.
- **Complex collision**: per-triangle from the render mesh — accurate but expensive; for static
  geometry queries, not physics simulation.
- Set via the mesh's Collision Complexity and the component's **Collision Presets**
  (object type + responses). See `physics-and-chaos` for channels/queries.

## LODs and Nanite

- **Traditional LODs**: lower-poly versions swapped by screen size; author or auto-generate.
- **Nanite** (static meshes): virtualized geometry that largely removes the need for manual LODs
  for dense meshes. Enable per-mesh; great for high-poly environment art. Support has expanded
  across 5.x (incl. some skinned/foliage cases) — verify what your 5.7 build supports before
  relying on it, and keep traditional LODs where Nanite doesn't apply.
- Skeletal meshes still use LODs for performance.

## Material slots

A mesh has one or more **material slots** (by section). Assign defaults on the asset; override
per-component with `SetMaterial(SlotIndex, Material)` or a `UMaterialInstanceDynamic`
(`materials-and-shaders`).

## Gotchas

- **Many actors for repeated meshes** instead of ISM/HISM → draw-call/perf blowup.
- **Complex collision for moving/physics objects** → expensive/incorrect; use simple collision.
- **Wrong skeleton** on a skeletal mesh → animations won't apply (see `animation-system`).
- **Forgot to set a material on a slot** → default checkerboard material.
- **Nanite on unsupported cases** (skeletal/translucent) — verify support before enabling.
- **Attaching to a non-existent socket name** silently attaches at the component origin.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Engine/StaticMesh.h`, `Engine/SkeletalMesh.h`.
- `Runtime/Engine/Classes/Components/StaticMeshComponent.h`, `SkeletalMeshComponent.h`.
- `Runtime/Engine/Classes/Animation/Skeleton.h` — `USkeleton`.

Official docs (UE 5.7): Working with Content —
<https://dev.epicgames.com/documentation/unreal-engine/working-with-content-in-unreal-engine>

Related: `importing-content`, `materials-and-shaders`, `animation-system`, `physics-and-chaos`.
