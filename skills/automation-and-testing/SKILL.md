---
name: automation-and-testing
description: Test Unreal projects — the Automation framework (simple/complex tests and the Spec
  style with FAutomationTestBase, TestTrue/TestEqual), in-level Functional Tests (AFunctionalTest),
  running tests from the editor (Session Frontend) or command line/CI, and Gauntlet for device-scale
  testing. Use when writing unit/integration tests for gameplay or systems, setting up automated
  test runs, or adding tests to CI.
metadata:
  engine-version: "5.7"
  category: tooling
---

# Automation & testing

Unreal has a built-in automation framework for code tests and in-world functional tests, runnable
from the editor or headless in CI. Test pure logic with automation tests; test gameplay-in-a-level
with functional tests.

## When to use this skill

- Unit-testing C++ logic (math, systems, data) without a running game.
- Integration/gameplay testing inside a level.
- Running tests automatically in CI / on commit.
- Validating content or catching regressions.

## Test types

| Type | Runs | Use for |
|---|---|---|
| **Simple/Complex automation test** | no world needed (or minimal) | pure logic, utilities, data validation |
| **Spec** (`DEFINE_SPEC`) | BDD-style describe/it | readable behavior specs |
| **Functional Test** (`AFunctionalTest`) | placed in a test level, with a world | gameplay/integration behavior |
| **Gauntlet** | full sessions on devices | large-scale/device/perf testing |

## Simple automation test

```cpp
#include "Misc/AutomationTest.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDamageMathTest, "MyGame.Combat.DamageMath",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FDamageMathTest::RunTest(const FString& Parameters)
{
    const float Result = ComputeDamage(100.f, 0.5f);
    TestEqual(TEXT("Half damage"), Result, 50.f);
    TestTrue(TEXT("Non-negative"), Result >= 0.f);
    return true;   // false marks the test failed
}
```
- The string is the **test path** shown in the test browser (use a dotted namespace).
- Flags set context (`EditorContext`/`ClientContext`) and filter category (`EngineFilter`,
  `ProductFilter`, `SmokeFilter`).
- Assertions: `TestTrue`/`TestFalse`/`TestEqual`/`TestNotNull`/`AddError` — they record results;
  prefer them over `check` so the harness reports cleanly.

## Spec style (readable)

`DEFINE_SPEC`/`BEGIN_DEFINE_SPEC` with `Describe`/`It` blocks express behavior specs with
setup/teardown (`BeforeEach`) — nicer for multi-case behavior.

## Functional tests (in a level)

`AFunctionalTest` actors live in a dedicated **test map**: they start, run gameplay (spawn, move,
assert via the test's API), and report pass/fail with a timeout. Use them for "does this ability/
encounter behave correctly in a real world" tests. They're driven by the same automation runner.

## Running tests

- **Editor:** Tools → Test Automation / Session Frontend → Automation tab → pick tests → Run.
- **Command line / CI:** run the editor headless with the automation commands, e.g.
  `UnrealEditor-Cmd.exe <Project> -ExecCmds="Automation RunTests MyGame; Quit" -unattended -nopause -testexit="Automation Test Queue Empty"`.
  Parse the results/log for pass/fail in CI.
- **Gauntlet** for device farms and longer scenarios.

## What to test (guidance)

- Pure functions/systems (damage, inventory, save migration) → automation tests (fast, no world).
- Cross-system gameplay (abilities, AI encounters) → functional tests in a map.
- Keep tests deterministic; avoid frame-timing/random dependence unless seeded.

## Gotchas

- **Wrong flags/context** → test won't appear or runs in the wrong environment.
- **Using `check`/`ensure`** in tests instead of `TestTrue`/`AddError` → crashes the run instead of
  reporting a failure.
- **Functional tests without a timeout** can hang CI.
- **Non-deterministic tests** (time, RNG, network) → flaky; control inputs.
- **Tests in a runtime module that needs the editor** — place editor-only tests appropriately.

## References & source material

Engine source (UE 5.7):
- `Runtime/Core/Public/Misc/AutomationTest.h` — `FAutomationTestBase`, `IMPLEMENT_*_AUTOMATION_TEST`,
  `DEFINE_SPEC`, `TestTrue/TestEqual/...`, `EAutomationTestFlags`.
- `Developer/FunctionalTesting/Classes/FunctionalTest.h` — `AFunctionalTest`.

Official docs (UE 5.7): Testing and Optimizing Your Content —
<https://dev.epicgames.com/documentation/unreal-engine/testing-and-optimizing-your-content>

Related: `logging-and-assertions`, `debugging-techniques`.
