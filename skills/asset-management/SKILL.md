---
name: asset-management
description: Reference and load Unreal assets correctly — hard vs soft references (TObjectPtr vs
  TSoftObjectPtr/TSoftClassPtr), virtual content paths, async loading with the streamable manager,
  the Asset Registry for querying without loading, and UAssetManager/primary data assets. Use when
  deciding how to reference an asset, fixing load hitches or huge memory/cook sizes from hard
  references, loading assets on demand, or enumerating assets at runtime.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Asset management

Every `.uasset` is a `UObject` in a package addressed by a virtual path. The single most
important decision is **hard vs soft reference**: it determines what loads into memory (and gets
cooked) with your class. Wrong choices here cause load hitches and bloated memory/package sizes.

## When to use this skill

- Choosing how a class references a mesh/material/sound/Blueprint/data asset.
- Load hitches, or memory/cook size ballooning from references.
- Loading content on demand (level streaming-friendly, plugin/DLC content).
- Enumerating or querying assets at runtime without loading them.

## Content paths

- `/Game/...` → project `Content/`; `/Engine/...` → engine; `/PluginName/...` → a plugin's content.
- Reference string: `/Game/Weapons/SM_Rifle.SM_Rifle` (`Package.Object`).
- Never use OS paths; always virtual paths.

## Hard vs soft references (the key distinction)

| Kind | Type | When the target loads | Use for |
|---|---|---|---|
| **Hard** | `TObjectPtr<UObject>` (UPROPERTY) | when the owner loads (eagerly) | small/always-needed assets |
| **Soft (object)** | `TSoftObjectPtr<UTexture2D>` | on demand, when you load it | heavy/optional/occasional assets |
| **Soft (class)** | `TSoftClassPtr<AActor>` | on demand | classes you spawn sometimes |

```cpp
UPROPERTY(EditAnywhere) TObjectPtr<UStaticMesh> AlwaysUsedMesh;     // hard: loads with owner
UPROPERTY(EditAnywhere) TSoftObjectPtr<USoundBase> RareSfx;        // soft: path until loaded
UPROPERTY(EditAnywhere) TSoftClassPtr<AActor> BossClass;          // soft class ref
```

A hard reference pulls the target (and its dependencies) into memory and into the cook whenever
the referencing class loads. A class loaded everywhere (e.g. a GameInstance, a base character)
holding hard refs to many heavy assets is a classic memory/cook bloat bug — use soft refs there.

## Loading soft references

Sync (use sparingly — blocks):
```cpp
if (UStaticMesh* M = MeshSoftPtr.LoadSynchronous()) { /* ... */ }
```

Async (preferred during gameplay) via the streamable manager:
```cpp
#include "Engine/AssetManager.h"
FStreamableManager& Streamable = UAssetManager::GetStreamableManager();
Streamable.RequestAsyncLoad(RareSfx.ToSoftObjectPath(),
    FStreamableDelegate::CreateUObject(this, &AMyActor::OnSfxLoaded));
// In OnSfxLoaded: USoundBase* S = RareSfx.Get();   // now resident
```
Keep the returned `TSharedPtr<FStreamableHandle>` if you want to manage/cancel/keep-alive the load.

## Referencing engine/known content in C++

`ConstructorHelpers::FObjectFinder`/`FClassFinder` resolve assets in the **constructor only**:
```cpp
static ConstructorHelpers::FObjectFinder<UStaticMesh> MeshObj(TEXT("/Engine/BasicShapes/Cube.Cube"));
if (MeshObj.Succeeded()) Mesh->SetStaticMesh(MeshObj.Object);
```
Fine for stable engine content and prototypes. For game content, prefer a soft/hard `UPROPERTY`
assigned in a Blueprint subclass (`blueprint-cpp-integration`) — it's data-driven and avoids
hard-coding paths.

## Asset Registry — query without loading

```cpp
#include "AssetRegistry/AssetRegistryModule.h"
IAssetRegistry& AR = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry").Get();
TArray<FAssetData> Assets;
AR.GetAssetsByClass(UStaticMesh::StaticClass()->GetClassPathName(), Assets);
// FAssetData has path, tags, class — no load required
```
Use this to discover/filter assets (e.g. all weapons) cheaply, then load the ones you need.

## UAssetManager & primary assets (for scale)

For games with lots of content/DLC, `UAssetManager` + `UPrimaryDataAsset` provide discovery,
async loading by type/id, and asset bundles for cook/chunking. Define primary asset types in
Project Settings → Asset Manager. Use when you need managed, queryable, streamable content sets;
overkill for tiny projects.

## Gotchas

- **Hard refs from widely-loaded classes** → memory/cook bloat; switch to soft refs.
- **`LoadSynchronous` during gameplay** → hitch; load async ahead of need.
- **Hard-coded asset path strings** scattered in C++ → brittle; expose `UPROPERTY` refs instead.
- **Forgetting the async load completed handler** / dropping the streamable handle → asset may be
  GC'd right after loading.
- **`FObjectFinder` outside a constructor** → fails/asserts; it's constructor-only.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Classes/Engine/AssetManager.h` — `UAssetManager`, `GetStreamableManager`.
- `Runtime/Engine/Classes/Engine/StreamableManager.h` — `FStreamableManager`, async load.
- `Runtime/CoreUObject/Public/UObject/SoftObjectPtr.h` — `TSoftObjectPtr`/`TSoftClassPtr`.
- `Runtime/Engine/Classes/Engine/DataAsset.h` — `UDataAsset`/`UPrimaryDataAsset`.
- `Runtime/AssetRegistry/Public/AssetRegistry/IAssetRegistry.h` — asset queries.

Official docs (UE 5.7): Working with Content —
<https://dev.epicgames.com/documentation/unreal-engine/working-with-content-in-unreal-engine>
