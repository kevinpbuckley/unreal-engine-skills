---
name: unreal-memory-and-gc
description: Manage object lifetime safely in Unreal — the UObject garbage collector, keeping
  objects alive with UPROPERTY, TObjectPtr vs raw pointers, TWeakObjectPtr, TSoftObjectPtr, the
  root set, FGCObject for non-UObject owners, and smart pointers (TSharedPtr/TUniquePtr) for
  plain C++ objects. Use when deciding a pointer/ownership type, fixing crashes after garbage
  collection, dangling-pointer or use-after-free bugs, or holding UObjects from non-UObject code.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Memory & garbage collection

Unreal has **two** memory worlds: garbage-collected `UObject`s, and ordinary C++ objects you
manage yourself. Mixing them up causes most UE crashes. The rule that prevents the majority of
them: **a UObject stays alive only while something reachable holds it in a `UPROPERTY`.**

## When to use this skill

- Choosing how to store a pointer to a UObject or a plain object.
- Crash after a few seconds / after level load (classic GC-collected-it symptom).
- A non-UObject (subsystem helper, `FGCObject`, Slate widget) needs to hold a UObject.
- "Why is my pointer suddenly null/garbage?" debugging.

## How UObject GC works

- The collector periodically finds all UObjects **reachable** from the *root set* by following
  `UPROPERTY` references (and a few other tracked references). Unreachable objects are destroyed.
- A raw `UObject*` that is **not** a `UPROPERTY` is invisible to GC. The object can be collected
  while your pointer still points at freed memory → crash.
- You make something reachable by: storing it in a `UPROPERTY`, adding it to the root
  (`AddToRoot`), or reporting it via `FGCObject::AddReferencedObjects`.

## Pointer types — when to use which

| Type | Keeps alive? | Use for |
|---|---|---|
| `UPROPERTY() TObjectPtr<U>` | **yes** | owned/held UObject **members** (modern default) |
| raw `U*` | no | locals, function params, short-lived refs you don't store |
| `TWeakObjectPtr<U>` | no | non-owning reference that may legitimately disappear; check before use |
| `TSoftObjectPtr<U>` / `TSoftClassPtr<U>` | no (path) | assets loaded on demand; stores a path, not a live ptr |
| `TStrongObjectPtr<U>` | yes (no UPROPERTY needed) | keep a UObject alive from non-UObject C++ |
| `TSharedPtr/TSharedRef/TUniquePtr<T>` | yes | **non-UObject** heap objects (plain structs, Slate) |

```cpp
UPROPERTY() TObjectPtr<UStaticMeshComponent> Mesh;   // member: owned, GC-visible
TWeakObjectPtr<AActor> Target;                        // may die; use Target.Get()/IsValid()
TSoftObjectPtr<UTexture2D> Icon;                       // asset path; load when needed
```

`TObjectPtr` behaves like a raw pointer at runtime but adds editor access tracking and lazy
load. Prefer it for all UObject `UPROPERTY` members; raw `U*` is fine for locals/params.

## Validity checks

- `IsValid(Obj)` — non-null **and** not pending-kill/garbage. Prefer over `Obj != nullptr`.
- `TWeakObjectPtr`: `if (UThing* T = Weak.Get()) { ... }` or `Weak.IsValid()`.
- After GC, a weak ptr resolves to null automatically (safe); a stray raw ptr does not (unsafe).

## Holding UObjects from non-UObject classes

A plain C++ class (e.g. a manager that isn't a UObject) can't use `UPROPERTY`. Options:

```cpp
// Option A: FGCObject — report references so GC keeps them alive
class FMyManager : public FGCObject
{
public:
    virtual void AddReferencedObjects(FReferenceCollector& Collector) override
    {
        Collector.AddReferencedObject(HeldObject);
    }
    virtual FString GetReferencerName() const override { return TEXT("FMyManager"); }
private:
    TObjectPtr<UMyObject> HeldObject = nullptr;
};

// Option B: TStrongObjectPtr — simplest for one or a few objects
TStrongObjectPtr<UMyObject> Held = TStrongObjectPtr<UMyObject>(NewObject<UMyObject>());
```

Prefer making the owner a `UObject`/subsystem with `UPROPERTY` when you can; use `FGCObject`/
`TStrongObjectPtr` only when it genuinely can't be a UObject.

## Creating and destroying

- `NewObject<T>(Outer)` — create a UObject; the `Outer` participates in lifetime/ownership.
- `CreateDefaultSubobject<T>(TEXT("Name"))` — constructor-only owned components.
- Don't `delete` UObjects. To request destruction: `Obj->MarkAsGarbage()` (rarely needed) or
  `Actor->Destroy()` for actors; GC reclaims the memory.
- `AddToRoot()`/`RemoveFromRoot()` — force-keep an object alive globally (use sparingly; easy to leak).

## Non-UObject memory (plain C++)

- `TUniquePtr<T>` — sole ownership (UE's `std::unique_ptr`). `MakeUnique<T>(...)`.
- `TSharedPtr<T>`/`TSharedRef<T>` — shared ownership (`MakeShared<T>(...)`). `TWeakPtr<T>` to break cycles.
- These are for `F*` types, not UObjects. Don't wrap a UObject in `TSharedPtr`.

## Gotchas

- **Raw `UObject*` member without `UPROPERTY`** → collected → dangling crash. The #1 bug.
- **`TSharedPtr` around a UObject** → fights GC; never do it.
- **Storing a strong ref to an actor in another system** can leak/keep levels loaded; prefer
  `TWeakObjectPtr` for cross-system references.
- **Accessing `Weak.Get()` without checking** after the target died → null deref.
- **`AddToRoot` without `RemoveFromRoot`** → permanent leak.

## References & source material

Engine source (UE 5.7):
- `Runtime/CoreUObject/Public/UObject/GarbageCollection.h` — the collector.
- `Runtime/CoreUObject/Public/UObject/ObjectPtr.h` — `TObjectPtr`.
- `Runtime/CoreUObject/Public/UObject/WeakObjectPtr.h` (fwd in `WeakObjectPtrFwd.h`) — `TWeakObjectPtr`.
- `Runtime/CoreUObject/Public/UObject/SoftObjectPtr.h` — soft ptrs.
- `Runtime/CoreUObject/Public/UObject/GCObject.h` — `FGCObject`.
- `Runtime/Core/Public/Templates/SharedPointer.h` — `TSharedPtr`/`TUniquePtr` (non-UObject).

Official docs (UE 5.7): Programming with C++ —
<https://dev.epicgames.com/documentation/unreal-engine/programming-with-cplusplus-in-unreal-engine>
