# Streamable manager — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `FStreamableManager` and `FStreamableHandle`
in detail: async loading workflow, batch loads, combined handles, handle lifecycle, priority, and
release semantics. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/StreamableManager.h`).

## Overview

`FStreamableManager` is a non-UObject struct (`struct FStreamableManager : public FGCObject`,
`StreamableManager.h`:705) that drives all on-demand loading. It maintains an internal map from
`FSoftObjectPath` to `FStreamable` tracking records, dispatches `FlushAsyncLoading`-backed
requests, and keeps loaded assets in memory via `FStreamableHandle` until the handle is released.

`UAssetManager` owns one instance and exposes it via the static accessor:
```cpp
FStreamableManager& SM = UAssetManager::GetStreamableManager();  // AssetManager.h:105
```
You may also construct your own `FStreamableManager` in a global singleton for projects that
do not use `UAssetManager` (e.g. a `GameSingletonClassName` object in `DefaultEngine.ini`).
In either case, only one per lifetime — the struct is not copyable.

## Async load (single asset)

```cpp
#include "Engine/AssetManager.h"

// Store the handle so the asset stays in memory after the callback:
TSharedPtr<FStreamableHandle> LoadHandle;

void AMyActor::StartLoad()
{
    LoadHandle = UAssetManager::GetStreamableManager().RequestAsyncLoad(
        MySoftPtr.ToSoftObjectPath(),
        FStreamableDelegate::CreateUObject(this, &AMyActor::OnLoaded));
}

void AMyActor::OnLoaded()
{
    if (USoundBase* S = MySoftPtr.Get())
    {
        // asset is resident
    }
}
```

`RequestAsyncLoad` (`StreamableManager.h`:730) accepts:
- A single `FSoftObjectPath`, an array, or any container convertible to `TArray<FSoftObjectPath>`.
- An optional `FStreamableDelegate` or lambda (called on completion or next tick if already loaded).
- An optional `TAsyncLoadPriority` (default `0`; `AsyncLoadHighPriority = 100` is available).
- An optional `bManageActiveHandle` flag — if `true`, the manager keeps the handle alive
  internally so you do not need to store it.
- An optional debug name string for `Unreal Insights` / log output.

## Batch load (multiple assets)

```cpp
TArray<FSoftObjectPath> Paths;
for (const TSoftObjectPtr<UStaticMesh>& Ref : MeshRefs)
    Paths.Add(Ref.ToSoftObjectPath());

TSharedPtr<FStreamableHandle> BatchHandle =
    UAssetManager::GetStreamableManager().RequestAsyncLoad(
        Paths,
        [this]{ OnBatchLoaded(); });
```

The callback fires once, after *all* listed paths have loaded (or failed). Individual failures
result in null pointers but do not abort the batch.

## Combined handles

When you have multiple independent handles and want a single callback when all complete:
```cpp
TSharedPtr<FStreamableHandle> Combined =
    UAssetManager::GetStreamableManager().CreateCombinedHandle(
        {HandleA, HandleB},
        TEXT("MyBatchLoad"));
Combined->BindCompleteDelegate(
    FStreamableDelegate::CreateUObject(this, &AMyActor::OnAllLoaded));
```
`CreateCombinedHandle` (`StreamableManager.h`:823) creates a parent handle that waits for all
children. Child handles remain individually cancellable.

## Synchronous load

```cpp
// Blocks until complete — avoid during gameplay:
UObject* Asset = UAssetManager::GetStreamableManager().LoadSynchronous(
    MySoftPtr.ToSoftObjectPath());           // StreamableManager.h:774
```
Or the typed convenience wrapper on `TSoftObjectPtr<T>`:
```cpp
UStaticMesh* M = MeshSoftPtr.LoadSynchronous();   // SoftObjectPtr.h:514
```
Both are fine during level load or initial startup; never call in `Tick` or response to input.

## FStreamableHandle lifecycle

A handle has three states:

| State | Meaning |
|---|---|
| Active + loading | In flight; callback has not fired; assets are **not** yet safe to use |
| Active + complete | Assets are resident; handle keeps them in memory |
| Released / destroyed | Handle is inactive; manager drops its GC reference to the assets |

Key methods on `FStreamableHandle` (`StreamableManager.h`:190):

| Method | Purpose |
|---|---|
| `HasLoadCompleted()` | Returns `true` when all assets loaded (callback may still be pending one tick) |
| `IsActive()` | `true` if not canceled and not released |
| `WaitUntilComplete(float Timeout)` | Promotes to high priority and blocks; use for initial load only |
| `GetLoadedAsset<T>()` | Returns first loaded asset cast to `T*` |
| `GetLoadedAssets(TArray<UObject*>&)` | Fills array with all loaded objects |
| `GetProgress()` | `float` 0..1; useful for progress bars |
| `ReleaseHandle()` | Unloads assets (or allows GC); call when done |
| `CancelHandle()` | Cancels an in-flight request; callback is **not** called |
| `BindCompleteDelegate(...)` | Replace callback after creation |

**GC safety:** while an active handle exists the `FStreamableManager` holds a hard GC reference
to every loaded asset. When you drop or release the handle, that reference disappears and GC
can reclaim the asset. If other systems hold their own hard refs (e.g. a `UPROPERTY` on an
in-memory object) the asset stays resident regardless.

## Priority

```cpp
// Load at high priority (jumps the queue):
FStreamableManager::AsyncLoadHighPriority  // = 100  (StreamableManager.h:710)
// Default priority:
FStreamableManager::DefaultAsyncLoadPriority  // = 0
```
Higher values are loaded first. Large content systems may assign distinct priorities to UI
assets (high) vs background preloads (low) to avoid contention.

## Stalled handles

Passing `bStartStalled = true` to `RequestAsyncLoad` creates a handle that does not start
loading immediately. Call `Handle->StartStalledHandle()` when ready. Useful for pre-queueing
loads that depend on a prior step (e.g. chunk download).

## Module dependency

Add `"Engine"` to `PublicDependencyModuleNames` in your `Build.cs`. The include is:
```cpp
#include "Engine/AssetManager.h"   // pulls in StreamableManager.h
```
Or include `StreamableManager.h` directly:
```cpp
#include "Engine/StreamableManager.h"
```

## Version notes

- The `FStreamableDelegate` type alias (`TDelegate<void()>`) was stable through UE4 and UE5.
- `FStreamableDelegateWithHandle` (`TDelegate<void(TSharedPtr<FStreamableHandle>)>`) is
  preferred in UE5 as it gives the callback direct access to the handle.
- `bManageActiveHandle` was added in UE4.17 and is present in all UE5 releases.
