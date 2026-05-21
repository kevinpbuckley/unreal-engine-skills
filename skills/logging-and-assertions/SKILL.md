---
name: logging-and-assertions
description: Add logging and runtime checks to Unreal C++ — UE_LOG with custom log categories
  (DECLARE_LOG_CATEGORY_EXTERN/DEFINE_LOG_CATEGORY), verbosity levels, on-screen debug messages,
  and the assertion macros check/checkf, ensure/ensureMsgf, and verify. Use when adding
  diagnostics, defining a log category, choosing between check and ensure, printing to screen,
  or deciding what should crash vs. warn in development.
metadata:
  engine-version: "5.7"
  category: cpp-foundations
---

# Logging & assertions

Good diagnostics make UE bugs findable. Use **log categories** (not stray prints), pick the
right **verbosity**, and choose **check vs ensure** deliberately — one halts the program, the
other reports and continues.

## When to use this skill

- Adding diagnostics to gameplay/system code.
- Defining a dedicated log category for a feature/module.
- Validating assumptions (non-null pointers, valid state).
- Deciding "should this crash, or warn and continue?"
- Quick on-screen debugging during PIE.

## Logging with categories

Declare a category in a header, define it once in a `.cpp`:

```cpp
// MyGame.h (or a Logging.h)
DECLARE_LOG_CATEGORY_EXTERN(LogMyGame, Log, All);
//                                     ^default verbosity  ^compile-time max

// MyGame.cpp
DEFINE_LOG_CATEGORY(LogMyGame);
```

Then log with `printf`-style formatting (always `TEXT()`):

```cpp
UE_LOG(LogMyGame, Log,     TEXT("Spawned %s at %s"), *Actor->GetName(), *Loc.ToString());
UE_LOG(LogMyGame, Warning, TEXT("Ammo low: %d"), Ammo);
UE_LOG(LogMyGame, Error,   TEXT("Null weapon on %s"), *GetName());
```

Format specifiers: `%d` int, `%f` float/double, `%s` **`TCHAR*`** (use `*FString` to get one),
`%p` pointer. Passing an `FString` directly to `%s` without `*` is a common bug.

### Verbosity levels (high → low)
`Fatal` (crashes) › `Error` › `Warning` › `Display` (always shown, non-spammy) › `Log` ›
`Verbose` › `VeryVerbose`. The category's compile-time max strips anything more verbose; the
runtime level can be raised per-category via console: `Log LogMyGame Verbose`.

### On-screen debug (PIE)
```cpp
if (GEngine)
{
    GEngine->AddOnScreenDebugMessage(-1, 5.f, FColor::Yellow,
        FString::Printf(TEXT("HP: %d"), Hp));
}
```
Use for transient visual debugging only; remove or gate before shipping.

## Assertions

| Macro | Behavior in dev | Shipping | Use when |
|---|---|---|---|
| `check(expr)` / `checkf(expr, fmt, ...)` | **halts** if false | compiled out (by default) | invariant that must hold; continuing is unsafe |
| `ensure(expr)` / `ensureMsgf(...)` | logs + reports a callstack once, **continues** | continues | recoverable "shouldn't happen" you want to know about |
| `verify(expr)` / `verifyf(...)` | halts if false | **expr still runs** | a side-effecting call that must succeed |
| `checkSlow(expr)` | only in debug builds | out | expensive checks |

```cpp
check(Weapon != nullptr);                                  // hard invariant
checkf(Index >= 0 && Index < Num, TEXT("bad index %d"), Index);

if (!ensure(Target != nullptr)) { return; }                // report but recover
ensureMsgf(bInitialized, TEXT("Used %s before init"), *GetName());

verify(Manager->Initialize());                             // call must run AND succeed
```

Rule of thumb: **`check`** for "the program is broken if this is false," **`ensure`** for
"this is unexpected but I can handle it" — `ensure` is usually the right choice in gameplay
code because it keeps the editor alive while still surfacing the problem.

## Where logs go

- Editor: Output Log window; also `Saved/Logs/<Project>.log`.
- Filter/search by category name (e.g. `LogMyGame`) in the Output Log.

## Gotchas

- **`%s` with an `FString`** needs the dereference: `*MyString`. Forgetting it prints garbage/crashes.
- **No `TEXT()`** around the format string → wrong char type / won't compile.
- **`check` in shipping** is compiled out — never put required side effects inside `check(...)`;
  use `verify(...)` if the expression must execute.
- **Logging every tick** at `Log`/`Warning` spams the log; use `Verbose` or throttle.
- **`ensure` fires once per call site** by default — it won't spam, but don't rely on it for loops.

## References & source material

Engine source (UE 5.7):
- `Runtime/Core/Public/Logging/LogMacros.h` — `UE_LOG`, `DECLARE/DEFINE_LOG_CATEGORY*`.
- `Runtime/Core/Public/Logging/LogVerbosity.h` — verbosity levels.
- `Runtime/Core/Public/Misc/AssertionMacros.h` — `check`, `ensure`, `verify` families.

Official docs (UE 5.7): Programming with C++ —
<https://dev.epicgames.com/documentation/unreal-engine/programming-with-cplusplus-in-unreal-engine>
