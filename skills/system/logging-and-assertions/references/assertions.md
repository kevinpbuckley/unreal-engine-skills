# Assertions — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers compile-flag mechanics, all macro variants,
shipping behavior, `FDebug` helpers, and when each family is appropriate. Grounded in UE 5.7
(`Engine/Source/Runtime/Core/Public/Misc/AssertionMacros.h`).

## Compile flags

Three independent flags control which assertion families are active:

| Flag | Controls | Active in |
|---|---|---|
| `DO_CHECK` | `check`, `verify`, `checkf`, `verifyf`, `checkNoEntry`, `checkNoReentry`, `checkNoRecursion`, `unimplemented` | Debug, Development, Test; NOT Shipping by default |
| `DO_GUARD_SLOW` | `checkSlow`, `checkfSlow`, `verifySlow` | Debug only |
| `DO_ENSURE` | `ensure`, `ensureMsgf`, `ensureAlways`, `ensureAlwaysMsgf` | Debug, Development, Test, Shipping Editor |

When `DO_CHECK` is 0, `check(expr)` expands to `{ CA_ASSUME(expr); }` — the expression is
**not evaluated**, but the compiler is told it is true (enables optimizer hints).
When `DO_CHECK` is 0, `verify(expr)` expands to evaluate the expression but not halt on
failure (`AssertionMacros.h`:319).

### Enabling checks in shipping

Set `USE_CHECKS_IN_SHIPPING=1` in your `Target.cs` or build configuration. This is useful for
tracking down shipping-only crashes, but has performance cost and should not be the default
for released products.

## check family

`check` / `checkf` — the closest UE equivalent to the C standard `assert`.

```cpp
check(SomePtr != nullptr);                        // halts with callstack if false
checkf(Value > 0, TEXT("Expected positive, got %d"), Value);  // halts + custom message
checkCode(                                         // code runs only when DO_CHECK is true
    if (!IsValidState())
    {
        UE_LOG(LogCore, Fatal, TEXT("Invalid state"));
    }
);
checkNoEntry();       // marks a code path that must never execute (e.g. unreachable default:)
checkNoReentry();     // catches unexpected re-entrant calls to the enclosing function
checkNoRecursion();   // catches unexpected recursive calls
unimplemented();      // marks a pure-virtual override that was not overridden
```

All expand to nothing (with `CA_ASSUME`) when `DO_CHECK` is 0. **Never put required
side effects in a `check` expression** — they will not run in shipping.

Implementation: `UE_CHECK_IMPL` (`AssertionMacros.h`:238) calls
`FDebug::CheckVerifyFailedImpl2` on failure, which logs the callstack then calls
`PLATFORM_BREAK()` to give the debugger a chance to attach before the crash.

## verify family

`verify` / `verifyf` — like `check` but the expression **always evaluates**, even when
`DO_CHECK` is 0.

```cpp
// GetRenderMesh() must run in all builds (it sets Mesh); use verify not check
verify((Mesh = GetRenderMesh()) != nullptr);

// With a message:
verifyf(Manager->RegisterSystem(this), TEXT("Failed to register %s"), *GetName());
```

In shipping with `DO_CHECK=0`: the expression runs, but failure does not halt or log. In all
other builds: failure halts identically to `check`.

`verifySlow` only runs in `DO_GUARD_SLOW` builds (Debug). Use for expensive self-checks that
must never run in Development.

## ensure family

Non-fatal assertions — execution continues after a failure. Failures are reported to the crash
reporter (automatically collected in automated test environments) and logged with a callstack.

```cpp
// ensure: report once per call site per session, then ignore subsequent failures
if (!ensure(Component != nullptr))
{
    return;   // guard the dereference — the false case is handled
}

// ensureMsgf: same but with a formatted message added to the report
ensureMsgf(bWasInitialized, TEXT("%s called before Init()"), *GetName());

// ensureAlways: report every time (use sparingly — can flood the crash reporter)
ensureAlways(SomeCounterIsValid());

// ensureAlwaysMsgf: always report with message
ensureAlwaysMsgf(Index < Count, TEXT("Index %d >= Count %d"), Index, Count);
```

Per-call-site deduplication (`AssertionMacros.h`:399) is implemented via a `static
std::atomic<uint8>` (`bGEnsureHasExecuted`) keyed by a compile-time hash of `__FILE__` and
`__LINE__`. The first failure sets it; subsequent calls short-circuit.

In shipping (`DO_ENSURE=0`): the expression evaluates (no compilation out), but
`EnsureFailed` / crash reporting is never invoked.

`ensure` returns `bool` — `true` if the expression was true, `false` if it fired. This makes
the `if (!ensure(x)) { return; }` pattern idiomatic for guarding code that follows.

### FDebug helpers

`FDebug` (`AssertionMacros.h`:68) exposes utilities useful for custom diagnostic tooling:

```cpp
FDebug::DumpStackTraceToLog(ELogVerbosity::Warning);  // dump current callstack to log
bool bCrashed = FDebug::HasAsserted();                // test whether a check fired
SIZE_T NumEnsures = FDebug::GetNumEnsureFailures();   // count of ensure hits this session
```

### LowLevelFatalError

For fatal conditions outside the check macro system — e.g. in early startup code before the
logging system is ready:

```cpp
LowLevelFatalError(TEXT("Platform initialization failed: %s"), *ErrorMsg);
```

This is a macro (`AssertionMacros.h`:554) that calls
`UE::Assert::Private::ProcessLowLevelFatalError`. The older function
`LowLevelFatalErrorHandler` was deprecated in 5.7.

## Decision guide

```
Does the expression have required side effects?
  Yes → verify / verifyf
  No  →
    Is continuing after failure unsafe (state corruption, imminent null deref)?
      Yes → check / checkf
      No  →
        Is this gameplay code where the editor must stay alive?
          Yes → ensure / ensureMsgf  (prefer this in most gameplay code)
          No  → check / checkf  (engine-level invariants)

Is the check expensive (O(n) scan, hash traversal)?
  Yes → checkSlow / verifySlow  (Debug only)
```

## Shipping summary

| Macro | Shipping: expression runs? | Shipping: halts on failure? |
|---|---|---|
| `check` / `checkf` | no | no |
| `checkSlow` | no | no |
| `verify` / `verifyf` | **yes** | no |
| `ensure` / `ensureMsgf` | **yes** | no |
| `ensureAlways` | **yes** | no |
| `Fatal` (UE_LOG) | yes | **yes** (always) |
