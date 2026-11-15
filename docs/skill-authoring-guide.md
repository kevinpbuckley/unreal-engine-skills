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
Agents often search with the text of an error they just got (`'unreal' has no attribute
'SubsystemBlueprintLibrary'`, `Cannot nativize 'float' as 'MovieSceneTimeWarpVariant'`): put the
errors your skill cures in the description and in an error table in the body.

Put synonyms that are not already in the description in `metadata.aliases`, a comma-separated
string (the spec's `metadata` values are strings): `aliases: "Sequencer, Level Sequence,
MovieScene, cutscene"`. Search on the hosted server reads the description and body today;
aliases are there for search that reads them.

YAML block scalars (`description: >`) and wrapped descriptions are fine in this repo. The UE 5.9
in-engine skill loader reads only one-line values, so `scripts/install-engine-skills.mjs`
flattens them when it installs the library into a project; run it with `--check` after
editing a description.

## 3. Body structure (recommended sections)

Order skills roughly like this. Omit sections that don't apply.

1. **When to use this skill** — 2-4 bullet triggers (mirror/expand the description).
2. **Mental model** — the few concepts the agent must hold to not make mistakes.
3. **Core workflow / steps** — numbered, imperative, copy-pasteable.
4. **C++ / editor Python patterns** — minimal correct snippets that compile (C++) or run
   (editor Python) against 5.9.
5. **Worked example** — a realistic example tying the patterns together (when it helps).
6. **Gotchas & edge cases** — the mistakes this skill exists to prevent.
7. **References & source material** *(required)* — real `Engine/Source/...` paths and verified
   official UE doc URLs, plus links to any `references/*.md`.
8. **Unverified** *(when it applies)* — claims read in source or reported by a project but not
   run. Never state them as facts elsewhere in the skill.

## 4. Repo-specific rules

- **Target UE 5.9.** Snippets must be valid against 5.9. When an API differs across 5.x,
  add a short *Version note* (say which version you compared against).
- **Ground in real source, and always reference it.** Cite verified paths under
  `C:\Program Files\Epic Games\UE_5.9\Engine\Source\...` (or `Engine\Plugins\...`). Prefer naming the header and class
  (e.g. `GameFramework/Actor.h` → `AActor`) over vague references. If unsure of a signature,
  read the header before asserting it. **Every skill must include a "References & source
  material" section** with at least one verified engine-source path (and official UE doc
  URLs where confirmed — never guess a URL). Line numbers are optional; when you give one,
  read it in the 5.9 file.
- **Engine API truth is in scope, whatever the language.** C++, Blueprint concepts, the
  editor's `unreal` Python API (exact names, what is not exposed, return shapes, the error
  each wrong guess produces) and, from 5.9, Epic's AI toolsets (`execute_python`, tool and
  parameter names, the in-engine skill format) are engine features: document them like any
  other API, from the 5.9 source. Most agent work on a 5.9 project goes through editor Python
  and these toolsets, and that is where agents fail.
- **Out of scope:** third-party plugins' tools (document the engine behaviour, not the
  plugin), MCP client configuration, click-by-click UI walkthroughs, private paths and project
  names. Facts measured in a real project are welcome; label them as such ("measured in ...")
  and keep the numbers.
- **Show the macro specifiers that matter.** `UPROPERTY`/`UFUNCTION`/`UCLASS` specifiers are
  where agents go wrong — show the exact specifiers (`EditAnywhere`, `BlueprintReadWrite`,
  `BlueprintCallable`, `Replicated`, `meta=(...)`) and why.
- **Python names are snake_case wrappers of reflected members.** Check them in the engine
  headers (`UFUNCTION`, `ScriptMethod`, `ScriptName`, `BlueprintInternalUseOnly` hides a
  function from Python) or in the Python plugin source before writing them.
- **Prefer modern APIs.** `TObjectPtr<>` for member UPROPERTYs, Enhanced Input over legacy
  input, MetaSounds over SoundCues, World Partition where applicable. Note legacy where the
  agent will still encounter it.
- **Keep code minimal and correct.** Snippets illustrate one idea; no incidental boilerplate.

## 5. Naming

- Skill folder = `name`. Use the `ue-` prefix followed by the action/domain, lowercase-hyphenated:
  `ue-gameplay-framework`, `ue-enhanced-input`, `ue-networking-and-replication`.
- Apply the prefix only to skill identifiers, folders, and references to those
  skills. Keep category IDs, ordinary Unreal terminology, external URLs, and
  reference filenames unchanged.
- Reference files: `references/REFERENCE.md` for the main deep-dive, or topic files like
  `references/replication-conditions.md`.
- Scripts: name by what they do, e.g. `scripts/create_widget_blueprint.py`.

## 6. Checklist before committing a skill

- [ ] Folder name == `name` frontmatter; passes naming rules.
- [ ] `description` says what + when, with keywords; ≤1024 chars.
- [ ] Body ≤ ~500 lines; deep material moved to `references/`.
- [ ] `node scripts/check-citations.mjs <category>/<name>` passes against the 5.9 tree.
- [ ] C++ snippets compile against 5.9 (correct includes, macros, module deps); Python names
      checked in the 5.9 headers or Python plugin source.
- [ ] Has a "References & source material" section with ≥1 verified engine source path.
- [ ] No third-party tool instructions, private paths or project names; unverified claims are
      in an *Unverified* section.
- [ ] `node scripts/install-engine-skills.mjs --check` passes.
- [ ] `skills-ref validate ./skills/<name>` passes (when available).
