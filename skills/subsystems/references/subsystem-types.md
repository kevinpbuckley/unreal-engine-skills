# Subsystem types — per-type reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the creation timing, world availability, and
special APIs for each subsystem base class. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Public/Subsystems/`).

## UEngineSubsystem

**Inherits:** `UDynamicSubsystem` → `USubsystem` → `UObject`

**Lifetime:** from engine module startup until process exit. One instance per class.

**Creation timing:** when the module containing the subsystem loads. If the engine subsystem
collection already exists at module-load time, the instance is created immediately; otherwise it
is created during engine initialization. `Initialize` is called after the module's
`StartupModule()` returns. `Deinitialize` is called after `ShutdownModule()` returns.

**World access:** none — `GetWorld()` returns null. Engine subsystems have no concept of a
specific world.

**Access:**
```cpp
UMyEngineSubsystem* Sub = GEngine->GetEngineSubsystem<UMyEngineSubsystem>();
```

**Dynamic loading:** `UEngineSubsystem` (and `UEditorSubsystem`) are *dynamic* subsystems via
`UDynamicSubsystem` (`Subsystem.h`:87). If a plugin containing a `UEngineSubsystem` subclass is
loaded at runtime, the collection instantiates the subsystem automatically. Similarly, unloading
the plugin calls `Deinitialize` and removes the instance. Use
`FSubsystemCollectionBase::ActivateExternalSubsystem` / `DeactivateExternalSubsystem`
(`SubsystemCollection.h`:48, :53) if you need to manually trigger this.

**Use for:** process-wide services that outlive any game session — asset registries, analytics
services, cross-session caches, plugin lifecycle management.

---

## UGameInstanceSubsystem

**Inherits:** `USubsystem` → `UObject`; declared `Within=GameInstance`

**Lifetime:** from `UGameInstance` initialization to shutdown. Survives seamless level travel
and every `UWorld` swap.

**Creation timing:** after `UGameInstance::Init()`. The subsystem's `Initialize` is called
during game instance initialization before `UGameInstance::OnStart`.

**World access:** `GetWorld()` is **not reliable** during `Initialize` — the world may not yet
be assigned to the game instance at that point. For world-dependent initialization, subscribe to
world begin-play via `FWorldDelegates::OnWorldBeginPlay` or use a companion
`UWorldSubsystem`. The convenience method `GetGameInstance()` on the subsystem returns the
owning `UGameInstance` (`GameInstanceSubsystem.h`:23).

**Access:**
```cpp
UGameInstance* GI = GetGameInstance();
UMySaveSubsystem* Sub = GI->GetSubsystem<UMySaveSubsystem>();

// Null-safe static form (returns nullptr if GI is null):
UMySaveSubsystem* Sub = UGameInstance::GetSubsystem<UMySaveSubsystem>(GetGameInstance());
```

**Use for:** services that must persist across level loads — save/load, match tracking,
cross-level player progression, plugin feature flags.

---

## UWorldSubsystem

**Inherits:** `USubsystem` → `UObject`

**Lifetime:** one `UWorld` instance. Recreated fresh after every seamless travel or `LoadMap`.
Destroyed before the world is torn down.

**Creation timing:** during `UWorld` initialization. `Initialize` (overridden in
`WorldSubsystem.h`:36) is followed by `PostInitialize` (`:39`) once all world subsystems have
been initialized — use `PostInitialize` for cross-subsystem setup within the world scope.
`OnWorldBeginPlay` (`:45`) is called when gameplay starts, mirroring `AActor::BeginPlay`.

**World access:** `GetWorld()` is always valid after `Initialize`; the world subsystem is owned
by its world.

**Filtering by world type:** override `DoesSupportWorldType` (`WorldSubsystem.h`:61) to skip
creation in certain world types (e.g. only create in game worlds, not preview or editor worlds):

```cpp
bool UMyWorldSub::DoesSupportWorldType(const EWorldType::Type WorldType) const
{
    return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
}
```

**`ShouldCreateSubsystem` vs `DoesSupportWorldType`:** `ShouldCreateSubsystem` makes a
one-time decision on the CDO (before any instance exists). `DoesSupportWorldType` is a
per-world filter checked each time a new world is created — prefer it for world-type gating.

**Access:**
```cpp
UMyWorldSub* Sub = GetWorld()->GetSubsystem<UMyWorldSub>();

// Checked — asserts if null (use when null is a programming error):
UMyWorldSub& Sub = *GetWorld()->GetSubsystemChecked<UMyWorldSub>();

// Static null-safe form:
UMyWorldSub* Sub = UWorld::GetSubsystem<UMyWorldSub>(GetWorld());
```

**Use for:** per-level state: AI behavior managers, level-event coordinators, streaming
orchestrators, per-world audio/vfx state.

---

## UTickableWorldSubsystem

**Inherits:** `UWorldSubsystem`, `FTickableGameObject`

Extends `UWorldSubsystem` with automatic per-frame `Tick`. Ticking begins at the end of
`Initialize` (via `Super::Initialize`) and stops during `Deinitialize`.

**Required overrides:**

```cpp
UCLASS()
class MYGAME_API UMyTickSub : public UTickableWorldSubsystem
{
    GENERATED_BODY()
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override
    {
        Super::Initialize(Collection); // starts ticking — must call
    }
    virtual void Deinitialize() override
    {
        Super::Deinitialize(); // stops ticking — must call
        // cleanup ...
    }
    virtual void Tick(float DeltaTime) override;

    // Pure virtual — must implement or the class is abstract and won't compile:
    virtual TStatId GetStatId() const override
    {
        RETURN_QUICK_DECLARE_CYCLE_STAT(UMyTickSub, STATGROUP_Tickables);
    }
};
```

`GetStatId` is declared `PURE_VIRTUAL` in `WorldSubsystem.h`:87. Every concrete subclass must
implement it; forgetting it results in a compile error because the class remains abstract.

`IsTickable` defaults to `true`. Override it if tick should be paused conditionally.

---

## ULocalPlayerSubsystem

**Inherits:** `USubsystem` → `UObject`; declared `Within=LocalPlayer`

**Lifetime:** one `ULocalPlayer`. In split-screen each slot has its own independent instance.

**Creation timing:** when the local player is created (before a player controller is assigned).

**Player controller access:** override `PlayerControllerChanged` (`LocalPlayerSubsystem.h`:37)
to react when the player's controller changes (e.g. after seamless travel or login).

**Access:**
```cpp
// From a PlayerController (handles the null LocalPlayer case):
UMyLPSub* Sub = ULocalPlayer::GetSubsystemFromController<UMyLPSub>(PlayerController);

// From a ULocalPlayer pointer:
UMyLPSub* Sub = LocalPlayer->GetSubsystem<UMyLPSub>();

// Static null-safe form:
UMyLPSub* Sub = ULocalPlayer::GetSubsystem<UMyLPSub>(LocalPlayer);
```

**Use for:** per-player input profiles, per-player UI state, per-player stat tracking,
split-screen-aware services.

---

## UEditorSubsystem (editor modules only)

Inherits `UDynamicSubsystem` like `UEngineSubsystem` and follows the same dynamic-loading
rules. Lives in the Editor module; never included in a shipping build. Access via
`GEditor->GetEditorSubsystem<T>()`. Use for editor tooling: custom asset importers, editor
utility extensions, scripted validation pipelines.

---

## Version notes

- `UWorldSubsystem::UpdateStreamingState` was deprecated in UE 5.5. Implement
  `IStreamingWorldSubsystemInterface` instead if streaming state callbacks are needed.
- `GetSubsystemChecked` on `UWorld` (`World.h`:4205) is new in UE 5.x; it returns
  `TNotNull<T*>` and asserts when the subsystem is absent.
- The subsystem framework is stable across UE5; the per-type headers and class hierarchy
  have not changed since the feature was introduced in UE 4.22.
