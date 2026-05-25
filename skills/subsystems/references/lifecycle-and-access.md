# Subsystem lifecycle and access — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the initialization sequence, dependency
ordering, collection internals, and how to access subsystems from C++ and Blueprints. Grounded
in UE 5.7 (`Engine/Source/Runtime/Engine/Public/Subsystems/SubsystemCollection.h`,
`Subsystem.h`, `GameInstanceSubsystem.h`, `WorldSubsystem.h`) and the official
[Programming Subsystems](https://dev.epicgames.com/documentation/unreal-engine/programming-subsystems-in-unreal-engine) doc.

## Initialization sequence

When an owner (e.g. `UGameInstance`) initializes, `FSubsystemCollectionBase::Initialize` is
called. It iterates every `USubsystem`-derived `UCLASS` in loaded modules that is `Within` the
collection's owner type:

1. **`ShouldCreateSubsystem(Outer)` on the CDO** — if `false`, the class is skipped and no
   instance is created. The CDO is checked, not the instance, so the method must not rely on
   per-instance state.
2. **`NewObject<T>(Outer)`** — the subsystem instance is created and owned by the outer object.
3. **`Initialize(Collection)`** — called on the new instance. Inside `Initialize`, the subsystem
   may call `Collection.InitializeDependency<T>()` to ensure another subsystem in the same
   collection is initialized first.
4. All subsystems are initialized before the owner's post-init callbacks proceed.

### Ordering with InitializeDependency

```cpp
void UMySubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    // Ensure UOtherSubsystem is ready before this one uses it:
    Collection.InitializeDependency<UOtherSubsystem>();
    Super::Initialize(Collection);
    UOtherSubsystem* Other = GetGameInstance()->GetSubsystem<UOtherSubsystem>();
    // Other is guaranteed non-null here.
}
```

`InitializeDependency` (`SubsystemCollection.h`:33, template form :40) initializes the named
class immediately if not already done, then returns its pointer. It only works within the same
collection — world and game-instance subsystems cannot declare dependencies on each other.
Circular dependency cycles are detected at runtime and result in an assertion failure.

### Deinitialization sequence

`FSubsystemCollectionBase::Deinitialize` calls `USubsystem::Deinitialize()` on each active
subsystem, in **reverse** initialization order (LIFO). Dependencies are therefore deinitialized
after the subsystems that depend on them.

## UWorldSubsystem extended lifecycle

`UWorldSubsystem` has additional lifecycle callbacks beyond `Initialize`/`Deinitialize`:

| Callback | When | Use for |
|---|---|---|
| `Initialize(Collection)` | World created, before actors initialize | subsystem setup, registering delegates |
| `PostInitialize()` | After all world subsystems are initialized | cross-subsystem references within the world |
| `OnWorldBeginPlay(World)` | Just before `BeginPlay` on actors | work that needs the world fully initialized |
| `OnWorldEndPlay(World)` | After `EndPlay` on actors, before deinitialization | pre-teardown logic |
| `PreDeinitialize()` | Just before `Deinitialize` | last-chance cleanup that needs peer subsystems |
| `Deinitialize()` | World torn down | release references, cancel async work |

`OnWorldBeginPlay` is the correct place for world-subsystem logic that would otherwise go in a
manager actor's `BeginPlay`.

## Collection internals

`FSubsystemCollectionBase` (`SubsystemCollection.h`:14) is the generic collection host. It
holds a `TMap<UClass*, USubsystem*>` internally. Each owner type (`UGameInstance`, `UWorld`,
`ULocalPlayer`, `UEngine`) owns one typed `FSubsystemCollection<TBaseType>` or
`FObjectSubsystemCollection<TBaseType>` member.

The GC sees the collection via `AddReferencedObjects`; the subsystems themselves are
`UObject`s owned by the outer, so the outer's lifetime governs theirs.

`ForEachSubsystem` and `ForEachSubsystemOfClass` on the collection allow iterating all active
subsystems (e.g. to broadcast an event to every world subsystem). Removal during iteration is
not permitted and is checked in debug builds.

## Accessing subsystems — all forms

### C++ accessors on the owner

```cpp
// GameInstance:
TSubsystem* S = GI->GetSubsystem<TSubsystem>();                           // GameInstance.h:440
TSubsystem* S = UGameInstance::GetSubsystem<TSubsystem>(GI);             // :450 (null-safe static)

// World:
TSubsystem* S = World->GetSubsystem<TSubsystem>();                        // World.h:4196
TSubsystem& S = *World->GetSubsystemChecked<TSubsystem>();                // :4205 (asserts on null)
TSubsystem* S = UWorld::GetSubsystem<TSubsystem>(World);                  // :4215 (null-safe static)

// Local player:
TSubsystem* S = LP->GetSubsystem<TSubsystem>();                           // LocalPlayer.h:355
TSubsystem* S = ULocalPlayer::GetSubsystem<TSubsystem>(LP);              // :365 (null-safe static)
TSubsystem* S = ULocalPlayer::GetSubsystemFromController<TSubsystem>(PC);// :379

// Engine:
TSubsystem* S = GEngine->GetEngineSubsystem<TSubsystem>();                // Engine.h:3779
```

### Multiple implementations (interface pattern)

Subsystems can share an interface base. Retrieve all implementations via `GetSubsystemArrayCopy`:

```cpp
// All GameInstance subsystems derived from IMyInterface:
TArray<UMyIfaceSubsystem*> All = GI->GetSubsystemArrayCopy<UMyIfaceSubsystem>();
```

This is niche; the common case is a single concrete class per slot.

### Blueprint access

`USubsystemBlueprintLibrary` (`SubsystemBlueprintLibrary.h`:14) provides Blueprint-internal
getters that power the auto-context getter nodes in the Blueprint graph. You never call these
directly from C++; they are the backing implementation for the Blueprint nodes. Mark subsystem
functions `UFUNCTION(BlueprintCallable)` to expose them; no extra registration is needed.

In Blueprint graphs, right-click and search the subsystem class name — a typed getter node
appears under the relevant category (GameInstance Subsystems, World Subsystems, etc.).

### Python access (editor only)

```python
# Engine subsystem:
sub = unreal.get_engine_subsystem(unreal.MyEngineSubsystem)
# Editor subsystem:
sub = unreal.get_editor_subsystem(unreal.MyEditorSubsystem)
```

## Null-safety rules

`GetSubsystem<T>` returns `nullptr` in two cases:
1. `ShouldCreateSubsystem` returned `false` for this class/outer combination.
2. The owner itself is null (avoid by using the static null-safe forms).

Always null-check the result unless you have made the subsystem unconditionally created (i.e.
`ShouldCreateSubsystem` is not overridden or always returns `true`). The checked accessor
`GetSubsystemChecked` documents via assertion that you consider null a bug.

## Version notes

- `GetSubsystemChecked` (returns `TNotNull<T*>`) is available in UE 5.x; it was not present in
  UE 4. In UE 4, use the regular accessor with a manual `check()`.
- `UWorldSubsystem::UpdateStreamingState` was deprecated in UE 5.5 (see `WorldSubsystem.h`:57);
  use `IStreamingWorldSubsystemInterface` for streaming callbacks.
- The `ForEachSubsystem` / `ForEachSubsystemOfClass` iteration API on
  `FSubsystemCollectionBase` was added in UE 5.x; not available in UE 4.
