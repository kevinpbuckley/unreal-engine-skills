---
name: coding-standards
description: Write Unreal C++ that matches Epic's coding standard — type prefixes (U/A/F/E/I/T/S),
  PascalCase naming, the bBool prefix, brace/formatting conventions, const correctness, TEXT()/
  nullptr/override usage, include order with generated.h last, and using engine types/containers
  over std. Use when writing or reviewing UE C++ to keep it idiomatic and consistent with the engine
  and surrounding code.
metadata:
  engine-version: "5.7"
  category: meta
---

# Unreal coding standards

Match Epic's C++ conventions so code reads like the engine and the rest of the project. This skill
is the style layer; the mechanics live in `cpp-fundamentals` and `core-types-and-containers`.
The overriding rule: **match the surrounding code**.

## When to use this skill

- Writing any new UE C++.
- Reviewing/cleaning code for consistency.
- Naming types, members, and functions the Unreal way.

## Naming

- **Type prefixes** (mandatory): `U` UObject (non-actor), `A` Actor, `F` plain struct/class,
  `E` enum, `I` interface, `T` template, `S` Slate widget, `G` global (rare). The name after the
  prefix matches the file name: `AMyPawn` in `MyPawn.h`. (See `cpp-fundamentals`.)
- **PascalCase** (UpperCamelCase) for types, functions, and member/local variables:
  `MaxHealth`, `ApplyDamage`, `TArray<AActor*> SpawnedActors`. Unreal does **not** use `m_` or
  snake_case for members.
- **Booleans** are prefixed `b`: `bIsDead`, `bHasKey`, `bReplicates`.
- **Enum class** values are PascalCase: `enum class EDoorState : uint8 { Closed, Open };`.
- Be descriptive; avoid abbreviations except well-known ones.

## Formatting

- **Allman braces** (opening brace on its own line) for types, functions, and blocks:
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
- Tabs for indentation (engine default). Always brace control-flow bodies, even single statements.
- One statement per line; reasonable line length.

## Language conventions

- **`nullptr`**, never `NULL`/`0` for pointers.
- **`override`** on every overridden virtual; `final` where appropriate.
- **`const` correctness**: const member functions for non-mutating methods; `const&` for non-trivial
  parameters you don't copy.
- **`TEXT("...")`** around every string literal so it's `TCHAR` (`core-types-and-containers`).
- Prefer **`enum class`** over plain enums; `uint8`-backed if Blueprint-exposed.
- Use **engine types/containers** (`FString`, `TArray`, `TMap`, `FVector`) — not `std::string`/
  `std::vector` (`core-types-and-containers`).
- Prefer `auto` only when the type is obvious from the right-hand side.

## Headers & includes

- Include order in a header: `CoreMinimal.h` (or specific core headers), then engine/module headers
  this header needs, then **`"<ThisType>.generated.h"` LAST** (`cpp-fundamentals`).
- **Forward declare** in headers where possible (`class UStaticMeshComponent;`) and include the full
  header in the `.cpp` — keeps compile times and dependencies down.
- Every reflected type uses `GENERATED_BODY()`; exported types use the module `*_API` macro
  (`module-and-build-system`).

## Reflection style

- Always set a `Category` on `UPROPERTY`/`UFUNCTION` exposed to the editor/Blueprints.
- Order specifiers consistently; put `meta=(...)` last.
- Use `TObjectPtr<>` for UObject `UPROPERTY` members (`memory-and-gc`).

## Comments & docs

- Use `//` for normal comments and `/** ... */` doc comments on public APIs (these surface as
  tooltips for Blueprint-exposed members).
- Comment *why*, not *what*; keep comments truthful and current.

## Logging & errors

- Log through a category with `UE_LOG` (`logging-and-assertions`); don't leave debug prints.
- `check` for invariants, `ensure` for recoverable "shouldn't happen"; never put required side
  effects in `check`.

## The meta-rule: match surrounding code

If a file/module already follows a convention (even a local one), follow it over these defaults.
Consistency within a codebase beats global preference. When in doubt, read a nearby engine or
project header (`navigating-engine-source`) and mirror it.

## Gotchas

- **`m_`/snake_case members** — not Unreal style; use PascalCase.
- **Missing `b` on booleans**, missing type prefixes, or file/class name mismatch.
- **`generated.h` not last** / missing `GENERATED_BODY()` → UHT errors.
- **`std::` containers/strings** in engine-facing code.
- **Omitting `override`** → silent non-override when a signature drifts.
- **No `Category`** on exposed reflection members → cluttered editor UI.

## References & source material

Engine source (UE 5.7): read any engine header as a style reference — e.g.
`Runtime/Engine/Classes/GameFramework/Actor.h` — for naming, formatting, include order, and
reflection conventions in practice.

Official docs (UE 5.7): the Epic C++ Coding Standard, under Programming with C++ —
<https://dev.epicgames.com/documentation/unreal-engine/programming-with-cplusplus-in-unreal-engine>

Related: `cpp-fundamentals`, `core-types-and-containers`, `module-and-build-system`.
