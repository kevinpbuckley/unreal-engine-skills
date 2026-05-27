# `EAutomationTestFlags`, CI patterns & Gauntlet — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the full `EAutomationTestFlags`
reference, CI command-line recipes, report export, and a Gauntlet overview. Grounded
in UE 5.7 (`Runtime/Core/Public/Misc/AutomationTest.h`:87).

## `EAutomationTestFlags` reference

Every test must OR together at least one **context** flag and one **filter** flag.

### Context flags (where the test can run)

| Flag | Value | Meaning |
|---|---|---|
| `EditorContext` | `0x01` | within the editor |
| `ClientContext` | `0x02` | within a game client |
| `ServerContext` | `0x04` | within a dedicated server |
| `CommandletContext` | `0x08` | within a commandlet (`-run=...`) |
| `ProgramContext` | `0x10` | a standalone program (not editor/game) |

`EAutomationTestFlags_ApplicationContextMask` — a convenience constant that ORs all
five context flags. Common in specs that should run anywhere:
```cpp
EAutomationTestFlags::ProductFilter | EAutomationTestFlags_ApplicationContextMask
```

### Filter flags (which CI bucket)

| Flag | Value | Typical purpose |
|---|---|---|
| `SmokeFilter` | `0x01000000` | fastest; run on every commit, seconds |
| `EngineFilter` | `0x02000000` | engine-level tests, longer-running |
| `ProductFilter` | `0x04000000` | product/game-specific tests |
| `PerfFilter` | `0x08000000` | performance benchmarks |
| `StressFilter` | `0x10000000` | stress / stability |
| `NegativeFilter` | `0x20000000` | tests whose correct outcome is failure |

### Feature flags (optional runtime requirements)

| Flag | Value | Meaning |
|---|---|---|
| `NonNullRHI` | `0x0100` | requires a rendering backend |
| `RequiresUser` | `0x0200` | requires interactive user session |

### One-off flags

| Flag | Value | Meaning |
|---|---|---|
| `Disabled` | `0x10000` | skip without commenting out; never returned in filter |
| `SupportsAutoRTFM` | `0x20000` | run inside a transactional commit and an abort |

### Priority flags (UE5+)

| Flag | Value |
|---|---|
| `CriticalPriority` | `0x00100000` |
| `HighPriority` | `0x00200000` |
| `MediumPriority` | `0x00400000` |
| `LowPriority` | `0x00800000` |

Priority is optional but useful for CI triage. Tests without a priority flag are
treated as unclassified. Convenience masks: `EAutomationTestFlags_PriorityMask`,
`EAutomationTestFlags_HighPriorityAndAbove`, `EAutomationTestFlags_MediumPriorityAndAbove`.

## CI command-line recipes

### Run a test path prefix
```
UnrealEditor-Cmd.exe MyGame.uproject
  -ExecCmds="Automation RunTest MyGame.Combat;Quit"
  -unattended -nopause -nullrhi
```
`MyGame.Combat` matches all tests whose dotted path starts with that prefix.

### Run individual tests by name
```
-ExecCmds="Automation RunTest MyGame.Combat.DamageMath+MyGame.Inventory.AddItem;Quit"
```
Separate multiple tests with `+`.

### Run a named test group
```
-ExecCmds="Automation RunTest Group:CI_Smoke;Quit"
```
Groups are configured in `DefaultEngine.ini`:
```ini
[AutomationTestSettings]
+AutomationTestGroups=(GroupName="CI_Smoke", Tests="MyGame.Combat,MyGame.Inventory")
```

### Export results
```
-ReportExportPath="TestResults/"
```
Writes JSON and HTML files consumable by the Automation Test Report Server.

### Resume an interrupted run
```
-ReportExportPath="TestResults/" -ResumeRunTest
```
Reads the existing JSON and skips tests already marked as run. In-progress tests
from the previous run are marked as failed.

### Headless flags to always include in CI
```
-unattended      # suppress dialogs / pop-ups
-nopause         # do not pause on exit
-nullrhi         # skip GPU / render backend (for non-rendering tests)
-nosplash        # skip splash screen
```
Add `-nullrhi` only when tests do not require rendering. Remove it for
`NonNullRHI`-flagged tests or screenshot comparison tests.

## Test naming convention

The dotted `PrettyName` string should follow a `Namespace.Category.TestName`
pattern:
```
MyGame.Combat.DamageMath
MyGame.Inventory.AddItemIncreasesCount
```
- Put all tests for a module under the same top-level namespace.
- Keep names short; the full path must be unique across the project.
- File location convention: `Source/<Module>/Private/Tests/<ClassFilename>Test.cpp`.

## Suppressing log noise during tests

`FAutomationTestBase` has static flags for controlling how log output maps to test
results:

```cpp
FAutomationTestBase::bSuppressLogWarnings = true;   // don't fail on log warnings
FAutomationTestBase::bElevateLogWarningsToErrors = true; // turn warnings into errors
FAutomationTestBase::SuppressedLogCategories.Add(TEXT("LogNetTraffic"));
```

`AddExpectedMessage` / `AddExpectedError` registers patterns that, when logged during
a test, are consumed rather than counted as unexpected failures.

## Gauntlet overview

**Gauntlet** is Unreal's full-session automation harness, designed for:
- Device farms (console, mobile, PC).
- Multi-process tests (server + clients).
- Long-running perf and stress sessions.
- Build-and-deploy pipelines.

Gauntlet wraps an `FAutomationTestBase`-based or functional test run inside a
managed session:
1. Build and cook the project.
2. Deploy to target device(s) via Gauntlet infrastructure.
3. Launch game sessions, connect clients.
4. Run tests and capture logs, screenshots, profiling data.
5. Collect and report results.

Gauntlet tests are implemented as C# `ITestNode` scripts that orchestrate UE
sessions. They live outside the game project (in `Engine/Source/Programs/AutomationTool/`)
and are invoked via `RunUAT.bat`:

```
RunUAT.bat RunUnreal -Project=MyGame -Test=GauntletTest_MyGame -Platform=Win64 -Configuration=Development
```

Gauntlet is covered in the official docs at:
<https://dev.epicgames.com/documentation/unreal-engine/gauntlet-automation-framework-in-unreal-engine>

For most projects, functional tests + command-line automation runner cover CI needs.
Gauntlet is warranted when targeting multiple devices, needing real network sessions,
or running hour-scale stability/performance tests.

## Source citations (UE 5.7)

- `Runtime/Core/Public/Misc/AutomationTest.h`:87 — `EAutomationTestFlags` enum with
  all values and documentation comments.
- `Runtime/Core/Public/Misc/AutomationTest.h`:143–148 — convenience mask constants
  (`EAutomationTestFlags_ApplicationContextMask`, `EAutomationTestFlags_FilterMask`,
  `EAutomationTestFlags_PriorityMask`, etc.).
- `Runtime/Core/Public/Misc/AutomationTest.h`:1607–1610 — `bSuppressLogWarnings`,
  `bElevateLogWarningsToErrors`, `SuppressedLogCategories`.
