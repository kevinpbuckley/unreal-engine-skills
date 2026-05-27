# Components, registration, and state — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the component type hierarchy, registration and its
events, render state, physics state, ticking, `InitializeComponent` vs `BeginPlay`, and
editor-only visualization components. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Components/ActorComponent.h`,
`Components/SceneComponent.h`, `Components/PrimitiveComponent.h`) and the official
[Components](https://dev.epicgames.com/documentation/unreal-engine/components-in-unreal-engine) doc.

## Type hierarchy and what each tier adds

`UActorComponent` is the base for all components — components are the only way to render meshes,
implement collision, and play audio, so everything the player sees or touches is ultimately a
component.

- **`UActorComponent`** — abstract behavior with no transform: movement logic, inventory,
  attributes, ability systems. No location in the world. No render or physics state by default.
- **`USceneComponent`** (child of `UActorComponent`) — adds a **transform** (`FTransform`:
  location, rotation, scale) and the ability to **attach** into a tree. Used for location-based
  behavior without geometry: spring arms, cameras, audio emitters, constraints. Creates a render
  state by default (so attached children render correctly) but draws nothing itself.
- **`UPrimitiveComponent`** (child of `USceneComponent`) — adds **geometry**: rendering and/or
  collision. Box/Capsule/Sphere collision volumes, Static Mesh, Skeletal Mesh, particle/Niagara
  systems. Creates both render state and **physics state** by default.

An actor designates one `USceneComponent` as its **root**; the actor's world transform is drawn from
that component. Non-scene components can't be the root or be attached.

## Registration

Registration is what associates a component with the world/scene so it can update each frame,
render, and collide. It happens **automatically** for components created as default subobjects
during the owning actor's spawn. For components created during play you must call it yourself:

```cpp
UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(this);
C->SetupAttachment(GetRootComponent());
C->RegisterComponent();      // ActorComponent.h:1305 — required for runtime components
// ...
C->UnregisterComponent();    // ActorComponent.h:1308 — remove from update/render/physics
C->DestroyComponent();       // ActorComponent.h:1311 — unregister and tear down
```

Registering during play has a cost; do it only when necessary. The component must be associated
with an actor.

### Register / unregister events

While registering, the engine runs (override these to hook in):

| Function | Role | Cite |
|---|---|---|
| `OnRegister` | general per-register hook | `ActorComponent.h`:816 |
| `CreateRenderState` | initialize render state | — |
| `OnCreatePhysicsState` | initialize physics state | — |

While unregistering, the mirror set runs: `OnUnregister` (`ActorComponent.h`:821),
`DestroyRenderState`, `OnDestroyPhysicsState`.

## Render state

To draw, a component needs a **render state**, which also tells the engine when render data changed.
When something changes, mark it "dirty" with `MarkRenderStateDirty()` (`ActorComponent.h`:1114); at
end of frame all dirty components update their render data. Scene and primitive components create
render states by default; plain actor components do not (nothing to draw).

## Physics state

To take part in physics simulation/collision, a component needs a **physics state**, which updates
immediately (no dirty-marker / frame-behind issues). Only primitive components create one by
default. Override `ShouldCreatePhysicsState()` (`ActorComponent.h`:864) to decide per class — don't
blindly return `true`; respect the cases (e.g. during destruction) where the `UPrimitiveComponent`
version returns `false`, and prefer returning `Super::ShouldCreatePhysicsState()` where you'd
otherwise return `true`.

## Ticking

By default components do **not** tick. To enable:

```cpp
// In the component constructor:
PrimaryComponentTick.bCanEverTick = true;                 // ActorComponent.h:168
// Then, in the constructor or later:
PrimaryComponentTick.SetTickFunctionEnable(true);         // EngineBaseTypes.h:338
// ...later, to pause:
PrimaryComponentTick.SetTickFunctionEnable(false);

virtual void TickComponent(float DeltaTime, ELevelTick TickType,
                           FActorComponentTickFunction* ThisTickFunction) override;  // :962
```

If a component never needs per-frame work, leave `bCanEverTick = false` for a small perf win, or
drive it manually from the owning actor. See `timers-and-async` for event/timer alternatives.

## `InitializeComponent` vs `BeginPlay`

- `InitializeComponent` (`ActorComponent.h`:905) runs during the actor's component-init
  sub-sequence (before `BeginPlay`) — **only if** the component sets
  `bWantsInitializeComponent = true` (`:331`) in its constructor. Use it for self-contained setup
  that must exist before any actor's `BeginPlay`.
- `UActorComponent::BeginPlay` (`:922`) runs when gameplay starts, after the owning actor's
  `BeginPlay`. Bind delegates and start gameplay interactions here. The mirror cleanup is
  `EndPlay` (`:935`); `UninitializeComponent` (`:941`) mirrors `InitializeComponent`.

Practical rule: bind delegates in `BeginPlay` and react via the observer pattern, so you don't have
to reason about init order across components.

## Visualization components (editor only)

Some components/actors have no visual representation, making them hard to select or debug.
**Visualization components** are ordinary components that exist only in the editor: create the
component, call `SetIsVisualizationComponent(true)` (`ActorComponent.h`:706), and guard all
references behind `WITH_EDITORONLY_DATA` / `WITH_EDITOR` so packaged builds never reference them.
The Camera Component uses this pattern to draw its view frustum in-editor. Such components do not
appear during Play-in-Editor or in packaged builds.

## Finding components on an actor

```cpp
UStaticMeshComponent* M = GetComponentByClass<UStaticMeshComponent>();  // Actor.h:3791, first match
TArray<UActorComponent*> All;
GetComponents<UActorComponent>(All);                                    // all matching
```

## Version notes

- The component model and registration flow are stable across UE5. Line numbers drift between 5.x
  patches; re-grep the component headers if a cite looks off.
- `TObjectPtr<T>` is the modern member type for component UPROPERTYs; raw `T*` still compiles.
