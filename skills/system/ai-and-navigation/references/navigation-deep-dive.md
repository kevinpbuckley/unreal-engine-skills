# Navigation system deep dive

Deep dive for [../SKILL.md](../SKILL.md). Covers nav area costs and query filters, RVO and
Detour Crowd avoidance, nav links (simple and smart), Navigation Invokers for open worlds,
and World Partition navigation mesh. Grounded in UE 5.7
(`Engine/Source/Runtime/NavigationSystem/Public/`).

## NavMesh generation fundamentals

`UNavigationSystemV1` (declared at `NavigationSystem.h`:295) manages all navigation data in
a world. It generates `ARecastNavMesh` (`NavMesh/RecastNavMesh.h`:573) from collision
geometry by voxelizing the level and converting traversable regions into convex polygons.

**Generation modes** (set in Project Settings → Navigation Mesh → Generation Mode):
- `Static` — built at cook time; no runtime regeneration. Lowest runtime cost.
- `Dynamic` — tiles regenerate when geometry changes. Required for moving obstacles.
- `Dynamic Modifiers Only` — base mesh is static; only `NavModifierVolume` changes are
  applied at runtime. Good compromise for levels with minimal geometry change.

Each polygon carries a **traversal cost** determined by its `UNavArea`. The pathfinder
selects the lowest-cost path (not necessarily the shortest distance).

## Nav areas and query filters

Subclass `UNavArea` (in `NavigationSystem/Public/NavAreas/NavArea.h`) to create custom areas:
```cpp
UCLASS()
class UNavArea_Shallow : public UNavArea
{
    GENERATED_BODY()
public:
    UNavArea_Shallow() { DefaultCost = 2.0f; }  // double cost to traverse
};
```

Apply to geometry via:
- `UNavModifierComponent` on an actor — applies the area to the actor's collision.
- `ANavModifierVolume` — a level-placed volume with an assigned `NavArea` class.

**Query filters** (`UNavigationQueryFilter` subclasses, in `NavigationSystem/Public/NavFilters/`)
let individual agents ignore or reweight areas per-move. Pass a filter to `MoveToActor`:
```cpp
MoveToActor(Target, AcceptRadius, true, true, true, false,
    UMyCustomFilter::StaticClass());
```

`ARecastNavMesh` exposes `DefaultQueryFilterImpl` and you can register custom filters via
`UNavigationSystemV1::RegisterCustomLink`.

## Path following

`UPathFollowingComponent` (at `AIModule/Classes/Navigation/PathFollowingComponent.h`:216)
executes movement along a computed path. It is created automatically by `AAIController` and
driven by `MoveToActor`/`MoveToLocation`.

Key signals:
- `OnMoveCompleted` override on the controller fires when the move ends.
- `ReceiveMoveCompleted` dynamic delegate (controller, line 239) for Blueprint-binding.
- `EPathFollowingResult::Success/Blocked/OffPath/Aborted/Invalid` describes why movement
  stopped.
- Call `StopMovement()` to cancel the current move (fires `Aborted` result).

**Partial paths:** If no full path exists, `ARecastNavMesh` can return a partial path to the
closest reachable point. Check `IsPartialPath()` on the `UNavigationPath` to detect this.
`UNavigationSystemV1::FindPathToLocationSynchronously` (line 521) and
`FindPathToActorSynchronously` (line 527) return a `UNavigationPath*` for manual path
inspection without issuing a `MoveTo`.

## Avoidance

Two complementary avoidance methods can coexist in a project:

### RVO (Reciprocal Velocity Obstacles)
- Enabled per-agent on `UCharacterMovementComponent`:
  `MovementComp->bUseRVOAvoidance = true`.
- Agents share velocity information via `UCrowdManagerBase`; each independently adjusts
  velocity to avoid predicted collisions.
- Lightweight; works without the `DetourCrowdAIController`.
- Best for low-to-medium agent counts where group formations are not required.

### Detour Crowd (`ADetourCrowdAIController`)
- Declared at `AIModule/Classes/DetourCrowdAIController.h`.
- Replaces `UPathFollowingComponent` with `UCrowdFollowingComponent` for shared-simulation
  path following using Recast/Detour's crowd manager.
- Agents share the same path, smoothed per-agent. Better group cohesion.
- Higher setup cost; the `ACrowdManager` (`AIModule/Classes/Navigation/CrowdManager.h`) must
  be present and configured (max agents, avoidance quality).

Use Detour Crowd for large groups following the same general path (e.g. soldiers moving to an
objective). Use RVO for independent agents that happen to share space.

## Nav links

**Simple links** connect two nav mesh areas that are physically separated (e.g. a ledge with
a jump-down). Place an `ANavLinkProxy` (`AIModule/Classes/Navigation/NavLinkProxy.h`:34) in
the level, configure `PointLinks` (each is a pair of left/right endpoints). The nav system
treats the link like a nav edge at the specified traversal cost.

**Smart links** (one per `ANavLinkProxy`) broadcast a delegate when an AI is about to use the
link, so you can trigger an animation and call `ResumePathFollowing` when the animation
finishes:
```cpp
// On ANavLinkProxy (Blueprint or C++):
OnSmartLinkReached.AddDynamic(this, &AMyNavLink::OnAgentReached);

void AMyNavLink::OnAgentReached(AActor* Agent, const FVector& Destination)
{
    // Play a jump animation on Agent, then after animation:
    ResumePathFollowing(Agent);
}
```

**Automatic Navigation Link Generation** (UE 5.3+): enable in Project Settings to have
the nav system automatically generate jump-down links from ledges based on geometry, without
manual `ANavLinkProxy` placement.

## Navigation Invokers (open worlds / World Partition)

For large open worlds, generating navmesh over the entire level is impractical. Enable
**Navigation Invokers** in Project Settings → Navigation System:

```cpp
// On the AI pawn or controller (during BeginPlay):
UNavigationInvokerComponent* Invoker =
    NewObject<UNavigationInvokerComponent>(this);
Invoker->TileGenerationRadius = 3000.f;   // generate within 3000 cm
Invoker->TileRemovalRadius   = 5000.f;   // remove when more than 5000 cm away
Invoker->RegisterComponent();
```

`UNavigationInvokerComponent` is declared at
`NavigationSystem/Public/NavigationInvokerComponent.h`. Only tiles close to an active invoker
are generated or kept in memory. Combine with World Partition's **World Partitioned Navigation
Mesh** (`ANavigationDataChunkActor`) to pre-cook nav tiles per partition cell and stream them
at runtime.

## World Partition navigation mesh

In a World Partition level, enable the `World Partitioned Navigation Mesh` option on the
`ARecastNavMesh` actor. The system divides the nav mesh into data chunks aligned to partition
cells. At runtime, streamed-in cells bring their nav data; the agent sees a continuous mesh
even as the world loads around it.

For dynamically-placed nav data (e.g. procedurally spawned buildings), use
`UNavigationSystemV1::AddNavigationDirtyArea` to invalidate tiles and trigger regeneration.

## Project Settings summary

| Setting | Location | Effect |
|---|---|---|
| Generate Navigation Only Around Navigation Invokers | Project Settings → Navigation System | Restricts generation to invoker radii |
| Agent Height / Step Height / Max Slope | RecastNavMesh Details | Controls what geometry is walkable |
| NavMesh Cell Size | RecastNavMesh Details | Resolution: smaller = more detail, higher cost |
| Default Query Filter | NavigationSystem | Global default cost table for pathfinding |
| Tick Freshness Threshold | AISystem | Forget-stale-actors for perception |

## Version notes

- **Automatic Navigation Link Generation** was introduced in UE 5.3. On earlier versions,
  all links must be placed manually via `ANavLinkProxy`.
- `UCrowdFollowingComponent` has been present since UE 4.x. The `DetourCrowdAIController`
  convenience class wraps it since UE 4.14.
- Line numbers in `NavigationSystem.h` and `RecastNavMesh.h` drift across patches; class
  and function names are stable.
