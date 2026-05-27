# UObject GC — reachability cycle and root set

Deep dive for [../SKILL.md](../SKILL.md). Covers the garbage collection reachability cycle,
the root set, object clustering, incremental GC, and the destruction callback sequence.
Grounded in UE 5.7 (`Engine/Source/Runtime/CoreUObject/`).

## The reachability cycle

Unreal's GC runs on the game thread between frames (or spread across frames with incremental GC).
Each cycle has three phases:

1. **Mark** — Starting from the root set, the collector traverses all `UPROPERTY` references
   transitively, marking every reachable `UObject`. `TObjectPtr` members participate in a
   write-barrier protocol that tells the incremental marker when a reference changes mid-frame,
   keeping the mark phase consistent without pausing the game thread.

2. **Sweep / unhash** — Unreachable objects (those not marked) are identified. Their names are
   removed from the name table, and `ConditionalBeginDestroy` is called.

3. **Purge** — `FinishDestroy` is called and memory is returned to the allocator. In incremental
   mode this is spread across frames; in full-purge mode (`CollectGarbage` with
   `bPerformFullPurge=true`) it completes in one pass.

`CollectGarbage(EObjectFlags KeepFlags, bool bPerformFullPurge)` is the manual trigger:
`Runtime/CoreUObject/Public/UObject/UObjectGlobals.h`:930.
`TryCollectGarbage` (non-blocking version):
`Runtime/CoreUObject/Public/UObject/UObjectGlobals.h`:940.

## Root set

Objects in the root set are always reachable regardless of other references. Sources of root-set
membership:

| Source | How |
|---|---|
| `UEngine`, `UWorld`, loaded `UPackage`s | registered automatically at engine startup |
| `UObject::AddToRoot()` | explicit, global — must be paired with `RemoveFromRoot()` |
| `FGCObject::AddReferencedObjects` reporter | registered via `UGCObjectReferencer` |
| `TStrongObjectPtr<T>` | adds a ref-count entry via the same `UGCObjectReferencer` mechanism |
| `RF_Standalone` flag | objects with this flag are kept alive even without UPROPERTY references |

`AddToRoot` / `RemoveFromRoot` / `IsRooted` are declared in
`Runtime/CoreUObject/Public/UObject/UObjectBaseUtility.h`:206, 212, 222.

**`AddToRoot` is global and permanent until `RemoveFromRoot`** — the object survives every GC
cycle. Missing the matching `RemoveFromRoot` is a common permanent leak.

## Object clustering

The GC can group a UObject and its subobjects into a *cluster*. Only the cluster root needs to be
found unreachable before all members are collected together. This reduces per-object overhead and
speeds up reachability analysis.

Actors and components have clustering off by default (except static meshes and reflection capture
components). Toggle via `bCanBeInCluster` or override `CanBeInCluster()`. Configurable in
*Project Settings → Garbage Collection → Create Garbage Collector UObject Clusters*.

## Incremental GC

Enabled by default in UE5. The mark phase is time-sliced across multiple frames to prevent
hitches. `TObjectPtr` members (vs. raw `T* UPROPERTY`) are required for the GC write barrier that
keeps incremental marking safe when references change mid-frame. Raw `T* UPROPERTY` works but
does not participate in the write barrier, which can cause objects to be missed in an incremental
pass and only collected on the next full pass.

## Destruction callbacks

When an object becomes unreachable and is scheduled for collection:

| Callback | What to do here |
|---|---|
| `UObject::BeginDestroy` | Release GPU/render resources; signal async work to stop. Most gameplay cleanup should have already happened in `EndPlay`. |
| `UObject::IsReadyForFinishDestroy` | Return `false` to defer the purge (e.g., while GPU work completes). GC re-checks each pass. |
| `UObject::FinishDestroy` | Last chance to free internal data. Memory is reclaimed immediately after. |

For actors, `EndPlay` is the correct place for gameplay cleanup (timers, delegates, handles). By
the time `BeginDestroy` is called, the actor has been removed from the world and gameplay has
already ended. See `actors-and-components` for the full actor lifecycle.

## MarkAsGarbage and IsValid

`MarkAsGarbage()` sets the `RF_MirroredGarbage` flag and marks the object in the global object
array. The object is collected on the next GC pass. The object is *not* immediately destroyed —
gameplay code should stop using it, but raw pointers to it will not be nulled.

`IsValid(UObject* Test)` returns `true` if `Test` is non-null and has neither the garbage flag
nor the `RF_BeginDestroyed` flag set:
`Runtime/CoreUObject/Public/UObject/Object.h`:1875.

`MarkAsGarbage` asserts `!IsRooted()` — you must `RemoveFromRoot()` before marking rooted objects
as garbage:
`Runtime/CoreUObject/Public/UObject/UObjectBaseUtility.h`:182.

## Version note

In UE4, `MarkPendingKill()` (setting `RF_PendingKill`) auto-nulled `UPROPERTY` pointers to the
marked object. In UE5, this behavior is off by default (`gc.PendingKillEnabled=false`). The
replacement is `MarkAsGarbage()` (which sets the garbage flag, making `IsValid` return false)
plus manually clearing pointers in `EndPlay`/`OnDestroyed`. If you see `RF_PendingKill` in
older code, treat it as equivalent to the garbage flag for all practical purposes.
