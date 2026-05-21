# Unreal Engine Skills

A comprehensive library of [Agent Skills](https://agentskills.io) that give AI coding
agents the domain knowledge to do real **Unreal Engine** work: writing C++, working with
Blueprints, assets, and the editor, and cross-referencing the engine source.

Each skill is a self-contained folder following the
[Agent Skills specification](https://agentskills.io/specification): a `SKILL.md` with YAML
frontmatter (`name`, `description`) plus Markdown instructions, optionally accompanied by
`references/`, `scripts/`, and `assets/`.

## Who/what these are for

The consumer is an **autonomous agent**, not a human clicking through the editor. The agent:

- Writes and edits **Unreal C++** (gameplay classes, modules, build files).
- Works with **Blueprints, assets, and editor concepts** to assemble and configure games.
- Has the **Unreal Engine source** available on disk to cross-reference exact APIs.

Skills are pure **UE domain knowledge**: correct classes, real API signatures, the right
patterns, the gotchas, and references into the engine source — not click-by-click UI
tutorials, and not tool/automation instructions. The agent brings its own tooling (e.g. an
MCP bridge to a live editor) and has separate skills for that; these skills tell it *what is
correct in Unreal*, not *which tool to operate*.

## Target environment

| Item | Value |
|---|---|
| Primary engine version | **UE 5.7** (`E:\Program Files\Epic Games\UE_5.7`) |
| Engine source for cross-ref | 5.7 (binary install incl. source), 5.5.1 + 5.8 full source builds |
| Engine source root (5.7) | `E:\Program Files\Epic Games\UE_5.7\Engine\Source` |

Skills target 5.7 APIs. Where an API moved or changed between 5.x versions, the skill notes it.

## Repository layout

```
unreal-engine-skills/
├── README.md                  # this file — index + conventions
├── docs/
│   └── skill-authoring-guide.md   # house style for writing skills in this repo
└── skills/
    ├── <skill-name>/
    │   ├── SKILL.md           # required: frontmatter + instructions
    │   ├── references/        # optional: deep-dive docs loaded on demand
    │   ├── scripts/           # optional: runnable helpers (e.g. editor Python)
    │   └── assets/            # optional: templates, snippets
    └── ...
```

## Skill index

Status: ✅ built · 🟡 planned. (Planned skills are tracked as tasks and built in batches.)

### Cross-cutting / meta
- ✅ `navigating-unreal-engine-source` — locate and cite exact APIs in the on-disk engine source
- ✅ `unreal-coding-standards` — Epic C++ coding standard, naming prefixes, conventions

### C++ foundations
- ✅ `unreal-cpp-fundamentals` — UObject, UCLASS/USTRUCT/UENUM, UPROPERTY/UFUNCTION, reflection, GC
- ✅ `unreal-module-and-build-system` — modules, `*.Build.cs`, `*.Target.cs`, dependencies
- ✅ `unreal-project-structure` — `.uproject`, Config/Content/Source layout, plugins
- ✅ `unreal-memory-and-gc` — UPROPERTY ownership, `TObjectPtr`, weak ptrs, smart pointers
- ✅ `unreal-core-types-and-containers` — `TArray`/`TMap`/`TSet`, `FString`/`FName`/`FText`, math types
- ✅ `unreal-delegates-and-events` — single/multicast/dynamic delegates and events
- ✅ `unreal-logging-and-assertions` — `UE_LOG`, log categories, `check`/`ensure`

### Gameplay framework
- ✅ `gameplay-framework` — GameInstance, GameMode/GameState, PlayerController, Pawn/Character, PlayerState, HUD
- ✅ `actors-and-components` — `AActor` lifecycle, components, attachment, spawning
- ✅ `character-and-movement` — `ACharacter`, `UCharacterMovementComponent`
- ✅ `enhanced-input` — Enhanced Input actions, mapping contexts, bindings
- ✅ `unreal-subsystems` — Engine/GameInstance/World/LocalPlayer subsystems
- ✅ `timers-and-async` — `FTimerManager`, async tasks, latent actions
- ✅ `gameplay-tags` — `FGameplayTag`, containers, tag-driven logic
- ✅ `gameplay-ability-system` — GAS abilities, attributes, effects, tasks

### Blueprints
- ✅ `blueprint-fundamentals` — BP classes, graphs, variables, components, the C++↔BP relationship
- ✅ `blueprint-cpp-integration` — expose C++ to BP (`BlueprintCallable`, native events, meta)

### Content & assets
- ✅ `asset-management` — `AssetRegistry`, soft/hard refs, async loading, `FObjectFinder`
- ✅ `importing-content` — meshes/textures/audio, Interchange, FBX/glTF
- ✅ `meshes-static-and-skeletal` — static & skeletal mesh setup
- ✅ `materials-and-shaders` — material graph, instances, parameters, material C++
- ✅ `data-driven-design` — DataTables, DataAssets, curves, config-driven systems

### Animation
- ✅ `animation-system` — skeletal meshes, AnimInstance/AnimBP, state machines, montages, notifies
- ✅ `control-rig-and-ik` — Control Rig, IK Rig/Retargeter
- ✅ `sequencer-and-cinematics` — Sequencer, cameras, cinematics

### World building
- ✅ `levels-and-world-partition` — levels, World Partition, data layers, streaming
- ✅ `landscape-and-foliage` — landscape, foliage, PCG
- ✅ `lighting-and-lumen` — lighting, Lumen GI/reflections
- ✅ `nanite-and-rendering` — Nanite, rendering features, post process

### VFX & audio
- ✅ `niagara-vfx` — Niagara systems, emitters, modules
- ✅ `audio-and-metasounds` — MetaSounds, audio components, attenuation

### UI
- ✅ `umg-and-slate` — UMG widgets, widget C++, Slate, CommonUI

### Systems
- ✅ `networking-and-replication` — replication, RPCs, replicated properties, multiplayer
- ✅ `physics-and-chaos` — collision, physics, Chaos
- ✅ `ai-and-navigation` — behavior trees, blackboard, EQS, navmesh
- ✅ `save-and-load` — `USaveGame`, serialization

### Tooling, pipeline, quality
- ✅ `editor-scripting-and-python` — editor utilities, Python, Blutility
- ✅ `plugins-and-modules` — creating and structuring plugins
- ✅ `automation-and-testing` — automation specs, functional tests
- ✅ `profiling-and-optimization` — Unreal Insights, `stat` commands, memory
- ✅ `packaging-and-deployment` — cooking, packaging, platforms
- ✅ `debugging-techniques` — debugger, Gameplay Debugger, Visual Logger

## Authoring conventions

See [`docs/skill-authoring-guide.md`](docs/skill-authoring-guide.md). In short:

- One skill = one folder under `skills/`; folder name **must equal** the `name` frontmatter.
- `name`: lowercase letters/digits/hyphens, ≤64 chars, no leading/trailing/double hyphens.
- `description`: ≤1024 chars, states **what it does and when to use it**, with searchable keywords.
- Keep `SKILL.md` under ~500 lines; push deep detail into `references/`.
- Ground claims in real 5.7 source paths; cite `Engine/Source/...` locations.
- Prefer C++ that compiles against 5.7; flag version-specific behavior.

## Validation

Validate any skill against the spec with the
[`skills-ref`](https://github.com/agentskills/agentskills/tree/main/skills-ref) tool:

```
skills-ref validate ./skills/<skill-name>
```
