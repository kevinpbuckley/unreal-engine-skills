# Materials, LODs, and collision — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers material slot mechanics, LOD
configuration, `UBodySetup` collision geometry, and `ECollisionTraceFlag` in detail.
Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Components/MeshComponent.h`,
`Engine/Source/Runtime/PhysicsCore/Public/BodySetupCore.h`,
`Engine/Source/Runtime/PhysicsCore/Public/BodySetupEnums.h`,
`Engine/Source/Runtime/Engine/Classes/PhysicsEngine/BodySetup.h`).

## Material slots in depth

Every `UMeshComponent` subclass inherits `SetMaterial` / `GetMaterial` from
`UMeshComponent` (lines 114-116):

```cpp
virtual UMaterialInterface* GetMaterial(int32 ElementIndex) const;
virtual void SetMaterial(int32 ElementIndex, UMaterialInterface* Material);
virtual void SetMaterialByName(FName MaterialSlotName, UMaterialInterface* Material);
virtual int32 GetNumMaterials() const;
```

The `OverrideMaterials` array (line 31, type `TArray<TObjectPtr<UMaterialInterface>>`)
stores per-component overrides. Slot indices where no override is set fall through to
the asset's default materials. Setting an override to `nullptr` resets that slot to
the asset default.

```cpp
// Reset slot 0 to the asset default:
Mesh->SetMaterial(0, nullptr);

// Verify how many slots exist before iterating:
for (int32 i = 0; i < Mesh->GetNumMaterials(); ++i)
{
    UMaterialInterface* M = Mesh->GetMaterial(i);
    // M may still be null if the asset has no default set for this slot
}
```

### UMaterialInstanceDynamic (MID)

`UMaterialInstanceDynamic` lets you change scalar, vector, and texture parameters at
runtime without spawning a new material draw call for each:

```cpp
UMaterialInstanceDynamic* MID =
    UMaterialInstanceDynamic::Create(BaseMaterial, Mesh);
MID->SetScalarParameterValue(TEXT("Roughness"), 0.2f);
MID->SetVectorParameterValue(TEXT("Albedo"), FLinearColor::Red);
Mesh->SetMaterial(0, MID);
```

Create MIDs in `BeginPlay` or on demand, not in the constructor (requires a world
context). One MID per mesh is the norm; if many components need independent parameter
values, create one MID per component (do not share mutable MIDs between components).

See `materials-and-shaders` for the full `UMaterialInterface` hierarchy, parameter
caching, and `CreateDynamicMaterialInstance` shortcut on the component itself.

## LOD configuration

### Static meshes

LODs are stored as `FStaticMeshSourceModel[]` on the `UStaticMesh` asset. The active
LOD is selected per frame from the screen-size metric computed by the renderer from
the component's bounds.

Key per-component LOD knobs on `UStaticMeshComponent`:

| Property | Type | Effect |
|---|---|---|
| `ForcedLodModel` | `int32` | 0 = auto; N = force LOD N-1 (1-based) |
| `MinLOD` | `int32` | Lowest LOD ever selected automatically |

Setting `ForcedLodModel = 1` pins the highest-quality LOD — useful for cinematics or
test renders. Leave at 0 in shipping.

### Skeletal meshes

Skeletal LODs strip bones, merge sections, and reduce polygon count per distance
threshold. Configure thresholds in the Skeletal Mesh Editor's LOD Settings panel or
link a shared `USkeletalMeshLODSettings` asset for consistent settings across
character variants.

### Per-platform LOD bias

The project-wide `r.StaticMeshLODDistanceScale` CVar scales LOD transition distances
globally. Per-platform LOD bias in Project Settings offsets the LOD index — positive
values use simpler LODs earlier (mobile), negative values keep higher-quality LODs.

## UBodySetup and collision geometry

### Class hierarchy

```
UBodySetupCore (PhysicsCore/Public/BodySetupCore.h)
  └─ UBodySetup  (Engine/Classes/PhysicsEngine/BodySetup.h)
       └─ USkeletalBodySetup (per-bone, skeletal meshes)
```

`UBodySetupCore` owns the key fields agents need:

| Field | Type | Meaning |
|---|---|---|
| `CollisionTraceFlag` | `TEnumAsByte<ECollisionTraceFlag>` | Simple vs. complex policy |
| `BoneName` | `FName` | Associated bone (skeletal only) |
| `PhysicsType` | `TEnumAsByte<EPhysicsType>` | Simulated / kinematic / default |

`UBodySetup` adds the actual geometry via `FKAggregateGeom AggGeom` (aggregate of
spheres, boxes, capsules, convex hulls) and a cooked complex triangle mesh.

### ECollisionTraceFlag

Declared in `PhysicsCore/Public/BodySetupEnums.h`:10:

| Enum value | Value | When to use |
|---|---|---|
| `CTF_UseDefault` | 0 | Follow Project Settings default |
| `CTF_UseSimpleAndComplex` | 1 | Physics uses simple; traces use complex |
| `CTF_UseSimpleAsComplex` | 2 | Simple geometry answers all queries (default for most meshes) |
| `CTF_UseComplexAsSimple` | 3 | Per-triangle mesh for all queries — static only |

`CTF_UseComplexAsSimple` makes the render mesh answer physics queries. This is only
suitable for static (non-simulated) environment geometry where accurate per-triangle
traces are needed (e.g. rocky terrain the player walks on). Enabling it on a
simulated rigid body causes expensive per-triangle collision and is unsupported by
Chaos physics.

### Setting collision in C++

You rarely build `UBodySetup` geometry in gameplay code — the asset pipeline handles
it. At runtime you typically change the **component's** collision settings:

```cpp
// Fully disable all collision:
Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

// Switch to a preset profile:
Mesh->SetCollisionProfileName(TEXT("BlockAll"));

// Fine-grained: respond to a specific channel:
Mesh->SetCollisionResponseToChannel(ECC_Pawn, ECR_Ignore);

// Enable/disable query-only (no physics sim, but traces work):
Mesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
```

For instanced meshes, collision is a **component-level** property — you cannot vary
collision per instance.

### Adding simple collision at runtime (editor/cooking context)

```cpp
// Add a convex hull element to a static mesh's BodySetup (editor utility context):
UBodySetup* BS = MyStaticMesh->GetBodySetup();
BS->AggGeom.ConvexElems.AddDefaulted();
FKConvexElem& Convex = BS->AggGeom.ConvexElems.Last();
Convex.VertexData = /* your vertex list */;
Convex.UpdateElemBox();
BS->InvalidatePhysicsData();
BS->CreatePhysicsMeshes();
```

Never call `CreatePhysicsMeshes()` during gameplay; it stalls the game thread for
cooking. Cook during editor import or at build time.

## Collision presets and channels

Collision presets (Blocking, Overlap, Query-only, etc.) are defined in
`DefaultEngine.ini` under `[/Script/Engine.CollisionProfile]`. Use
`SetCollisionProfileName` to apply named presets rather than setting every channel
individually. See `physics-and-chaos` for trace channels, `FHitResult`, and overlap
event setup.

## Version notes

- `GetMaterialRelevance(ERHIFeatureLevel::Type)` is deprecated in 5.7; use
  `GetMaterialRelevance(EShaderPlatform)` instead.
- Chaos (the physics engine since 5.0) evaluates `CTF_UseComplexAsSimple` differently
  from the legacy PhysX path; test collision complexity settings after migrating from
  UE4.
