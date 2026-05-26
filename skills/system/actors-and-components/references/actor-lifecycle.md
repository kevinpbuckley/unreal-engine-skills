# AActor lifecycle — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the three creation paths, the component
initialization sub-sequence, end-of-life, and garbage collection, with the matching
`AActor`/`UObject` callbacks. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h`) and the official
[Actor Lifecycle](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-actor-lifecycle)
doc.

## The three creation paths

Every actor reaches the same `PreInitializeComponents → InitializeComponent →
PostInitializeComponents → BeginPlay` convergence, but how it gets there depends on *how* it was
created.

### 1. Load from disk
For actors already saved in a level (e.g. `UEngine::LoadMap`, or streaming via
`UWorld::AddToWorld`):
1. Actors are deserialized from the package/level.
2. `UObject::PostLoad` runs after load completes — do versioning/fixup here. **Mutually exclusive
   with `PostActorCreated`.**
3. `UAISystemBase::InitializeActorsForPlay` prepares actors for gameplay.
4. `ULevel::RouteActorInitialize` runs the component-init sub-sequence (below) for any
   uninitialized actors.
5. `BeginPlay` when the level starts.

### 2. Play in Editor (PIE)
Actors are **duplicated** from the editor world instead of loaded from disk:
1. Editor actors are duplicated into a new world.
2. `UObject::PostDuplicate` runs.
3. `UAISystemBase::InitializeActorsForPlay`, then `ULevel::RouteActorInitialize` (component-init
   sub-sequence).
4. `BeginPlay`.

### 3. Spawning (`UWorld::SpawnActor`)
1. `SpawnActor` is called.
2. `PostSpawnInitialize`.
3. `PostActorCreated` — constructor-style setup for spawned actors. **Mutually exclusive with
   `PostLoad`.**
4. `ExecuteConstruction` → `OnConstruction(Transform)` — Blueprint actors create their
   components and initialize Blueprint variables here.
5. `PostActorConstruction` runs the component-init sub-sequence.
6. `UWorld::OnActorSpawned` is broadcast.
7. `BeginPlay`.

### 4. Deferred spawn (`UWorld::SpawnActorDeferred`)
Same as spawning, but pauses after `PostActorCreated` so you can configure the actor (set
properties, "expose on spawn" values) on a valid-but-incomplete instance. Calling
`AActor::FinishSpawning(Transform)` resumes at `ExecuteConstruction` and proceeds to `BeginPlay`.
Use this whenever the actor needs data set **before** its construction script / `BeginPlay` runs.

## Component initialization sub-sequence

Shared by all paths, run by `ULevel::RouteActorInitialize` / `PostActorConstruction`:

1. `AActor::PreInitializeComponents` — called before any component is initialized.
2. `UActorComponent::InitializeComponent` — once per component, **only if** that component set
   `bWantsInitializeComponent = true` (`ActorComponent.h`:331). This is the component analog of an
   early init pass and runs before the actor's `BeginPlay`.
3. `AActor::PostInitializeComponents` — after all components are initialized; components exist and
   are registered, so this is the safe place to wire components to each other.

Then `BeginPlay` runs on the actor, which in turn drives `BeginPlay` on its components.

## Callback responsibilities (cheat sheet)

| Callback | When | Put here |
|---|---|---|
| Constructor | object construction, incl. CDO & editor | defaults, `CreateDefaultSubobject`, tick flags |
| `PostInitProperties` (2346) | after UPROPERTYs initialized | rare native fixup |
| `OnConstruction` (3448) | spawn + every editor property change | idempotent construction logic |
| `PreInitializeComponents` (3123) | before component init | pre-init wiring |
| `InitializeComponent` (component) | per component, needs `bWantsInitializeComponent` | component self-init |
| `PostInitializeComponents` (3126) | after component init | wire components together |
| `BeginPlay` (2128) | gameplay start | gameplay init, timers, delegate binds, spawning |
| `Tick` (3059) | per frame, if enabled | per-frame logic (avoid when possible) |
| `EndPlay` (2135) | any exit reason | clean up timers/delegates/handles |
| `Destroyed` (3568) | legacy destroy response | (prefer `EndPlay`) |
| `BeginDestroy` (2357) | GC, off game thread concerns | free non-gameplay resources |

## End of an actor's life

`Destroy()` marks the actor pending-kill and removes it from the level's actor array. `EndPlay`
is the single reliable cleanup hook — it is called for **all** of:
- an explicit `Destroy()`,
- Play-in-Editor ending,
- level transitions (seamless travel or load map),
- a streaming level containing the actor being unloaded,
- the actor's lifespan expiring (`SetLifeSpan`),
- application shutdown (everything is destroyed).

`OnDestroyed` is a **legacy** response to `Destroy`; Epic recommends moving its logic to `EndPlay`,
which also covers level transitions and other cleanup paths.

### Resurrection gotcha
An actor whose `EndPlay` fired is not guaranteed to be destroyed. If
`s.ForceGCAfterLevelStreamedOut` is `false` and a sublevel is reloaded quickly, the *same* actor
instance can be "resurrected" with its member variables **not** reset to defaults. Don't assume a
fresh actor after `EndPlay`; re-initialize state in `BeginPlay`, not just in the constructor.

## Garbage collection

After an actor is marked for destruction (`RF_PendingKill`), GC eventually frees it:
1. `UObject::BeginDestroy` — release memory and multithreaded resources (e.g. render-thread proxy
   objects). Most gameplay cleanup should already have happened in `EndPlay`.
2. `UObject::IsReadyForFinishDestroy` — return `false` to defer deallocation to a later GC pass
   (e.g. while async work completes).
3. `UObject::FinishDestroy` — last chance to free internal data before memory is reclaimed.

To hold a safe reference to an actor that might be destroyed, use `TWeakObjectPtr<AActor>` and check
`IsValid()` rather than tracking pending-kill manually. UE clusters objects and their subobjects so
GC frees them together, reducing churn (configurable under Project Settings → Garbage Collection).

## Version notes

- The lifecycle is stable across UE5. Function **line numbers** drift across 5.x patch releases;
  header paths and names are stable. Re-grep `Actor.h` if a line cite looks off.
- `RF_PendingKill` semantics evolved with UE5's move toward null-on-destroy object handling; the
  practical guidance (use weak pointers, do cleanup in `EndPlay`) is unchanged. See `memory-and-gc`.
