# Skill Authoring Guide

House style for writing Unreal Engine skills in this repo. Read this before adding or
editing a skill. It layers repo-specific conventions on top of the official
[Agent Skills specification](https://agentskills.io/specification).

## 1. The spec, in brief

A skill is a directory containing at minimum a `SKILL.md` with YAML frontmatter + Markdown body.

Frontmatter fields:

| Field | Required | Rule |
|---|---|---|
| `name` | yes | ≤64 chars; `a-z`, `0-9`, `-` only; no leading/trailing/consecutive hyphens; **must equal the folder name** |
| `description` | yes | ≤1024 chars; non-empty; says **what** the skill does **and when** to use it; keyword-rich |
| `license` | no | short license name or file reference |
| `compatibility` | no | ≤500 chars; environment requirements |
| `metadata` | no | string→string map |
| `allowed-tools` | no | space-separated, experimental |

Progressive disclosure budget:
- **name + description** (~100 tokens) — always loaded, for *discovery*.
- **SKILL.md body** (< ~5000 tokens / 500 lines) — loaded on *activation*.
- **`references/`, `scripts/`, `assets/`** — loaded *on demand*.

Keep one reference hop from `SKILL.md` (don't chain references deeply).

## 2. Writing the `description` (most important field)

The description is how an agent decides whether to activate the skill. Pattern:

> `<What it does in concrete terms>. Use when <triggers: tasks, keywords, symptoms>.`

Good:
```yaml
description: Implements Unreal gameplay framework classes — GameMode, GameState,
  PlayerController, Pawn, Character, PlayerState, GameInstance, HUD — in C++. Use when
  setting up game rules, player possession, spawn flow, or wiring the core gameplay loop.
```
Poor:
```yaml
description: Helps with gameplay.
```

Include the words an agent's task would contain (class names, system names, error phrases).

## 3. Body structure (recommended sections)

Order skills roughly like this. Omit sections that don't apply.

1. **When to use this skill** — 2-4 bullet triggers (mirror/expand the description).
2. **Mental model** — the few concepts the agent must hold to not make mistakes.
3. **Core workflow / steps** — numbered, imperative, copy-pasteable.
4. **C++ patterns** — minimal correct snippets that compile against 5.7.
5. **Worked example** — a realistic example tying the patterns together (when it helps).
6. **Gotchas & edge cases** — the mistakes this skill exists to prevent.
7. **References & source material** *(required)* — real `Engine/Source/...` paths and verified
   official UE 5.7 doc URLs, plus links to any `references/*.md`.

## 4. Repo-specific rules

- **Target UE 5.7.** Snippets must be valid against 5.7. When an API differs across 5.x,
  add a short *Version note*.
- **Ground in real source, and always reference it.** Cite verified paths under
  `E:\Program Files\Epic Games\UE_5.7\Engine\Source\...`. Prefer naming the header and class
  (e.g. `GameFramework/Actor.h` → `AActor`) over vague references. If unsure of a signature,
  read the header before asserting it. **Every skill must include a "References & source
  material" section** with at least one verified engine-source path (and official UE 5.7 doc
  URLs where confirmed — never guess a URL).
- **No tooling/automation instructions.** Skills are pure UE domain knowledge. Do **not**
  describe how to drive the editor, MCP, or any specific tool — the consuming agent handles
  that and has its own tooling skills. Describe *what* is correct in Unreal, not *which tool*
  performs it.
- **Show the macro specifiers that matter.** `UPROPERTY`/`UFUNCTION`/`UCLASS` specifiers are
  where agents go wrong — show the exact specifiers (`EditAnywhere`, `BlueprintReadWrite`,
  `BlueprintCallable`, `Replicated`, `meta=(...)`) and why.
- **Prefer modern APIs.** `TObjectPtr<>` for member UPROPERTYs, Enhanced Input over legacy
  input, MetaSounds over SoundCues, World Partition where applicable. Note legacy where the
  agent will still encounter it.
- **Keep code minimal and correct.** Snippets illustrate one idea; no incidental boilerplate.

## 5. Naming

- Skill folder = `name`. Use the action/domain, lowercase-hyphenated:
  `gameplay-framework`, `enhanced-input`, `networking-and-replication`.
- Reference files: `references/REFERENCE.md` for the main deep-dive, or topic files like
  `references/replication-conditions.md`.
- Scripts: name by what they do, e.g. `scripts/create_widget_blueprint.py`.

## 6. Checklist before committing a skill

- [ ] Folder name == `name` frontmatter; passes naming rules.
- [ ] `description` says what + when, with keywords; ≤1024 chars.
- [ ] Body ≤ ~500 lines; deep material moved to `references/`.
- [ ] Every cited source path exists in the 5.7 tree.
- [ ] C++ snippets compile against 5.7 (correct includes, macros, module deps).
- [ ] Has a "References & source material" section with ≥1 verified engine source path.
- [ ] No MCP/tooling/automation instructions.
- [ ] `skills-ref validate ./skills/<name>` passes (when available).
