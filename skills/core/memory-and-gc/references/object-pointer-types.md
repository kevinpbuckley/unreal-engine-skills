# UObject pointer types — depth reference

Deep dive for [../SKILL.md](../SKILL.md). Covers all UObject pointer types available in UE 5.7,
their GC semantics, serialization support, and correct usage patterns.
Grounded in UE 5.7 (`Engine/Source/Runtime/CoreUObject/`).

## Summary table

| Type | UPROPERTY? | Keeps alive? | Serialized? | Networked? | Use case |
|---|---|---|---|---|---|
| `T*` raw | optional* | only if UPROPERTY | only if UPROPERTY | only if UPROPERTY | locals, params, short-lived refs |
| `TObjectPtr<T>` | yes | yes (with UPROPERTY) | yes | yes | owned UObject members in UE5 |
| `TWeakObjectPtr<T>` | optional | no | yes | yes | non-owning observer; auto-nulled on GC |
| `TSoftObjectPtr<T>` | yes | no (path only) | yes | yes | async-loaded assets |
| `TStrongObjectPtr<T>` | no | yes (always) | no | no | non-UObject owner |
| `TLazyObjectPtr<T>` | yes | no | yes | no | deprecated; use `TSoftObjectPtr` |

*Raw pointers marked `UPROPERTY` are GC-visible and serialized, but do not get the incremental
GC write barrier. Prefer `TObjectPtr` for new code.

## TObjectPtr\<T\>

`TObjectPtr` is a drop-in replacement for a raw UObject pointer that adds:

- A **GC write barrier** required for incremental GC marking. When the pointer is reassigned,
  the barrier informs the GC that the reference graph changed, so the in-progress mark pass
  remains consistent.
- **Cook-time dependency tracking** for the asset pipeline.
- **Editor access tracking** and optional lazy-load support via object handles.

Declared at `Runtime/CoreUObject/Public/UObject/ObjectPtr.h`. The underlying `FObjectPtr`
struct wraps an `FObjectHandle`. In non-editor builds, the handle reduces to a plain pointer with
no runtime overhead.

```cpp
UPROPERTY(VisibleAnywhere)
TObjectPtr<UMaterialInstance> Mat;   // preferred over UMaterialInstance* in UE5
```

`TObjectPtr` without `UPROPERTY` is **not GC-safe** — the pointer itself holds no GC reference;
only the `UPROPERTY` annotation makes it visible to the collector.

## TWeakObjectPtr\<T\>

A weak reference to a UObject. The pointer is stored as an object index + serial number pair;
when the object is collected, the GC zeroes the serial number and future `.Get()` / `.IsValid()`
calls return null / false automatically.

Declared at `Runtime/CoreUObject/Public/UObject/WeakObjectPtr.h`.

```cpp
TWeakObjectPtr<AActor> CachedTarget;

// Usage — always check before dereferencing
if (AActor* T = CachedTarget.Get())
{
    T->DoThing();
}

// Pin to a strong ref for a multi-step operation:
TStrongObjectPtr<AActor> Pinned = CachedTarget.Pin();
if (Pinned)
{
    Pinned->MultiStepWork();
}
```

`TWeakObjectPtr` can optionally be marked `UPROPERTY()` — this serializes the reference but does
**not** keep the target alive (weak semantics are preserved). Omitting `UPROPERTY` is fine for
transient runtime caches.

`TWeakObjectPtr` cannot be used as a `TMap` key or `TSet` element; use `TObjectKey<T>` for that.

## TSoftObjectPtr\<T\>

Stores an `FSoftObjectPath` (a string path) rather than a live pointer. The target object is not
loaded until explicitly requested. The pointer toggles between valid and pending as the target
loads and unloads.

Declared at `Runtime/CoreUObject/Public/UObject/SoftObjectPtr.h`.

```cpp
UPROPERTY(EditAnywhere)
TSoftObjectPtr<UTexture2D> SplashTexture;

// Synchronous load (blocks; avoid on game thread for large assets)
UTexture2D* Tex = SplashTexture.LoadSynchronous();

// Async load via FStreamableManager (preferred for content assets)
// See asset-management skill for the full pattern.
```

`TSoftObjectPtr` is the recommended replacement for the deprecated `TLazyObjectPtr`. It correctly
handles redirectors, package renames, and cook-time dependency resolution.

## TStrongObjectPtr\<T\>

A ref-counted strong reference intended for **non-UObject owners** (plain `F*` classes, test
fixtures, RAII guards). It holds the target alive through a reference registered with
`UGCObjectReferencer`, the same mechanism `FGCObject` uses.

Declared at `Runtime/Core/Public/UObject/StrongObjectPtrTemplates.h`:25.

Key rules:
- Cannot be marked `UPROPERTY`. Do not put it in a `UCLASS` — this creates an uncollectable cycle.
- Creating/destroying a `TStrongObjectPtr` is more expensive than a raw pointer (atomic ops +
  GC registration). Prefer it for long-lived references, not per-frame transients.
- Use `TWeakObjectPtr::Pin()` to produce a temporary `TStrongObjectPtr` when you need to protect
  a weak reference for the duration of a single operation.

```cpp
// Good: non-UObject owner needing a strong reference
class FAssetCache
{
    TStrongObjectPtr<UTexture2D> CachedIcon;   // keeps texture alive
};

// Bad: inside a UCLASS without UPROPERTY
UCLASS()
class UMySystem : public UObject
{
    // TStrongObjectPtr<UMySystem> Self;  // do NOT do this — uncollectable cycle
};
```

## Choosing a UObject pointer type — decision tree

1. Is the pointer a member of a `UCLASS` or `USTRUCT`?
   - Yes, and it **owns** / keeps the target alive → `UPROPERTY() TObjectPtr<T>`
   - Yes, and it's a **non-owning** observer → `TWeakObjectPtr<T>` (optionally `UPROPERTY`)
   - Yes, and it's an **asset** you load on demand → `UPROPERTY() TSoftObjectPtr<T>`
2. Is the pointer in a plain `F*` class that needs to keep a UObject alive?
   - Use `TStrongObjectPtr<T>` or inherit from `FGCObject`.
3. Is the pointer a local variable or parameter?
   - Use a raw `T*` — it's fine for short-lived stack references.

## Version notes

- `TObjectPtr` was introduced in UE5 as the modern default. UE4 codebases use raw `T* UPROPERTY`;
  both compile in 5.7 but `TObjectPtr` is required for incremental GC write barriers.
- `TLazyObjectPtr` is deprecated in 5.7 (marked for future removal); migrate to `TSoftObjectPtr`.
- `TWeakObjectPtr` zero-initialization semantics changed in 5.6 (`UE_WEAKOBJECTPTR_ZEROINIT_FIX`);
  default construction now correctly yields a null pointer.
