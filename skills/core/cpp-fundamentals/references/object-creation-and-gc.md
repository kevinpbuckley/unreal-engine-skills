# Object creation, ownership, and garbage collection

Deep dive for [../SKILL.md](../SKILL.md). Covers `NewObject` vs `CreateDefaultSubobject`, object
flags, GC root set, keeping objects alive in non-UPROPERTY contexts (`FGCObject`, `TStrongObjectPtr`,
`AddToRoot`), and the ownership patterns you'll encounter in real Unreal code. Grounded in UE 5.7
(`Engine/Source/Runtime/CoreUObject/Public/UObject/UObjectGlobals.h`,
`Engine/Source/Runtime/CoreUObject/Public/UObject/GarbageCollection.h`).

## NewObject — runtime object creation

`NewObject` is the correct factory for any UObject that is **not** an Actor (use
`UWorld::SpawnActor` for Actors) and is **not** being created in a constructor (use
`CreateDefaultSubobject` there).

Three key overloads (`UObjectGlobals.h`):

```cpp
// Simplest: auto-generated name, transient package as outer
T* NewObject<T>(UObject* Outer = GetTransientPackageAsObject())   // line 1919

// Explicit class (useful when the class is chosen at runtime)
T* NewObject<T>(UObject* Outer, const UClass* Class,
                FName Name = NAME_None, EObjectFlags Flags = RF_NoFlags,
                UObject* Template = nullptr, ...)                  // line 1891

// Named, with flags
T* NewObject<T>(UObject* Outer, FName Name,
                EObjectFlags Flags = RF_NoFlags, ...)              // line 1934
```

**Outer**: sets the object's position in the outer chain (its logical parent/package). Use `this`
when creating a helper UObject owned by the current object. Use `GetTransientPackage()` for
one-off runtime objects with no persistent package.

**Template**: object to copy defaults from instead of the CDO. Useful for spawning pre-configured
instances.

**Flags** (selected from `EObjectFlags`):
| Flag | Value | Meaning |
|---|---|---|
| `RF_NoFlags` | `0x0` | Normal transient runtime object. |
| `RF_Transient` | `0x40` | Not saved to disk. |
| `RF_Standalone` | `0x2` | Kept alive even if unreferenced (e.g. assets open in the editor). |
| `RF_RootSet` | `0x80` | Never GC'd regardless of references. |
| `RF_ClassDefaultObject` | `0x10` | Marks the object as a CDO (set by the engine; do not set manually). |

Most runtime-created objects should use `RF_NoFlags` (the default) and be kept alive by a
`UPROPERTY`.

## CreateDefaultSubobject — constructor-only subobjects

`CreateDefaultSubobject<T>(FName)` (`Object.h`:147) is exclusively for constructors. It:
- Creates the subobject as a default subobject of the class being constructed.
- Registers the subobject's CDO under the outer class's CDO.
- Ensures every spawned instance of the outer gets its own copy.

```cpp
AMyActor::AMyActor()
{
    // Correct: constructor context, unique name
    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));

    // Wrong: runtime context (asserts via FObjectInitializer::AssertIfInConstructor)
    // Mesh = NewObject<UStaticMeshComponent>(this);
}
```

Using `NewObject` inside a constructor fires the assertion at `UObjectGlobals.h`:1896. Using
`CreateDefaultSubobject` outside a constructor is also undefined behavior.

## Keeping UObjects alive outside UPROPERTY

Three mechanisms for non-UPROPERTY UObject lifetime:

### FGCObject (preferred for non-UObject C++ objects)

```cpp
class FMySystem : public FGCObject
{
    UMyHelper* Helper = nullptr;

    virtual void AddReferencedObjects(FReferenceCollector& Collector) override
    {
        Collector.AddReferencedObject(Helper);
    }

    virtual FString GetReferencerName() const override
    {
        return TEXT("FMySystem");
    }
};
```

`FGCObject` (`GCObject.h`) is the standard way for non-UObject C++ classes to keep UObjects alive.
The GC calls `AddReferencedObjects` during the mark phase.

### AddToRoot / RemoveFromRoot

```cpp
UMyObject* Obj = NewObject<UMyObject>();
Obj->AddToRoot();       // pins to root set; never GC'd until RemoveFromRoot()
// ... use Obj ...
Obj->RemoveFromRoot();  // allow GC to collect it
```

Use sparingly. Forgetting `RemoveFromRoot` leaks the object permanently. Prefer `FGCObject` or a
`UPROPERTY` instead.

### TStrongObjectPtr (editor/tool use)

```cpp
TStrongObjectPtr<UMyObject> StrongRef = TStrongObjectPtr<UMyObject>(NewObject<UMyObject>());
// Keeps Obj alive as long as StrongRef is in scope
```

`TStrongObjectPtr` is semantically similar to `AddToRoot` but RAII-scoped. It is designed for
editor tools and test code, not for gameplay systems (use `UPROPERTY` in gameplay).

## Weak references

`TWeakObjectPtr<T>` does not prevent GC. Use it for non-owning references that may become invalid:

```cpp
TWeakObjectPtr<UMyObject> WeakRef = SomeObj;

if (WeakRef.IsValid())   // false if object is null or was GC'd
{
    UMyObject* Pinned = WeakRef.Get();
    // use Pinned
}
```

With `gc.PendingKillEnabled=false` (default in UE5), `TWeakObjectPtr::IsValid()` checks the
garbage flag; the pointer is not automatically nulled. Always call `.IsValid()` before `.Get()`.

## GC reachability and clustering

The GC performs a **mark phase** (trace all reachable objects from the root set through UPROPERTY
chains) followed by a **sweep phase** (collect unreachable objects). In UE 5.7 this is
**incremental** by default (work is spread across frames via Project Settings → Garbage Collection).

**GC clusters**: a group of objects treated as one unit during reachability. If any object in the
cluster is reachable, the entire cluster is kept. Clusters are used for Blueprint generated classes
and their associated data. Configured via:
- **Create Garbage Collector UObject Clusters** — on by default.
- **Actor Clustering Enabled** — off by default for most actors.
- **Blueprint Clustering Enabled** — clusters the `UBlueprintGeneratedClass` and related metadata.

## Destruction order and dangling pointers

The GC does not guarantee any ordering between objects being collected in the same pass. Never
access another UObject from `BeginDestroy` or `FinishDestroy` unless you know it is still alive
(e.g. via a raw check against the outer chain, not a UPROPERTY).

For Actors and Components, cleanup code belongs in `EndPlay(EEndPlayReason::Type)`, which is called
before GC and in a well-defined order relative to gameplay. See `actors-and-components`.

## Common ownership patterns in engine code

| Pattern | Example | Notes |
|---|---|---|
| Actor owns component | `UPROPERTY() TObjectPtr<UComp> Comp` | CDO subobject; GC-safe |
| Manager singleton (subsystem) | `UGameInstanceSubsystem` | Owned by `UGameInstance`; see `subsystems` |
| Asset held in memory | `UPROPERTY() TSoftObjectPtr<UTexture>` | Lazy; load on demand |
| Transient runtime helper | `UPROPERTY() TObjectPtr<UHelper>` | Outer=`this`, no disk save |
| Editor tool | `TStrongObjectPtr<UMyEditorData>` | RAII pin; editor only |
| Non-UObject system | `FGCObject::AddReferencedObjects` | Correct C++ class → UObject bridge |

## Version notes

- `TStrongObjectPtr` was added in UE 4.23.
- Incremental GC (chunked reachability) became the default in UE 5.3.
- The `EObjectFlags` table is defined in `ObjectMacros.h` and has been stable across UE4/5. The
  `RF_PendingKill` flag (`0x8000`) is still present in the enum for compatibility, but with
  `gc.PendingKillEnabled=false` it has no effect.
