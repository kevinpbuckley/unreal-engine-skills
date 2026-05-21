---
name: debugging-techniques
description: Debug Unreal gameplay and code — logging and assertions, on-screen and 3D debug drawing
  (DrawDebugHelpers), the Visual Logger for time-recorded events/shapes, the Gameplay Debugger for
  AI/gameplay categories, the native C++ debugger with Live Coding caveats, and console commands /
  cheat manager. Use when diagnosing wrong behavior, visualizing positions/traces/AI state, or
  setting up an in-editor debugging workflow.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Debugging techniques

Pick the debugging tool that matches the question: *what value?* (logs/assertions), *where in
space?* (debug draw), *what happened over time?* (Visual Logger), *what is the AI thinking?*
(Gameplay Debugger), *step through code?* (native debugger).

## When to use this skill

- Behavior is wrong and you need to see values, positions, or state.
- Visualizing traces, ranges, AI targets, or paths in the world.
- Tracking an issue that unfolds over several seconds (then replaying it).
- Stepping through C++ to find a crash or logic bug.

## Logging & assertions (start here)

`UE_LOG` with categories, on-screen messages, and `check`/`ensure` — see
`unreal-logging-and-assertions`. Prefer `ensure` in gameplay code so the editor survives while
surfacing the problem. For most "what's the value / did this run" questions, a log line is fastest.

## Debug drawing (visualize in the world)

```cpp
#include "DrawDebugHelpers.h"
DrawDebugLine(GetWorld(), Start, End, FColor::Red, false, 2.f, 0, 1.f);
DrawDebugSphere(GetWorld(), Loc, 50.f, 16, FColor::Green, false, 2.f);
DrawDebugString(GetWorld(), Loc, FString::Printf(TEXT("HP %d"), Hp), nullptr, FColor::White, 2.f);
```
- Great for traces (`physics-and-chaos`), ranges, spawn points, aim. The `Duration` param: `-1`/
  `false` persists one frame; a positive value lingers.
- Debug draw is compiled out in Shipping (`ENABLE_DRAW_DEBUG`) — it's a dev tool.
- On-screen text: `GEngine->AddOnScreenDebugMessage(...)` for transient HUD-less readouts.

## Visual Logger (events over time)

The Visual Logger records logs + shapes per actor with timestamps, so you can **scrub a timeline**
and see exactly what an actor saw/did — invaluable for AI and intermittent bugs:
```cpp
UE_VLOG(this, LogMyAI, Verbose, TEXT("Acquired target %s"), *Target->GetName());
UE_VLOG_LOCATION(this, LogMyAI, Verbose, Loc, 30.f, FColor::Yellow, TEXT("LKP"));
```
Open the Visual Logger window, record, then replay. Better than spammy `UE_LOG` for anything
spatial/temporal.

## Gameplay Debugger (live HUD categories)

Press the apostrophe key (`'`) in PIE to toggle the **Gameplay Debugger**: live categories for AI
(behavior tree state, perception, navmesh, EQS), abilities, and more, drawn over the game. Extend it
with custom categories for your systems. The fastest way to inspect AI without logging
(`ai-and-navigation`).

## Native debugger (C++)

- Attach Visual Studio / Rider; set breakpoints, inspect, use the UE **natvis** (readable
  `FString`/`TArray`/`FName` in the watch window).
- **Live Coding** (`Ctrl+Alt+F11`) recompiles function bodies fast, but **structural changes**
  (new UPROPERTY/UFUNCTION, new members, header changes) need a full rebuild — a frequent source of
  "my change didn't take / weird crashes." Restart the editor after structural edits.
- For crashes, read the callstack; `ensure`/`check` callstacks point at the failed invariant.

## Console commands & cheats

- Console (`~`) commands and cvars (`r.*`, `stat *`) for runtime toggles.
- `UCheatManager` (on the PlayerController) hosts `Exec` cheat functions for testing (god mode,
  give item) — dev-only.
- Add `Exec` UFUNCTIONs for quick test hooks.

## Picking the tool

- Value/flow → logs/assertions. Spatial → debug draw. Temporal/AI replay → Visual Logger.
- Live AI/gameplay state → Gameplay Debugger. Crash/step-through → native debugger.
- Performance (not correctness) → `profiling-and-optimization`.

## Gotchas

- **Relying on debug draw/logs in Shipping** — they're stripped; they're dev tools.
- **Live Coding after structural changes** → silent staleness/crashes; do a full build.
- **`UE_LOG` spam every tick** instead of Visual Logger for spatial/temporal issues.
- **`check` that crashes the editor** when an `ensure` (recoverable) was wanted.
- **Forgetting to remove/gate** heavy debug drawing before shipping/perf tests.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Public/DrawDebugHelpers.h` — `DrawDebug*` functions.
- `Runtime/Engine/Public/VisualLogger/VisualLogger.h` — `UE_VLOG*`.
- `Runtime/GameplayDebugger/Public/GameplayDebugger.h` — Gameplay Debugger.
- `Runtime/Core/Public/Misc/AssertionMacros.h` — `check`/`ensure` (see `unreal-logging-and-assertions`).

Official docs (UE 5.7): Testing and Optimizing Your Content —
<https://dev.epicgames.com/documentation/unreal-engine/testing-and-optimizing-your-content>

Related: `unreal-logging-and-assertions`, `ai-and-navigation`, `profiling-and-optimization`.
