# Low-level tests (LLT) & CQTest — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers Catch2-based Low-Level Tests (LLTs),
CQTest fixtures, build target setup, and build/run invocation. Grounded in UE 5.7
(`Developer/LowLevelTestsRunner/`, `Developer/CQTest/`).

## Why low-level tests

LLTs compile a **thin standalone executable** per module — no editor, no game
session, no reflection system overhead. Startup time is under a second. They are the
right layer for:
- Pure algorithm and data-structure logic.
- Module-internal APIs that have no UObject or world dependency.
- CI smoke checks that must complete in seconds.

They use **Catch2** (a modern C++ header-only test framework) extended by the UE
`LowLevelTestsRunner` harness to handle UE-specific types, logging, and build
integration.

## File and module layout

```
Source/
  MyModule/
    MyModule.Build.cs
    Private/
      MySystem.cpp
    Tests/                      ← test sources live here
      MySystemTest.cpp
  MyModuleTests/                ← separate test module (preferred)
    MyModuleTests.Build.cs
    MyModuleTests.Target.cs     ← required; defines a Test build target
    Private/
      MySystemTest.cpp
```

`MyModuleTests.Target.cs` must set `Type = TargetType.Program` and include
`LowLevelTestsRunner` in the build graph. See the official
[Build and Run Low-Level Tests](https://dev.epicgames.com/documentation/unreal-engine/build-and-run-low-level-tests-in-unreal-engine)
doc for the full target configuration.

`MyModuleTests.Build.cs` should add:
```csharp
PrivateDependencyModuleNames.AddRange(new string[]
{
    "Core", "MyModule", "LowLevelTestsRunner"
});
```

## Writing Catch2 tests

```cpp
// MyModuleTests/Private/MySystemTest.cpp
#include "TestHarness.h"   // Developer/LowLevelTestsRunner/Public/TestHarness.h

TEST_CASE("MySystem / ComputeResult / positive inputs", "[smoke]")
{
    const int32 R = ComputeResult(4, 2);
    CHECK(R == 2);
}

TEST_CASE("MySystem / ComputeResult / zero divisor", "[edge]")
{
    CHECK_THROWS(ComputeResult(4, 0));
}
```

Catch2 macros available via `TestHarness.h`:
- `TEST_CASE(Name, Tags)` / `SECTION(Name)` — define and nest test cases.
- `CHECK(expr)` — non-fatal assertion (continues on failure).
- `REQUIRE(expr)` — fatal assertion (stops current test on failure).
- `CHECK_THROWS` / `REQUIRE_THROWS` — exception assertions.
- `CHECK_THAT(val, matcher)` — fluent matchers (range checks, string contains, etc.).

Tags follow Catch2 convention: `[smoke]`, `[unit]`, `[integration]`, `[perf]`.

## CQTest — fixture-based alternative

`CQTest` (`Developer/CQTest/`) extends `FAutomationTestBase` with Xunit-style
fixtures, automatic state reset, and `ASSERT_THAT` matchers. Add `"CQTest"` to
`PrivateDependencyModuleNames`.

```cpp
#include "CQTest.h"

// Simple standalone test
TEST(MySimpleTest, "MyGame.Unit")
{
    ASSERT_THAT(AreEqual(1 + 1, 2));
}

// Fixture class — state resets automatically before each TEST_METHOD
TEST_CLASS(FInventoryFixture, "MyGame.Inventory")
{
    TUniquePtr<FInventorySystem> Inv;

    BEFORE_EACH()
    {
        Inv = MakeUnique<FInventorySystem>();
    }

    AFTER_EACH()
    {
        Inv.Reset();
    }

    TEST_METHOD(FInventoryFixture, AddItem_IncreasesCount)
    {
        Inv->AddItem(TEXT("Sword"), 1);
        ASSERT_THAT(AreEqual(Inv->GetCount(TEXT("Sword")), 1));
    }

    TEST_METHOD(FInventoryFixture, AddItem_RejectsDuplicate)
    {
        Inv->AddItem(TEXT("Sword"), 1);
        ASSERT_THAT(IsFalse(Inv->AddItem(TEXT("Sword"), 1)));
    }
};
```

`BEFORE_ALL` / `AFTER_ALL` handle class-wide one-time setup; `BEFORE_EACH` /
`AFTER_EACH` run per test method. CQTest tests appear in the Automation tab under
the registered dotted path, and can also be run from the CLI.

## Building and running

**Build (Unreal Build Tool):**
```
UnrealBuildTool.exe MyModuleTests Win64 Test -Project=MyGame.uproject
```

**Run:**
```
Binaries\Win64\MyModuleTests.exe --run-tests [smoke] --reporter console
```

Catch2 CLI flags:
- `--run-tests [tag]` — filter by tag.
- `[#name]` — filter by test name substring.
- `--reporter xml` / `--reporter junit` — CI-friendly report output.

**BuildGraph** integration (for automated pipelines): use the `BuildGraph` script
target `RunLowLevelTests` which handles compilation, execution, and report collection
across platforms. See Epic's build infrastructure samples for reference.

## Catch2 vs `FAutomationTestBase` — when to use each

| Criterion | LLT / Catch2 | Automation test / Spec |
|---|---|---|
| No UObject / no world | ideal | works |
| Needs editor or world | not suitable | use functional test |
| CI speed | fastest (standalone exe) | slower (editor startup) |
| BDD style | Catch2 BDD sections | Spec (DEFINE_SPEC) |
| Blueprint-visible | no | no |
| Ground Truth Data | no | via functional test |

## Source citations (UE 5.7)

- `Developer/LowLevelTestsRunner/Public/TestHarness.h` — Catch2 bridge, `std::ostream`
  adapters for UE types.
- `Developer/LowLevelTestsRunner/Public/TestRunner.h` — test runner entry point.
- `Developer/CQTest/Public/CQTest.h` — `TEST`, `TEST_CLASS`, `ASSERT_THAT`, `BEFORE_EACH`,
  `AFTER_EACH`, `BEFORE_ALL`, `AFTER_ALL`, `TEST_METHOD` macros.
- `Developer/CQTest/README.md` — installation, usage, and example fixtures.
