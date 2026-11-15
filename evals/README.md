# Skill evals

Golden tasks that measure whether a skill actually improves an agent's Unreal Engine
output. Each task in `tasks/` is a realistic, self-contained prompt an agent might
receive, paired with acceptance criteria that are checkable against UE 5.9.

## Why

Skill quality is otherwise unmeasurable: a skill can read well and still teach an agent
nothing it didn't already know — or worse, drift out of date when the engine moves.
These tasks give every high-traffic skill a regression test. When the repo re-targets a
new engine version, rerun the evals (and `node scripts/check-citations.mjs`) to catch
anything that moved.

## Method

For each task file:

1. **Baseline run** — give a fresh agent session the task prompt *without* the skill.
2. **Skill run** — give a fresh agent session the same prompt with the skill loaded
   (paste the SKILL.md, install it as an Agent Skill, or let the agent pull it from the
   MCP server at `https://www.unrealengineskills.com/api/mcp`).
3. Score both against the task's **Acceptance criteria**, then compare.

A skill earns its place when the skill run consistently beats the baseline on the
criteria — or when the baseline already fails to compile and the skill run doesn't.

## Scoring

Every task is scored on three layers, in order:

| Layer | Check | How |
|---|---|---|
| 1. Compiles / runs | C++: builds against UE 5.9 with no errors. Editor Python: runs in a 5.9 editor without an exception. Config or diagnosis tasks: N/A (the task file says so) | C++: drop generated files into a scratch UE 5.9 C++ project (`Source/<Module>/`) and build the Development Editor target. Python: see *Running an editor-Python task* |
| 2. API truth | Every engine class, function, specifier, Python name and config key used actually exists with that signature | Spot-check against `C:\Program Files\Epic Games\UE_5.9\Engine\Source` (and `Engine/Plugins`, `Engine/Platforms`) |
| 3. Task criteria | The task's specific acceptance criteria | Listed per task file |

Record results as pass/fail per criterion. A task "passes" only when all three layers do
(a layer marked N/A counts as passed).

Task kinds: C++ (`asset-management-*`, `enhanced-input-*`, `gameplay-tags-*`, `gas-*`,
`networking-*`, `umg-*`), planning (`gameplay-architecture-planning`), editor Python
(`sequencer-python-camera-cut`, `pie-python-read-text-press-button`) and config or diagnosis
(`wasm-cook-never-cook-config`, `wasm-cross-origin-isolation`). The last two kinds come from
where agents failed most in a real UE 5.9 project: editor Python and the browser build.

## Task file format

```markdown
---
skill: <skill-id the task exercises>
title: <short name>
---

## Prompt
<the exact prompt to give the agent>

## Acceptance criteria
- <checkable statement>
- ...

## Common baseline failures
<what agents typically get wrong without the skill — what to look for>
```

## Running a compile check

Create (once) a scratch project `EvalScratch` from the UE 5.9 "Blank C++" template,
then for each eval output:

```
# copy generated .h/.cpp into EvalScratch/Source/EvalScratch/
& "C:\Program Files\Epic Games\UE_5.9\Engine\Build\BatchFiles\Build.bat" `
  EvalScratchEditor Win64 Development -Project="<path>\EvalScratch.uproject" -WaitMutex
```

Some tasks need a plugin enabled in the `.uproject` (noted per task, e.g. GAS needs
`GameplayAbilities`; the editor-Python tasks need `PythonScriptPlugin`, and the PIE task the
5.9 toolset plugins it names).

## Running an editor-Python task

Use the same scratch project with the Python Editor Script Plugin enabled. Save the agent's
script to a file and run it headless:

```
& "C:\Program Files\Epic Games\UE_5.9\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" `
  "<path>\EvalScratch.uproject" -ExecCmds="py <abs path to script>; Quit" -unattended -nopause -nullrhi
```

Tasks that need a running game (PIE) or `await call_tool(...)` run inside the editor's
`execute_python` tool instead (5.9 `EditorToolset`; see `ue-editor-scripting-and-python`).
Read the script's printed result in the log (`Saved/Logs/EvalScratch.log`, category
`LogPython`).
