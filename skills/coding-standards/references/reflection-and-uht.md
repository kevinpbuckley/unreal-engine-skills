# Reflection macros and UHT — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UCLASS`, `USTRUCT`, `UENUM`,
`UPROPERTY`, `UFUNCTION`, `GENERATED_BODY`, modern specifiers, `TObjectPtr`, and what
UHT requires to generate code correctly. Grounded in UE 5.7.

## How UHT works

Unreal Header Tool (UHT) parses `.h` files for reflection macros and emits the
`<Type>.generated.h` file (in `Intermediate/Build/.../UHT/`). The generated header defines
the `GENERATED_BODY()` expansion, the static class / struct info, and Blueprint-callable
thunks.

Rules UHT enforces:
1. The `*.generated.h` include must be the **last** include in the header.
2. Reflected types must have `GENERATED_BODY()` (or the older `GENERATED_UCLASS_BODY()`)
   as the very first line of the class/struct body.
3. Type prefixes (U/A/F/E/I/S) must be correct — UHT checks them.
4. Reflected types must be at global scope — UHT does not parse inside namespaces.

## UCLASS

Marks a class for reflection. Required for any `UObject`/`AActor` subclass you expose to
the editor, Blueprints, or the GC.

```cpp
UCLASS(BlueprintType, Blueprintable, config=Game)
class MYGAME_API AMyActor : public AActor
{
    GENERATED_BODY()
    // ...
};
```

Key specifiers:
- `BlueprintType` — allows Blueprint variables of this type.
- `Blueprintable` — allows Blueprint subclasses.
- `Abstract` — prevents instantiation; marks a base class.
- `MinimalAPI` — exports only the type's vtable and `StaticClass()`, not every method. Use
  this when you want the type visible across modules without full member export.
- `config=Game` — maps `UPROPERTY(Config)` to `DefaultGame.ini`.
- `meta=(ShortTooltip="...")` — appears in editor tooltips and the Blueprint palette.

Engine example: `UCLASS(BlueprintType, Blueprintable, config=Engine, ..., MinimalAPI)` at
`GameFramework/Actor.h`:255.

## USTRUCT

Marks a struct for reflection. The struct takes the `F` prefix. Include `GENERATED_BODY()`
as the first member:

```cpp
USTRUCT(BlueprintType)
struct MYGAME_API FDamageInfo
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Damage")
    float Amount = 0.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Damage")
    TObjectPtr<AActor> Source;
};
```

Structs do not inherit from `UObject`; they cannot be garbage-collected individually. Use
`TObjectPtr` only for member pointers inside a `UCLASS` — plain `AActor*` is fine inside
a struct used as a value type (the GC reaches it through the owning object).

## UENUM

Marks an enum for reflection. Use `enum class` backed by `uint8` for Blueprint exposure:

```cpp
UENUM(BlueprintType)
enum class EWeaponType : uint8
{
    Melee   UMETA(DisplayName="Melee Weapon"),
    Ranged  UMETA(DisplayName="Ranged Weapon"),
    Magic   UMETA(DisplayName="Magic Weapon"),
};
```

`UMETA(DisplayName="...")` controls the label shown in Blueprint dropdowns. Without a
`UENUM`, the enum cannot appear as a Blueprint variable or property.

## UPROPERTY

Exposes a member variable to reflection (GC, editor, Blueprints, networking). Key specifiers:

| Specifier | Meaning |
|---|---|
| `EditAnywhere` | Editable on instances and archetypes |
| `EditDefaultsOnly` | Editable only on the CDO/Blueprint default |
| `VisibleAnywhere` | Visible but read-only in the editor |
| `BlueprintReadWrite` | Blueprint get + set |
| `BlueprintReadOnly` | Blueprint get only |
| `Category="..."` | **Required** for editor exposure; groups properties in Details panel |
| `Replicated` | Replicates to clients; also declare in `GetLifetimeReplicatedProps` |
| `ReplicatedUsing=OnRep_Func` | Replication with a notification callback |
| `Transient` | Not saved; reset each load |
| `Config` | Read from config file (e.g. `DefaultGame.ini`) |
| `meta=(...)` | Sub-specifiers: `AllowPrivateAccess`, `ClampMin`, `ClampMax`, etc. |

Ordering convention: access specifiers first, then `meta=(...)` last.

```cpp
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Health",
          meta=(ClampMin="0.0", ClampMax="1000.0"))
float MaxHealth = 100.f;
```

### TObjectPtr for UObject member properties (modern)

Use `TObjectPtr<T>` instead of raw `T*` for `UPROPERTY` members holding `UObject`-derived
pointers. It provides access tracking in editor builds and is the modern UE5 form. Raw `T*`
still compiles and many legacy headers use it.

```cpp
UPROPERTY(VisibleAnywhere, Category="Components")
TObjectPtr<UStaticMeshComponent> Mesh;

UPROPERTY(EditDefaultsOnly, Category="Gameplay")
TObjectPtr<UDataTable> StatsTable;
```

Engine examples: `TObjectPtr<USceneComponent> RootComponent` at `Actor.h`:995;
`TObjectPtr<class UInputComponent> InputComponent` at `Actor.h`:862.

For arrays: `TArray<TObjectPtr<AActor>> Children` at `Actor.h`:990.

## UFUNCTION

Exposes a member function to reflection (Blueprints, RPC, delegates, etc.):

```cpp
UFUNCTION(BlueprintCallable, Category="Damage")
void ApplyDamage(float Amount, AActor* DamageCauser);

UFUNCTION(BlueprintPure, Category="State")
bool IsAlive() const;

UFUNCTION(BlueprintImplementableEvent, Category="Events")
void OnPickedUp();

UFUNCTION(BlueprintNativeEvent, Category="Events")
void OnDamaged(float Amount);   // declare virtual; implement as OnDamaged_Implementation()

// Server RPC (reliable):
UFUNCTION(Server, Reliable, WithValidation)
void ServerSetTarget(FVector NewTarget);
```

Key specifiers:
- `BlueprintCallable` — callable from Blueprint graphs.
- `BlueprintPure` — no side effects; no exec pin in Blueprint.
- `BlueprintImplementableEvent` — implemented entirely in Blueprint; C++ body is auto-generated (empty).
- `BlueprintNativeEvent` — has C++ default; Blueprint can override. C++ implementation
  method is named `FunctionName_Implementation`.
- `Server`/`Client`/`NetMulticast` + `Reliable`/`Unreliable` — RPC variants.
- `WithValidation` — RPC validation; implement `FunctionName_Validate()` returning `bool`.

Overlap/hit callbacks that use `AddDynamic` **must** be `UFUNCTION()` with the exact delegate
signature. Without `UFUNCTION()`, `AddDynamic` silently fails to bind.

## GENERATED_BODY

Must be the first line of the class or struct body. It expands to a series of declarations
inserted by UHT: static class info, constructor helpers, and serialization boilerplate.
Omitting it causes compile errors (undefined symbols from the generated header).

```cpp
UCLASS()
class MYGAME_API UMyObject : public UObject
{
    GENERATED_BODY()   // ← first line of body, every time
public:
    // ...
};
```

Engine evidence: `UActorComponent` at `Components/ActorComponent.h`:153;
`UObject` at `CoreUObject/Public/UObject/Object.h`:96.

## Common UHT gotchas

- Missing `GENERATED_BODY()` — generated header references symbols that don't exist → compile
  error.
- `generated.h` not last — UHT complains or produces incorrect output.
- Reflected type inside a namespace — UHT does not see it; strip the namespace.
- Missing `Category` on editor-facing `UPROPERTY`/`UFUNCTION` — properties clutter the root
  of the Details panel with no grouping.
- `ReplicatedUsing` handler not a `UFUNCTION()` — the callback is not wired at runtime.
- Returning `TObjectPtr` from a `UFUNCTION` — allowed, but ensure the pointer's lifetime is
  GC-managed.

## Source material

Engine source paths verified in UE 5.7:
- `Runtime/Engine/Classes/GameFramework/Actor.h`:255–256 — `UCLASS(...)` / `class AActor`.
- `Runtime/Engine/Classes/GameFramework/Actor.h`:862, 990, 995 — `TObjectPtr` member examples.
- `Runtime/Engine/Classes/Components/ActorComponent.h`:150–153 — `UCLASS()` + `GENERATED_BODY()`.
- `Runtime/CoreUObject/Public/UObject/Object.h`:93–96 — `UCLASS(Abstract, MinimalAPI)` + `GENERATED_BODY()`.
- `Runtime/Engine/Classes/Interfaces/Interface_AssetUserData.h`:13–16 — `UINTERFACE()` + `GENERATED_UINTERFACE_BODY()`.
