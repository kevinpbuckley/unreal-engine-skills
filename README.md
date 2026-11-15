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
tutorials. That includes the engine's own scripting and agent surfaces: the editor's `unreal`
Python API (names, return shapes, error messages) and, from 5.9, Epic's AI toolsets and
in-engine skills, because most agent work on a 5.9 project goes through them. Third-party
tools (and how to configure an MCP client) stay out: these skills tell the agent *what is
correct in Unreal*, not which third-party tool to operate.

## Target environment

| Item | Value |
|---|---|
| Primary engine version | **UE 5.9** (default install `C:\Program Files\Epic Games\UE_5.9`) |
| Engine source for cross-ref | 5.9 (binary install incl. source); a 5.8 install kept for version diffing |
| Engine source root (5.9) | `C:\Program Files\Epic Games\UE_5.9\Engine\Source` |

Skills target 5.9 APIs. Where an API moved or changed between 5.x versions, the skill notes it.
The library was written against 5.8 and moved to 5.9 in 2026-11: every cited path exists in
5.9 (`check-citations.mjs`), line numbers were re-mapped from 5.8 to 5.9, and the skills
added for 5.9 (Wasm, AI toolsets, editor Python, PIE, Sequencer Python, StateTree, MetaHumans
at run time) were checked against 5.9 headers. Older text written for 5.8 was not re-reviewed
line by line for behaviour changes; version notes say where a difference is known.

## Repository layout

```
unreal-engine-skills/
├── README.md                  # this file — index + conventions
├── docs/
│   └── skill-authoring-guide.md   # house style for writing skills in this repo
├── evals/                     # golden tasks measuring skill effectiveness (see evals/README.md)
│   └── tasks/
├── scripts/
│   ├── check-citations.mjs    # verifies every cited Engine/Source path (and line range) exists on disk
│   ├── install-engine-skills.mjs  # installs the library as a UE 5.9 in-engine skill root
│   └── check-hosted-catalog.mjs   # compares the hosted MCP server's catalog with this repo
└── skills/
    ├── <category>/            # core, metahuman, ultra-dynamic-sky, ultra-dynamic-weather
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
- ✅ `ue-ai-toolsets` — the 5.9 AI toolset system: ToolsetRegistry, the editor's MCP server, writing `AICallable` toolsets in C++ or Python, in-engine agent skills (`SKILL.md` roots, `ListSkills` / `GetSkills`)

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
- ✅ `ue-mover-movement-system` — the Mover plugin: movement modes, layered moves, rollback networking backends
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
- ✅ `ue-hair-and-grooms` — Hair Strands grooms, Alembic groom import, bindings, groom components, cards to strands, groom LODs and the cards-only cvars, custom MetaHuman hair
- ✅ `ue-materials-and-shaders` — material graph, instances, parameters, material C++
- ✅ `ue-material-graph-effects` — UV motion, vertex animation, dissolve, glow, and interactive parameters
- ✅ `ue-master-material-authoring` — reusable PBR graphs, instances, switches, and packed texture channels
- ✅ `ue-data-driven-design` — DataTables, DataAssets, curves, config-driven systems

### Animation
- ✅ `ue-animation-system` — skeletal meshes, AnimInstance/AnimBP, state machines, montages, notifies
- ✅ `ue-control-rig-and-ik` — Control Rig, IK Rig/Retargeter
- ✅ `ue-animation-authoring` — create and edit AnimSequences from code (`IAnimationDataController`), animation-only FBX import, numeric pose verification
- ✅ `ue-skin-weights` — read, repair, transfer, and bind skeletal mesh skin weights (weight painting) via `USkinWeightModifier` and GeometryScript
- ✅ `ue-sequencer-and-cinematics` — Sequencer, cameras, cinematics
- ✅ `ue-sequencer-python` — Level Sequences from editor Python (5.9): binding proxies vs binding IDs, time units, play rate (`MovieSceneTimeWarpVariant`), marked-frame ranges, camera cuts, audio sections, runtime scrubbing

### MetaHuman (`skills/metahuman/`)
- ✅ `ue-metahuman-creator` — MetaHuman Character asset, editor subsystem API (body/face/skin/eyes/makeup), wardrobe palette, cloud auto-rig and texture sources, build/assembly, Python scripting
- ✅ `ue-metahuman-animator` — capture data ingest (mono video, Live Link Face takes, archives), Identity (Mesh to MetaHuman), Performance processing (depth, mono, audio), AnimSequence/LevelSequence export
- ✅ `ue-metahuman-runtime` — MetaHumans in a shipped game and on low-end / web targets: face AnimBP that plays baked clips, offline lip-sync bake, blinks, groom LOD holes, cook size, mobile-path teeth and skin, wardrobe and accessories
- ✅ `ue-metahuman-live-link` — MetaHuman Video/Audio and Live Link Face sources, subject calibration and smoothing, binding to the assembled MetaHuman face AnimBP, Take Recorder, runtime notes

### World building
- ✅ `ue-levels-and-world-partition` — levels, World Partition, data layers, streaming
- ✅ `ue-landscape-and-foliage` — landscape, foliage, PCG
- ✅ `ue-auto-landscape-materials` — painted and generated terrain layers, slope and height masks, projection
- ✅ `ue-landscape-rvt-and-grass` — runtime virtual textures, ground blending, and material-driven grass
- ✅ `ue-lighting-and-lumen` — lighting, Lumen GI/reflections
- ✅ `ue-nanite-and-rendering` — Nanite, rendering features, post process

### VFX & audio
- ✅ `ue-niagara-vfx` — Niagara systems, emitters, modules
- ✅ `ue-niagara-flamethrower` — sustained muzzle flame with layered emitters, runtime controls, and separate damage detection
- ✅ `ue-niagara-renderers-and-materials` — sprites, mesh particles, ribbons, SubUV, and particle-driven materials
- ✅ `ue-niagara-sequenced-effects` — timed portals, impacts, beams, projectiles, and attacks
- ✅ `ue-niagara-custom-modules` — scratch-pad modules, attribute readers, events, and environmental effects
- ✅ `ue-niagara-mesh-disintegration` — mesh sampling, detached particles, and synchronized dissolve materials
- ✅ `ue-audio-and-metasounds` — MetaSounds, audio components, attenuation

### UI
- ✅ `ue-umg-and-slate` — UMG widgets, widget C++, Slate, CommonUI

### Systems
- ✅ `ue-networking-and-replication` — replication, RPCs, replicated properties, multiplayer
- ✅ `ue-physics-and-chaos` — collision, physics, Chaos
- ✅ `ue-ai-and-navigation` — behavior trees, blackboard, EQS, navmesh
- ✅ `ue-statetree` — StateTree for game flow and logic beyond AI: schemas, tasks, conditions, transitions, events, property binding, editing trees from Python
- ✅ `ue-save-and-load` — `USaveGame`, serialization

### Tooling, pipeline, quality
- ✅ `ue-editor-scripting-and-python` — editor utilities, Python, Blutility; the 5.9 `execute_python` contract and Python wrapper traps
- ✅ `ue-pie-python` — editor Python against a running PIE game: world, subsystems, live widgets, presses vs real clicks, captures, automation tests
- ✅ `ue-plugins-and-modules` — creating and structuring plugins
- ✅ `ue-automation-and-testing` — automation specs, functional tests
- ✅ `ue-profiling-and-optimization` — Unreal Insights, `stat` commands, memory
- ✅ `ue-game-thread-performance` — game-thread budgets, FPS impact, optimization levers
- ✅ `ue-packaging-and-deployment` — cooking, packaging, platforms
- ✅ `ue-web-wasm-webgpu` — UE 5.9 browser builds (Wasm, WebGPU): plugins kept out of the cook, never/always-cook rules, download size, audio click-to-start, no-Lumen look, cross-origin isolation and itch.io hosting
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

## Using the library with agents

An agent only benefits from a skill it loads. In one 48-hour UE 5.9 project built by agents,
the hosted server was connected the whole time and never called: the project's instructions
called the engine's own agent skills "skills", most work was editor Python, and the client
listed the tool only by name. Give agents the library in at least one of these ways, and tell
them when to use it.

1. **Hosted MCP server** at `https://www.unrealengineskills.com/api/mcp`: one tool,
   `unreal-engine-skills-manager` (`search`, `load`, `categories`).
2. **Inside the editor (UE 5.9).** 5.9 serves Markdown skills to every agent on the editor's
   MCP server through `ToolsetRegistry.AgentSkillToolset` (`ListSkills`, `GetSkills`), from
   `<Project>/Skills/` among other roots (see `ue-ai-toolsets`). Install a copy there:

   ```
   node scripts/install-engine-skills.mjs --out "<Project>/Skills/UnrealEngineSkills"
   node scripts/install-engine-skills.mjs --out "<Project>/Skills/UnrealEngineSkills" --max-description 400
   ```

   Keys become `/Skills/Project/UnrealEngineSkills/<skill-id>`. The script rewrites each
   frontmatter to one-line `name` / `description` (the engine's reader does not understand
   wrapped YAML), copies `references/` alongside, and refuses to overwrite a folder it did not
   create. `--max-description` keeps `ListSkills` short; `--only a,b` installs a subset;
   `--check` validates without writing. Re-run it after pulling this repo. Whether to commit the
   copy is the project's choice (it is plain Markdown, about 3 MB).
3. **As Agent Skills files** for clients that load `SKILL.md` folders directly: copy
   `skills/<category>/<skill-id>/` folders into the client's skills directory.

### Paste-in paragraph for a project's `AGENTS.md` / `CLAUDE.md`

```markdown
## Unreal Engine knowledge: the Unreal Engine Skills library
Before writing or changing anything that uses an Unreal API (C++, Blueprint logic, editor
Python run through execute_python, Sequencer, UMG, cook/packaging/web build config, MetaHumans),
search the Unreal Engine Skills library and load the best match: MCP tool
`unreal-engine-skills-manager` with {action: "search", query: "<keywords or the error text>"},
then {action: "load", skill: "<id>"}; or, inside the editor, AgentSkillToolset `ListSkills` and
`GetSkills` on `/Skills/Project/UnrealEngineSkills/<id>`. Do this again after any
`'unreal' has no attribute ...`, "Failed to find property", "Cannot nativize", cook or packaging
error, before guessing a second time. Then confirm names in the engine source or with the
editor's own symbol tools. The library is different from the engine's own toolset skills
(listed by the same ListSkills call) and from third-party plugins' skills: use all of them.
```

To reach every agent that connects to the editor, the same text (on one line) can go in the
project's MCP instructions, which the 5.9 MCP server sends to clients on connect:

```ini
; Config/DefaultGame.ini
[/Script/ModelContextProtocol.ModelContextProtocolProjectSettings]
Instructions=Before guessing an Unreal API, search the Unreal Engine Skills library (MCP tool unreal-engine-skills-manager, or AgentSkillToolset ListSkills under /Skills/Project/UnrealEngineSkills) and load the matching skill.
```

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
- Ground claims in real 5.9 source paths; cite `Engine/Source/...` locations.
- Prefer C++ that compiles against 5.9 and editor Python checked against the 5.9 Python plugin;
  flag version-specific behavior.
- Put the words an agent would search for (synonyms, error strings) in the description and in
  `metadata.aliases`.

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

Set `UE_ENGINE_ROOT` if your engine install is not at the default path
(`C:\Program Files\Epic Games\UE_5.9`). The checker also fails a line number written after a
full path (`Engine/.../File.h:123`) that is past the end of the file.

Check that every skill installs cleanly as a UE 5.9 in-engine skill (one-line frontmatter the
engine reads, relative links that resolve):

```
node scripts/install-engine-skills.mjs --check
```

After deploying the hosted server, check that it serves exactly the repo's skills:

```
node scripts/check-hosted-catalog.mjs          # add --load to also load each skill by id
```

## Evals

`evals/tasks/` holds golden tasks for high-traffic skills — realistic prompts with
checkable acceptance criteria, used to compare an agent's output with and without the
skill loaded. See [`evals/README.md`](evals/README.md) for the method and the UE 5.8
compile-check workflow.
