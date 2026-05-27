# UObject lifecycle and the CDO

Deep dive for [../SKILL.md](../SKILL.md). Covers how a UObject is constructed, how the Class
Default Object (CDO) is created and used, the `PostInitProperties` / `PostLoad` callbacks, and the
GC destruction sequence (`BeginDestroy` → `IsReadyForFinishDestroy` → `FinishDestroy`). Grounded in
UE 5.7 (`Engine/Source/Runtime/CoreUObject/Public/UObject/Object.h`,
`Engine/Source/Runtime/CoreUObject/Public/UObject/Class.h`).

## What the CDO is

Every `UClass` holds exactly one **Class Default Object** (`TObjectPtr<UObject> ClassDefaultObject`,
`Class.h`:3928, deprecated as a direct field in 5.6). The CDO is constructed by
`UClass::GetDefaultObject()` (`Class.h`:4373) the first time it is requested — typically at engine
startup during module registration. Constructing the CDO runs your C++ constructor with no world
context.

The CDO serves several purposes:
- It is the archetype from which all new instances are initialized (property values are copied from
  it via `StaticConstructObject_Internal`).
- It is the source for "default value propagation": when you change a property default in the CDO
  (or its Blueprint counterpart), instances that still hold the old default are updated on load.
- Editor tooling reads it to display default values and to generate Blueprint variable defaults.

**Never mutate the CDO at runtime** — changes affect all future instances. Use
`GetDefault<T>()` (read-only) or `GetMutableDefault<T>()` (rare, valid only during startup) from
`UObjectGlobals.h`:2157/2171.

## UObject construction sequence

For an object created with `NewObject<T>(Outer)`:

1. Memory is allocated and zeroed (all members are zero-filled before the constructor runs).
2. The C++ constructor executes. Reflection properties are then initialized from the CDO.
3. `PostInitProperties()` (`Object.h`:222) — called after UPROPERTYs are initialized (including
   config-loaded values). Override here to do early fixup that depends on defaults being set.
   This is the first point at which config values are available.
4. Object is returned to the caller. No gameplay context exists yet.

For objects loaded from a package (`PostLoad` path):
1. Memory is allocated; deserialized data is applied (properties loaded from the archive).
2. `PostLoad()` — versioning, fixup, and upgrade logic. Called instead of `PostInitProperties`
   for loaded objects; the two are mutually exclusive.

For `CreateDefaultSubobject` (constructor only):
- Creates the subobject immediately and registers it as a default subobject of the outer class.
- The outer's CDO owns the subobject's CDO; instances copy from it.
- `FObjectInitializer::AssertIfInConstructor` (`UObjectGlobals.h`:1896) fires if you accidentally
  call `NewObject` during construction instead.

## PostInitProperties vs BeginPlay

| Callback | When | Reliable world? | Use for |
|---|---|---|---|
| Constructor | Object construction, incl. CDO & editor | No | Set defaults, CreateDefaultSubobject |
| `PostInitProperties` | After UPROPERTY init, config loaded | No | Early fixup based on config/defaults |
| `PostLoad` | After deserialization from disk | No | Version migration, loaded-data fixup |
| `BeginPlay` | Gameplay starts | Yes | All gameplay init, spawning, timers, bindings |

## GC destruction sequence

When a UObject becomes unreachable (no `UPROPERTY` or root-set reference holds it) and the GC runs:

1. `BeginDestroy()` (`Object.h`:366) — release async/render-thread resources. Called immediately
   when the GC marks the object for deletion. The object is still in memory; do not access it from
   gameplay after this point.
2. `IsReadyForFinishDestroy()` (`Object.h`:373) — the GC polls this each pass. Return `false` to
   defer destruction until background work (e.g. render proxy teardown) completes.
3. `FinishDestroy()` (`Object.h`:387) — final cleanup before the memory is reclaimed. Call
   `Super::FinishDestroy()` **last** (not first), as the engine destroys properties here.

Gameplay cleanup should happen in `EndPlay` (for Actors/Components), not in `BeginDestroy`.
`BeginDestroy` is for resource-system teardown that must happen on the game thread before memory
is freed.

## MarkAsGarbage and the PendingKill transition

In UE5 (5.0+), `MarkAsGarbage()` replaced `MarkPendingKill()`. With the default setting
`gc.PendingKillEnabled=false`, objects marked as garbage are **not** automatically null'ed in
`UPROPERTY` pointers. Instead:
- `IsValid(Obj)` returns false for objects marked as garbage (checks the garbage flag, not null).
- UPROPERTY pointers are not automatically zeroed; you must clear them manually or use
  `TWeakObjectPtr<T>` (which becomes `nullptr` on `IsValid` check after GC).
- `MarkPendingKill()` still compiles but is a semantic no-op unless `gc.PendingKillEnabled=true`.

Practical advice: clear UPROPERTY references in `EndPlay` (for Actors) or whenever you know the
target is going away, rather than relying on auto-null.

## UClass vs UStruct vs UScriptStruct

The class hierarchy in the type system (`Class.h`):

```
UObject
  └─ UField
       └─ UStruct          (Class.h:476) — base for all structured types
            ├─ UClass       (Class.h:3792) — runtime descriptor for UCLASS types; has CDO
            └─ UScriptStruct (Class.h:1719) — runtime descriptor for USTRUCT types; no CDO, no GC
```

- `UClass` is what `T::StaticClass()` returns for any UObject-derived type. It carries the CDO,
  the `ClassFlags`, and the `ClassConstructor`.
- `UScriptStruct` is what `T::StaticStruct()` returns for a USTRUCT. It has no CDO and does not
  participate in GC. Struct instances are plain memory managed by their containing object or stack.
- Both provide property iteration, serialization, and editor metadata through the `UStruct` base.

## Root set and GC clustering

The GC starts from a **root set** — objects pinned with `RF_RootSet` or held by the engine's global
tables (loaded packages, the `GEngine`, the `GWorld`, etc.). Anything reachable through UPROPERTY
chains from the root set is kept alive. Everything else is collected.

**GC clusters** group related objects (a Blueprint class and its generated class, or a mesh and its
materials) so the GC can treat them as one unit during reachability. This reduces per-object
overhead at the cost of all-or-nothing collection. Configured under Project Settings → Garbage
Collection. Relevant flags: `RF_RootSet` (`0x00000080`), `RF_ClassDefaultObject`
(`0x00000010`), `RF_Standalone` (`0x00000002`).

## Version notes

- `ClassDefaultObject` as a public field was deprecated in UE 5.6 (`Class.h`:3926). Use
  `GetDefaultObject()` or `GetDefault<T>()`/`GetMutableDefault<T>()` from `UObjectGlobals.h`.
- Incremental GC (chunked reachability analysis) was introduced in UE 5.3 and is the default in
  5.7. It spreads GC work across frames, reducing hitches. Settings are in Project Settings →
  Garbage Collection → Incremental Reachability Analysis.
- `PostReinitProperties()` (`Object.h`:228) was added in UE 5.x to handle subobject
  re-initialization from CDO; distinct from `PostInitProperties` which runs only once.
