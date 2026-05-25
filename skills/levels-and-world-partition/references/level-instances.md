# Level Instances & Packed Level Actors — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers Level Instance runtime modes, Packed
Level Actors, property overrides, and the relationship with World Partition. Grounded in
UE 5.7 `Engine/Source/Runtime/Engine/Public/LevelInstance/` and the official
[Level Instancing](https://dev.epicgames.com/documentation/unreal-engine/level-instancing-in-unreal-engine)
doc.

## What a Level Instance is

`ALevelInstance` is an `AActor` that references a `.umap` file via
`TSoftObjectPtr<UWorld> WorldAsset`. At edit time the referenced level is loaded
*inside* the owning world, with all actors displayed in-context. When you edit the
instance all copies in the world update on save. At runtime the sub-level is either
**embedded** into the World Partition grid or loaded via standard **level streaming**,
depending on whether the sub-level uses OFPA.

Source: `Runtime/Engine/Public/LevelInstance/LevelInstanceActor.h`:18.

## Runtime modes

### Embedded Mode (default, preferred)

When the Level Instance's sub-level has *Use External Actors* (OFPA) enabled, its actors
are owned by individual external packages. At runtime these actors are registered directly
into the owning world's World Partition grid. The `ALevelInstance` actor itself exists only
in the editor.

Benefits: actors participate in WP cell streaming and Data Layers; no extra `ULevel`
object overhead at runtime.

Limitation: `AWorldSettings` and other non-OFPA actors inside the Level Instance are not
available at runtime. Do not rely on them.

### Level Streaming Mode

When the sub-level does not use OFPA (e.g. a legacy level), the Level Instance falls back
to loading the associated `ULevel` via `ULevelStreaming` when its owning WP cell activates.
This is a higher-cost path (more `ULevel` objects, additional streaming overhead) and is
not recommended for high-density use.

Avoid dense usage of Level Streaming Mode instances — each one adds a level to the
streaming stack when its cell is active.

## Data Layers and Level Instances

Actors inside the Level Instance inherit the Data Layer of the `ALevelInstance` actor by
default. Additional Data Layers can be assigned to individual actors inside the instance
for finer-grained control (e.g. a building instance on *Neighborhood* with holiday
decorations on *Holiday*).

## Property overrides (5.3+)

`ULevelInstancePropertyOverrideAsset` lets you override per-instance properties without
editing the source level. Overrides are stored in a separate asset and applied on top of
the source level's values at runtime. This is useful for colour/material variations of the
same building template without duplicating the level.

Source: `Runtime/Engine/Public/LevelInstance/LevelInstancePropertyOverrideAsset.h`.

## Packed Level Actors

`APackedLevelActor` (subclass of `ALevelInstance`) bakes all Static Meshes from the source
level into a set of `UInstancedStaticMeshComponent` objects, yielding one actor with ISM
components instead of many individual mesh actors. This dramatically reduces draw-call
overhead for dense repetitive geometry such as city blocks.

The packing is performed by `FPackedLevelActorBuilder`
(`Runtime/Engine/Public/PackedLevelActor/PackedLevelActorBuilder.h`). The result is stored
as a Blueprint (`UBlueprint`) whose parent class is `APackedLevelActor`; the Blueprint
contains the ISM components with pre-baked instance transforms.

Limitations:
- Only Static Meshes are supported. Any other component types in the source level are lost
  in the packing step — use a regular `ALevelInstance` when non-mesh actors are needed.
- Property overrides (`SupportsPropertyOverrides`) are not supported.
- Partial editor loading (`SupportsPartialEditorLoading`) is not supported.

Source: `Runtime/Engine/Public/PackedLevelActor/PackedLevelActor.h`:25.

## Creating instances in C++

Level Instances are ordinarily created in the editor. To create one at runtime (uncommon),
use `ULevelInstanceSubsystem`:

```cpp
// LevelInstanceSubsystem is a WorldSubsystem
ULevelInstanceSubsystem* LISys =
    GetWorld()->GetSubsystem<ULevelInstanceSubsystem>();
// LISys can be used to load/query level instance state
```

Source: `Runtime/Engine/Public/LevelInstance/LevelInstanceSubsystem.h`.

In Blueprints, actor properties can reference the `ALevelInstance` and call interface
functions from `ILevelInstanceInterface` (`LevelInstance/LevelInstanceInterface.h`).

## Breaking a Level Instance

"Breaking" replaces the `ALevelInstance` actor with the individual actors from the source
level in the owning world. This operation cannot be undone and does not delete the source
level asset. Use it when you need to diverge an instance from its template.

## Version notes

- Level Instances and Packed Level Actors are UE 5.0+ features.
- `FPackedLevelActorUtils::CreateOrUpdateBlueprint` replaces the static functions
  on `APackedLevelActor` that were deprecated in 5.3.
- Embedded Mode was made the default runtime behavior in UE 5.1.
- Property override support via `ULevelInstancePropertyOverrideAsset` was added in 5.3.
