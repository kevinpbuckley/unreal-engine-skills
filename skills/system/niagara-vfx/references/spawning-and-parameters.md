# Spawning and parameters — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers all spawn variants, parameter store internals,
soft-reference loading, component pooling, `ANiagaraActor`, and a worked example. Grounded in
UE 5.7 (`Engine/Plugins/FX/Niagara/Source/Niagara/Public/NiagaraFunctionLibrary.h`,
`Public/NiagaraComponent.h`, `Public/NiagaraActor.h`) and the official
[Niagara Overview](https://dev.epicgames.com/documentation/unreal-engine/overview-of-niagara-effects-for-unreal-engine)
doc.

## Spawn function signatures (UE 5.7)

```cpp
// UNiagaraFunctionLibrary — NiagaraFunctionLibrary.h:42
static UNiagaraComponent* SpawnSystemAtLocation(
    const UObject* WorldContextObject,
    UNiagaraSystem* SystemTemplate,
    FVector Location,
    FRotator Rotation        = FRotator::ZeroRotator,
    FVector Scale            = FVector(1.f),
    bool bAutoDestroy        = true,
    bool bAutoActivate       = true,
    ENCPoolMethod PoolingMethod = ENCPoolMethod::None,
    bool bPreCullCheck       = true);

// NiagaraFunctionLibrary.h:45
static UNiagaraComponent* SpawnSystemAttached(
    UNiagaraSystem* SystemTemplate,
    USceneComponent* AttachToComponent,
    FName AttachPointName,
    FVector Location,
    FRotator Rotation,
    EAttachLocation::Type LocationType,
    bool bAutoDestroy,
    bool bAutoActivate       = true,
    ENCPoolMethod PoolingMethod = ENCPoolMethod::None,
    bool bPreCullCheck       = true);

// Overload with explicit scale — NiagaraFunctionLibrary.h:47
static UNiagaraComponent* SpawnSystemAttached(
    UNiagaraSystem* SystemTemplate,
    USceneComponent* AttachToComponent,
    FName AttachPointName,
    FVector Location, FRotator Rotation, FVector Scale,
    EAttachLocation::Type LocationType,
    bool bAutoDestroy,
    ENCPoolMethod PoolingMethod,
    bool bAutoActivate       = true,
    bool bPreCullCheck       = true);
```

`bPreCullCheck = true` allows the scalability manager to reject spawns that are too far away or
would exceed the effect budget — the function returns `nullptr` in that case. Always null-check
the return value before calling `Set*` on it.

## Setting parameters — internals

When you call `FX->SetVariableFloat(TEXT("Intensity"), 1.5f)`, Niagara:

1. Looks up the `FName` in the component's `FNiagaraUserRedirectionParameterStore`
   (`OverrideParameters` member, `NiagaraComponent.h`).
2. If the parameter exists in the system's `ExposedParameters` store
   (`UNiagaraSystem::GetExposedParameters`, `NiagaraSystem.h:364`), writes the value.
3. On the next simulation tick, the value is forwarded into the live system instance's parameter
   store and becomes visible to modules.

Parameters set **before** `Activate()` are applied when the instance starts. Parameters set
**during** execution take effect on the next tick — there is a one-frame latency. If you need
instantaneous effect at spawn, set parameters before calling `Activate(true)` or before passing
the component to a spawn function.

## Parameter types and C++ setters (5.7)

| Niagara type | C++ setter | Notes |
|---|---|---|
| float | `SetVariableFloat(FName, float)` / `SetFloatParameter(FName, float)` | — |
| int32 | `SetVariableInt(FName, int32)` | — |
| bool | `SetVariableBool(FName, bool)` | — |
| Vector2 | `SetVariableVec2(FName, FVector2D)` | — |
| Vector3 | `SetVariableVec3(FName, FVector)` / `SetVectorParameter(FName, FVector)` | — |
| Vector4 | `SetVariableVec4(FName, FVector4)` | — |
| Position | `SetVariablePosition(FName, FVector)` | Large World Coordinates-aware |
| Quaternion | `SetVariableQuat(FName, FQuat)` | — |
| LinearColor | `SetVariableLinearColor(FName, FLinearColor)` / `SetColorParameter` | — |
| Actor | `SetVariableActor(FName, AActor*)` | — |
| Object | `SetVariableObject(FName, UObject*)` | — |
| Material | `SetVariableMaterial(FName, UMaterialInterface*)` | — |
| Static Mesh | `SetVariableStaticMesh(FName, UStaticMesh*)` | — |
| Texture | `SetVariableTexture(FName, UTexture*)` | — |

The `SetNiagaraVariable*` variants (accepting `FString`) are deprecated since 5.3. Use the
`SetVariable*` or `Set*Parameter` forms in all new code.

## Soft references and async loading

Niagara System assets can be large (compiled shaders, meshes). For non-essential effects, prefer
a soft reference to avoid loading at startup:

```cpp
// In your actor header:
UPROPERTY(EditAnywhere)
TSoftObjectPtr<UNiagaraSystem> ExplosionSystemSoft;

// At spawn time (load synchronously if already streaming; otherwise request async):
UNiagaraSystem* Sys = ExplosionSystemSoft.Get();
if (!Sys)
{
    // Use StreamableManager or AsyncLoad; see asset-management skill.
    return;
}
UNiagaraFunctionLibrary::SpawnSystemAtLocation(this, Sys, Location);
```

Hard `UPROPERTY(EditAnywhere) TObjectPtr<UNiagaraSystem>` is fine for effects that are always
loaded (weapons, characters). Use soft refs for rare/world-building effects.

## Component pooling

`ENCPoolMethod` controls pool behavior:

| Value | Behavior |
|---|---|
| `None` | No pooling; allocate and free each time (default, fine for rare effects) |
| `AutoRelease` | Component is returned to the pool automatically on completion |
| `ManualRelease` | You call `ReleaseToPool()` when done; use when timing matters |
| `FreeInPool` | Internal; indicates a component already in the pool |

The pool lives on the `UWorld` as a `UNiagaraComponentPool` subsystem. Pool components must have
`SetUserParametersToDefaultValues()` called before reuse to prevent parameter bleed-through
between instances — the pooling system does this automatically for `AutoRelease` components, but
you are responsible for `ManualRelease` components.

```cpp
// Spawning from the pool:
UNiagaraComponent* FX = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
    this, GunfireSystem, MuzzleLocation, FRotator::ZeroRotator,
    FVector(1.f), true, true, ENCPoolMethod::AutoRelease);
```

## ANiagaraActor

`ANiagaraActor` (`NiagaraActor.h`) is a thin actor wrapper around `UNiagaraComponent`. It is
mainly useful for placing Niagara effects directly in a level and toggling
`bDestroyOnSystemFinish`. In C++, you do not need `ANiagaraActor` — use `UNiagaraComponent`
directly on your gameplay actor, or call `SpawnSystemAtLocation`.

## Worked example: impact effect with gameplay parameters

```cpp
// Called on a hit (e.g. from UDamageType::ApplyDamage or an overlap handler):
void AWeapon::PlayImpactFX(const FHitResult& Hit)
{
    if (!ImpactSystem) return;   // UNiagaraSystem*, UPROPERTY(EditAnywhere)

    UNiagaraComponent* FX = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
        this,
        ImpactSystem,
        Hit.ImpactPoint,
        Hit.ImpactNormal.Rotation(),
        FVector(1.f),
        /*bAutoDestroy*/ true);

    if (!FX) return;  // null if pre-culled by scalability

    FX->SetVariableVec3(TEXT("HitNormal"),  Hit.ImpactNormal);
    FX->SetVariableFloat(TEXT("Damage"),    LastDamageDealt);
    FX->SetVariableLinearColor(TEXT("Color"), SurfaceColor);
}
```

All `SetVariable*` calls after `SpawnSystemAtLocation` take effect on the first simulation tick
(one-frame latency). For effects that are sensitive to the initial parameters, set them before
activation by creating the component manually with `bAutoActivate = false`, setting parameters,
then calling `Activate()`.
