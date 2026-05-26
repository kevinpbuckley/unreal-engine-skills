# Naming conventions — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers every type-prefix rule, identifier
conventions, boolean naming, enum style, macros, template parameters, and the `Out`/`In`
parameter patterns. Grounded in UE 5.7 and demonstrated by engine headers under
`Engine/Source/Runtime/`.

## Type prefixes (mandatory)

UnrealHeaderTool (UHT) enforces these for reflected types. Mismatches are a compile error.

| Prefix | Applies to | Engine example |
|---|---|---|
| `U` | Any class inheriting `UObject` (non-actor) | `UActorComponent` (`Components/ActorComponent.h`:151) |
| `A` | Any class inheriting `AActor` | `AActor` (`GameFramework/Actor.h`:256), `ACharacter` (`GameFramework/Character.h`:241) |
| `F` | Plain structs and non-UObject classes | `FAttachmentTransformRules` (`Engine/EngineTypes.h`:74) |
| `E` | Enum and enum class | `EAttachmentRule` (`Engine/EngineTypes.h`:61) |
| `I` | Abstract interface classes (paired with a `U` shell for UHT) | `IInterface_AssetUserData` (`Interfaces/Interface_AssetUserData.h`:19) |
| `T` | Class templates | `TArray` (`Containers/Array.h`:669), `TObjectPtr` |
| `S` | Slate widget classes | `SWidget`, `SCompoundWidget` |
| `G` | Global singleton objects (rare; e.g. `GEngine`) | — |
| `b` | Boolean variable or member | `bReplicates` (`GameFramework/Actor.h`:556), `bWantsInitializeComponent` (`Components/ActorComponent.h`:331) |

The letter after the prefix begins with uppercase and words are PascalCase: `UMyHealthComponent`,
`ASpaceshipPawn`, `FPlayerStats`. The class/struct name must match the filename without the prefix:
`UMyHealthComponent` → `MyHealthComponent.h`.

`C` is used for Epic's concept-alike constraint structs (rare in gameplay code; you will see it in
the engine source for template constraints). Typedef a template instantiation with the appropriate
prefix: `typedef TArray<FMyType> FArrayOfMyTypes;`.

## PascalCase rules

All types, functions, member variables, and local variables use PascalCase (UpperCamelCase). No
`m_` prefix, no `_` snake_case, no `camelCase` for any Unreal identifier.

```cpp
// Correct Unreal naming
int32   MaxHealth;        // member — PascalCase, no m_
float   AttackRadius;
bool    bIsStunned;       // boolean — b prefix + PascalCase

void    ApplyDamage(float DamageAmount);   // function — verb phrase, PascalCase params
FString GetDisplayName() const;            // accessor — "Get" verb, returns something
bool    IsAlive() const;                   // bool query — asks a question
```

No underscores between words. Abbreviations are kept well-known and consistent (`AI`, `GC`, `HUD`,
`LOD`). The greater the scope, the more descriptive: local loop variables may be shorter, but types
and members that live in headers should be fully spelled out.

## Boolean naming rules

All boolean variables — members, locals, parameters — must start with lowercase `b`:

```cpp
bool bIsDead;            // state query
bool bHasKey;
bool bReplicates;        // engine example, Actor.h:556

// Function names (bool return) ask a true/false question:
bool IsVisible() const;
bool ShouldClearBuffer() const;
bool HasActiveTasks() const;
```

Never name a bool `Dead`, `HasKey`, or `Flag1`. The `b` prefix signals intent to readers and
is required for reflection tooling consistency.

## Enum style

Use `enum class` backed by `uint8` for any enum exposed to Blueprints. The enum type takes the `E`
prefix; values are PascalCase (no `ECB_Red`-style enum-name-prefix):

```cpp
// Correct — enum class, E prefix, uint8 backing, PascalCase values
UENUM(BlueprintType)
enum class EDoorState : uint8
{
    Closed,
    Opening,
    Open,
    Closing,
};

// Flag enums — use ENUM_CLASS_FLAGS and a None = 0 sentinel
UENUM()
enum class EActorFlags : uint8
{
    None    = 0x00,
    Hidden  = 0x01,
    Static  = 0x02,
};
ENUM_CLASS_FLAGS(EActorFlags)
```

Old-style `namespace + enum Type` patterns still exist in the codebase but should not be used
in new code. Checking flags: compare against `EActorFlags::None` rather than using the raw value
in a truth context (language limitation with scoped enums).

`EAttachmentRule : uint8` at `Engine/EngineTypes.h`:61 is a representative engine example.

## Function and method naming

- Functions that have an effect: strong verb + object. `ApplyDamage`, `SpawnProjectile`,
  `SetCollisionEnabled`.
- Functions that return a value describe the return: `GetOwner`, `IsAlive`, `HasLineOfSight`.
- Avoid `Handle` and `Process` prefixes — they are vague.
- Output parameters by reference should be prefixed `Out`: `void GetActors(TArray<AActor*>& OutActors)`.
  If also boolean: `bool bOutResult`.
- Input reference parameters that won't be modified: `const FHitResult& InHit`.

## Macro naming

Macros use `UPPER_CASE_WITH_UNDERSCORES` and carry a `UE_` prefix:

```cpp
#define UE_MY_CUSTOM_MACRO  1
```

The engine follows this: `UE_LOG`, `UE_BUILD_SHIPPING`, `UPROPERTY`, `UCLASS` (the reflection
macros are an established exception — no `UE_` prefix there).

## Template parameter naming

Template type parameters are not subject to the type-prefix rules (the category is unknown). Use
descriptive names. When a class exposes a `using` alias based on a template parameter, use an
`In` prefix on the template parameter to distinguish it from the alias:

```cpp
template <typename InElementType>
class TContainer
{
public:
    using ElementType = InElementType;
};
```

## Interface class pairing

A UE interface always comes in two parts:
- `UMyInterface` — the UObject shell, required for reflection (`UINTERFACE()`).
- `IMyInterface` — the abstract C++ interface that gameplay code implements.

```cpp
// MyInterface.h
#pragma once
#include "UObject/Interface.h"
#include "MyInterface.generated.h"

UINTERFACE(MinimalAPI, BlueprintType)
class UMyInterface : public UInterface
{
    GENERATED_BODY()
};

class IMyInterface
{
    GENERATED_BODY()
public:
    virtual void DoThing() = 0;
};
```

Engine example: `UInterface_AssetUserData` / `IInterface_AssetUserData` at
`Engine/Source/Runtime/Engine/Classes/Interfaces/Interface_AssetUserData.h`:13–19.

## Source material

- `GameFramework/Actor.h`:255–256 — `UCLASS()` / `class AActor : public UObject` showing A prefix.
- `GameFramework/Actor.h`:556 — `uint8 bReplicates:1` showing b prefix on bitfield bool.
- `GameFramework/Character.h`:240–241 — `class ACharacter` showing A prefix on a derived actor.
- `Components/ActorComponent.h`:150–151 — `class UActorComponent` showing U prefix.
- `Components/ActorComponent.h`:331 — `uint8 bWantsInitializeComponent:1` showing b prefix.
- `Engine/EngineTypes.h`:61 — `enum class EAttachmentRule : uint8` showing E prefix + uint8 backing.
- `Engine/EngineTypes.h`:74 — `struct FAttachmentTransformRules` showing F prefix on a struct.
- `Interfaces/Interface_AssetUserData.h`:13–19 — U/I interface pair pattern.
- `Containers/Array.h`:669 — `class TArray` showing T prefix on a template class.
