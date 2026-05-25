# Containers — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `TArray`, `TMap`, `TSet`, `TQueue`,
`TArrayView`, allocators, and iteration patterns. Grounded in UE 5.7
(`Runtime/Core/Public/Containers/`).

## TArray

`TArray<T>` (`Containers/Array.h`:669) is the workhorse container — a contiguous, growable
array that owns its elements. Use it unless you have a specific reason to choose something
else.

Key operations:

| Method | Notes |
|---|---|
| `Add(val)` / `Emplace(args...)` | Append; `Emplace` constructs in-place, preferred for non-trivial types |
| `Insert(val, idx)` | O(n); use `Emplace` at end when order doesn't matter |
| `Remove(val)` | Removes all matching, shifting remaining down |
| `RemoveAtSwap(idx)` | O(1) removal — swaps with last element; use when order doesn't matter |
| `RemoveAll(pred)` | Predicate-based batch removal |
| `Contains(val)` | Linear search; use `TSet` for repeated membership tests |
| `Sort(pred)` / `StableSort(pred)` | Quicksort / merge-sort |
| `Reserve(n)` | Pre-allocate to avoid reallocation during known-size additions |
| `Shrink()` | Release unused slack memory |
| `GetData()` | Pointer to raw contiguous buffer; invalidated by any mutation |
| `Num()` | Count of live elements |

```cpp
// Reserve then fill — avoids repeated reallocation
TArray<FVector> Points;
Points.Reserve(1000);
for (int32 i = 0; i < 1000; ++i)
{
    Points.Emplace(FVector(i * 10.0, 0.0, 0.0));
}

// Predicate removal
Points.RemoveAll([](const FVector& V){ return V.X < 0.0; });

// Stable removal while iterating (iterate backwards)
for (int32 i = Points.Num() - 1; i >= 0; --i)
{
    if (!IsValid(SomeActors[i])) { Points.RemoveAt(i); }
}
```

### TArray allocators

The default `FDefaultAllocator` heap-allocates. For performance-critical small arrays:

- `TArray<T, TInlineAllocator<N>>` — first N elements on the stack, spills to heap.
  `TInlineAllocator` is defined at `Containers/ContainerAllocationPolicies.h`:1073.
- `TArray<T, TFixedAllocator<N>>` — fixed capacity, no heap fallback; asserts if exceeded.
  Defined at `Containers/ContainerAllocationPolicies.h`:1275.
- `TStaticArray<T, N>` (`Containers/StaticArray.h`:25) — fixed-size, stack-only, no
  `TArray` API; prefer for truly fixed-size data.

```cpp
// 8-element inline buffer; safe on the stack, no heap unless it grows past 8
TArray<UActorComponent*, TInlineAllocator<8>> Components;
Actor->GetComponents(Components);
```

### UPROPERTY containers and GC

A `TArray` of `UObject*` stored as a member **must** be a `UPROPERTY()` to prevent GC from
collecting the referenced objects:

```cpp
UPROPERTY()
TArray<TObjectPtr<AActor>> SpawnedActors;
```

Without `UPROPERTY`, the array entries can be silently garbage-collected mid-frame.

---

## TMap

`TMap<K, V>` (`Containers/Map.h`, defined via `Map.h.inl`) is a hash map implemented over a
sparse array. Keys are unique; iteration order is unspecified.

```cpp
TMap<FName, int32> ScoreTable;
ScoreTable.Reserve(64);           // pre-size the hash table
ScoreTable.Add(TEXT("Alice"), 10);
ScoreTable.Add(TEXT("Bob"),   20);

// Find — returns V* (null if absent); the idiomatic lookup
if (int32* Score = ScoreTable.Find(TEXT("Alice")))
{
    (*Score) += 5;
}

// FindOrAdd — inserts a default value if the key is missing
int32& BobScore = ScoreTable.FindOrAdd(TEXT("Bob"));
BobScore++;

// Iterate over pairs
for (const TPair<FName, int32>& Pair : ScoreTable)
{
    UE_LOG(LogTemp, Log, TEXT("%s: %d"), *Pair.Key.ToString(), Pair.Value);
}
```

`TMultiMap<K, V>` allows duplicate keys; use `MultiFind` to retrieve all values for a key.

### Custom key types

To use a custom struct as a `TMap` key, either provide `operator==` and a non-member
`GetTypeHash(const T&)` overload, or pass a custom `KeyFuncs` as the fourth template
parameter.

---

## TSet

`TSet<T>` (`Containers/Set.h`, defined via `CompactSet.h.inl` or `ScriptSparseSet.h`
depending on `UE_USE_COMPACT_SET_AS_DEFAULT`) is a hashed set. Use it for fast membership
tests when ordering doesn't matter.

```cpp
TSet<FName> VisitedRooms;
VisitedRooms.Add(TEXT("Library"));
VisitedRooms.Add(TEXT("Library")); // no-op: already present

if (VisitedRooms.Contains(TEXT("Library")))
{
    // constant-time lookup
}
VisitedRooms.Remove(TEXT("Library"));
```

A `TSet<T>` requires `GetTypeHash` and `operator==` for `T`.

---

## TQueue

`TQueue<T>` (`Containers/Queue.h`:47) is a lock-free, singly-linked FIFO queue — thread-safe
for single-producer / single-consumer (SPSC) or multiple-producer / single-consumer (MPSC).

```cpp
TQueue<FHitResult> PendingHits;

// Producer side (can be a different thread in MPSC mode)
PendingHits.Enqueue(SomeHit);

// Consumer side
FHitResult Out;
while (PendingHits.Dequeue(Out))
{
    ProcessHit(Out);
}
```

Do not use `TArray` across threads without an external lock; prefer `TQueue` for producer-
consumer patterns.

---

## TArrayView

`TArrayView<T>` (`Containers/ArrayView.h`) is a non-owning, read-only (or writable with
`TArrayView<T>` rather than `TArrayView<const T>`) view into a contiguous buffer. Pass it
instead of `const TArray<T>&` when the caller doesn't care about ownership, and it avoids
a copy if a raw pointer + size is available.

```cpp
void ProcessPoints(TArrayView<const FVector> Points)
{
    for (const FVector& V : Points) { /* ... */ }
}

// Compatible with TArray, C arrays, and raw pointer+count
TArray<FVector> MyArray = ...;
ProcessPoints(MyArray);                       // implicit conversion
ProcessPoints(TArrayView<const FVector>(RawPtr, Count));
```

---

## Iteration patterns

**Range-for** is preferred for all three main containers:

```cpp
for (const FVector& V : Array)    { /* ... */ }
for (const TPair<FName,int32>& P : Map) { /* P.Key, P.Value */ }
for (const FName& N : Set)        { /* ... */ }
```

**Removing during iteration** — never modify a container while in a range-for loop. Use
`RemoveAll`/predicate for `TArray`, or collect indices to remove then call `RemoveAt` in
reverse, or iterate with explicit indices backwards.

**Explicit iterators** — use `CreateIterator` / `CreateConstIterator` when you need to
remove elements via `It.RemoveCurrent()` (supported on `TArray` iterators).

---

## Version notes

- **UE 5.5+**: `TSet` defaults may use `TCompactSet` internals when
  `UE_USE_COMPACT_SET_AS_DEFAULT` is set. The public API is unchanged.
- Line numbers in headers drift between patch releases. Verify with Grep before citing.
