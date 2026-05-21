---
name: blueprint-cpp-integration
description: Expose C++ to Blueprints correctly in Unreal — UFUNCTION specifiers (BlueprintCallable,
  BlueprintPure, BlueprintImplementableEvent, BlueprintNativeEvent), UPROPERTY exposure
  (BlueprintReadWrite/ReadOnly, EditAnywhere, ExposeOnSpawn), Blueprint function libraries,
  TSubclassOf and soft references, and Blueprint-implementable interfaces. Use when deciding which
  specifiers to put on C++ members/functions, exposing an API for designers, or calling between
  C++ and Blueprint.
metadata:
  engine-version: "5.7"
  category: blueprints
---

# Blueprint ↔ C++ integration

The boundary between C++ and Blueprint is defined entirely by **reflection specifiers**. Getting
them right is what makes a clean, designer-friendly API; getting them wrong means nodes don't
appear, values don't expose, or events don't fire. This is the contract layer of the
"C++ base + Blueprint subclass" pattern (`blueprint-fundamentals`).

## When to use this skill

- Choosing `UFUNCTION`/`UPROPERTY` specifiers to expose C++ to designers.
- Letting Blueprints override or implement C++ behavior (events).
- Building a Blueprint function library of static helpers.
- Passing classes/assets between C++ and Blueprint (`TSubclassOf`, soft refs).

## Exposing functions

```cpp
// Callable from BP, has side effects → exec pins
UFUNCTION(BlueprintCallable, Category="Combat")
void ApplyDamage(float Amount);

// Pure: no side effects, no exec pins (a getter/compute)
UFUNCTION(BlueprintPure, Category="Combat")
float GetHealthPercent() const;

// Declared in C++, IMPLEMENTED in Blueprint (no C++ body)
UFUNCTION(BlueprintImplementableEvent, Category="FX")
void OnHitReaction(const FVector& ImpactPoint);

// C++ has a default impl; Blueprint MAY override it
UFUNCTION(BlueprintNativeEvent, Category="AI")
void OnAlert(AActor* Threat);
void OnAlert_Implementation(AActor* Threat);   // the C++ default
```

- **BlueprintCallable** — designers call it. **BlueprintPure** — for value queries only.
- **BlueprintImplementableEvent** — C++ raises it (just call `OnHitReaction(...)`), Blueprint
  defines what happens. No C++ body — UHT generates the thunk.
- **BlueprintNativeEvent** — provide `_Implementation`; call the **base name** to invoke (the
  engine routes to the Blueprint override if present). Call `Super::OnAlert_Implementation(...)`
  from an override when extending.

## Exposing properties

```cpp
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Stats", meta=(ClampMin="0"))
float MaxHealth = 100.f;

UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Stats")
float CurrentHealth = 100.f;

UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Spawn", meta=(ExposeOnSpawn="true"))
int32 StartingAmmo = 30;     // appears as a pin on SpawnActor nodes

UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category="Setup")
TSubclassOf<AActor> ProjectileClass;   // designer picks a class (incl. a Blueprint)
```

Specifier cheat sheet:
- Edit in editor: `EditAnywhere` / `EditDefaultsOnly` / `EditInstanceOnly`; read-only:
  `VisibleAnywhere` etc.
- BP access: `BlueprintReadWrite` (get+set) / `BlueprintReadOnly` (get).
- `meta=(ExposeOnSpawn="true")` → pin on spawn nodes. `meta=(AllowPrivateAccess="true")` → expose
  a `private` member. `meta=(ClampMin/UIMin/...)` → editor ranges.

## Passing classes & assets

- `TSubclassOf<AThing>` — a class reference (a C++ class or a Blueprint subclass). Spawn with it.
- `TSoftObjectPtr<UTexture2D>` / `TSoftClassPtr<...>` — async-loadable references; keeps assets
  out of memory until needed (see `asset-management`).
- Plain `UObject*`/`AActor*` params/returns are fine for BlueprintCallable functions.

## Blueprint function libraries (static helpers)

For utility functions not tied to an instance:

```cpp
#include "Kismet/BlueprintFunctionLibrary.h"

UCLASS()
class MYGAME_API UMyMathLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintPure, Category="Math", meta=(DisplayName="Snap To Grid"))
    static FVector SnapToGrid(const FVector& In, float GridSize);
};
```
These appear as global nodes. `UGameplayStatics` (engine) is the canonical example.

## Blueprint-implementable interfaces

Let unrelated classes share a contract that Blueprints can implement:

```cpp
UINTERFACE(MinimalAPI, Blueprintable)
class UInteractable : public UInterface { GENERATED_BODY() };

class IInteractable
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category="Interact")
    void Interact(AActor* Instigator);
};

// Call safely whether implemented in C++ or BP:
if (Target->Implements<UInteractable>())
    IInteractable::Execute_Interact(Target, this);   // generated static dispatcher
```
Use `Execute_<Func>` to call interface functions that may be implemented in Blueprint.

## Exposing delegates/events to Blueprint

Use a dynamic multicast delegate with `BlueprintAssignable` so designers can bind in the Event
Graph (see `delegates-and-events`):
```cpp
UPROPERTY(BlueprintAssignable, Category="Events")
FOnDiedSignature OnDied;
```

## Gotchas

- **No `Category`** → members dump into a default group; always set one.
- **`BlueprintImplementableEvent` with a C++ body** → won't compile; it must have none.
- **Calling a `BlueprintNativeEvent` via `_Implementation`** bypasses the Blueprint override; call
  the base name to route correctly.
- **Forgetting `Execute_` for interface calls** → you skip Blueprint implementations.
- **`BlueprintReadWrite` on a `private` member** without `meta=(AllowPrivateAccess="true")` won't compile.
- **Returning by const ref** to Blueprint can be unsafe; prefer returning by value for BP-exposed funcs.

## References & source material

Engine source (UE 5.7):
- `Runtime/CoreUObject/Public/UObject/ObjectMacros.h` — all `UFUNCTION`/`UPROPERTY` specifiers.
- `Runtime/Engine/Classes/Kismet/BlueprintFunctionLibrary.h` — `UBlueprintFunctionLibrary`.
- `Runtime/Engine/Classes/Kismet/GameplayStatics.h` — a large real BP library to model on.
- `Runtime/CoreUObject/Public/UObject/Interface.h` — `UInterface`/interface plumbing.

Related: `cpp-fundamentals`, `blueprint-fundamentals`, `delegates-and-events`.
Official docs (UE 5.7): Blueprints Visual Scripting —
<https://dev.epicgames.com/documentation/unreal-engine/blueprints-visual-scripting-in-unreal-engine>
