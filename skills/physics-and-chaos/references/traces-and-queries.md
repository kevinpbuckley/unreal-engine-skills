# Traces and queries — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the full trace/sweep/overlap API,
ByChannel vs ByObjectType, `FCollisionQueryParams`, async traces, UV from hits, and debug
draw helpers. Grounded in UE 5.7 (`Engine/Source/Runtime/Engine/Classes/Engine/World.h`
and `Engine/Source/Runtime/Engine/Public/CollisionQueryParams.h`) and the official
[Traces Overview](https://dev.epicgames.com/documentation/unreal-engine/traces-in-unreal-engine---overview)
doc.

## Query families

The three query families on `UWorld`:

| Family | Methods | Result |
|---|---|---|
| **Line trace** | `LineTraceSingleByChannel`, `LineTraceMultiByChannel`, `LineTraceSingleByObjectType`, `LineTraceMultiByObjectType` | Infinitely thin ray |
| **Sweep** | `SweepSingleByChannel`, `SweepMultiByChannel`, `SweepSingleByObjectType`, `SweepMultiByObjectType` | Shaped volume swept along a path |
| **Overlap** | `OverlapMultiByChannel`, `OverlapMultiByObjectType`, `OverlapBlockingTestByChannel` | All bodies at a point/volume |

`*Single` returns the first blocking hit. `*Multi` returns all overlapping results up to and
including the first blocking hit (for ByChannel) or all matching-type results (for
ByObjectType).

## ByChannel vs ByObjectType

- **ByChannel** uses a trace channel (`ECollisionChannel`) and returns hits from components
  whose response to that channel is `ECR_Block` (Single) or `ECR_Overlap`/`ECR_Block` (Multi).
  Use for gameplay queries like weapon firing, visibility tests, and interaction checks where
  you care about "what stops the trace" rather than the object's type.

- **ByObjectType** takes `FCollisionObjectQueryParams`, a bitmask of object channels. Returns
  any component of those object types, ignoring trace-response filtering. Use to count or
  collect all objects of specific types within a volume.

```cpp
// ByObjectType example — collect all PhysicsBody actors in a sphere
FCollisionObjectQueryParams ObjParams;
ObjParams.AddObjectTypesToQuery(ECC_PhysicsBody);

TArray<FOverlapResult> Overlaps;
GetWorld()->OverlapMultiByObjectType(Overlaps, Center, FQuat::Identity,
    ObjParams, FCollisionShape::MakeSphere(300.f));
```

## FCollisionQueryParams

Declared at `CollisionQueryParams.h`:42. Key fields and methods:

| Field / Method | Default | Purpose |
|---|---|---|
| `bTraceComplex` | `false` | Query per-triangle complex collision (slower; no sim) |
| `bReturnPhysicalMaterial` | `false` | Populate `FHitResult::PhysMaterial` |
| `bReturnFaceIndex` | `false` | Populate `FHitResult::FaceIndex` for UV lookup |
| `AddIgnoredActor(AActor*)` | — | Exclude actor from results |
| `AddIgnoredActors(TArray<AActor*>)` | — | Exclude multiple actors |

```cpp
FCollisionQueryParams Params(SCENE_QUERY_STAT(WeaponTrace), /*bTraceComplex=*/false);
Params.AddIgnoredActor(this);
Params.bReturnPhysicalMaterial = true;   // needed to read SurfaceType from result
```

`SCENE_QUERY_STAT(Name)` is a macro that embeds debug stat tracking into the query at no
cost in shipping builds. Always use it instead of passing a bare `FName`.

## FHitResult fields

`FHitResult` (`Engine/Classes/Engine/HitResult.h`:20) key members:

| Field | Type | Meaning |
|---|---|---|
| `bBlockingHit` | `bool` | True if this is a blocking hit |
| `bStartPenetrating` | `bool` | Trace started inside the shape |
| `Time` | `float` | 0–1 along the trace segment |
| `Distance` | `float` | World-space distance from trace start |
| `Location` | `FVector` | Where the swept shape center would rest |
| `ImpactPoint` | `FVector` | Actual surface contact point |
| `Normal` | `FVector` | Trace-direction normal (swept shapes) |
| `ImpactNormal` | `FVector` | Surface normal at contact |
| `TraceStart` / `TraceEnd` | `FVector` | Original query endpoints |
| `PhysMaterial` | `TWeakObjectPtr<UPhysicalMaterial>` | Surface material (needs `bReturnPhysicalMaterial`) |
| `GetActor()` | `AActor*` | Hit actor |
| `GetComponent()` | `UPrimitiveComponent*` | Hit component |
| `BoneName` | `FName` | Hit bone (skeletal meshes only) |
| `FaceIndex` | `int32` | Face index for UV lookup (needs `bReturnFaceIndex`) |

## Shape types for sweeps

`FCollisionShape` static constructors:

```cpp
FCollisionShape::MakeSphere(float Radius)
FCollisionShape::MakeBox(FVector HalfExtent)
FCollisionShape::MakeCapsule(float Radius, float HalfHeight)
```

For box sweeps pass `FQuat::Identity` unless you need oriented boxes.

## UV coordinates from hit

Enable `Support UV From Hit Results` in Project Settings → Physics, then rebuild. Set
`FCollisionQueryParams::bTraceComplex = true` and `bReturnFaceIndex = true`. Works on Static
Mesh and Procedural Mesh components only (not Skeletal Mesh — Physics Asset doesn't carry UVs).
Read UV via `UGameplayStatics::FindCollisionUV(HitResult, UVChannel, OutUV)`.

## Debug draw helpers

Add draw calls after a trace to visualize results in-editor or in debug builds:

```cpp
DrawDebugLine(GetWorld(), Start, End, FColor::Red, false, 1.f);
if (Hit.bBlockingHit)
{
    DrawDebugSphere(GetWorld(), Hit.ImpactPoint, 10.f, 8, FColor::Green, false, 1.f);
}
```

`DrawDebug*` functions are in `DrawDebugHelpers.h` and stripped in shipping. For persistent
traces, use the visual logger (`FVisualLogger`) or Gameplay Debugger.

## Async traces

`UWorld::AsyncLineTrace*` and `AsyncSweep*` submit queries to the physics thread and invoke
a delegate on completion. Useful to amortize trace cost across frames:

```cpp
FTraceDelegate Delegate;
Delegate.BindUObject(this, &AMyActor::OnTraceComplete);
GetWorld()->AsyncLineTraceByChannel(EAsyncTraceType::Single, Start, End,
    ECC_Visibility, Params, FCollisionResponseParams::DefaultResponseParam, &Delegate);
```

The completion delegate fires on the game thread in the next frame after the physics thread
finishes. Do not read `FHitResult` from a previous frame's async handle after issuing a new
query — race conditions apply if the delegate hasn't fired yet.
