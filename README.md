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
| Primary engine version | **UE 5.8** (`E:\Program Files\Epic Games\UE_5.8`) |
| Engine source for cross-ref | 5.8 (binary install incl. source); 5.7 install kept for version diffing |
| Engine source root (5.8) | `E:\Program Files\Epic Games\UE_5.8\Engine\Source` |

Skills target 5.8 APIs. Where an API moved or changed between 5.x versions, the skill notes it.

## Repository layout

```
unreal-engine-skills/
├── README.md                  # this file — index + conventions
├── docs/
│   └── skill-authoring-guide.md   # house style for writing skills in this repo
├── evals/                     # golden tasks measuring skill effectiveness (see evals/README.md)
│   └── tasks/
├── scripts/
│   └── check-citations.mjs    # verifies every cited Engine/Source path exists on disk
└── skills/
    ├── <category>/            # core, ultra-dynamic-sky, ultra-dynamic-weather
    │   ├── category.md        # category description
    │   └── <skill-name>/
    │       ├── SKILL.md       # required: frontmatter + instructions
    │       ├── references/    # optional: deep-dive docs loaded on demand
    │       ├── scripts/       # optional: runnable helpers (e.g. editor Python)
    │       └── assets/        # optional: templates, snippets
    └── ...
```

## Skill index

Status: ✅ built · 🟡 planned. (Planned skills are tracked as tasks and built in batches.)

### Cross-cutting / meta
- ✅ `ue-gameplay-architecture-planning` — brainstorm systems, compare trade-offs, map ownership/communication/data, and produce implementation plans
- ✅ `ue-navigating-engine-source` — locate and cite exact APIs in the on-disk engine source
- ✅ `ue-coding-standards` — Epic C++ coding standard, naming prefixes, conventions

### C++ foundations
- ✅ `ue-cpp-fundamentals` — UObject, UCLASS/USTRUCT/UENUM, UPROPERTY/UFUNCTION, reflection, GC
- ✅ `ue-module-and-build-system` — modules, `*.Build.cs`, `*.Target.cs`, dependencies
- ✅ `ue-project-structure` — `.uproject`, Config/Content/Source layout, plugins
- ✅ `ue-memory-and-gc` — UPROPERTY ownership, `TObjectPtr`, weak ptrs, smart pointers
- ✅ `ue-core-types-and-containers` — `TArray`/`TMap`/`TSet`, `FString`/`FName`/`FText`, math types
- ✅ `ue-delegates-and-events` — single/multicast/dynamic delegates and events
- ✅ `ue-logging-and-assertions` — `UE_LOG`, log categories, `check`/`ensure`

### Gameplay framework
- ✅ `ue-gameplay-framework` — GameInstance, GameMode/GameState, PlayerController, Pawn/Character, PlayerState, HUD
- ✅ `ue-actors-and-components` — `AActor` lifecycle, components, attachment, spawning
- ✅ `ue-character-and-movement` — `ACharacter`, `UCharacterMovementComponent`
- ✅ `ue-enhanced-input` — Enhanced Input actions, mapping contexts, bindings
- ✅ `ue-subsystems` — Engine/GameInstance/World/LocalPlayer subsystems
- ✅ `ue-timers-and-async` — `FTimerManager`, async tasks, latent actions
- ✅ `ue-gameplay-tags` — `FGameplayTag`, containers, tag-driven logic
- ✅ `ue-gameplay-ability-system` — GAS abilities, attributes, effects, tasks

### Blueprints
- ✅ `ue-blueprint-fundamentals` — BP classes, graphs, variables, components, the C++↔BP relationship
- ✅ `ue-blueprint-cpp-integration` — expose C++ to BP (`BlueprintCallable`, native events, meta)

### Content & assets
- ✅ `ue-asset-management` — `AssetRegistry`, soft/hard refs, async loading, `FObjectFinder`
- ✅ `ue-importing-content` — meshes/textures/audio, Interchange, FBX/glTF
- ✅ `ue-meshes-static-and-skeletal` — static & skeletal mesh setup
- ✅ `ue-materials-and-shaders` — material graph, instances, parameters, material C++
- ✅ `ue-data-driven-design` — DataTables, DataAssets, curves, config-driven systems

### Animation
- ✅ `ue-animation-system` — skeletal meshes, AnimInstance/AnimBP, state machines, montages, notifies
- ✅ `ue-control-rig-and-ik` — Control Rig, IK Rig/Retargeter
- ✅ `ue-sequencer-and-cinematics` — Sequencer, cameras, cinematics

### World building
- ✅ `ue-levels-and-world-partition` — levels, World Partition, data layers, streaming
- ✅ `ue-landscape-and-foliage` — landscape, foliage, PCG
- ✅ `ue-lighting-and-lumen` — lighting, Lumen GI/reflections
- ✅ `ue-nanite-and-rendering` — Nanite, rendering features, post process

### VFX & audio
- ✅ `ue-niagara-vfx` — Niagara systems, emitters, modules
- ✅ `ue-audio-and-metasounds` — MetaSounds, audio components, attenuation

### UI
- ✅ `ue-umg-and-slate` — UMG widgets, widget C++, Slate, CommonUI

### Systems
- ✅ `ue-networking-and-replication` — replication, RPCs, replicated properties, multiplayer
- ✅ `ue-physics-and-chaos` — collision, physics, Chaos
- ✅ `ue-ai-and-navigation` — behavior trees, blackboard, EQS, navmesh
- ✅ `ue-save-and-load` — `USaveGame`, serialization

### Tooling, pipeline, quality
- ✅ `ue-editor-scripting-and-python` — editor utilities, Python, Blutility
- ✅ `ue-plugins-and-modules` — creating and structuring plugins
- ✅ `ue-automation-and-testing` — automation specs, functional tests
- ✅ `ue-profiling-and-optimization` — Unreal Insights, `stat` commands, memory
- ✅ `ue-game-thread-performance` — game-thread budgets, FPS impact, optimization levers
- ✅ `ue-packaging-and-deployment` — cooking, packaging, platforms
- ✅ `ue-debugging-techniques` — debugger, Gameplay Debugger, Visual Logger

### Marketplace asset pack skills

Skills for widely-used marketplace asset packs. These follow the same authoring style as the rest
of the repo (frontmatter, system tables, *When to use*, *Gotchas*, *References & source material*)
with one deviation from convention: skills cite the pack's documentation + its plugin asset paths (`Blueprints/...`, `Materials/...`,
`Particles/...`) instead of `Engine/Source/...`, and code patterns are Blueprint-flavored
pseudocode for packs that have no public C++ API.

#### Ultra Dynamic Sky
- ✅ `ue-uds-setup-and-modes` — adding UDS to a level, Sky/Color/Project/Feature Mode
- ✅ `ue-uds-clouds` — Volumetric/Static/2D/Voxel clouds, movement, painter, wisps, light rays
- ✅ `ue-uds-time` — Time of Day, day/night cycle, runtime functions, event dispatchers
- ✅ `ue-uds-sun-moon-stars` — sun/moon positioning + appearance, stars, aurora, Space Layer (planets/moons/nebula)
- ✅ `ue-uds-lighting-and-shadows` — sun/moon directional lights, cloud shadows, sky light modes, exposure, light shafts, Light Day/Night Toggle
- ✅ `ue-uds-fog-and-atmosphere` — fog density/color, volumetric fog, Global Volumetric Material, dust, sky atmosphere, Simplified Color
- ✅ `ue-uds-simulation` — real-world sun/moon/stars (lat/long/date/time zone), city presets, Use System Time
- ✅ `ue-uds-cinematics-rendering` — Sequencer keyframing, Movie Render Queue, Path Tracer support, seamless cloud looping
- ✅ `ue-uds-modifiers-configs-state` — Sky Modifiers, Configuration Manager, save/load state, lens flare, post process components, interior + Player Occlusion, water level, on-screen UI
- ✅ `ue-uds-performance-mobile-troubleshooting` — perf levers, mobile + Feature Level, updating UDS, cache system (Static Properties / Hard Reset Cache), common runtime issues

#### Ultra Dynamic Weather
- ✅ `ue-udw-setup-and-state` — weather state model, presets, Change Weather, Manual Weather State, sampling, event dispatchers, Actor Weather Status component
- ✅ `ue-udw-random-seasons-temperature` — Random Weather Variation, seasons (0–4), climate presets, temperature system, Temperature Volumes
- ✅ `ue-udw-spatial-weather` — Weather Override Volumes, Radial Storms, Weather Above Volumetric Clouds, Weather Mask Brush / Projection Box
- ✅ `ue-udw-particles-lightning-wind-sounds` — rain/snow/dust particles, collision modes, lightning (incl. strikable actor interface), wind systems, sounds, environment sounds (5.1 metasound)
- ✅ `ue-udw-material-and-screen-effects` — Surface Weather Effects, DLWE V3, Glass Rain Drips, Foliage Wind, Water Ripples, screen droplets/frost/distortion, Puddle Fluid Volume, drip splines, breath, icicles

## Updating existing installations

Skill names and folders now use the `ue-` prefix so they are easier to identify
alongside skills for other tools. For example, `enhanced-input` is now
`ue-enhanced-input`. Names that already had the prefix, such as
`ue-cpp-fundamentals`, are unchanged.

After updating, replace previously copied skill folders instead of keeping both
versions. Update explicit skill invocations, configured paths, and saved discovery
URLs to use the new names. Category IDs and reference filenames are unchanged.

## Authoring conventions

See [`docs/skill-authoring-guide.md`](docs/skill-authoring-guide.md). In short:

- One skill = one folder under `skills/`; folder name **must equal** the `name` frontmatter.
- `name`: lowercase letters/digits/hyphens, ≤64 chars, no leading/trailing/double hyphens.
- `description`: ≤1024 chars, states **what it does and when to use it**, with searchable keywords.
- Keep `SKILL.md` under ~500 lines; push deep detail into `references/`.
- Ground claims in real 5.8 source paths; cite `Engine/Source/...` locations.
- Prefer C++ that compiles against 5.8; flag version-specific behavior.

## Validation

Validate any skill against the spec with the
[`skills-ref`](https://github.com/agentskills/agentskills/tree/main/skills-ref) tool:

```
skills-ref validate ./skills/<category>/<skill-name>
```

Verify that every engine-source citation in the skills still exists on disk (run after
editing skills, and when re-targeting a new engine version):

```
node scripts/check-citations.mjs            # all skills
node scripts/check-citations.mjs core/ue-gameplay-tags   # one skill
```

Set `UE_ENGINE_ROOT` if your engine install is not at the default path.

## Evals

`evals/tasks/` holds golden tasks for high-traffic skills — realistic prompts with
checkable acceptance criteria, used to compare an agent's output with and without the
skill loaded. See [`evals/README.md`](evals/README.md) for the method and the UE 5.8
compile-check workflow.
