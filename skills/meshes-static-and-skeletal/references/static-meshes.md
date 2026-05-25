# Static meshes — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UStaticMesh` asset structure, mesh
sections, LOD internals, static sockets, and Nanite settings. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Engine/StaticMesh.h`,
`Engine/Source/Runtime/Engine/Classes/Components/StaticMeshComponent.h`,
`Engine/Source/Runtime/Engine/Classes/Engine/StaticMeshSocket.h`).

## UStaticMesh asset structure

`UStaticMesh` is the data asset that holds:
- **Render data** — per-LOD `FStaticMeshLODResources` (vertex/index buffers, sections).
- **Source models** — editable per-LOD source geometry used during cooking.
- **`StaticMaterials`** — ordered list of `FStaticMaterial` defining per-section slot
  names and default material assignments.
- **`BodySetup`** — the `UBodySetup` that owns simple and complex collision geometry.
- **`NaniteSettings`** — `FMeshNaniteSettings` controlling whether Nanite data is built.
- **Sockets** — array of `UStaticMeshSocket` (editor-defined, bone-free attach points).

The asset is loaded as a UObject; the component references it by `TObjectPtr<UStaticMesh>`
and is the only entity that creates per-component render/collision state.

## Mesh sections

Each **LOD level** is divided into **sections** (`FStaticMeshSection`). A section maps
a contiguous triangle range to one material slot index. The number of draw calls for a
non-instanced, non-Nanite mesh equals its active section count (before batching).
Reducing sections (merging material slots in the DCC) directly lowers draw call cost.

```cpp
// Read the number of sections in LOD 0 at runtime (editor or game thread):
const FStaticMeshLODResources& LOD0 =
    MyStaticMesh->GetRenderData()->LODResources[0];
int32 SectionCount = LOD0.Sections.Num();
```

Do not call `GetRenderData()` before the mesh is fully compiled/loaded; wrap in
`IsCompiling()` checks in editor utilities.

## LOD internals

`UStaticMeshComponent` selects the active LOD each frame based on screen size (the
ratio of the mesh bounds to viewport height). Override for debugging:

```cpp
Mesh->ForcedLodModel = 2;   // 1-based; 0 = auto; 2 = LOD1 (zero-indexed LOD1)
```

Per-platform LOD bias can be set in Project Settings and affects all components
without code changes. The `MinLOD` property on the component clamps the selected LOD
from below (useful to keep high-fidelity meshes even far away for cinematics).

Automatic LOD generation (available in the Static Mesh Editor) creates reduced-poly
LODs using a screen-size percentage reduction rule. Mesh sections must be preserved
for per-LOD material slot overrides to work correctly.

## Static mesh sockets

`UStaticMeshSocket` defines a named, immobile attach point on the mesh.

Key properties (`Engine/Classes/Engine/StaticMeshSocket.h`):

| Property | Type | Meaning |
|---|---|---|
| `SocketName` | `FName` | Unique name used in `AttachToComponent` |
| `RelativeLocation` | `FVector` | Offset from mesh pivot |
| `RelativeRotation` | `FRotator` | Rotation from mesh pivot |
| `RelativeScale` | `FVector` | Scale relative to mesh |
| `Tag` | `FString` | Optional user tag |

Retrieve the socket's current world-space transform at runtime:

```cpp
UStaticMeshSocket const* S = Mesh->GetSocketByName(TEXT("MuzzleFlash")); // line 892
if (S)
{
    FTransform WT = Mesh->GetSocketTransform(TEXT("MuzzleFlash"));
}
```

`GetSocketTransform` returns identity if the socket name is not found — always check
with `GetSocketByName` first. Sockets defined in the Static Mesh Editor are stored on
the `UStaticMesh` asset and are shared across all component instances.

## Nanite settings

`FMeshNaniteSettings` (declared `Engine/Classes/Engine/EngineTypes.h`:3039):

| Field | Type | Meaning |
|---|---|---|
| `bEnabled` | `uint8 : 1` | Whether Nanite geometry data is built for this mesh |
| `bExplicitTangents` | `uint8 : 1` | Store tangents explicitly (vs. derive in shader) |
| `KeepPercentTriangles` | `float` | 1.0 = no reduction; 0.0 = no triangles |
| `TrimRelativeError` | `float` | Minimum relative error at which to stop reducing |
| `PositionPrecision` | `int32` | Step size = 2^(-PositionPrecision) cm; `MIN_int32` = auto |

In 5.7, direct member access is deprecated (`UE_DEPRECATED(5.7, ...)`). Use:

```cpp
FMeshNaniteSettings NS = MyMesh->GetNaniteSettings();   // line 836
NS.bEnabled = true;
MyMesh->SetNaniteSettings(NS);                          // line 845
// Call PostEditChange / MarkPackageDirty to trigger rebuild in-editor.
```

Nanite meshes bypass traditional draw calls entirely. On platforms that support Nanite
(DX12 SM6+), the fallback mesh is used for ray tracing unless `r.RayTracing.Nanite.Mode 1`
is set (experimental native Nanite ray tracing in 5.7).

## Collision on static meshes

A `UStaticMesh` carries one `UBodySetup` (accessible via `GetBodySetup()`) that
stores both simple convex/primitive shapes (`AggGeom`) and a cooked complex
(per-triangle) mesh used for `CTF_UseComplexAsSimple`. See
[materials-lods-collision.md](materials-lods-collision.md) for the full setup guide.

## Version notes

- `NaniteSettings` direct-member deprecation is new in 5.7; use accessors in all new
  code. Older assets compiled before 5.7 are still valid.
- Nanite Skeletal Mesh (full deforming Nanite) is production-supported from 5.7;
  static mesh Nanite has been stable since 5.0.

## See also

- [Importing Static Meshes](https://dev.epicgames.com/documentation/unreal-engine/importing-static-meshes-in-unreal-engine)
- [Creating and Using LODs](https://dev.epicgames.com/documentation/unreal-engine/creating-and-using-lods-in-unreal-engine)
- [Using Sockets With Static Meshes](https://dev.epicgames.com/documentation/unreal-engine/using-sockets-with-static-meshes-in-unreal-engine)
- [Nanite Virtualized Geometry](https://dev.epicgames.com/documentation/unreal-engine/nanite-virtualized-geometry-in-unreal-engine)
