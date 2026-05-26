---
name: blueprint-cpp-integration
description: Expose C++ classes, functions, and properties to Blueprint in Unreal Engine — UFUNCTION
  specifiers (BlueprintCallable, BlueprintPure, BlueprintImplementableEvent, BlueprintNativeEvent),
  UPROPERTY exposure (BlueprintReadWrite/ReadOnly, EditAnywhere/DefaultsOnly, ExposeOnSpawn),
  UCLASS specifiers (Blueprintable, BlueprintType), meta=(...) tags, Blueprint function libraries,
  TSubclassOf/soft references, and Blueprint-implementable interfaces. Use when deciding which
  specifiers to put on C++ members or functions, designing a designer-facing API, calling between
  C++ and Blueprint, or debugging missing nodes/properties/events in the Blueprint graph.
metadata:
  engine-version: "5.7"
  category: blueprints
---

# Blueprint ↔ C++ integration

The boundary between C++ and Blueprint is defined entirely by **reflection specifiers** declared in
UHT macros. Getting them right produces a clean, designer-friendly API; getting them wrong means
nodes don't appear, properties don't show, or events never fire. This is the contract layer of the
"C++ base + Blueprint subclass" pattern.

## When to use this skill

- Choosing `UFUNCTION`/`UPROPERTY`/`UCLASS` specifiers to expose C++ to designers.
- Letting Blueprints override or implement C++ behavior via events.
- Building a Blueprint function library of static helpers.
- Passing class references or soft assets between C++ and Blueprint.
- Defining a shared interface contract implementable in C++ or Blueprint.

## Mental model: what UHT generates

Unreal Header Tool (UHT) reads each macro and generates two things: **metadata** (stored in the
`UClass`/`UFunction`/`FProperty` object) and **thunk functions** (the glue that lets Blueprint
call C++ and vice versa). The specifiers you write are instructions to UHT, not runtime code.
`BlueprintCallable` adds exec-pin wiring; `BlueprintPure` suppresses those pins; event specifiers
generate the dispatching thunk that routes a call from the Blueprint VM to the right C++ or BP body.

## Exposing functions (UFUNCTION)

```cpp
// Side-effect function — gets exec in/out pins in BP
UFUNCTION(BlueprintCallable, Category="Combat")
void ApplyDamage(float Amount);

// Pure query — no exec pins, result cached per evaluation
UFUNCTION(BlueprintPure, Category="Combat")
float GetHealthPercent() const;

// C++ raises it; Blueprint defines what happens — no C++ body
UFUNCTION(BlueprintImplementableEvent, Category="FX")
void OnHitReaction(const FVector& ImpactPoint);

// C++ has a default; Blueprint may override it
UFUNCTION(BlueprintNativeEvent, Category="AI")
void OnAlert(AActor* Threat);
void OnAlert_Implementation(AActor* Threat);   // the C++ fallback
```

Key rules:
- **BlueprintCallable** — designers can call it with side effects. Add `Category` always.
- **BlueprintPure** — for value queries. No exec pins. Avoid heavy work; BP re-evaluates it
  every time the output pin is read.
- **BlueprintImplementableEvent** — UHT generates the thunk; you may **not** provide a C++ body.
  Call it from C++ by invoking the base name (`OnHitReaction(...)`); BP decides what happens.
- **BlueprintNativeEvent** — provide `_Implementation` as the C++ default. Call the **base name**
  so the engine routes to the BP override when present. In a C++ override of an NE, call
  `Super::FuncName_Implementation(...)`.

Additional useful function specifiers:
- `CallInEditor` — adds a button in the Details panel (editor only).
- `BlueprintAuthorityOnly` — BP can only call it on the server/single-player.
- `BlueprintCosmetic` — skipped on dedicated servers.
- `meta=(DisplayName="Friendly Name")` — overrides the node label in the BP graph.
- `meta=(ExpandEnumAsExecs="Param")` — creates one exec pin per enum value.

Full specifier table and advanced meta tags: [references/ufunction-specifiers.md](references/ufunction-specifiers.md).

## Exposing properties (UPROPERTY)

```cpp
// Editable in all contexts; read-write from BP; clamped in editor UI
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Stats",
          meta=(ClampMin="0.0", ClampMax="1000.0"))
float MaxHealth = 100.f;

// Read-only from BP; C++ internal writes are fine
UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Stats")
float CurrentHealth = 100.f;

// Appears as a pin on SpawnActor/BeginDeferredActorSpawn nodes
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Spawn",
          meta=(ExposeOnSpawn="true"))
int32 StartingAmmo = 30;

// Designer picks a class (C++ or Blueprint); type-safe
UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category="Setup")
TSubclassOf<AActor> ProjectileClass;

// Private member exposed to BP via allow-access meta
UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Components",
          meta=(AllowPrivateAccess="true"))
TObjectPtr<UStaticMeshComponent> Mesh;
```

Edit/visibility specifier summary:

| Specifier | Edit? | Where? |
|---|---|---|
| `EditAnywhere` | yes | archetypes + instances |
| `EditDefaultsOnly` | yes | archetypes only (class defaults) |
| `EditInstanceOnly` | yes | placed/spawned instances only |
| `VisibleAnywhere` | read-only display | everywhere |
| `VisibleDefaultsOnly` | read-only display | archetypes only |

Blueprint access specifiers: `BlueprintReadWrite` (get+set node), `BlueprintReadOnly` (get only).
These are independent of the Edit/Visible axis — combine them as needed.

Useful meta tags: `ClampMin`/`ClampMax` (editor input range), `UIMin`/`UIMax` (slider range),
`ExposeOnSpawn="true"` (spawn pin), `AllowPrivateAccess="true"` (expose private member to BP),
`EditCondition="bSomeFlag"` (grey-out unless flag is true).

Full property specifier and meta-tag reference: [references/uproperty-specifiers.md](references/uproperty-specifiers.md).

## UCLASS specifiers for Blueprint

```cpp
// Subclassable in BP and usable as a BP variable type
UCLASS(Blueprintable, BlueprintType)
class MYGAME_API UMyDataAsset : public UDataAsset { ... };

// Cannot be subclassed in BP (abstract base, library)
UCLASS(Abstract, NotBlueprintable)
class MYGAME_API UMyInternalBase : public UObject { ... };
```

- `Blueprintable` — designers can create a Blueprint subclass of this C++ class.
- `BlueprintType` — the class can be used as a variable type in Blueprint graphs.
- Both are inherited by subclasses unless overridden.
- `MinimalAPI` — exports only the type info needed for `Cast<>` and vtable; keeps compile times low
  for classes that don't need all methods accessible in other modules.

## Passing class references and soft assets

```cpp
// Type-safe class reference: editor shows only AProjectile and subclasses
UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category="Projectile")
TSubclassOf<AProjectile> ProjectileClass;

// Async-loadable texture: not kept in memory until loaded
UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category="Visuals")
TSoftObjectPtr<UTexture2D> SplashTexture;

// Async-loadable class (useful in streaming scenarios)
UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category="AI")
TSoftClassPtr<AAIController> AIControllerClass;
```

Spawn with a class ref: `GetWorld()->SpawnActor<AProjectile>(ProjectileClass, Location, Rotation)`.
Load a soft ref asynchronously via the Asset Manager or `RequestAsyncLoad` (see `asset-management`).

## Blueprint function libraries

For utility functions not tied to any particular object instance:

```cpp
#include "Kismet/BlueprintFunctionLibrary.h"

UCLASS()
class MYGAME_API UGeometryLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintPure, Category="Geometry",
              meta=(DisplayName="Snap To Grid"))
    static FVector SnapToGrid(const FVector& In, float GridSize);

    UFUNCTION(BlueprintCallable, Category="Geometry")
    static bool TraceLineOfSight(const UObject* WorldContext,
                                 const FVector& From, const FVector& To);
};
```

Methods must be `static`. They appear as global nodes in any BP graph.
`UGameplayStatics` (`Engine/Classes/Kismet/GameplayStatics.h`) is the canonical large example.

## Blueprint-implementable interfaces

An interface lets unrelated classes share a C++/Blueprint contract without a common parent:

```cpp
// Interactable.h
#include "UObject/Interface.h"

UINTERFACE(MinimalAPI, Blueprintable)
class UInteractable : public UInterface { GENERATED_BODY() };

class IInteractable
{
    GENERATED_BODY()
public:
    // C++ default provided; Blueprint may override
    UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category="Interact")
    void Interact(AActor* Instigator);
};
```

Implement in C++: inherit `IInteractable` and provide `Interact_Implementation`.
Implement in Blueprint: add the interface in Class Settings; implement the event node.

Calling interface functions safely from C++:

```cpp
if (Target->Implements<UInteractable>())
    IInteractable::Execute_Interact(Target, this);   // routes to BP override if present

// Cast<> only works when the interface is implemented in C++, not Blueprint
```

Use `Execute_<FuncName>` for any `BlueprintNativeEvent`/`BlueprintImplementableEvent` on an
interface — it is the only path that correctly dispatches to Blueprint overrides.

Full interface patterns, `TScriptInterface`, and `Cast<>` caveats:
[references/blueprint-interfaces.md](references/blueprint-interfaces.md).

## Delegates exposed to Blueprint

```cpp
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnHealthDepleted, float, LastDamage);

UPROPERTY(BlueprintAssignable, Category="Events")
FOnHealthDepleted OnHealthDepleted;
```

`BlueprintAssignable` lets designers bind to the event in the Event Graph. The delegate must be
`DYNAMIC_MULTICAST` — UHT only exposes that family to Blueprint. See `delegates-and-events`.

## Gotchas

- **No `Category`** — members land in a flat "Default" group; always set a meaningful one.
- **`BlueprintImplementableEvent` with a C++ body** — compile error; UHT generates the body.
- **Calling a `BlueprintNativeEvent` via `_Implementation` directly** bypasses Blueprint overrides;
  always invoke the base name in production code.
- **Missing `Execute_` on interface calls** — silently skips Blueprint implementations.
- **`BlueprintReadWrite` on a `private` member** without `meta=(AllowPrivateAccess="true")`
  won't compile — UHT rejects the combination.
- **Returning `const&` to Blueprint** — unsafe; BP holds a copy of the pin value. Return by value.
- **`BlueprintPure` on a slow function** — BP re-runs it for every connected node; cache in a
  variable or switch to `BlueprintCallable`.
- **`Cast<IMyInterface>` on a BP-only implementor returns null** — use `Implements<>` +
  `Execute_` for interfaces implemented in Blueprint.
- **Forgetting `GENERATED_BODY()` in the `I`-prefixed interface class** — UHT will refuse to
  generate the dispatcher.

## Version notes

- `TObjectPtr<T>` is the modern UPROPERTY member idiom (UE5+); older code uses raw `T*` which
  still works. Prefer `TObjectPtr` for new code.
- `BlueprintPure=false` on a `const` function forces it to show exec pins (UE 5.0+).
- The specifier set is stable across UE 5.x; the line numbers in source citations may drift
  across patch releases but header paths and enum names are stable.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/CoreUObject/Public/UObject/ObjectMacros.h` — `UF::BlueprintImplementableEvent`:950,
  `UF::BlueprintNativeEvent`:955, `UF::BlueprintPure`:984, `UF::BlueprintCallable`:987;
  `UP::EditAnywhere`:1116, `UP::EditDefaultsOnly`:1122, `UP::BlueprintReadOnly`:1134,
  `UP::BlueprintReadWrite`:1140, `UP::BlueprintAssignable`:1104;
  meta `AllowPrivateAccess`:1309, `ExposeOnSpawn`:1382;
  `UC::Blueprintable`:808, `UC::BlueprintType`:802.
- `Runtime/Engine/Classes/Kismet/BlueprintFunctionLibrary.h` — `UBlueprintFunctionLibrary`:15.
- `Runtime/Engine/Classes/Kismet/GameplayStatics.h` — canonical large BP function library.
- `Runtime/CoreUObject/Public/UObject/Interface.h` — `UInterface`:18, `IInterface`:24.

Official docs (UE 5.7):
- UFunctions — <https://dev.epicgames.com/documentation/unreal-engine/ufunctions-in-unreal-engine>
- UProperties — <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-uproperties>
- Metadata Specifiers — <https://dev.epicgames.com/documentation/unreal-engine/metadata-specifiers-in-unreal-engine>
- Unreal Interfaces — <https://dev.epicgames.com/documentation/unreal-engine/interfaces-in-unreal-engine>
- TSubclassOf — <https://dev.epicgames.com/documentation/unreal-engine/typed-object-pointer-properties-in-unreal-engine>

Deep-dive references in this skill:
- [references/ufunction-specifiers.md](references/ufunction-specifiers.md) — full UFUNCTION specifier
  and function-meta-tag table with exact ObjectMacros.h locations.
- [references/uproperty-specifiers.md](references/uproperty-specifiers.md) — UPROPERTY edit/visible/BP
  access/meta specifiers, BlueprintGetter/Setter custom accessors.
- [references/blueprint-interfaces.md](references/blueprint-interfaces.md) — interface declaration,
  dispatch rules, `TScriptInterface`, and C++ vs. Blueprint implementation caveats.

Related skills: `cpp-fundamentals`, `blueprint-fundamentals`, `delegates-and-events`, `asset-management`.
