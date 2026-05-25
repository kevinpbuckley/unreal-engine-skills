# Material instances and parameters — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the MIC vs MID distinction in
detail, every parameter type, the C++ creation and assignment API, and the
index-cache optimization. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Public/Materials/MaterialInstanceDynamic.h`,
`MaterialInstanceConstant.h`, `MaterialInstance.h`) and the official
[Instanced Materials](https://dev.epicgames.com/documentation/unreal-engine/instanced-materials-in-unreal-engine)
doc.

## MIC vs MID — when to use each

| | `UMaterialInstanceConstant` (MIC) | `UMaterialInstanceDynamic` (MID) |
|---|---|---|
| Created | Content Browser, saved as `.uasset` | C++ / Blueprint at runtime |
| Parameters changeable at runtime | No (`EditorOnly` setters only) | Yes |
| Shader compiled | Shared with parent — only once | Same shader; no recompile |
| Lifetime | Asset; managed by asset system | Object; must hold in `UPROPERTY` |
| Use for | Art variants (color, texture swap) | Gameplay feedback, procedural animation |

A MIC compiles its shader once for each unique combination of static parameters.
A MID uses the same compiled shader as its parent MIC/UMaterial — it only uploads
new constant-buffer values each frame.

**Key invariant**: you cannot change a MIC's parameter values at runtime from C++.
The `Set*EditorOnly` functions (`SetScalarParameterValueEditorOnly`, etc.) in
`MaterialInstanceConstant.h` are `WITH_EDITOR` only. Create a MID when any
parameter must change during play.

## Parameter types

### Scalar parameter (`float`)
A named `float` value. Used for roughness, metallic, emissive strength, dissolve
amount, damage state — any single numeric control.

```cpp
// MaterialInstanceDynamic.h:24
void SetScalarParameterValue(FName ParameterName, float Value);
// Read back:
float K2_GetScalarParameterValue(FName ParameterName);
```

### Vector parameter (`FLinearColor` / 4-component float)
A named RGBA/XYZW value. Used for colors, tint multipliers, or any 4-component
data. `FLinearColor` maps to the material's RGBA channels.

```cpp
// MaterialInstanceDynamic.h:109
void SetVectorParameterValue(FName ParameterName, FLinearColor Value);
// Convenience overloads accept FVector and FVector4:
void SetVectorParameterValue(FName ParameterName, const FVector& Value);
void SetVectorParameterValue(FName ParameterName, const FVector4& Value);
```

### Texture parameter (`UTexture*`)
Swaps which texture asset a `TextureSampleParameter2D` (or Cube, etc.) samples.

```cpp
// MaterialInstanceDynamic.h:65
void SetTextureParameterValue(FName ParameterName, UTexture* Value);
```

Changing the texture parameter updates the binding for the next frame. The
parameter node type in the material graph must match the texture type (2D, Cube,
etc.).

### Static Switch parameter
Compiled per MIC at load/save time; cannot be changed at runtime. Controlled
through the Material Instance Editor or `SetStaticSwitchParameterValueEditorOnly`
in `WITH_EDITOR` code. Each unique static switch combination produces a separate
compiled shader, so minimize the number of independent switches and combinations
in use.

### Material attributes (Make/Break MaterialAttributes)
An alternative to connecting individual inputs; wraps all standard inputs into
one struct pin. Used with layered materials and material functions that output a
full attribute set. Not a runtime-settable parameter — it is a graph topology
choice.

## C++ worked example — damage material

```cpp
// In a character component header:
UPROPERTY()
TObjectPtr<UMaterialInstanceDynamic> DamageMID;

// In BeginPlay (mesh already registered):
void AMyCharacter::BeginPlay()
{
    Super::BeginPlay();

    // Slot 0 of the skeletal mesh uses the base material.
    // CreateDynamicMaterialInstance creates the MID and assigns it to slot 0.
    DamageMID = GetMesh()->CreateDynamicMaterialInstance(
        0, DamageMaterial);   // DamageMaterial is a UPROPERTY UMaterialInterface*
}

// Called from gameplay code when damage is taken:
void AMyCharacter::OnDamage(float Severity)
{
    if (DamageMID)
    {
        DamageMID->SetScalarParameterValue(TEXT("DamageAmount"), Severity);
        DamageMID->SetVectorParameterValue(
            TEXT("BurnTint"), FLinearColor(1.f, 0.2f, 0.f, 1.f));
    }
}
```

Hold `DamageMID` in a `UPROPERTY()` member. Without `UPROPERTY()`, the GC can
collect the MID while the component still references it — a silent crash.

## Index-cache API for high-frequency calls

When setting the same parameter many times per frame on the same MID (e.g. an
audio-reactive emissive pulse), repeated name-string lookups add up. Use the
index-cache API instead:

```cpp
int32 EmissiveIndex = INDEX_NONE;

// Call once (e.g. in BeginPlay), set initial value and retrieve the index:
bool bFound = MID->InitializeScalarParameterAndGetIndex(
    TEXT("EmissivePower"), 1.0f, EmissiveIndex);

// Call every tick — no name lookup:
if (EmissiveIndex != INDEX_NONE)
    MID->SetScalarParameterByIndex(EmissiveIndex, NewValue);
```

The cached index is valid only as long as the MID's parent material is unchanged
and no parameters have been added or removed. Do not share indices across
different MIDs.

Equivalent vector index functions:
```cpp
bool InitializeVectorParameterAndGetIndex(
    const FName& ParameterName, const FLinearColor& Value, int32& OutParameterIndex);
bool SetVectorParameterByIndex(int32 ParameterIndex, const FLinearColor& Value);
```

## Instance hierarchy traversal

A MID can be parented to a MIC, which is itself parented to a base `UMaterial`.
When reading a parameter, the engine walks the chain from child to root and
returns the first overridden value it finds. When setting on a MID, only that
MID's override table is written — the parent MIC is never mutated.

`UMaterialInstance::GetMaterial()` (on `MaterialInstance.h`:626) returns the
root `UMaterial` regardless of chain depth.

## MID lifetime gotchas

- A MID created by `CreateDynamicMaterialInstance` is automatically given the
  component as its outer, but still needs a `UPROPERTY()` reference to survive
  GC across frames.
- Calling `CreateDynamicMaterialInstance` a second time on the same slot creates
  a **new** MID and discards the old one. Cache the returned pointer if you need
  to call setters later.
- In replicated actors, MID creation and parameter changes happen on each machine
  independently. The MID itself is not replicated — replicate the underlying data
  (e.g. `DamageAmount` as a `Replicated float`) and create/update the MID locally
  on each client.
