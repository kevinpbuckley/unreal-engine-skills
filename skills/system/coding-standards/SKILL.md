---
name: coding-standards
description: Write Unreal C++ that conforms to Epic's coding standard — type prefixes
  (U/A/F/E/I/T/S), PascalCase naming, the bBool prefix, enum class style, Allman braces,
  tab indentation, const correctness, nullptr/override/final usage, TEXT() string literals,
  include order with generated.h last, IWYU and forward declarations, API export macros
  (MODULE_API), UPROPERTY/UFUNCTION specifiers with Category, TObjectPtr for UObject
  members, and engine types over std containers. Use when writing or reviewing any UE
  C++, naming types or members, structuring headers, or making code consistent with the
  engine and surrounding project code.
metadata:
  engine-version: "5.7"
  category: meta
---

# Unreal coding standards

Match Epic's C++ conventions so code reads like the engine and the rest of the project. The
overriding rule: **match the surrounding code first**; these are the defaults when nothing
else is established.

Related skills: `cpp-fundamentals`, `core-types-and-containers`, `module-and-build-system`.

## When to use this skill

- Writing any new UE C++ header or source file.
- Reviewing or cleaning up code for style consistency.
- Choosing names for types, members, functions, or files.
- Structuring includes and forward declarations in a header.

## Type prefixes (mandatory for reflected types)

UHT enforces prefixes for reflected types; mismatches are a compile error.

| Prefix | Type | Engine example |
|---|---|---|
| `U` | UObject subclass (non-actor) | `UActorComponent` (`Components/ActorComponent.h`:151) |
| `A` | AActor subclass | `AActor` (`GameFramework/Actor.h`:256) |
| `F` | Plain struct or non-UObject class | `FAttachmentTransformRules` (`Engine/EngineTypes.h`:74) |
| `E` | Enum / enum class | `EAttachmentRule` (`Engine/EngineTypes.h`:61) |
| `I` | Abstract interface class | `IInterface_AssetUserData` (`Interfaces/Interface_AssetUserData.h`:19) |
| `T` | Class template | `TArray` (`Containers/Array.h`:669) |
| `S` | Slate widget | `SWidget`, `SCompoundWidget` |
| `b` | Boolean variable | `bReplicates` (`GameFramework/Actor.h`:556) |

The word after the prefix is PascalCase. The class name without its prefix must match the
filename: `AMyPawn` → `MyPawn.h`. Typedefs take the prefix appropriate to their underlying type.

Full prefix rules, interface pairing, enum value style, and template parameter conventions:
[references/naming-conventions.md](references/naming-conventions.md).

## Naming

- **PascalCase** for every identifier — types, functions, member variables, local variables,
  and parameters. No `m_` prefix, no `camelCase`, no `snake_case`.
- **Booleans** carry the `b` prefix: `bIsDead`, `bHasKey`, `bReplicates`.
- **Functions with a bool return** ask a question: `IsAlive()`, `ShouldClearBuffer()`.
- **Output reference parameters** carry `Out`: `void GetItems(TArray<FItem>& OutItems)`.
- **Type and variable names** are nouns; **function names** are verb phrases.
- Be descriptive; avoid abbreviations except established ones (`AI`, `HUD`, `LOD`, `GC`).
- **Macros** are `UE_ALL_CAPS_WITH_UNDERSCORES`.

## Formatting

Allman braces — opening brace on its own line for every construct. Always brace single-statement
blocks:

```cpp
void AMyActor::BeginPlay()
{
    Super::BeginPlay();
    if (bIsReady)
    {
        DoThing();
    }
}
```

- Tabs (4-character width) for indentation; spaces only for alignment within a line.
- One statement per line.
- Pointer/reference spacing: `FType* Ptr;` and `const FType& Ref;` — `*`/`&` bind to the type.
- No variable shadowing across scopes.

Switch statements must have an explicit `default:` branch and document intentional fall-through
with `// falls through`.

Full formatting rules, switch style, and namespace rules:
[references/formatting-and-includes.md](references/formatting-and-includes.md).

## Language conventions

- **`nullptr`** — never `NULL` or `0` for pointers.
- **`override`** on every overriding virtual. Add `final` where the class or function should
  not be further overridden.
- **`const` correctness** — const member functions for non-mutating methods; `const&` for
  non-trivial parameters not being copied; never const a by-value return.
- **`TEXT("...")`** around every string literal that constructs an `FString` or `FName`.
- **`enum class`** over plain enums; back with `uint8` if exposed to Blueprints. Values are
  PascalCase. Use `ENUM_CLASS_FLAGS(EFoo)` for bitfield enums with a `None = 0` sentinel.
- **Engine containers** (`TArray`, `TMap`, `TSet`, `FString`, `FName`) over `std::` equivalents
  in engine-facing code.
- **`auto`** only where the type is either a lambda, a verbose iterator, or genuinely
  indiscernible from context. Always apply `const`, `&`, or `*` explicitly with `auto`.
- **Range-based for** is preferred. For `TMap`, iterate as `for (TPair<K,V>& Kvp : Map)`.
- **Move semantics** — use `MoveTemp(X)` (UE's `std::move`) when transferring ownership of
  containers or `FString` into a member or return.
- **Lambdas** — prefer explicit captures over `[=]` or `[&]`. Captured `UObject*` pointers
  are invisible to the GC. Use `CreateWeakLambda` / `BindWeakLambda` for deferred lambdas.
- **UObjects via pointer** — pass by pointer, not reference. Null is the signal for "absent".
- Portable integer types: `int32`, `uint32`, `uint8`, `float`, `double`, `TCHAR`; avoid bare
  `int` in serialized or replicated data.

## Headers and includes

### Header structure (in order)

```cpp
// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"          // 1. CoreMinimal (or fine-grained core headers)
#include "GameFramework/Actor.h"  // 2. Engine / module headers this type needs
#include "MyActor.generated.h"   // 3. generated.h — ALWAYS LAST
```

### Source file structure

```cpp
#include "MyActor.h"                        // matching header first
#include "Components/StaticMeshComponent.h" // then any implementation deps
```

- **`#pragma once`** at the top of every header (all target compilers support it).
- **`generated.h` must be the last include** — UHT requires it. Missing it or putting it in
  the middle causes broken generated code.
- **IWYU** (Include What You Use) — include every header you directly depend on; do not rely
  on transitive includes through another header.
- **Forward declare** in headers where you only need a pointer or reference. In `.cpp`, include
  the full header. This reduces compile times and dependency coupling.

```cpp
// Header — forward declare only
class UStaticMeshComponent;

UCLASS()
class MYGAME_API AMyActor : public AActor
{
    GENERATED_BODY()
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Mesh;
};

// Source — full include
#include "Components/StaticMeshComponent.h"
```

Engine evidence: `Actor.h` lines 5–28 use IWYU-style fine-grained includes ending with
`"Actor.generated.h"` at line 28; `Character.h` lines 5–18 show `CoreMinimal.h` first and
`"Character.generated.h"` at line 18.

## Reflection style

Every reflected class or struct needs `GENERATED_BODY()` as its **first** body member. Every
public class in a module needs the module `*_API` export macro:

```cpp
UCLASS(Blueprintable, BlueprintType, config=Game)
class MYGAME_API AWeapon : public AActor
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintCallable, Category="Weapon")
    void Fire();

    UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category="Stats",
              meta=(ClampMin="0"))
    float Damage = 25.f;

protected:
    UPROPERTY(VisibleAnywhere, Category="Components")
    TObjectPtr<UStaticMeshComponent> Mesh;
};
```

Key rules:
- Always set a `Category` on any `UPROPERTY`/`UFUNCTION` the editor will show. Without it,
  properties land in an uncategorized root group.
- Put `meta=(...)` last in the specifier list.
- Use `TObjectPtr<T>` for `UPROPERTY` members holding `UObject`-derived pointers (UE5+ modern
  form). Raw `T*` still works and appears in older code.
- The `*_API` macro (e.g. `MYGAME_API`, `ENGINE_API`) must appear between `class` and the
  class name for any non-inline public API. UBT expands it to `__declspec(dllexport/import)`.

See [references/reflection-and-uht.md](references/reflection-and-uht.md) for the full specifier
reference, `USTRUCT`/`UENUM`/`UFUNCTION` details, and common UHT errors.

## Comments and documentation

- `//` for inline comments; `/** ... */` JavaDoc-style comments on public API declarations —
  these surface as tooltips for Blueprint-exposed members and in the generated API docs.
- Comment *why*, not *what*. Keep comments accurate and current with the code.
- Class comments describe the problem the class solves. Multi-line method comments document
  purpose, parameter units/ranges, return value, and any `@warning`/`@see`/`@deprecated`.

```cpp
/** Maximum health this actor can have. Modified by difficulty at BeginPlay. */
UPROPERTY(EditDefaultsOnly, Category="Health", meta=(ClampMin="1"))
float MaxHealth = 100.f;
```

## Logging and errors

- Log through a named category with `UE_LOG` (`logging-and-assertions`).
- `check(Condition)` for invariants — aborts in all builds if violated. Never put side effects
  inside a `check`.
- `ensure(Condition)` for recoverable "shouldn't happen" — fires once in non-shipping builds,
  returns bool so you can handle the failure.
- Remove debug prints before submitting.

## Gotchas

- **Wrong or missing type prefix** — UHT build error; check U/A/F/E/I/T/S.
- **`generated.h` not last** — UHT mis-generates or fails outright.
- **Missing `GENERATED_BODY()`** — compile errors from undefined generated symbols.
- **Missing `Category`** on editor-exposed properties — unorganized Details panel.
- **`m_` prefix or `snake_case`** — not Unreal style; use PascalCase.
- **Missing `b` on booleans** — style violation; also breaks naming-based tooling.
- **`std::` containers in engine-facing code** — use `TArray`/`TMap`/`FString` instead.
- **Omitting `override`** — silent non-override when a virtual signature drifts.
- **Bare `NULL`/`0` for pointers** — use `nullptr`.
- **No `TEXT()` around string literals** — produces an undesirable narrow-to-wide conversion.
- **`auto` overuse** — hide types from readers; use only for lambdas, verbose iterators, or
  template-context expressions where the type is genuinely unwriteable.
- **`[=]`/`[&]` lambda captures** — UObject pointers captured by `[=]` are invisible to the
  GC; deferred `[&]` lambdas dangle. Use explicit captures and weak wrappers.

## References and source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/Engine/Classes/GameFramework/Actor.h`:255–256, 262, 273, 556, 862, 990, 995
- `Runtime/Engine/Classes/GameFramework/Character.h`:3, 5, 18, 240–241
- `Runtime/Engine/Classes/Components/ActorComponent.h`:3, 23, 27–36, 150–153, 168, 331
- `Runtime/Engine/Classes/Engine/EngineTypes.h`:61, 74
- `Runtime/Engine/Classes/Interfaces/Interface_AssetUserData.h`:3, 13–19
- `Runtime/CoreUObject/Public/UObject/Object.h`:93–96, 102, 125
- `Runtime/Core/Public/Containers/Array.h`:669
- `Runtime/Core/Public/Windows/WindowsPlatform.h`:213–214
- `Runtime/Core/Public/HAL/Platform.h`:1006–1008

Official docs (UE 5.7):
- Epic C++ Coding Standard:
  <https://dev.epicgames.com/documentation/unreal-engine/epic-cplusplus-coding-standard-for-unreal-engine>

Deep-dive references in this skill:
- [references/naming-conventions.md](references/naming-conventions.md) — all prefix rules,
  PascalCase details, boolean/enum/function/macro naming, interface pairing.
- [references/formatting-and-includes.md](references/formatting-and-includes.md) — Allman
  braces, tabs, switch style, const correctness detail, `#pragma once`, include order, IWYU,
  forward declarations, API export macros.
- [references/reflection-and-uht.md](references/reflection-and-uht.md) — `UCLASS`/`USTRUCT`/
  `UENUM`/`UPROPERTY`/`UFUNCTION` specifier reference, `TObjectPtr`, `GENERATED_BODY()`,
  and common UHT errors.
