---
name: debugging-techniques
description: Debug Unreal C++ and gameplay code — native debugger usage (VS/Rider, natvis, Live
  Coding caveats), DrawDebug* world-space helpers (DrawDebugLine, DrawDebugSphere, DrawDebugString,
  etc.), on-screen messages (GEngine->AddOnScreenDebugMessage), the Visual Logger (UE_VLOG*,
  timestamped replay of spatial/temporal events), the Gameplay Debugger (FGameplayDebuggerCategory,
  custom categories), ensure/check as debugging aids, and stat/console commands for runtime
  interrogation. Use when diagnosing wrong behavior, visualizing traces/ranges/AI state in the
  world, reproducing intermittent or AI bugs with timeline replay, stepping through a crash, or
  adding in-game debug overlays to a custom system.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Debugging techniques

Pick the tool that fits the question:

| Question | Tool |
|---|---|
| What value / did this run? | `UE_LOG` / `ensure` — see `logging-and-assertions` |
| Where in space is this thing? | `DrawDebug*` helpers |
| What happened over the last N seconds? | Visual Logger |
| What is the AI/gameplay system thinking right now? | Gameplay Debugger |
| Crash / step through logic? | Native debugger (VS/Rider) |
| Frame time, draw calls, physics cost? | `profiling-and-optimization` |

## When to use this skill

- Behavior is wrong and you need values, positions, or state visible during play.
- Visualizing traces, detection ranges, AI targets, nav paths, or spawn points.
- An intermittent bug whose cause unfolds over several seconds — record with the Visual Logger and scrub the timeline.
- Stepping through C++ to find a crash or logic error; attaching a debugger and reading a callstack.
- Adding a custom in-game debug overlay for a new system (Gameplay Debugger custom category).

## Logging and assertions — start here

For "what is the value / did this path run" questions, a `UE_LOG` line is fastest. For
invariant violations, prefer `ensure` over `check` in gameplay code so the editor survives and
surfaces the problem without a crash. Full coverage — log categories, verbosity, `UE_LOG`,
`check`, `ensure`, `checkf`, `ensureMsgf` — is in `logging-and-assertions`.

```cpp
// Non-fatal invariant — logs callstack, editor keeps running, fires once per session by default
if (!ensure(MyComponent != nullptr))
    return;

// Fatal invariant — crashes intentionally when the assumption is broken in dev builds
check(GetWorld() != nullptr);
checkf(Health >= 0.f, TEXT("Health underflowed to %.1f on %s"), Health, *GetName());
```

Source: `Runtime/Core/Public/Misc/AssertionMacros.h` — `check`:232, `checkf`:258, `ensure`
block begins at line 363 with `DO_ENSURE` guard; `ensure` fires once per call-site per session,
`ensureAlways` fires every time.

## Debug drawing (visualize in the world)

`DrawDebug*` functions render geometry directly into the viewport — lines, spheres, boxes,
capsules, text labels, arrows, cones, and more. They require no actor or component; call them
from any code that has a `UWorld*`.

```cpp
#include "DrawDebugHelpers.h"

// Line — show a trace or path segment
DrawDebugLine(GetWorld(), TraceStart, TraceEnd, FColor::Red,
              /*bPersistentLines=*/false, /*LifeTime=*/2.f, /*DepthPriority=*/0, /*Thickness=*/1.f);

// Sphere — visualize a detection radius or spawn point
DrawDebugSphere(GetWorld(), GetActorLocation(), DetectionRadius,
                /*Segments=*/16, FColor::Green, false, 0.f);

// Text label at a world position — tag an actor with live data
DrawDebugString(GetWorld(), GetActorLocation() + FVector(0,0,80),
                FString::Printf(TEXT("HP: %d"), Health),
                /*TestBaseActor=*/nullptr, FColor::White, /*Duration=*/0.f);

// Capsule — match a character's collision shape
DrawDebugCapsule(GetWorld(), GetActorLocation(), CapsuleHalfHeight, CapsuleRadius,
                 FQuat::Identity, FColor::Yellow, false, 1.f);

// Directional arrow — show a velocity or AI direction
DrawDebugDirectionalArrow(GetWorld(), Tail, Head, /*ArrowSize=*/20.f,
                          FColor::Cyan, false, 1.f);
```

Key parameters shared by most functions:
- `bPersistentLines` — if `true`, stays until `FlushPersistentDebugLines` is called.
- `LifeTime` — seconds the shape is visible; `-1` means one frame; `0.f` on most shapes
  means "use duration", which defaults to one frame from the game's perspective.
- `DepthPriority` — higher priority draws on top; use `SDPG_Foreground` (1) to prevent
  geometry from occluding the shape.
- `Thickness` — line thickness in screen pixels for wire shapes.

All functions are guarded by `#if ENABLE_DRAW_DEBUG` (which evaluates to false in Shipping),
so they are automatically stripped from release builds — no manual `#if` guards needed.

Source: `Runtime/Engine/Public/DrawDebugHelpers.h` — `DrawDebugLine`:22, `DrawDebugPoint`:24,
`DrawDebugSphere`:45, `DrawDebugBox`:28, `DrawDebugCapsule`:57, `DrawDebugString`:52,
`DrawDebugDirectionalArrow`:26, `DrawDebugCone`:49, `DrawDebugCylinder`:47,
`DrawDebugCapsule`:57, `DrawDebugSolidBox`:68, `FlushPersistentDebugLines`:20.

Full shape catalog and persistent-line patterns:
[references/draw-debug-and-console.md](references/draw-debug-and-console.md).

## On-screen debug messages

For transient HUD-free readouts — values that update each frame without spamming the log:

```cpp
// Keyed message: same key overwrites the previous value each frame
if (GEngine)
{
    GEngine->AddOnScreenDebugMessage(
        /*Key=*/1,                                    // unique int key; INDEX_NONE appends
        /*TimeToDisplay=*/0.f,                        // 0 = one frame, positive = linger
        FColor::Yellow,
        FString::Printf(TEXT("Speed: %.1f"), Speed)
    );
}
```

Use `Key` values unique per message so they overwrite rather than stack. `INDEX_NONE` (-1)
appends a new line every call — useful for single-shot notifications, noisy if called every tick.
`GEngine->ClearOnScreenDebugMessages()` removes all messages at once.

Source: `Runtime/Engine/Classes/Engine/Engine.h` — `AddOnScreenDebugMessage` (uint64 key):2138,
`AddOnScreenDebugMessage` (int32 key):2141, `ClearOnScreenDebugMessages`:2147,
`RemoveOnScreenDebugMessage`:2150.

## Visual Logger (events over time)

The Visual Logger records text and spatial shapes per-actor with timestamps. After recording you
can scrub a timeline in the Visual Logger window and see *exactly* what each actor saw, decided,
and drew at each moment — invaluable for AI and intermittent bugs that plain logging cannot
capture. For spatial/temporal bugs, prefer `UE_VLOG*` over flooding the output log with
`UE_LOG`.

```cpp
#include "VisualLogger/VisualLogger.h"

// Text entry — attached to 'this' actor's timeline row
UE_VLOG(this, LogMyAI, Verbose, TEXT("Acquired target %s at dist %.1f"),
        *Target->GetName(), Distance);

// Sphere at a world position — mark a last-known position
UE_VLOG_LOCATION(this, LogMyAI, Verbose, LastKnownPos, /*Radius=*/30.f,
                 FColor::Yellow, TEXT("LKP"));

// Segment between two points — visualize a planned move
UE_VLOG_SEGMENT(this, LogMyAI, Verbose, Start, Goal, FColor::Cyan, TEXT("Path"));

// Wire sphere — perception radius at this frame
UE_VLOG_WIRESPHERE(this, LogMyAI, Verbose, GetActorLocation(), PerceptionRadius,
                   FColor::Green, TEXT("Hear radius"));

// Conditional variant — only logs if the condition is true (avoids branching boilerplate)
UE_CVLOG(bTargetVisible, this, LogMyAI, Verbose, TEXT("Target visible"));
```

All `UE_VLOG*` macros are no-ops unless `ENABLE_VISUAL_LOG` is defined (true in non-Shipping
builds). The macros short-circuit on `FVisualLogger::IsRecording()` so there is no overhead
when the Visual Logger is inactive. `UE_VLOG_UELOG` emits to both the Visual Logger and the
standard output log simultaneously.

Source: `Runtime/Engine/Public/VisualLogger/VisualLogger.h` — macro block starts at line 30;
`FVisualLogger` class at line 232; `SetIsRecording`:801, `IsRecording` (static inline):803,
`SetIsRecordingToFile`:806, `FVisualLogger::Get()`:746.

Full macro catalog, redirection, and file recording:
[references/visual-logger.md](references/visual-logger.md).

## Gameplay Debugger (live categories in PIE)

The Gameplay Debugger is an in-game overlay activated by the apostrophe key (`'`) in PIE. Built-in
categories cover the AI subsystem (Behavior Trees, EQS, perception, navigation), abilities, and
more. You can add **custom categories** to visualize your own systems alongside the built-in data.

### Registering a custom category

```cpp
// In your module's StartupModule():
#if WITH_GAMEPLAY_DEBUGGER
    IGameplayDebugger& GDB = IGameplayDebugger::Get();
    GDB.RegisterCategory(
        TEXT("MySystem"),
        IGameplayDebugger::FOnGetCategory::CreateStatic(
            &FMySystemDebuggerCategory::MakeInstance),
        EGameplayDebuggerCategoryState::EnabledInGameAndSimulate
    );
    GDB.NotifyCategoriesChanged();
#endif

// In ShutdownModule():
#if WITH_GAMEPLAY_DEBUGGER
    if (IGameplayDebugger::IsAvailable())
    {
        IGameplayDebugger::Get().UnregisterCategory(TEXT("MySystem"));
    }
#endif
```

### Implementing the category

```cpp
// MySystemDebuggerCategory.h
#if WITH_GAMEPLAY_DEBUGGER
#include "GameplayDebuggerCategory.h"

class FMySystemDebuggerCategory : public FGameplayDebuggerCategory
{
public:
    static TSharedRef<FGameplayDebuggerCategory> MakeInstance()
    {
        return MakeShared<FMySystemDebuggerCategory>();
    }

    // [AUTH] — runs on server/standalone, collects data to replicate
    virtual void CollectData(APlayerController* OwnerPC, AActor* DebugActor) override;

    // [LOCAL] — runs on client, draws the collected data
    virtual void DrawData(APlayerController* OwnerPC,
                          FGameplayDebuggerCanvasContext& CanvasContext) override;
};
#endif
```

In `CollectData`, call `AddTextLine(TEXT("{yellow}Key: {white}Value"))` and `AddShape(...)` to
populate replicated data. In `DrawData`, the lines and shapes added by `CollectData` render
automatically before your custom draw code runs.

`WITH_GAMEPLAY_DEBUGGER` is not defined in Shipping builds by default; guard all category code
with it. Add `SetupGameplayDebuggerSupport(Target)` to your `Build.cs` to link correctly.

Source: `Runtime/GameplayDebugger/Public/GameplayDebugger.h` — `IGameplayDebugger` interface,
`RegisterCategory`:78, `UnregisterCategory`:79, `NotifyCategoriesChanged`:80.
`Runtime/GameplayDebugger/Public/GameplayDebuggerCategory.h` — `FGameplayDebuggerCategory`:48,
`CollectData`:56, `DrawData`:59, `AddTextLine`:68, `AddShape`:71.

Full custom-category walkthrough:
[references/gameplay-debugger.md](references/gameplay-debugger.md).

## Native debugger (C++ breakpoints and inspection)

Attach Visual Studio or Rider to the Unreal Editor process (or launch with `-debug`). Unreal
ships `.natvis` files so the watch window renders `FString`, `FName`, `TArray`, `TMap`, and
`FVector` as readable values rather than raw memory.

Practical habits:
- Break on `ensure` failures: in VS, add a conditional breakpoint on `FDebug::EnsureFailed`
  or use "Break on all exceptions" for C++ in the Exception Settings.
- For crash callstacks, read from the top down; the first frame in project code is usually
  where the bad pointer or bad assumption lives.
- `checkNoEntry()` marks code paths that should be unreachable; hitting one in the debugger
  means the control flow is wrong, not the data.

### Live Coding

Live Coding (`Ctrl+Alt+F11`) recompiles function bodies without restarting the editor. It is
safe for changing logic inside existing functions. It cannot handle:
- Adding or removing `UPROPERTY` / `UFUNCTION` members.
- Changing class layout (new member variables, changed base classes).
- Changes to header files that affect other translation units.

After any of these, restart the editor for a full hot reload or use Unreal Build Tool. The
common failure mode is that Live Coding "succeeds" on a structural change but the old CDO or
Blueprint instance retains the stale layout, causing silent data corruption or crashes on the
next frame. When in doubt after a crash following Live Coding, do a full rebuild.

## Console commands and cvars

Open the console with the tilde key (`~`). Useful dev commands:

| Command | What it shows |
|---|---|
| `stat fps` | Frame rate overlay |
| `stat unit` | Game/render/GPU thread timing |
| `stat game` | Per-system game-thread costs |
| `stat ai` | AI tick costs |
| `showdebug ai` | AI state overlay (overlaps with Gameplay Debugger) |
| `showdebug input` | Current input action states |
| `showdebug collision` | Collision channel visualization |
| `displayall ClassName PropertyName` | Live broadcast of a UPROPERTY value for all instances |
| `dumpticks` | Lists all ticking actors and their tick group |
| `r.VisualizeOccludedPrimitives 1` | Highlights culled primitives |
| `ToggleDebugCamera` | Detaches the camera from the pawn for free-fly inspection |
| `Slomo 0.1` | Slows time by 10x (via `UCheatManager`) |
| `t.MaxFPS 10` | Caps frame rate for slow-motion inspection |

**CVars** follow the pattern `r.*` (rendering), `s.*` (streaming), `p.*` (physics), `t.*`
(time), `ai.*` (AI). Use `DumpConsoleCommands` or start typing in the console to search.

**Exec functions** on any `UObject` in the input chain (pawn, controller, game mode, cheat
manager) can be marked `UFUNCTION(Exec)` and invoked from the console by name. `UCheatManager`
(on `APlayerController`) is the canonical home for dev-only cheats.

```cpp
// In your PlayerController or CheatManager subclass:
UFUNCTION(Exec)
void ToggleMyDebugVis()
{
    bShowMyDebugOverlay = !bShowMyDebugOverlay;
}
```

Source: `Runtime/Engine/Classes/GameFramework/CheatManager.h` — `UCheatManager`:98,
`UFUNCTION(exec)` cheat examples: `FreezeFrame`:158, `Fly`:171, `God`:183, `Slomo`:187.

Full stat commands, cvar authoring, and `displayall`:
[references/draw-debug-and-console.md](references/draw-debug-and-console.md).

## Decision guide

```
Bug type                        → Tool
──────────────────────────────────────────────────────
Wrong value / missing execution → UE_LOG / ensure
Wrong position / shape / range  → DrawDebug* or UE_VLOG_LOCATION
AI makes wrong decision         → Gameplay Debugger + Visual Logger
Intermittent / race / sequence  → Visual Logger (scrub timeline)
Crash / access violation        → Native debugger + callstack
Perf regression (fps/ms)        → profiling-and-optimization
```

## Gotchas

- **`DrawDebug*` and `GEngine->AddOnScreenDebugMessage` in Shipping** — both are stripped.
  They are dev tools; never rely on them for gameplay feedback.
- **Live Coding after structural changes** — silent staleness or immediate crash; do a full
  hot-reload restart instead.
- **`UE_LOG` spam every tick** instead of the Visual Logger — produces GBs of output; use
  `UE_VLOG*` for spatial/temporal information.
- **`check` when `ensure` was wanted** — crashes the editor and loses unsaved work; prefer
  `ensure` in gameplay code for non-fatal invariants.
- **`UE_VLOG*` with no owner** — pass `this` (an `AActor` or `UObject`); a null owner silently
  drops the entry.
- **Forgetting `#if WITH_GAMEPLAY_DEBUGGER`** — linker error in Shipping if the GameplayDebugger
  module is excluded; always guard category code.
- **`DrawDebugString` with a non-null `TestBaseActor`** — the string position is relative to
  that actor, which can be confusing if the actor moves; pass `nullptr` for absolute positions.
- **`LifeTime = -1.f`** — in `DrawDebugLine`/`DrawDebugSphere`, `-1.f` means "use the default
  duration" (one frame), NOT "persist forever". Use `bPersistentLines = true` for persistence,
  then call `FlushPersistentDebugLines` to clear.

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/Engine/Public/DrawDebugHelpers.h` — `DrawDebugLine`:22, `DrawDebugPoint`:24,
  `DrawDebugSphere`:45, `DrawDebugBox`:28, `DrawDebugCapsule`:57, `DrawDebugString`:52,
  `DrawDebugDirectionalArrow`:26, `DrawDebugCone`:49, `DrawDebugSolidBox`:68;
  `ENABLE_DRAW_DEBUG` macro:14.
- `Runtime/Engine/Classes/Engine/Engine.h` — `AddOnScreenDebugMessage` (uint64):2138,
  `AddOnScreenDebugMessage` (int32):2141, `ClearOnScreenDebugMessages`:2147,
  `RemoveOnScreenDebugMessage`:2150.
- `Runtime/Engine/Public/VisualLogger/VisualLogger.h` — `UE_VLOG` macro:30,
  `UE_VLOG_LOCATION`:45, `UE_VLOG_SEGMENT`:39, `UE_VLOG_SPHERE`:48, `UE_VLOG_UELOG`:33;
  `FVisualLogger`:232, `SetIsRecording`:801, `IsRecording`:803, `FVisualLogger::Get()`:746.
- `Runtime/GameplayDebugger/Public/GameplayDebugger.h` — `IGameplayDebugger`:50,
  `RegisterCategory`:78, `UnregisterCategory`:79, `NotifyCategoriesChanged`:80.
- `Runtime/GameplayDebugger/Public/GameplayDebuggerCategory.h` — `FGameplayDebuggerCategory`:48,
  `CollectData`:56, `DrawData`:59, `AddTextLine`:68, `AddShape`:71.
- `Runtime/Core/Public/Misc/AssertionMacros.h` — `check`:232, `checkf`:258,
  `ensure` block:363 (see also `logging-and-assertions`).
- `Runtime/Engine/Classes/GameFramework/CheatManager.h` — `UCheatManager`:98,
  example `UFUNCTION(exec)` cheat bodies:158–215.

Official docs (UE 5.7):
- Visual Logger — <https://dev.epicgames.com/documentation/unreal-engine/visual-logger-in-unreal-engine>
- Gameplay Debugger — <https://dev.epicgames.com/documentation/unreal-engine/using-the-gameplay-debugger-in-unreal-engine>
- Console Variables — <https://dev.epicgames.com/documentation/unreal-engine/console-variables-cplusplus-in-unreal-engine>
- Live Coding — <https://dev.epicgames.com/documentation/unreal-engine/using-live-coding-to-recompile-unreal-engine-applications-at-runtime>

Related skills: `logging-and-assertions`, `ai-and-navigation`, `profiling-and-optimization`.

Deep-dive references in this skill:
- [references/visual-logger.md](references/visual-logger.md) — full `UE_VLOG*` macro catalog,
  redirection, file recording, Rewind Debugger integration.
- [references/gameplay-debugger.md](references/gameplay-debugger.md) — custom category
  walkthrough, replication, key bindings, `Build.cs` setup.
- [references/draw-debug-and-console.md](references/draw-debug-and-console.md) — full shape
  catalog, persistent lines, on-screen messages, stat/console command reference.
