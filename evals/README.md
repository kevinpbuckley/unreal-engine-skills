# Skill evals

Golden tasks that measure whether a skill actually improves an agent's Unreal Engine
output. Each task in `tasks/` is a realistic, self-contained prompt an agent might
receive, paired with acceptance criteria that are checkable against UE 5.7.

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
| 1. Compiles | Code builds against UE 5.7 with no errors | Drop generated files into a scratch UE 5.7 C++ project (`Source/<Module>/`) and build the Development Editor target |
| 2. API truth | Every engine class/function/specifier used actually exists with that signature | Spot-check against `E:\Program Files\Epic Games\UE_5.7\Engine\Source` |
| 3. Task criteria | The task's specific acceptance criteria | Listed per task file |

Record results as pass/fail per criterion. A task "passes" only when all three layers do.

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

Create (once) a scratch project `EvalScratch` from the UE 5.7 "Blank C++" template,
then for each eval output:

```
# copy generated .h/.cpp into EvalScratch/Source/EvalScratch/
& "E:\Program Files\Epic Games\UE_5.7\Engine\Build\BatchFiles\Build.bat" `
  EvalScratchEditor Win64 Development -Project="<path>\EvalScratch.uproject" -WaitMutex
```

Some tasks need a plugin enabled in the `.uproject` (noted per task, e.g. GAS needs
`GameplayAbilities`).
