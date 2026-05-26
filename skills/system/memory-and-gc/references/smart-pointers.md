# Non-UObject smart pointers

Deep dive for [../SKILL.md](../SKILL.md). Covers `TSharedPtr`, `TSharedRef`, `TWeakPtr`,
`TUniquePtr`, `MakeShared`, `TSharedFromThis`, thread-safety modes, and how to choose between
these types and GC-based ownership (`FGCObject` / `TStrongObjectPtr`).
Grounded in UE 5.7 (`Engine/Source/Runtime/Core/Public/Templates/`).

## The fundamental rule

**Non-UObject smart pointers (`TSharedPtr`, `TUniquePtr`, etc.) are for plain C++ `F*` types.**
Never wrap a `UObject` (any class with a `U`/`A` prefix) in one of these — the reference count
is invisible to the GC, which will collect the object while the shared pointer still holds an
address, causing a crash. For UObjects, use `UPROPERTY` / `TWeakObjectPtr` / `TStrongObjectPtr` /
`FGCObject` as described in [../SKILL.md](../SKILL.md).

## Type overview

| Type | Nullable? | Ownership | Thread-safe by default? |
|---|---|---|---|
| `TUniquePtr<T>` | yes | sole, exclusive | N/A (no sharing) |
| `TSharedPtr<T>` | yes | shared (ref-counted) | no (`ESPMode::Fast`) |
| `TSharedRef<T>` | **no** (never null) | shared (ref-counted) | no (`ESPMode::Fast`) |
| `TWeakPtr<T>` | yes | non-owning observer | no |

Declared at `Runtime/Core/Public/Templates/SharedPointer.h` and
`Runtime/Core/Public/Templates/UniquePtr.h`.

## TUniquePtr\<T\>

```cpp
// Sole owner; destructs when it goes out of scope or is reset
TUniquePtr<FHttpRequest> Request = MakeUnique<FHttpRequest>(Url);

// Transfer ownership (move-only)
TUniquePtr<FHttpRequest> Taken = MoveTemp(Request);  // Request is now null

// Release and take the raw pointer (manual ownership)
FHttpRequest* Raw = Request.Release();
```

Use `TUniquePtr` as the default for heap objects owned by exactly one thing. It has zero runtime
overhead over a raw pointer in shipping builds. `MakeUnique<T>(...)` is the factory.

When a `UObject` contains a `TUniquePtr<F*>` member, the `F*` destructor must be visible at the
point the `UObject`'s destructor is compiled — declare the destructor in the `.h` and define it
(even as `= default`) in the `.cpp` to avoid incomplete-type errors from UHT-generated code.
This is described in the `TDefaultDelete` comment in `UniquePtr.h`:55.

## TSharedPtr\<T\> and TSharedRef\<T\>

```cpp
// Shared ownership — released when the last TSharedPtr/TSharedRef is gone
TSharedPtr<FConnectionState> Conn = MakeShared<FConnectionState>(Port);

// TSharedRef: always valid, never null — ideal for "required" dependencies
TSharedRef<FSerializer> Ser = MakeShared<FSerializer>();

// TSharedPtr from TSharedRef is implicit (and always non-null)
TSharedPtr<FSerializer> Opt = Ser;

// Get the raw pointer (no AddRef; valid only while Conn is alive)
FConnectionState* Raw = Conn.Get();
```

Prefer `MakeShared<T>(...)` over `MakeShareable(new T(...))`. `MakeShared` allocates the object
and its reference controller in a single block (one allocation instead of two), improving cache
locality and performance.

Prefer `TSharedRef` for function parameters and return values when the value is guaranteed
non-null. Pass by `const TSharedRef<T>&` or `const TSharedPtr<T>&` to avoid unnecessary copies
of the reference controller.

## TWeakPtr\<T\> (non-UObject)

```cpp
TSharedPtr<FSession> Session = MakeShared<FSession>();
TWeakPtr<FSession> WeakSession = Session;

// Must Pin() to use — returns null TSharedPtr if the owner is gone
if (TSharedPtr<FSession> Live = WeakSession.Pin())
{
    Live->SendHeartbeat();
}
```

`TWeakPtr` breaks reference cycles between `TSharedPtr`-managed objects. Unlike
`TWeakObjectPtr<T>`, it is not aware of GC — it tracks the ref-count controller, not the object
registry. Use it only with non-UObject types.

## TSharedFromThis

```cpp
class FMyService : public TSharedFromThis<FMyService>
{
public:
    TSharedRef<FMyService> GetSelf()
    {
        return AsShared();  // safe only after construction is complete
    }
};
```

Derive from `TSharedFromThis<T>` when a class needs to return a `TSharedRef` to `this` from a
member function. Do **not** call `AsShared()` or `SharedThis(this)` from constructors — the
reference controller is not yet initialized at that point and the call will assert.

## Thread safety

By default, `TSharedPtr`/`TSharedRef`/`TWeakPtr` are **not** thread-safe (uses `ESPMode::Fast`,
a non-atomic ref-count). For cross-thread sharing, use the thread-safe mode:

```cpp
TSharedPtr<FWorkItem, ESPMode::ThreadSafe> WorkItem = MakeShared<FWorkItem, ESPMode::ThreadSafe>();
```

Thread-safe versions use atomic operations for ref-counting; reads and copies are always safe
from multiple threads; writes and resets must still be synchronized externally. Only use the
thread-safe mode when you actually share across threads — it is measurably slower.

## FGCObject vs TStrongObjectPtr — choosing

Both allow a non-UObject class to keep one or more UObjects alive. The choice:

| Need | Use |
|---|---|
| Hold a small, fixed set of UObjects in a long-lived system | `TStrongObjectPtr<T>` (simpler) |
| Hold a dynamically-changing collection of UObjects | `FGCObject` + `AddReferencedObjects` |
| Your class is itself long-lived and manages many refs | `FGCObject` (more control, single registration) |
| You need the name to appear in GC leak reports | `FGCObject::GetReferencerName` |

`TStrongObjectPtr` registers a separate ref-count entry per pointer instance. `FGCObject`
registers once and reports all references from a single `AddReferencedObjects` call — more
efficient when holding many objects.

`FGCObject` is not trivially relocatable (`GCObject.h`:226). Do not store `FGCObject` subclasses
by value in `TArray` or similar relocating containers.

## Casting

```cpp
TSharedPtr<FBase> Base = MakeShared<FDerived>();

// Static downcast (use when you know the type)
TSharedPtr<FDerived> Der = StaticCastSharedPtr<FDerived>(Base);

// Const cast
TSharedPtr<FMyType> Mut = ConstCastSharedPtr<FMyType>(ConstPtr);
```

Dynamic casting is not available (no RTTI in shipping builds). Use a static cast after verifying
the type through another mechanism.

## Quick selection guide

| Situation | Use |
|---|---|
| Sole ownership, plain C++ | `TUniquePtr<T>`, `MakeUnique<T>` |
| Shared ownership, plain C++ | `TSharedPtr<T>`, `MakeShared<T>` |
| Non-nullable shared, e.g. service dependency | `TSharedRef<T>`, `MakeShared<T>` |
| Non-owning observer of a `TSharedPtr` | `TWeakPtr<T>` |
| Non-UObject class owns a UObject | `TStrongObjectPtr<T>` |
| Non-UObject class owns many UObjects | Inherit from `FGCObject` |
| UObject member owned by another UObject | `UPROPERTY() TObjectPtr<T>` |
| UObject non-owning cross-reference | `TWeakObjectPtr<T>` |
