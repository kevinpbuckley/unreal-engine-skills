# Utility types — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `TOptional`, `TVariant`, `TTuple`,
`TPair`, and related helpers. Grounded in UE 5.7 (`Runtime/Core/Public/`).

## TOptional

`TOptional<T>` (`Misc/Optional.h`:127) is the UE equivalent of `std::optional`. It wraps a
`T` that may or may not be present, without heap allocation.

```cpp
TOptional<FHitResult> Trace(const FVector& Start, const FVector& End)
{
    FHitResult Hit;
    if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility))
        return Hit;          // implicitly constructs TOptional<FHitResult>
    return {};               // empty optional
}

auto Result = Trace(Origin, Target);
if (Result.IsSet())          // IsSet:69 — check before GetValue
{
    ProcessHit(Result.GetValue()); // GetValue:443 — asserts if not set
}
// Or use Get with a default
FHitResult Hit = Result.Get(FHitResult{});  // Get:472
```

**Rules:**
- Always call `IsSet()` before `GetValue()`. Calling `GetValue()` on an empty optional
  triggers a runtime check.
- `Get(Default)` is the safe, concise alternative that returns a fallback without an assert.
- `TOptional<T>` works with any value type — it stores `T` inline (no heap).

---

## TVariant

`TVariant<A, B, ...>` (`Misc/TVariant.h`:42) is a type-safe discriminated union — one of
several pre-declared types at a time, stored inline.

```cpp
using FEvent = TVariant<FPickupEvent, FDamageEvent, FDeathEvent>;

FEvent E;
E.Set<FPickupEvent>(FPickupEvent{ Actor });   // Set and activate the type

if (E.IsType<FPickupEvent>())                 // IsType:140
{
    FPickupEvent& Pickup = E.Get<FPickupEvent>(); // Get:148 — asserts if wrong type
}

// Safe fallback
if (FDamageEvent* D = E.TryGet<FDamageEvent>()) // TryGet:177 — returns pointer, null if wrong type
{
    ApplyDamage(*D);
}
```

**All types in the parameter pack must be unique** — `TVariant` enforces this at
compile-time.

---

## TTuple

`TTuple<A, B, ...>` (`Templates/Tuple.h`:651) is a fixed-size, heterogeneous collection.
Access is by index (compile-time constant) using `Get<N>()`.

```cpp
TTuple<FString, int32, bool> Entry = MakeTuple(TEXT("Player"), 100, true);

FString& Name  = Entry.Get<0>();  // Get:307
int32    Score = Entry.Get<1>();
bool     bAlive = Entry.Get<2>();
```

`TTuple` is useful for returning multiple values from a function without a custom struct.
For two values, `TPair<K, V>` (the element type of `TMap` iteration) is simpler.

```cpp
// Prefer a named struct for anything beyond two or three values
// — TTuple members have no names and callers must know the order.
TTuple<int32, int32> MinMax(const TArray<int32>& Arr)
{
    return MakeTuple(
        *Algo::MinElement(Arr),
        *Algo::MaxElement(Arr));
}
auto [Min, Max] = MinMax(Scores);  // C++17 structured bindings
```

---

## TPair

`TPair<K, V>` is what `TMap` iteration produces. You rarely construct it directly.

```cpp
for (const TPair<FName, int32>& Pair : ScoreMap)
{
    UE_LOG(LogTemp, Log, TEXT("%s = %d"), *Pair.Key.ToString(), Pair.Value);
}
```

---

## Choosing among these types

| Need | Use |
|---|---|
| Maybe-a-value without heap | `TOptional<T>` |
| One-of-N types, known at compile time | `TVariant<A,B,...>` |
| Fixed tuple of heterogeneous values | `TTuple<A,B,...>` |
| Key-value pair (map iteration) | `TPair<K,V>` |
| Polymorphic maybe-value (heap) | `TUniquePtr<Base>` or `TSharedPtr<Base>` |

---

## Version notes

These utility types are stable across UE5. The underlying implementations use C++17
constructs internally (constexpr destructors, `std::conditional_t`) but the public API
does not require callers to use C++17 features explicitly.
