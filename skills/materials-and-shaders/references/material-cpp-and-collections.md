# Material C++ API and parameter collections — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the full `UMaterialInstanceDynamic`
C++ API, `UKismetMaterialLibrary` for material parameter collections, per-instance
primitive data, and common runtime gotchas. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Public/Materials/MaterialInstanceDynamic.h`,
`Engine/Source/Runtime/Engine/Classes/Kismet/KismetMaterialLibrary.h`,
`Engine/Source/Runtime/Engine/Public/Materials/MaterialParameterCollection.h`) and the
official [Material Parameter Collections](https://dev.epicgames.com/documentation/unreal-engine/using-material-parameter-collections-in-unreal-engine)
doc.

## UMaterialInstanceDynamic — complete API summary

All methods are game-thread calls. They schedule uniform-buffer updates that
become visible on the render thread at the next frame boundary.

### Parameter setters

```cpp
// Scalar (float)
void SetScalarParameterValue(FName ParameterName, float Value);          // :24
void SetScalarParameterValueByInfo(                                       // :28
    const FMaterialParameterInfo& ParameterInfo, float Value);

// Vector (FLinearColor / 4 floats)
void SetVectorParameterValue(FName ParameterName, FLinearColor Value);   // :109
void SetVectorParameterValue(FName ParameterName, const FVector& Value); // inline
void SetVectorParameterValue(FName ParameterName, const FVector4& Value);// inline
void SetVectorParameterValueByInfo(                                       // :121
    const FMaterialParameterInfo& ParameterInfo, FLinearColor Value);

// Texture
void SetTextureParameterValue(FName ParameterName, UTexture* Value);     // :65
void SetTextureParameterValueByInfo(                                      // :69
    const FMaterialParameterInfo& ParameterInfo, UTexture* Value);

// Double-precision vector (for materials using LWC coordinates)
void SetDoubleVectorParameterValue(FName ParameterName, FVector4 Value); // :117
```

Line numbers reference `MaterialInstanceDynamic.h` in UE 5.7.

### Parameter getters

```cpp
float K2_GetScalarParameterValue(FName ParameterName);                   // :57
FLinearColor K2_GetVectorParameterValue(FName ParameterName);            // :128
UTexture* K2_GetTextureParameterValue(FName ParameterName);              // :85
```

The `K2_` prefix indicates Blueprint-callable variants. In C++ you can call
them directly by name.

### Factory and copy

```cpp
// Create a standalone MID (does not assign to a component slot):
static UMaterialInstanceDynamic* Create(                                 // :176
    UMaterialInterface* ParentMaterial, UObject* InOuter,
    FName Name = NAME_None);

// Fast copy of scalar+vector from another MID or material interface:
void CopyScalarAndVectorParameters(                                       // :202
    const UMaterialInterface& SourceMaterialToCopyFrom,
    EShaderPlatform ShaderPlatform);

// Remove all overridden parameters:
void ClearParameterValues();                                              // :187
```

`CopyScalarAndVectorParameters` is the preferred way to snapshot parameter state
from one MID to another (e.g. for lerp-based material transitions). The overload
taking `ERHIFeatureLevel::Type` is deprecated in 5.7; use the `EShaderPlatform`
version.

### Interpolation

```cpp
// Lerp scalar and vector parameters between two material instances:
void K2_InterpolateMaterialInstanceParams(                                // :144
    UMaterialInstance* SourceA, UMaterialInstance* SourceB, float Alpha);
```

Both sources and the target MID must share the same base material. Alpha is
typically in [0, 1] but extrapolation is allowed.

## Index-cache optimization pattern

Repeated name-based lookup has a small but measurable cost when called many
times per frame (e.g. audio visualizers, procedural animation driving many
parameters). Cache the index after the first set:

```cpp
// Initialization (once, e.g. BeginPlay):
int32 PulseIdx = INDEX_NONE;
MID->InitializeScalarParameterAndGetIndex(TEXT("Pulse"), 0.f, PulseIdx);

// Per-frame (no name lookup):
if (PulseIdx != INDEX_NONE)
    MID->SetScalarParameterByIndex(PulseIdx, AudioAmplitude);
```

Equivalent vector API:
```cpp
bool InitializeVectorParameterAndGetIndex(
    const FName& ParameterName, const FLinearColor& Value, int32& OutParameterIndex);
bool SetVectorParameterByIndex(int32 ParameterIndex, const FLinearColor& Value);
```

Invalidation conditions: the parent material changes, a parameter is added or
removed, or you call `ClearParameterValues`. The index is specific to one MID
instance; do not reuse it on a different MID.

## Creating a MID — three patterns

**Pattern 1 — from a component slot (most common)**

```cpp
// PrimitiveComponent.h:1546
UMaterialInstanceDynamic* MID =
    Mesh->CreateDynamicMaterialInstance(SlotIndex, SourceMaterial);
```

Creates the MID, assigns it to the slot, and returns it. `SourceMaterial` is the
starting parent (can be `nullptr` to use the slot's current material).

**Pattern 2 — standalone, then assign**

```cpp
UMaterialInstanceDynamic* MID =
    UMaterialInstanceDynamic::Create(BaseMat, this);
// … configure parameters …
Mesh->SetMaterial(SlotIndex, MID);   // PrimitiveComponent.h:1517
```

Use this when you need to configure parameters before the MID is visible on a
mesh, or when sharing one MID across multiple components.

**Pattern 3 — from an existing MIC**

```cpp
// Parent a MID on a MIC (inherits all MIC overrides as starting values):
UMaterialInstanceDynamic* MID =
    UMaterialInstanceDynamic::Create(MyMIC, this);
```

The MID starts with all the MIC's parameter overrides and can then diverge at
runtime.

## UMaterialParameterCollection — C++ runtime update

`UKismetMaterialLibrary` (`Classes/Kismet/KismetMaterialLibrary.h`:22) exposes
collection parameter updates to both C++ and Blueprint.

```cpp
#include "Kismet/KismetMaterialLibrary.h"

// Set a scalar parameter in a collection:
UKismetMaterialLibrary::SetScalarParameterValue(  // :30
    WorldContextObject,
    WetnessCollection,          // UPROPERTY TObjectPtr<UMaterialParameterCollection>
    TEXT("GlobalWetness"),
    0.85f);

// Set a vector parameter:
UKismetMaterialLibrary::SetVectorParameterValue(  // :34
    WorldContextObject,
    TODCollection,
    TEXT("SkyColor"),
    FLinearColor(0.4f, 0.6f, 1.f, 1.f));
```

The `WorldContextObject` is typically `this` (any `UObject` that has a world).
The update is applied immediately and propagated to the render thread before the
next draw.

### Collection constraints

- A single `UMaterial` graph can reference **at most two** `UMaterialParameterCollection`
  assets. Exceeding two produces a compile error.
- A collection holds up to **1024 scalar** and **1024 vector** parameters. This
  ceiling is per-asset, not per-material reference.
- **Adding or removing a parameter** from a collection triggers a re-shader-compile
  on all materials that reference it. Add parameters in bulk in an empty test
  map and don't restructure a collection in production.
- **Renaming a parameter** breaks Blueprint references to that parameter (they
  show as "broken" nodes), but C++ `FName`-based lookups still resolve by new
  name. Verify both sides after a rename.
- Collection updates are **not replicated** — set values independently on each
  machine or replicate the source data and drive the collection locally.

## Per-primitive custom data (alternative to MID for instanced meshes)

For `UInstancedStaticMeshComponent` and `UHierarchicalInstancedStaticMeshComponent`,
creating one MID per instance is prohibitively expensive. Instead, the material
can use `GetCustomPrimitiveData` or read per-instance float data stored via
`SetCustomPrimitiveDataFloat`:

```cpp
// Store 4 floats per instance at index 0:
ISMComp->SetCustomPrimitiveDataFloat(InstanceIndex, 0, MyValue);
```

In the material graph, a `PerInstanceCustomData` node reads these values.
This keeps a single MID for the entire ISM while allowing per-instance variation.
See the [Storing Custom Data Per Primitive](https://dev.epicgames.com/documentation/unreal-engine/storing-custom-data-in-unreal-engine-materials-per-primitive)
doc for setup details.

## Common runtime mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| MID not in a `UPROPERTY()` | MID garbage-collected mid-play; component shows default material | Add `UPROPERTY()` to the member |
| Calling `CreateDynamicMaterialInstance` twice on same slot | First MID silently abandoned; second overrides | Cache the returned pointer; call once |
| Setting parameters before `BeginPlay` | Component not yet registered; slot material may not be assigned | Defer to `BeginPlay` or `PostInitializeComponents` |
| Wrong parameter name (typo/case) | Set call silently no-ops | Verify exact `FName` spelling against material graph |
| Modifying a MIC at runtime | `Set*EditorOnly` functions missing outside editor | Create a MID instead |
| Setting parameters from a non-game thread | Undefined behavior / crash in render thread | Enqueue on game thread via `AsyncTask` or check `IsInGameThread()` |
