# DrawDebug helpers and console commands — full reference

Deep dive for [../SKILL.md](../SKILL.md). Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Public/DrawDebugHelpers.h` and
`Engine/Source/Runtime/Engine/Classes/Engine/Engine.h`).

## DrawDebug full shape catalog

All functions below are declared in `DrawDebugHelpers.h` and guarded by
`#if ENABLE_DRAW_DEBUG`. They are no-ops in Shipping builds. The common parameter tail is:
`bool bPersistentLines, float LifeTime, uint8 DepthPriority, float Thickness`.

| Function (line) | Geometry | Notable parameters |
|---|---|---|
| `DrawDebugLine` (22) | Line segment | `LineStart`, `LineEnd` |
| `DrawDebugPoint` (24) | Point | `Position`, `Size` |
| `DrawDebugDirectionalArrow` (26) | Arrow | `ArrowSize` |
| `DrawDebugBox` (28, 30) | Wire box | AABB overload or `FQuat` rotation |
| `DrawDebugSphere` (45) | Wire sphere | `Radius`, `Segments` |
| `DrawDebugCylinder` (47) | Wire cylinder | `Start`, `End`, `Radius`, `Segments` |
| `DrawDebugCone` (49) | Wire cone | `AngleWidth`, `AngleHeight` in radians |
| `DrawDebugCapsule` (57) | Wire capsule | `HalfHeight`, `Radius`, `Rotation` (FQuat) |
| `DrawDebugString` (52) | Text label | `TestBaseActor` (null = absolute position) |
| `DrawDebugSolidBox` (68, 70, 72) | Solid box | FBox overload, or Center+Extent+optional FQuat |
| `DrawDebugCoordinateSystem` (32) | XYZ axes | `Scale` |
| `DrawDebugCircle` (36, 38) | Circle | Matrix or Center+YAxis+ZAxis overloads |
| `DrawDebugCircleArc` (40) | Arc | `AngleWidth` in radians |
| `DrawDebugFrustum` (53) | Camera frustum | `FrustumToWorld` matrix |
| `DrawDebugCamera` (59) | Camera shape | `FOVDeg`, `Scale` |
| `DrawDebugMesh` (74) | Arbitrary mesh | `Verts`, `Indices` |
| `DrawDebugFloatHistory` (79, 82) | 2D graph | `FDebugFloatHistory`, `DrawSize` |
| `FlushPersistentDebugLines` (20) | Clears persistent | — |
| `FlushDebugStrings` (64) | Clears text labels | — |

### LifeTime semantics

- `LifeTime = -1.f` — "use the engine default", which is one frame for most functions.
- `LifeTime > 0.f` — shape persists for that many seconds.
- `bPersistentLines = true` — shape stays until `FlushPersistentDebugLines` is called,
  regardless of `LifeTime`.

### DepthPriority values

Defined in `EngineTypes.h` as `ESceneDepthPriorityGroup`:
- `0` (SDPG_World) — drawn at normal world depth; can be occluded by geometry.
- `1` (SDPG_Foreground) — always drawn on top; useful for inspecting occluded volumes.

## On-screen messages

`GEngine->AddOnScreenDebugMessage` writes text to the viewport corner without a HUD widget.

```cpp
if (GEngine)
{
    // Keyed: overwrites the previous message with the same key each frame
    GEngine->AddOnScreenDebugMessage(
        /*Key=*/42,               // int32; INDEX_NONE (-1) appends a new line
        /*TimeToDisplay=*/5.f,    // seconds; 0 = one frame
        FColor::Cyan,
        FString::Printf(TEXT("Ammo: %d"), Ammo)
    );

    // Remove a specific key
    GEngine->RemoveOnScreenDebugMessage(42);

    // Clear all
    GEngine->ClearOnScreenDebugMessages();
}
```

Source: `Runtime/Engine/Classes/Engine/Engine.h` — `AddOnScreenDebugMessage` (uint64 key):2138,
`AddOnScreenDebugMessage` (int32 key):2141, `ClearOnScreenDebugMessages`:2147,
`RemoveOnScreenDebugMessage`:2150.

Key rules:
- `Key = INDEX_NONE` appends a new entry every call — suitable for one-shot events, not for
  every-tick updates (stacks up and fills the screen).
- The uint64-key overload exists for systems that need keys above `INT_MAX`.
- `bNewerOnTop = true` (the default) means newer messages push older ones down.
- Messages are drawn only when `GEngine` is non-null and the viewport is visible; they do not
  appear in Shipping builds.

## Console and stat commands

### Stat overlays

Run these at the console (`~`) during PIE or a standalone game:

| Command | What it shows |
|---|---|
| `stat fps` | Frame rate and frame time in ms |
| `stat unit` | Per-thread breakdown: Game / Draw / GPU / RHI |
| `stat unitgraph` | Scrolling graph version of `stat unit` |
| `stat game` | Per-system game-thread costs (actors, components, movement) |
| `stat ai` | AI task tick costs |
| `stat particles` | Niagara/particle system costs |
| `stat streaming` | Level streaming request counts and memory |
| `stat memory` | High-level memory categories |
| `stat rhi` | RHI draw primitive counts |

### Visualization commands

| Command | Effect |
|---|---|
| `showdebug ai` | AI state text overlay (Behavior Tree state, perception) |
| `showdebug input` | Active input action states |
| `showdebug collision` | Collision channels and shapes |
| `showdebug physics` | Physics body counts and states |
| `showdebug none` | Turns off all showdebug overlays |
| `displayall ClassName PropName` | Prints a UPROPERTY value for every instance of `ClassName` every frame |
| `dumpticks` | Lists ticking objects, their tick group, and tick interval |
| `ToggleDebugCamera` | Detaches camera from pawn for free-fly inspection |
| `r.VisualizeOccludedPrimitives 1` | Highlights culled (occluded) primitives in red |
| `r.ShowMipLevels 1` | Overlays texture mip level selection |
| `p.chaos.DebugDraw.Enabled 1` | Shows Chaos physics body outlines |

### Time manipulation

| Command | Effect |
|---|---|
| `Slomo 0.1` | Slow-motion at 10% speed (game time only) |
| `t.MaxFPS 10` | Cap frame rate for frame-by-frame analysis |
| `pause` | Pauses the game (or `FreezeFrame 5.0` for a timed pause) |

### CVar authoring

Declare a console variable in your module's `.cpp` to expose a toggle without recompiling:

```cpp
static TAutoConsoleVariable<int32> CVarShowMyDebug(
    TEXT("my.ShowDebug"),
    0,
    TEXT("1 = draw my system debug shapes"),
    ECVF_Cheat
);

// In Tick or wherever you draw:
if (CVarShowMyDebug.GetValueOnGameThread() != 0)
{
    DrawDebugSphere(GetWorld(), GetActorLocation(), 100.f, 12, FColor::Magenta, false, 0.f);
}
```

`ECVF_Cheat` prevents the cvar from being set in Shipping builds. Other flags:
- `ECVF_Default` — unrestricted.
- `ECVF_ReadOnly` — can only be set at startup (e.g. from `.ini`).
- `ECVF_RenderThreadSafe` — safe to read on the render thread with `GetValueOnRenderThread()`.

Source: `Runtime/Core/Public/HAL/IConsoleManager.h` — `TAutoConsoleVariable`, `ECVF_*` flags.
