---
name: unreal-core-types-and-containers
description: Use Unreal's core types instead of the C++ standard library — containers (TArray,
  TMap, TSet, TArrayView), string types (FString, FName, FText) and when each applies, math
  types (FVector, FRotator, FQuat, FTransform), and utility types (TOptional, TVariant, TTuple).
  Use when writing any UE C++ that stores data, manipulates strings, does math, or when deciding
  between FString/FName/FText or std:: vs Unreal containers.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Core types & containers

Unreal ships its own containers, strings, and math types. Use them, not `std::`: they integrate
with reflection, serialization, allocators, and the rest of the engine. Mixing in `std::string`
or `std::vector` causes friction and won't reflect/serialize.

## When to use this skill

- Storing collections (use `TArray`/`TMap`/`TSet`, not `std::`).
- Any string work — and choosing `FString` vs `FName` vs `FText`.
- Vector/rotation/transform math.
- Reaching for `std::optional`/`std::variant`/`std::tuple` (use the `T*` equivalents).

## Containers

| Type | Use for | Notes |
|---|---|---|
| `TArray<T>` | dynamic array (the default container) | contiguous; `Add`, `Emplace`, `Remove`, `RemoveAtSwap`, `Sort`, `Contains`, `IndexOf` |
| `TMap<K,V>` | key→value | `Add`, `FindOrAdd`, `Find` (returns `V*`), `Contains`, `Remove` |
| `TSet<T>` | unique set | fast `Contains`/`Add` |
| `TArrayView<T>` | non-owning window over contiguous data | pass instead of `const TArray&` when you don't need ownership |
| `TStaticArray`, `TInlineAllocator` | fixed/inline storage | avoid heap for small/known sizes |

```cpp
TArray<AActor*> Actors;
Actors.Add(SomeActor);
for (AActor* A : Actors) { /* ... */ }
Actors.RemoveAll([](AActor* A){ return !IsValid(A); });

TMap<FName, int32> Scores;
Scores.Add(TEXT("p1"), 10);
if (int32* S = Scores.Find(TEXT("p1"))) { (*S)++; }

TSet<FGameplayTag> Tags;
```

`TArray` of UObject pointers stored as a member must still be a `UPROPERTY()` to keep elements
alive (e.g. `UPROPERTY() TArray<TObjectPtr<AActor>> Spawned;`). See `unreal-memory-and-gc`.

## Strings: FString vs FName vs FText (pick the right one)

| Type | Mutable? | Purpose | Compare cost |
|---|---|---|---|
| `FName` | no | identifiers/keys (asset names, bone names, tags, socket names) | O(1), case-insensitive (interned) |
| `FString` | yes | runtime building/parsing/manipulation; not for display to players | O(n) |
| `FText` | n/a | **localized, user-facing** display text | for equality use `EqualTo`/keys |

```cpp
FName Socket = TEXT("hand_r");                       // identifier
FString Path = FString::Printf(TEXT("X=%d"), 5);     // manipulation
FText Label  = NSLOCTEXT("UI", "Start", "Start Game"); // localized display
FText Dyn    = FText::Format(NSLOCTEXT("UI","Hp","HP: {0}"), FText::AsNumber(Hp));
```

Conversions:
- `FString` → `FName`: `FName(*MyString)` or `FName(MyString)`.
- `FName`/`FText` → `FString`: `Name.ToString()`, `Text.ToString()`.
- `FString` → `FText`: `FText::FromString(S)` (use only for non-localized/debug text).
- C string literals must be wrapped in `TEXT("...")` so they're `TCHAR` (UTF-16/wide).

Rules: never build user-facing text with `FString` (it can't localize); never use `FText` as a
map key or identifier; prefer `FName` for anything compared frequently.

## Math types (UE5 = double precision by default)

| Type | Meaning |
|---|---|
| `FVector` | 3D vector (`FVector3d`, doubles in UE5) — location/direction |
| `FVector2D`, `FVector4` | 2D / 4D |
| `FRotator` | pitch/yaw/roll in degrees |
| `FQuat` | quaternion rotation (compose/interpolate rotations) |
| `FTransform` | location + rotation + scale (the actor transform) |
| `FMatrix`, `FBox`, `FBoxSphereBounds`, `FIntPoint`, `FIntVector` | matrices, bounds, integer vectors |

```cpp
FVector Loc = Actor->GetActorLocation();
FVector Fwd = Actor->GetActorForwardVector();
FRotator Rot = (Target - Loc).Rotation();
FTransform T(Rot, Loc, FVector(1.f));
float Dist = FVector::Dist(A, B);
FVector Lerped = FMath::Lerp(A, B, Alpha);
```

`FMath` holds the math helpers (`Clamp`, `Lerp`, `RandRange`, `FInterpTo`, `Abs`, `Min`/`Max`).

## Utility types

- `TOptional<T>` — maybe-a-value (`IsSet()`, `GetValue()`, `Get(Default)`).
- `TVariant<A,B,...>` — one of several types.
- `TTuple<A,B>` — `MakeTuple(a,b)`; access with `Get<0>()`.
- `TPair<K,V>` — key/value pair (what `TMap` iterates).

## Gotchas

- **`std::string`/`std::vector` in UE C++** — avoid; they won't reflect/serialize and clash with
  engine APIs. Use `FString`/`TArray`.
- **Forgetting `TEXT()`** around string literals → narrow `char*`, wrong overloads/encoding.
- **`TMap::Find` returns a pointer** (null if absent) — check before dereferencing.
- **Holding a pointer/reference into a `TArray` across an `Add`** — reallocation invalidates it.
- **`FName` is case-insensitive and not for display**; **`FText` equality** isn't `==`, use `EqualTo`.
- **UE5 doubles:** don't assume `FVector` components are `float`; they're `double`.

## References & source material

Engine source (UE 5.7):
- `Runtime/Core/Public/Containers/Array.h`, `Map.h`, `Set.h`, `ArrayView.h`.
- `Runtime/Core/Public/Containers/UnrealString.h` — `FString`.
- `Runtime/Core/Public/UObject/NameTypes.h` — `FName`.
- `Runtime/Core/Public/Internationalization/Text.h` — `FText`.
- `Runtime/Core/Public/Math/Vector.h`, `Rotator.h`, `Quat.h`, `Transform.h`, `UnrealMathUtility.h` (`FMath`).

Official docs (UE 5.7): Programming with C++ —
<https://dev.epicgames.com/documentation/unreal-engine/programming-with-cplusplus-in-unreal-engine>
