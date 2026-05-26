# Source conventions and naming

Deep-dive companion to [../SKILL.md](../SKILL.md). Grounded in UE 5.7 at
`E:\Program Files\Epic Games\UE_5.7\Engine\Source` (Build.version: 5.7.4).

Covers naming prefixes, the Public/Private/Classes folder convention, how
`*.generated.h` fits in, and Include What You Use (IWYU) rules.

---

## Naming prefixes as navigation hints

UE enforces type-name prefixes through UHT. Knowing the prefix tells you what
kind of type you have and where to look:

| Prefix | Type | Example | Location pattern |
|---|---|---|---|
| `A` | Actor (`AActor` subclass) | `ACharacter`, `AGameMode` | `Classes\GameFramework\` or a gameplay plugin |
| `U` | UObject (`UObject` subclass, non-actor) | `UActorComponent`, `UWidget` | `Classes\Components\`, `UMG\Public\`, plugin `Public\` |
| `F` | Non-UObject struct / class | `FVector`, `FHitResult`, `FGameplayTag` | `Core\Public\`, `Classes\` headers |
| `E` | Enum | `EEndPlayReason`, `ECollisionChannel` | Near the classes that use them (same header) |
| `T` | Template class | `TArray`, `TObjectPtr`, `TSubclassOf` | `Core\Public\Containers\`, `CoreUObject\Public\UObject\` |
| `I` | Interface | `IGameplayTaskOwnerInterface` | Plugin or module `Public\` |
| `G` | Global variable | `GWorld`, `GEngine` | Runtime module globals |
| `s_` or `S` | (rare) singleton statics | — | — |

Prefix violations are a compile error under UHT — the tool will reject a
`UCLASS` whose name does not start with `A` or `U`, a `USTRUCT` without `F`, etc.

---

## Public / Private / Classes folder convention

A module's headers are distributed across three root-level folders:

```
<ModuleName>/
  Classes/     — UCLASS/USTRUCT/UENUM headers (always public; legacy position)
  Public/      — public API headers (not necessarily reflected types)
  Private/     — private headers and all *.cpp files
  <ModuleName>.Build.cs
```

### What goes where

- **`Classes/`** — Historically, UHT required reflected types (`UCLASS`,
  `USTRUCT`, `UENUM`) to live here. The engine still uses this for most gameplay
  classes in the `Engine` module (e.g. `Classes\GameFramework\Actor.h`). New
  modules sometimes put reflected types directly in `Public/` — UHT supports both.

- **`Public/`** — Headers exposed to dependent modules. Any header here may be
  included by code in other modules. Forward declarations only in other modules'
  headers if the type is only used by pointer/reference in a `.cpp`.

- **`Private/`** — Internal headers and all `.cpp` translation units. Nothing
  here is accessible to external modules. Moving a header from `Public/` to
  `Private/` is a breaking API change for any module that included it.

### Include path convention (IWYU)

Under UE's Include What You Use (IWYU) model, the `#include` path is relative to
the module's `Public/` or `Classes/` root — not a project-absolute path.

Examples from the `Engine` module:
```cpp
#include "GameFramework/Actor.h"         // Classes/GameFramework/Actor.h
#include "Components/StaticMeshComponent.h" // Classes/Components/StaticMeshComponent.h
#include "Engine/World.h"                // Classes/Engine/World.h
#include "Kismet/GameplayStatics.h"      // Classes/Kismet/GameplayStatics.h
```

Examples from `Core`:
```cpp
#include "CoreMinimal.h"                 // Core/Public/CoreMinimal.h
#include "Containers/Array.h"            // Core/Public/Containers/Array.h
#include "Math/Vector.h"                 // Core/Public/Math/Vector.h
```

**Rule:** start every header with `#include "CoreMinimal.h"` (or `CoreTypes.h` in
low-level headers), then include only the specific headers you use. Do not use
monolithic headers like `Engine.h` or `UnrealEd.h` in new code.

---

## The *.generated.h file

Every reflected header (`UCLASS`, `USTRUCT`, `UENUM`) must include its generated
counterpart as the **last** include in the file:

```cpp
// MyActor.h
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "MyActor.generated.h"   // MUST be last
```

The `*.generated.h` file is produced by Unreal Header Tool (UHT) during the
build phase before the C++ compiler runs. It contains:
- The `GENERATED_BODY()` macro expansion (reflection tables, `StaticClass()`,
  virtual dispatch stubs, etc.)
- `DECLARE_SERIALIZER` and related boilerplate.

**Never edit `*.generated.h`** — it is regenerated on every build. The generated
files are placed under the module's `Intermediate/` folder, not in `Source/`.

The `GENERATED_BODY()` macro must appear as the **first statement** in the class
body. Placing anything before it causes a UHT parse error.

---

## Build.cs essentials

Every module has exactly one `<ModuleName>.Build.cs` in its root. The file:
- Declares the class `<ModuleName> : ModuleRules`.
- Lists `PublicDependencyModuleNames` and `PrivateDependencyModuleNames`.
- Optionally sets `PCHUsage`, `bEnforceIWYU`, platform conditions, defines.

Key rules:
- **Public vs Private dependency**: use `PublicDependencyModuleNames` only if a
  dependent module's *public headers* reference the dependency's types. Otherwise
  prefer `PrivateDependencyModuleNames` to avoid propagating the dependency chain.
- **Finding the module name**: the module name equals the folder under `Source/`
  that contains the `.Build.cs` — e.g., folder `Runtime\GameplayTags\` → module
  name `"GameplayTags"`.
- **Plugin modules**: add the module name to `Build.cs` as normal; also ensure
  the plugin is listed (and enabled) in the `.uproject` or `.uplugin` file.

---

## Common naming and include pitfalls

| Mistake | Symptom | Fix |
|---|---|---|
| Class prefix wrong (`class MyActor` instead of `AMy...`) | UHT error: "type does not comply with naming convention" | Rename; A for actors, U for UObjects, F for structs |
| `*.generated.h` not last include | Compiler: redefinition or mysterious macro errors | Move it to the last `#include` |
| `GENERATED_BODY()` not first in class | UHT parse error | Put it immediately after `{` |
| Including `Engine.h` monolith | Build warning; pulls in enormous dependency | Include only specific headers you need |
| Editor header included in Runtime code | Linker error in Shipping or missing symbol | Wrap in `#if WITH_EDITOR` or move to Editor module |
| Wrong `#include` path (absolute instead of relative-to-module) | Include not found across modules | Use the relative form: `"GameFramework/Actor.h"` not `"Runtime/Engine/Classes/GameFramework/Actor.h"` |
| Missing module in `Build.cs` | "Identifier not found" or "unresolved external symbol" | Add the module to `Public/PrivateDependencyModuleNames` |

---

## Version notes

The Public/Private/Classes convention and UHT/IWYU rules are stable across UE5.
Plugin module layout (matching `Source/<Module>/Public/` etc.) has been consistent
since UE4. The `TObjectPtr<T>` member idiom (replacing raw `T*` in UPROPERTYs) was
introduced in UE5.0 and is the preferred form in UE 5.7 — both compile and behave
correctly, but `TObjectPtr` participates in access tracking and is the engine's
current standard. See the `cpp-fundamentals` and `memory-and-gc` skills for detail.
