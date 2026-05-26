---
name: core-types-and-containers
description: Use Unreal's core C++ types instead of the standard library — containers
  (TArray, TMap, TSet, TQueue, TArrayView), string types (FString, FName, FText,
  TStringBuilder) with conversion patterns and localization rules, math types (FVector,
  FRotator, FQuat, FTransform) with Large World Coordinates (LWC/double precision), and
  utility types (TOptional, TVariant, TTuple). Use when writing any UE C++ that stores
  collections, manipulates strings, does 3D math, or when choosing between FString/FName/
  FText, between std:: and UE containers, or between FRotator and FQuat for rotation.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Core types & containers

Unreal ships its own containers, string types, and math types. Use them, not `std::`:
they integrate with UObject reflection, serialization, allocators, and garbage collection.
Mixing in `std::string` or `std::vector` causes friction and these types won't serialize
or reflect correctly.

## When to use this skill

- Storing collections: choose `TArray`/`TMap`/`TSet` over `std::vector`/`std::map`/`std::set`.
- String work: pick `FString` (mutable), `FName` (identifier), or `FText` (user-facing / localized).
- 3D math: `FVector`, `FRotator`, `FQuat`, `FTransform`, and `FMath` helpers.
- Reaching for `std::optional`, `std::variant`, or `std::tuple`: use `TOptional`, `TVariant`, `TTuple`.
- Thread-safe producer/consumer: `TQueue` over a locked `TArray`.

## Containers at a glance

| Type | Use for | Key property |
|---|---|---|
| `TArray<T>` | dynamic array (default container) | contiguous, owning, serializable |
| `TMap<K,V>` | key→value | hashed, unique keys, O(1) avg lookup |
| `TSet<T>` | unique set | hashed, O(1) avg membership test |
| `TQueue<T>` | FIFO, cross-thread | lock-free SPSC/MPSC |
| `TArrayView<T>` | non-owning read-only window | zero-copy; pass over contiguous data |
| `TArray<T, TInlineAllocator<N>>` | small array, avoid heap | N elements on stack, spills to heap |

### TArray — the default container

```cpp
TArray<FVector> Waypoints;
Waypoints.Reserve(64);                          // pre-size; avoids reallocations
Waypoints.Emplace(100.0, 200.0, 0.0);          // construct in-place; prefer over Add
Waypoints.Emplace(300.0, 400.0, 0.0);

for (const FVector& W : Waypoints) { /* ... */ }

// Predicate removal — no iterator invalidation
Waypoints.RemoveAll([](const FVector& V){ return V.Z < 0.0; });

// O(1) removal when order doesn't matter
Waypoints.RemoveAtSwap(0);

// Sort with a predicate
Waypoints.Sort([](const FVector& A, const FVector& B){ return A.X < B.X; });
```

**GC rule:** a `TArray` of `UObject` pointers stored as a member must be a `UPROPERTY()`:
```cpp
UPROPERTY()
TArray<TObjectPtr<AActor>> Spawned;  // GC keeps entries alive
```

### TMap

```cpp
TMap<FName, int32> Scores;
Scores.Reserve(32);
Scores.Add(TEXT("Alice"), 10);

// Idiomatic lookup — returns V* (null if missing)
if (int32* S = Scores.Find(TEXT("Alice")))
    (*S)++;

// Insert or get existing
int32& BobScore = Scores.FindOrAdd(TEXT("Bob"));  // inserts 0 if absent

// Iterate pairs
for (const TPair<FName, int32>& P : Scores)
    UE_LOG(LogGame, Log, TEXT("%s=%d"), *P.Key.ToString(), P.Value);
```

### TSet

```cpp
TSet<FName> Visited;
Visited.Add(TEXT("Level_A"));          // no-op if already present
bool bSeen = Visited.Contains(TEXT("Level_A"));  // O(1)
Visited.Remove(TEXT("Level_A"));
```

### TQueue (thread-safe FIFO)

```cpp
TQueue<FHitResult> PendingHits;   // SPSC by default
PendingHits.Enqueue(Hit);         // producer (can be off game thread)

FHitResult Out;
while (PendingHits.Dequeue(Out))  // consumer (game thread)
    ProcessHit(Out);
```

See [references/containers.md](references/containers.md) for `TArrayView`, allocators,
iteration patterns, and GC/UPROPERTY rules.

## Strings: choose the right type

| Type | Mutable? | Purpose | Compare cost |
|---|---|---|---|
| `FName` | no | identifiers, keys, asset names, bone/socket names | O(1), case-insensitive |
| `FString` | yes | runtime build/parse/format; not for player-facing text | O(n) |
| `FText` | n/a | **localized user-facing text** | use `EqualTo()` not `==` |

```cpp
FName   Socket = TEXT("hand_r");                            // interned identifier
FString Path   = FString::Printf(TEXT("/Game/%s"), *Map);   // runtime manipulation
FText   Label  = NSLOCTEXT("UI", "Start", "Start Game");    // localized display
FText   HpText = FText::Format(
    NSLOCTEXT("UI", "HpFmt", "HP: {0}/{1}"),
    FText::AsNumber(Hp), FText::AsNumber(MaxHp));
```

### Key conversions

```cpp
FString S = Name.ToString();           // FName → FString
FName   N = FName(*SomeFString);       // FString → FName  (case-insensitive; lossy)
FText   T = FText::FromString(S);      // FString → FText  (not localizable; debug only)
bool bSame = TextA.EqualTo(TextB);     // FText equality — never operator==
```

### TStringBuilder — efficient string building

Prefer `TStringBuilder<N>` over repeated `+=` on `FString`. The N-character stack buffer
avoids heap allocation for most outputs.

```cpp
TStringBuilder<256> B;
B << TEXT("Actor=") << *Actor->GetName();
B.Appendf(TEXT(" X=%.1f"), Loc.X);
FString Result(B);
```

`TStringBuilder<N>` is the alias defined at `Containers/StringFwd.h`:30 for
`TStringBuilderWithBuffer<TCHAR, N>` (`Misc/StringBuilder.h`:508).

See [references/strings-and-text.md](references/strings-and-text.md) for the full
conversion matrix, `FStringView`, string tables, encoding rules, and `NSLOCTEXT` vs
`LOCTEXT`.

## Math types (UE5 = double precision everywhere)

All primary math types are `double` in UE5 (Large World Coordinates). Float variants
(`FVector3f`, `FQuat4f`, etc.) exist for rendering/physics payloads.

| Type | Meaning |
|---|---|
| `FVector` | 3D point/direction (`double X,Y,Z`); `TVector<double>` |
| `FRotator` | pitch/yaw/roll in degrees; intuitive but prone to gimbal lock |
| `FQuat` | quaternion; compose/interpolate rotations without gimbal lock |
| `FTransform` | location + rotation + scale; the actor/component transform |
| `FVector2D`, `FVector4` | 2D and 4D variants |
| `FMatrix` | 4×4 double matrix |
| `FBox`, `FBoxSphereBounds` | axis-aligned bounds, sphere bounds |
| `FIntVector`, `FIntPoint` | integer vector/point |

```cpp
FVector Loc  = Actor->GetActorLocation();
FVector Fwd  = Actor->GetActorForwardVector();
double  Dist = FVector::Dist(A, B);           // Dist:1017

FQuat Q    = Actor->GetActorQuat();
FQuat Rot  = FQuat(FVector::UpVector, FMath::DegreesToRadians(45.0));
FQuat Comp = Q * Rot;                         // compose: apply Q then Rot

FQuat Blended = FQuat::Slerp(Q, Target, Alpha); // smooth interpolation

FTransform T = Actor->GetActorTransform();
FVector LocalPt = T.InverseTransformPosition(WorldPt);

// FMath helpers
float Clamped   = FMath::Clamp(Val, 0.f, 1.f);
float Lerped    = FMath::Lerp(A, B, Alpha);
float Smoothed  = FMath::FInterpTo(Current, Target, DeltaTime, Speed);
```

**Gimbal-lock rule:** use `FRotator` for editor-facing properties and single-axis tweaks;
use `FQuat` whenever composing or interpolating multiple rotations in code.

See [references/math-types.md](references/math-types.md) for per-type APIs, LWC pitfalls,
`FMath` reference, and version notes.

## Utility types

```cpp
// TOptional<T> — maybe-a-value, no heap
TOptional<FHitResult> MaybeHit = DoTrace(Start, End);
if (MaybeHit.IsSet())
    Process(MaybeHit.GetValue());

// TVariant<A,B,...> — type-safe discriminated union
using FGameEvent = TVariant<FPickupEvent, FDamageEvent>;
FGameEvent Ev;
Ev.Set<FPickupEvent>({Actor});
if (FPickupEvent* P = Ev.TryGet<FPickupEvent>()) { /* ... */ }

// TTuple<A,B,...> — heterogeneous fixed-size tuple
TTuple<FString, int32> NameScore = MakeTuple(TEXT("Alice"), 100);
FString Name  = NameScore.Get<0>();
int32   Score = NameScore.Get<1>();

// TPair<K,V> — produced by TMap iteration
for (const TPair<FName, int32>& P : ScoreMap) { /* P.Key, P.Value */ }
```

See [references/utility-types.md](references/utility-types.md) for usage rules, `Get` vs
`TryGet`, C++17 structured bindings, and when to prefer a named struct over `TTuple`.

## Gotchas

- **`std::string`/`std::vector` in UE C++** — avoid; they skip reflection/serialization
  and don't interact with GC. Use `FString`/`TArray`.
- **Missing `TEXT()`** around literals — produces narrow `char*`; implicit conversion may
  silently mangle non-ASCII characters.
- **`TMap::Find` returns a pointer** (null if absent) — always null-check before
  dereferencing. `operator[]` asserts if the key is missing.
- **Holding a pointer into a `TArray` across an `Add`** — `Add` may reallocate;
  previously obtained `GetData()` pointers or element references are then invalid.
- **`FName` is case-insensitive** — `FName("Hand_R") == FName("hand_r")`; never use it
  where case matters.
- **`FText` equality is `EqualTo()`**, not `==` — `operator==` compares internal identity,
  not display strings.
- **`FVector` components are `double`** — assigning `.X` to a `float` variable narrows.
  Use `(float)V.X` explicitly when interfacing with float-only APIs.
- **Composing rotations with `FRotator +`** — does not produce correct multi-axis results;
  use `FQuat` multiplication instead.
- **`TOptional::GetValue()` on an unset optional** — runtime check failure; call `IsSet()`
  first, or use `Get(DefaultValue)`.
- **`TQueue` is not iterable** — it is write-only from the producer side and dequeue-only
  from the consumer side; no `Num()` or range-for.

## Version notes

- **UE5+:** All primary math types are `double` (Large World Coordinates / LWC). Float
  variants (`FVector3f`, `FRotator3f`, `FTransform3f`, `FQuat4f`) exist for rendering
  and physics payloads; do not mix with double variants without explicit conversion.
- **UE 5.3:** `TWriteToString<N>` deprecated; use `TStringBuilder<N>`.
- **UE 5.5+:** `TSet` may internally use `TCompactSet`; the public API is unchanged.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/Core/Public/`):
- `Containers/Array.h`:669 — `TArray<T>` template class; `Contains`:1518, `Reserve`:3016,
  `Sort`:3418.
- `Containers/Map.h` (via `Map.h.inl`) — `TMap<K,V>`; uses sparse-array + hash bucket
  backing.
- `Containers/Set.h` — `TSet<T>`.
- `Containers/Queue.h`:47 — `TQueue<T>`, `Enqueue`:123, `Dequeue`:80, `IsEmpty`:206.
- `Containers/ArrayView.h` — `TArrayView<T>`.
- `Containers/ContainerAllocationPolicies.h`:1073 — `TInlineAllocator`; :1275 — `TFixedAllocator`.
- `Containers/StaticArray.h`:25 — `TStaticArray<T,N>`.
- `Containers/UnrealString.h` (impl in `UnrealString.h.inl`:54) — `FString`; `Printf`:1423,
  `Format`:1465, `FromInt`:2023.
- `Containers/StringFwd.h`:21 — `FStringBuilderBase`; :30 — `TStringBuilder<N>` alias.
- `Misc/StringBuilder.h`:78 — `TStringBuilderBase`; `Append`:238, `Appendf`:419.
- `UObject/NameTypes.h`:616 — `FName`; `ToString`:675.
- `Internationalization/Text.h`:384 — `FText`; `Format`:647, `FromString`:497,
  `EqualTo`:571, `AsNumber`:407.
- `Misc/Optional.h`:127 — `TOptional<T>`; `IsSet`:69 (via base), `GetValue`:443, `Get`:472.
- `Misc/TVariant.h`:42 — `TVariant<T,Ts...>`; `IsType`:140, `Get`:148, `TryGet`:177.
- `Templates/Tuple.h`:651 — `TTuple<...>`; `MakeTuple`:58, `Get<N>()`:307.
- `Math/MathFwd.h`:47 — type aliases: `FVector`, `FQuat`:50, `FTransform`:53, `FRotator`:57.
- `Math/Vector.h`:50 — `TVector<T>`; `Dist`:1017, `DotProduct`:265, `CrossProduct`:240,
  `GetSafeNormal`:649, `Normalize`:632.
- `Math/Quat.h`:38 — `TQuat<T>`; `Slerp`:660, `MakeFromEuler`:374.
- `Math/TransformVectorized.h`:61 — `TTransform<T>`; `GetLocation`:602, `GetScale3D`:1240,
  `TransformPosition`:565, `InverseTransformPosition`:570.
- `Math/UnrealMathUtility.h` — `FMath`; `Clamp`:592, `Lerp`:1116, `FInterpTo`:1502,
  `FInterpConstantTo`:1483, `RandRange`:289.

Official docs (UE 5.7):
- Containers overview — <https://dev.epicgames.com/documentation/unreal-engine/containers-in-unreal-engine>
- TArray — <https://dev.epicgames.com/documentation/unreal-engine/array-containers-in-unreal-engine>
- TMap — <https://dev.epicgames.com/documentation/unreal-engine/map-containers-in-unreal-engine>
- TSet — <https://dev.epicgames.com/documentation/unreal-engine/set-containers-in-unreal-engine>
- String Handling — <https://dev.epicgames.com/documentation/unreal-engine/string-handling-in-unreal-engine>

Deep-dive references in this skill:
- [references/containers.md](references/containers.md) — `TArray` allocators, `TQueue`,
  `TArrayView`, iteration patterns, GC/UPROPERTY rules.
- [references/strings-and-text.md](references/strings-and-text.md) — full conversion matrix,
  `TStringBuilder`, `FStringView`, string tables, `NSLOCTEXT` vs `LOCTEXT`, encoding.
- [references/math-types.md](references/math-types.md) — per-type APIs, LWC/double pitfalls,
  `FMath` reference, `FQuat` composition convention.
- [references/utility-types.md](references/utility-types.md) — `TOptional`, `TVariant`,
  `TTuple`, `TPair`, selection guide.
