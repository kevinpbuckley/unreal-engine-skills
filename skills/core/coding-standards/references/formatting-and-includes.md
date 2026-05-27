# Formatting and includes — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers Allman braces, indentation, switch
statements, namespaces, const rules, include order, IWYU, `#pragma once`, API export macros,
and forward declarations. Grounded in UE 5.7 engine headers under `Engine/Source/Runtime/`.

## Brace style (Allman)

Opening braces go on their own line — for functions, control flow, and type bodies. Every
control-flow block must be braced even when it has a single statement:

```cpp
void UMyComponent::BeginPlay()
{
    Super::BeginPlay();

    if (bActivateOnStart)
    {
        Activate();
    }
    else
    {
        Deactivate();
    }
}
```

Inline one-liners are not allowed for control flow or functions of any meaningful length.
This is a hard rule — brace wars end here.

## Indentation

- Use tabs (set to 4 characters wide), not spaces.
- Each logical scope (function body, if/else/for/switch/class) adds one level.
- Spaces are acceptable for alignment within a line when following non-tab characters.

## Switch statements

Provide an explicit comment if a case intentionally falls through. Always include a `default:`
branch even if it only contains `break`:

```cpp
switch (State)
{
    case EDoorState::Closed:
        Close();
        break;

    case EDoorState::Opening:
        // falls through
    case EDoorState::Open:
        NotifyOpen();
        break;

    default:
        break;
}
```

## Const correctness

Const is both documentation and a compiler constraint. Apply it in all of these positions:

```cpp
// 1. Non-mutating member functions
FString GetDisplayName() const;

// 2. Input-only reference and pointer parameters
void Process(const FHitResult& InHit, const TArray<AActor*>& InActors);

// 3. By-value locals/parameters that won't be reassigned
void Foo(const int32 Count)
{
    const int32 Max = Count + 10;
    // ...
}

// 4. Const iteration
for (const FString& Name : NameList)
{
    // Name will not be modified
}
```

Rules to remember:
- **Never** `const` a return-by-value — it inhibits move semantics.
- `const` on a return-by-reference or return-by-pointer is fine.
- `T* const Ptr` — the pointer itself is const (cannot be reassigned); `T` is still mutable.
- `T& const Ref` is illegal (references are inherently non-rebindable).

Engine precedent: every `Get*()` accessor in `Actor.h` and `ActorComponent.h` is `const`.

## `#pragma once`

All UE headers use `#pragma once` instead of traditional include guards. All target compilers
support it. Place it as the very first non-comment line:

```cpp
// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
// ... more includes
#include "MyType.generated.h"
```

Engine examples: `GameFramework/Actor.h`:3, `GameFramework/Character.h`:3,
`Components/ActorComponent.h`:3.

## Include order and IWYU

Unreal uses an Include-What-You-Use discipline: include every header you actually need directly;
do not rely on transitive includes through another header.

Order for a **header** (`.h`):

1. `#pragma once` + copyright
2. `CoreMinimal.h` (or fine-grained core headers — avoids the heavyweight `Core.h`)
3. Engine / module headers this type directly depends on
4. `"<ThisType>.generated.h"` — **always last**, required by UHT

```cpp
// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "MyActor.generated.h"   // MUST be last
```

Order for a **source file** (`.cpp`):

1. The matching `.h` first (the file being implemented)
2. Any additional headers needed for the implementation

```cpp
#include "MyActor.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
```

Do not include the `.generated.h` in a `.cpp` — it belongs in the header.

Engine evidence: `Character.h` lines 5–18 show fine-grained includes ending with
`"Character.generated.h"` at line 18. `Actor.h` lines 5–28 show IWYU-style includes ending
with `"Actor.generated.h"` at line 28.

### Fine-grained vs `CoreMinimal.h`

`CoreMinimal.h` bundles a subset of Core types (`FString`, `TArray`, `FName`, math types)
and is the minimal convenience include for most gameplay headers. It is much lighter than the
old `Core.h` or `Engine.h`. Do not include `Engine.h` in gameplay code.

### Forward declarations

In headers, prefer forward declaring types used only as pointers or references:

```cpp
// MyActor.h
class UStaticMeshComponent;   // forward declare — no full include needed
class AActor;

UCLASS()
class MYGAME_API AMyActor : public AActor
{
    GENERATED_BODY()
    UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Mesh;
};
```

In the corresponding `.cpp`, include the full header:

```cpp
#include "Components/StaticMeshComponent.h"
```

Forward-declared types must be declared in their namespace (if any) to avoid link errors.
Engine example: `ActorComponent.h` lines 27–36 show a cluster of forward declarations
(`class AActor`, `class UWorld`, etc.) before the class body.

## API export macros

Every public type in a module that other modules link to must be marked with its module's
`*_API` macro. UBT generates these from the module name:

```cpp
// Module named "MyGame" → macro is MYGAME_API
UCLASS()
class MYGAME_API AMyPawn : public APawn
{
    GENERATED_BODY()
    ENGINE_API virtual void PossessedBy(AController* NewController) override;
};
```

The macro expands to `__declspec(dllexport)` when building the module and
`__declspec(dllimport)` when consuming it (Windows; other platforms use visibility attributes).
This is defined per-platform in `Core/Public/Windows/WindowsPlatform.h`:213–214.

Without the macro, the linker cannot find the symbol in other modules. Engine examples:
- `ENGINE_API AActor()` at `GameFramework/Actor.h`:262 (constructor export)
- `ENGINE_API virtual void GetLifetimeReplicatedProps(...)` at `GameFramework/Actor.h`:273
- `COREUOBJECT_API UObject()` at `CoreUObject/Public/UObject/Object.h`:102

Inline functions and template specializations do not need the export macro (they are
header-only). Only apply the macro to non-inline methods or free functions that must cross
module boundaries.

## Namespaces

- UHT does not support `UCLASS`/`USTRUCT`/`UENUM` inside a namespace. Keep reflected types
  at global scope.
- New non-reflected APIs should live in a `UE::` namespace (e.g. `UE::Audio::`).
- Implementation details go in a `Private` sub-namespace (e.g. `UE::Audio::Private::`).
- Never put `using` declarations at global scope in a `.cpp` — UBT's unity builds merge
  multiple source files and a global `using` pollutes all of them.
- Macros cannot live in a namespace; use the `UE_` prefix instead.

## Pointer and reference spacing

Attach `*` and `&` to the type, not the name, with one space to the right:

```cpp
FShaderType* Ptr;        // correct
const FHitResult& Hit;   // correct

FShaderType *Ptr;        // wrong
FShaderType * Ptr;       // wrong
```

## No variable shadowing

C++ allows shadowing an outer scope variable, but Unreal prohibits it. A member `Count`,
a parameter `Count`, and a loop variable `Count` in the same class are disallowed — rename
to eliminate ambiguity.

## Source material

Engine source paths verified in UE 5.7:
- `Runtime/Engine/Classes/GameFramework/Actor.h`:3, 28 — `#pragma once`, `generated.h` last.
- `Runtime/Engine/Classes/GameFramework/Character.h`:3, 5, 18 — `CoreMinimal.h` first, `generated.h` last.
- `Runtime/Engine/Classes/Components/ActorComponent.h`:3, 23, 27–36 — `#pragma once`, `generated.h` last, forward decls.
- `Runtime/CoreUObject/Public/UObject/Object.h`:102, 125 — `COREUOBJECT_API` export macro.
- `Runtime/Engine/Classes/GameFramework/Actor.h`:262, 273 — `ENGINE_API` on constructor and virtual.
- `Runtime/Core/Public/Windows/WindowsPlatform.h`:213–214 — `DLLEXPORT`/`DLLIMPORT` definition.
