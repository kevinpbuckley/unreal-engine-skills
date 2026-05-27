---
name: memory-and-gc
description: Manage UObject lifetime and plain C++ memory in Unreal Engine. Covers the garbage
  collector reachability cycle and root set, keeping UObjects alive with UPROPERTY and TObjectPtr,
  non-owning TWeakObjectPtr, path-only TSoftObjectPtr, TStrongObjectPtr for non-UObject owners,
  FGCObject::AddReferencedObjects, AddToRoot/RemoveFromRoot, MarkAsGarbage and IsValid checks,
  and the non-UObject smart pointers TSharedPtr/TSharedRef/TWeakPtr/TUniquePtr and MakeShared.
  Use when choosing a pointer or ownership type, debugging crashes after garbage collection,
  investigating dangling pointer or use-after-free bugs, holding UObjects from non-UObject
  classes, or picking between TSharedPtr and TUniquePtr for plain C++ objects.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Memory & garbage collection

Unreal has **two** memory worlds: garbage-collected `UObject`s managed by the engine's GC, and
ordinary C++ heap objects you manage with smart pointers or RAII. Mixing them up causes most UE
crashes. The one rule that prevents the majority of them: **a UObject stays alive only while
something reachable from the root set holds it in a `UPROPERTY` (or an equivalent GC-tracked
reference).**

## When to use this skill

- Choosing which pointer type to use for a UObject or plain C++ object.
- Crash after a few seconds or after a level load — the classic "GC collected it" symptom.
- A non-UObject class (subsystem helper, Slate widget, RAII guard) needs to keep a UObject alive.
- "Why is my pointer suddenly null or garbage?" debugging.
- Deciding between `TSharedPtr`, `TSharedRef`, `TUniquePtr`, or `FGCObject` for a new type.

See also: `cpp-fundamentals` for UObject/UPROPERTY/UFUNCTION macro basics; `actors-and-components`
for actor ownership and component lifetime.

## How UObject GC works

The garbage collector runs periodically (between frames by default). It marks every UObject
**reachable** from the *root set* by following `UPROPERTY` references and a small number of other
tracked reference types. Anything not reachable is collected: `BeginDestroy` is called, then
`FinishDestroy`, then the memory is reclaimed.

**Root set** — the starting nodes. In practice: the global `UEngine`, loaded `UWorld`s, all
`UPackage`s, objects explicitly added via `AddToRoot()`, and objects held by `FGCObject` /
`TStrongObjectPtr` reporters. From these, the GC follows every `UPROPERTY()` transitively.

**What the GC cannot see:**
- A raw `UObject*` member that is *not* a `UPROPERTY` — invisible, can be collected while your
  pointer still points at freed memory.
- A `TSharedPtr<UMyObject>` — the smart pointer's ref-count is unknown to the GC; don't do it.
- A `UObject*` captured in a lambda by raw pointer — ditto.

**GC clustering** groups subobjects together so the whole cluster is reclaimed at once, reducing
overhead. Configurable under *Project Settings → Garbage Collection*.

**Incremental GC** (enabled by default in UE5) spreads the mark pass across multiple frames to
reduce hitches. `TObjectPtr` members enable GC write barriers that make incremental marking safe.

Full reachability cycle and destruction callbacks:
[references/uobject-gc-and-roots.md](references/uobject-gc-and-roots.md).

## Pointer types — which to use when

| Type | GC-visible? | Keeps alive? | Notes |
|---|---|---|---|
| `UPROPERTY() TObjectPtr<T>` | yes | yes | owned UObject member — modern default |
| `UPROPERTY() T*` (raw) | yes | yes | legacy, still valid; prefer `TObjectPtr` in UE5 |
| raw `T*` without `UPROPERTY` | no | no | locals, params, short-lived; never store as a member |
| `TWeakObjectPtr<T>` | yes (auto-nulled) | no | non-owning; check before use |
| `TSoftObjectPtr<T>` | path only | no | asset loaded on demand; stores disk path |
| `TStrongObjectPtr<T>` | yes (ref-count) | yes | non-UObject owner; no `UPROPERTY` needed |
| `TSharedPtr<T>` / `TUniquePtr<T>` | no | yes (ref/scope) | plain C++ (`F*`) only; never wrap UObjects |

Full pointer-type mechanics and source references:
[references/object-pointer-types.md](references/object-pointer-types.md).

## The UObject-GC pattern — owned members

```cpp
UCLASS()
class MYGAME_API UInventory : public UObject
{
    GENERATED_BODY()

    // GC-tracked, editor-visible owned reference — the right default
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UItemData> ActiveItem;

    // Cross-system reference that may disappear independently
    TWeakObjectPtr<AActor> LastInteractedActor;

    // Asset loaded on demand (stores a path, not a live pointer)
    UPROPERTY(EditAnywhere)
    TSoftObjectPtr<UStaticMesh> PreviewMesh;
};
```

- `TObjectPtr` in a `UPROPERTY` enables the GC write barrier required for incremental GC marking.
  Prefer it over raw `T*` for all UObject members in UE5.
- `TWeakObjectPtr` is **not** a `UPROPERTY` here intentionally — it is a non-owning observer. If
  you add `UPROPERTY()` to it, the GC will still not keep the target alive (weak semantics are
  preserved), but the pointer *will* be serialized. Omitting `UPROPERTY` is the common pattern for
  transient cross-system caches.
- A `TSoftObjectPtr` holds only a path; call `TSoftObjectPtr::LoadSynchronous()` or use
  `FStreamableManager` to actually load. See `asset-management` for async loading.

## Validity checks

```cpp
// Prefer IsValid() over bare null checks for UObjects
if (IsValid(MyObj))         // non-null AND not marked as garbage
{
    MyObj->DoSomething();
}

// Weak pointer: always go through Get() or IsValid()
if (UMyThing* T = WeakThing.Get())   // returns null if target was GC'd
{
    T->Act();
}

// Pin a weak ptr to a strong ref for the duration of a worker thread op
TStrongObjectPtr<UMyThing> Pinned = WeakThing.Pin();
if (Pinned)
{
    // Pinned keeps the object alive while this scope runs
}
```

`IsValid` is declared in `Runtime/CoreUObject/Public/UObject/Object.h`:1875.
`TWeakObjectPtr` resolves to null automatically after the target is collected — unlike a raw
pointer, which becomes a dangling address.

## Holding UObjects from non-UObject classes

A plain `F*` class cannot use `UPROPERTY`. Two options:

```cpp
// Option A: FGCObject — report references to the GC explicitly
class FMyManager : public FGCObject
{
public:
    virtual void AddReferencedObjects(FReferenceCollector& Collector) override
    {
        Collector.AddReferencedObject(OwnedData);  // keeps OwnedData alive
    }
    virtual FString GetReferencerName() const override
    {
        return TEXT("FMyManager");
    }
private:
    TObjectPtr<UMyData> OwnedData;
};

// Option B: TStrongObjectPtr — simplest for one object
TStrongObjectPtr<UMyData> Held(NewObject<UMyData>());
// Held keeps the object alive until Held goes out of scope or is reset
```

`FGCObject` is declared in
`Runtime/CoreUObject/Public/UObject/GCObject.h`:127.
`TStrongObjectPtr` is declared in
`Runtime/Core/Public/UObject/StrongObjectPtrTemplates.h`:25.

**Important:** `TStrongObjectPtr` cannot be used inside a `UCLASS` as a `UPROPERTY`; using it
inside a UObject without `UPROPERTY` creates cycles that the GC cannot collect. Reserve it for
genuinely non-UObject owners (subsystem helpers, RAII guards, test fixtures).

`FGCObject` instances are **not trivially relocatable** — don't put them in `TArray` by value.
See the `static_assert` in `GCObject.h`:226.

## Creating, destroying, and the root set

```cpp
// Create a UObject (outside of a constructor)
UMyData* Data = NewObject<UMyData>(this);     // 'this' becomes the outer

// Constructor-only — only call from an AActor/UActorComponent constructor
UMyComp* Comp = CreateDefaultSubobject<UMyComp>(TEXT("MyComp"));

// Force-keep alive globally (use sparingly — easy to leak permanently)
Data->AddToRoot();
// ... later, must pair with:
Data->RemoveFromRoot();

// Request destruction (for non-actors)
Data->MarkAsGarbage();   // GC collects on the next pass; do NOT 'delete' UObjects

// Actors: use Destroy() instead
MyActor->Destroy();
```

`AddToRoot`/`RemoveFromRoot`/`MarkAsGarbage` are declared in
`Runtime/CoreUObject/Public/UObject/UObjectBaseUtility.h`:206, 212, 182.

`NewObject` overloads are declared in
`Runtime/CoreUObject/Public/UObject/UObjectGlobals.h`:1891.

`CollectGarbage` / `TryCollectGarbage` (force a GC pass) are declared in
`Runtime/CoreUObject/Public/UObject/UObjectGlobals.h`:930.

## Non-UObject memory — plain C++ smart pointers

These are for `F*` structs, engine subsystems, and anything that is *not* a UObject. Never wrap a
UObject in a `TSharedPtr` — the reference count is invisible to the GC and the two ownership
models fight each other.

```cpp
// TUniquePtr — sole owner, destructs when it goes out of scope
TUniquePtr<FMyConfig> Config = MakeUnique<FMyConfig>(/* args */);

// TSharedPtr — shared ownership; released when last owner is gone
TSharedPtr<FConnectionState> State = MakeShared<FConnectionState>();

// TSharedRef — non-nullable shared; ideal for APIs that must always have a value
TSharedRef<FMyService> Service = MakeShared<FMyService>();

// TWeakPtr — non-owning observer; check IsValid() / Pin() before use
TWeakPtr<FConnectionState> WeakState = State;
if (TSharedPtr<FConnectionState> Pinned = WeakState.Pin())
{
    Pinned->Send();
}
```

`TSharedPtr`/`TSharedRef`/`TWeakPtr` are declared in
`Runtime/Core/Public/Templates/SharedPointer.h`.
`TUniquePtr` is declared in
`Runtime/Core/Public/Templates/UniquePtr.h`.

Full smart-pointer guide with thread-safety notes and `TSharedFromThis`:
[references/smart-pointers.md](references/smart-pointers.md).

## Gotchas

- **Raw `UObject*` member without `UPROPERTY`** → collected → dangling crash. This is the #1 UE
  memory bug. Always `UPROPERTY()` a stored UObject pointer.
- **`TSharedPtr` around a UObject** → ref-count invisible to GC; the GC will collect the object
  while the shared pointer still holds an address → crash. Never do it.
- **Storing a strong ref to an actor in a global or long-lived system** can prevent level unloads.
  Prefer `TWeakObjectPtr` for cross-system or cross-level actor references.
- **`Weak.Get()` / `Weak.IsValid()` without a check** after the target was collected → null deref.
- **`AddToRoot` without a paired `RemoveFromRoot`** → permanent leak; the object never collects.
- **`TStrongObjectPtr` inside a `UCLASS` member without `UPROPERTY`** → uncollectable cycle; the
  object keeps itself alive even when nothing else references it.
- **`MarkAsGarbage` on a rooted object** → asserts (`check(!IsRooted())`); remove from root first.
- **Calling `delete` on a UObject** → double-free; let GC own destruction.
- **`FGCObject` stored by value in a `TArray`** → relocates the instance, breaking GC registration
  (not trivially relocatable). Store by pointer or use another lifetime strategy.

## Version notes

- `MarkAsGarbage()` replaced `MarkPendingKill()` in UE5. If `gc.PendingKillEnabled=false`
  (default in UE5), auto-nulling of `UPROPERTY` pointers on the target object no longer happens;
  use `IsValid()` checks and clear pointers manually in `OnDestroyed`/`EndPlay`.
- `TObjectPtr<T>` is the UE5 idiom for UObject `UPROPERTY` members. Older codebases use raw `T*
  UPROPERTY`, which still compiles and works, but `TObjectPtr` adds the GC write barrier needed
  for incremental GC and cook-time dependency tracking.
- `TLazyObjectPtr` is deprecated in 5.7; migrate to `TSoftObjectPtr`.
- `FGCObject::EFlags::RegisterLater` (UE 5.4+) allows deferred GC registration for
  partially-initialized objects; register explicitly with `RegisterGCObject()`.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/CoreUObject/Public/UObject/ObjectPtr.h` — `TObjectPtr<T>` / `FObjectPtr`.
- `Runtime/CoreUObject/Public/UObject/WeakObjectPtr.h` — `TWeakObjectPtr<T>`, `FWeakObjectPtr`.
- `Runtime/Core/Public/UObject/StrongObjectPtrTemplates.h` — `TStrongObjectPtr<T>`:25.
- `Runtime/CoreUObject/Public/UObject/GCObject.h` — `FGCObject`:127,
  `AddReferencedObjects`:195, `GetReferencerName`:198.
- `Runtime/CoreUObject/Public/UObject/UObjectBaseUtility.h` — `MarkAsGarbage`:182,
  `AddToRoot`:206, `RemoveFromRoot`:212.
- `Runtime/CoreUObject/Public/UObject/Object.h` — `IsValid`:1875.
- `Runtime/CoreUObject/Public/UObject/UObjectGlobals.h` — `NewObject`:1891,
  `CollectGarbage`:930, `TryCollectGarbage`:940.
- `Runtime/CoreUObject/Public/UObject/SoftObjectPtr.h` — `TSoftObjectPtr<T>`.
- `Runtime/CoreUObject/Public/UObject/GarbageCollection.h` — GC internals, `CollectGarbage` flags.
- `Runtime/Core/Public/Templates/SharedPointer.h` — `TSharedPtr`/`TSharedRef`/`TWeakPtr`.
- `Runtime/Core/Public/Templates/UniquePtr.h` — `TUniquePtr`.

Official docs (UE 5.7, all verified live):
- Object Pointers —
  <https://dev.epicgames.com/documentation/unreal-engine/object-pointers-in-unreal-engine>
- Unreal Object Handling —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-object-handling-in-unreal-engine>
- Objects (UObject) —
  <https://dev.epicgames.com/documentation/unreal-engine/objects-in-unreal-engine>
- UObject Instance Creation —
  <https://dev.epicgames.com/documentation/unreal-engine/creating-objects-in-unreal-engine>
- Unreal Smart Pointer Library —
  <https://dev.epicgames.com/documentation/unreal-engine/smart-pointers-in-unreal-engine>

Deep-dive references in this skill:
- [references/uobject-gc-and-roots.md](references/uobject-gc-and-roots.md) — GC reachability
  cycle, root set, `BeginDestroy`/`FinishDestroy`, incremental GC, destruction callbacks.
- [references/object-pointer-types.md](references/object-pointer-types.md) — all UObject pointer
  types in depth: `TObjectPtr`, `TWeakObjectPtr`, `TSoftObjectPtr`, `TStrongObjectPtr`, and the
  rules for when to use each.
- [references/smart-pointers.md](references/smart-pointers.md) — non-UObject smart pointers:
  `TSharedPtr`/`TSharedRef`/`TWeakPtr`/`TUniquePtr`, `MakeShared`, `TSharedFromThis`, thread
  safety, and `FGCObject` vs `TStrongObjectPtr` selection.
