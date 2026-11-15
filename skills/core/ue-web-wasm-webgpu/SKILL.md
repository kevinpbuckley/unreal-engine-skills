---
name: ue-web-wasm-webgpu
description: >
  Platform facts for shipping a UE 5.9 game to the browser (HTML5 successor: the Wasm /
  WebAssembly target, WebGPU RHI) that Epic's web-deploy and unreal-trim skills do not
  spell out - mobile renderer tiers and no Lumen, C++ project and emscripten 6.0.10,
  plugins to keep out of the Wasm cook, never-cook and always-cook rules, download size
  (Brotli, .ucas), texture pool, click-to-start audio, cross-origin isolation
  (COOP/COEP, SharedArrayBuffer, itch.io) and a smoke checklist. Use to package for web,
  make a browser / WebGPU / itch.io build, shrink a web download, or on "Sdk: not found.
  Required version 6.0.10", "is a content-only project", "which is in a module that is not available on the platform",
  "Registered the path ... for two different domains", "Content is missing from cook",
  "Failed to find shader map for default material", "The page is not cross-origin
  isolated", "SharedArrayBuffer is not defined", "TEXTURE STREAMING POOL OVER ... BUDGET".
metadata:
  engine-version: "5.9"
  category: tooling
  aliases: "web, browser, HTML5, Wasm, WebAssembly, WebGPU, emscripten, itch.io, web build, browser build, COOP, COEP, SharedArrayBuffer, cross-origin isolation"
---

# Web builds: Wasm + WebGPU (UE 5.9)

UE 5.9 ships a browser platform, `Wasm` (WebAssembly code, WebGPU rendering). Epic ships
the **procedure** with the engine as in-engine skills and docs; this skill holds the
**platform facts and traps** around that procedure, most of them measured in a 48-hour
UE 5.9 game-jam project (2026-11) that shipped sixteen Shipping web packages of a game with
six MetaHumans. Each claim is tagged: **(Epic)** = stated in the 5.9 install's Wasm docs or
skills, **(engine)** = read in engine config or source, **(jam)** = measured there.
Numbers, config blocks, code and the failure log are in
[references/measured-and-config.md](references/measured-and-config.md).

## When to use this skill

- Packaging, cooking or hosting a UE 5.9 project for the browser (itch.io, a static host).
- A Wasm cook fails, a web build boots dark, silent, broken or not at all.
- The web download is too big, or the texture pool overflows on the web.
- Deciding whether to ship a web build or fall back to a Windows build.

## Mental model

1. **Procedure lives in the engine; read it, do not re-derive it.** Paths are relative to
   the engine root (the folder holding `Engine/`).

   | Need | Read |
   |---|---|
   | Build, cook, stage, run, measure, plan a deploy | `Engine/Platforms/Wasm/Skills/web-deploy/SKILL.md` (and `Engine/Platforms/Wasm/Docs/README.md`) |
   | Make the download smaller (a measured loop) | `Engine/Extras/AgentTools/Skills/unreal-trim/SKILL.md`, and its `references/traps.md` before the first cut |
   | Frame rate; phones and Apple GPUs | `Engine/Platforms/Wasm/Skills/web-perf-hillclimb/SKILL.md`, `.../web-texture-sets/SKILL.md` |
   | Host rules, headers, itch.io | `Engine/Platforms/Wasm/Docs/Deploy.md` |
   | A symptom; page settings and hooks | `Engine/Platforms/Wasm/Docs/Troubleshooting.md`, `Debugging.md`, `PageContract.md`, `SupportMatrix.md` |
   | Tools | `Engine/Platforms/Wasm/Build/Tools/deploy/` (`check_stage.py`, `deploy.py`, `webdoctor.py`), `.../Tools/web/` (`serve.py`, `webrun.py`) |

   In a 5.9 editor with the AI toolset plugins on, the same skills are listed by
   `AgentSkillToolset.ListSkills` as `/Skills/Platforms/Wasm/<name>` and `/Skills/Engine/unreal-trim`.
2. **It is the mobile renderer.** Two tiers are cooked by default: mobile forward
   (`SP_WEBGPU_ES3_1`) and mobile deferred (`SP_WEBGPU_ES3_1_DEFERRED`); the page picks one per
   device. The desktop tier `SP_WEBGPU_SM5` (the only one with Lumen) is experimental and off.
   Plan for **no Lumen, no Nanite (fallback meshes draw), no virtual shadow maps, no hardware
   ray tracing**. `bTargetMobileDeferredTier=False` cooks the forward tier only. (Epic, engine:
   `BaseWasmEngine.ini`, `DataDrivenPlatformInfo.ini`)
3. **A browser tab is not a PC.** HTTP is off by default, there are no raw sockets, no listen
   server (`net.SupportsListenServers=0`), no online subsystems. A game that calls a live
   service at run time (TTS, a voice endpoint, a backend) has no web build until that output is
   baked to assets. A tab cannot quit: hide Quit when `FPlatformProperties::IniPlatformName()`
   is `"Wasm"`. (Epic; jam)
4. **The cooker runs with editor plugins loaded.** Denying a plugin for the Wasm *target* does
   not stop what it does during the *cook*. Two of the hardest failures came from that
   (section "Plugins").
5. **Size is measured as the Brotli download, not bytes on disk**, and the IoStore `.ucas`
   container dominates it.

## Core workflow

### 1. Before the first cook

- **C++ project.** A Blueprint-only project stops at once: UAT exit code 19, `is a
  content-only project`. Add one C++ class. (Epic)
- **emscripten 6.0.10 exactly**, at `WASM_EMSDK_ROOT` (or `EMSDK`). A cloned emsdk with nothing
  installed fails UBT with `Sdk: not found. Required version 6.0.10`: run `emsdk install
  6.0.10` and `emsdk activate 6.0.10`. An editor that was already open does not see the
  variable until it restarts; UAT from a fresh shell sees it at once. (Epic; jam)
- **UAT on Windows from PowerShell** (`& "<engine root>\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun
  -platform=Wasm ...`); the quoted `Program Files` path did not launch from cmd or Git Bash.
  Pass `-NoCompileEditor` while an editor is open, `-map=` with only the shipping maps (else
  every map cooks), and an **absolute** `-archivedirectory` (a relative one lands under the
  engine folder). (jam)
- **Build the Wasm target on day one.** Code that compiles for the editor can fail the game
  target (an editor-only StateTree task member broke Game, Shipping and Wasm until it sat in
  `#if WITH_EDITORONLY_DATA`), and each failure below costs a full cook to find. First Wasm
  game-target build with link: 133 s; cook of a near-empty project: 34 s. (jam)
- **The page URL is not the game's command line.** A Shipping page keeps only a `/Game/` map
  and an allow-list of switches from `?args=` (`QueryArgs`). Custom URL options (`?seed=`) need
  an intro shell script: `IntroShellScript=<page path>.js` under
  `[/Script/WasmTargetPlatform.WasmTargetSettings]`, the file staged from
  `<Project>/Build/Wasm/Template/`, pushing arguments into the page before boot. (engine:
  `WasmTargetSettings.h`; jam; hooks in `PageContract.md`)

### 2. Plugins: keep them out of the Wasm target

Edit the `.uproject` `Plugins` array (keep a backup; re-parse it as JSON after editing).

| Plugin kind | Entry | Why |
|---|---|---|
| Epic AI toolsets: `AIAssistant`, `AllToolsets`, `AllMetaHumanToolsets`, `ToolsetRegistry`, `ModelContextProtocol`, `MCPClientToolset`, `GeometryToolset`, `KnowledgeBaseToolset`, and any editor tool plugin of your own | `"TargetAllowList": ["Editor"], "PlatformDenyList": ["Wasm"]` | They crash a Wasm cook (Epic names the first three; the jam denied all of these) |
| `OnlineSubsystemUtils`, `OnlineSubsystemNull` (enabled by default, so add entries) | `"Enabled": true, "PlatformDenyList": ["Wasm"]` | Online subsystems do not run in a browser (Epic) |
| Editor-only helpers (Python, editor scripting, importers) and content-generation plugins whose output you import as ordinary assets | `"TargetAllowList": ["Editor"]` | Not needed at run time; imported SoundWaves/meshes still cook (jam) |
| MetaHuman Animator (`MetaHuman`) | leave its `"SupportedTargetPlatforms": ["Win64","Linux","Mac"]` | Capture/solve tools only; the character runtime (`MetaHumanCharacter`, `RigLogic`, `HairStrands` cards) cooked and ran on Wasm unchanged (jam) |

**What the deny list does not stop** (both real):

1. **ToolsetRegistry manifest packages.** The plugin builds packages in memory when the cook
   commandlet starts. The cook fails (exit 25, `Error_UnknownCookFailure`) with `Failed to cook
   /ToolsetRegistry/ToolsetManifestSeed/_Generated_/<Toolset> for platform Wasm. It imports
   class /Script/ToolsetRegistry.ToolsetRegistryManifest, which is in a module that is not
   available on the platform`. Fix: `+DirectoriesToNeverCook=(Path="/ToolsetRegistry/ToolsetManifestSeed")`
   (a sub-folder, never the plugin root; section 3). (jam)
2. **Editor plugins that rewrite assets at cook time.** With UE 5.9's text-to-motion plugins
   enabled (`Kimodo` depends on `AnimGenOffline`, which enables `MovieSceneAnimMixer`; the jam
   took out `Kimodo` and `PythonMLPackages`), every Animation Blueprint was cooked with an
   `AnimBlueprintExtension_SequencerMixerTarget` (declared in the editor module
   `MovieSceneAnimMixerEditor`). The Wasm runtime has no such type: the **Development** build
   asserted at boot, the **Shipping** build booted with broken Anim BPs and no error. No asset
   on disk carried the extension. Fix: `"Enabled": false` on those plugins before any cook;
   enable them only for the session that needs them. After adding any plugin, boot a
   **Development** web build before trusting a Shipping one: only Development asserts. (jam;
   engine: the `.uplugin` dependency chain and header)

### 3. Cook rules (`Config/DefaultGame.ini`, `[/Script/UnrealEd.ProjectPackagingSettings]`)

- **Never list a plugin root as never-cook.** `+DirectoriesToNeverCook=(Path="/ToolsetRegistry")`
  failed the cook on an ensure: `Registered the path /ToolsetRegistry/ for two different
  domains: Plugin:ToolsetRegistry and Never Cooked Content` (raised by the
  `AssetReferenceRestrictions` plugin's domain table when it is enabled; the same happened with
  `/NNEDenoiser`). Name a folder inside the plugin (`/ToolsetRegistry/ToolsetManifestSeed`,
  `/MetaHumanCoreTech/RealtimeMono`); to drop a whole plugin's content, disable the plugin. (jam;
  engine: `AssetReferencingDomains.cpp`; Epic's unreal-trim says the same)
- **Never-cook only what no kept content references**, and cook after each change: a
  referenced folder fails with `Content is missing from cook`. Keep material-function folders
  off the list (their use is compiled in, so the import graph shows no edge). (Epic; engine:
  `CookImportsChecker.cpp`)
- **Never-cook your editor-only folders** (bake intermediates, fit tests, backups). One
  `/Game/<Project>/Editor` folder for all of them makes it one line. (jam: 277 MB stayed out)
- **Always-cook every folder the game loads by path.** A path string built in C++ or
  Blueprint (`LoadObject`, a soft path from a naming convention, a DataTable row turned into an
  asset path) is not a reference the cooker follows: it works in PIE and is missing in the
  package, with no error. Seen as: a cutscene showing an empty set, a viewer staying grey, lines
  playing with no voice or face. Fix: `+DirectoriesToAlwaysCook=(Path="/Game/<Folder>")`; grep
  the source for `/Game/` strings when you add one. Only a full playthrough of the **Shipping**
  stage finds these. (jam)
- **Nothing writes config or assets while a cook runs.** `Config/DefaultEngine.ini` gained two
  renderer lines 40 s into a cook: the package built and passed `check_stage.py`, then every
  load aborted with `Failed to find shader map for default material
  DefaultDeferredDecalMaterial` (shaders compiled under the old settings, the new ini staged).
  Re-packaging unchanged fixed it. Assets created during a cook were missed by its asset scan
  and the build failed. With several agents on one project, the cook needs the same lock as the
  editor. (jam)

### 4. Size: measure the download, then cut the big things

- **Count the Brotli download.** A stage holds each big file twice (original and `.br` twin), so
  folder size overstates by about 70 %: 561.8 MB on disk was 330.9 MB of download. Count one
  copy per file: the `.br` where one is staged, else the file itself. **The `.ucas` has no twin
  and travels at full size** (270 MB of that 330.9). (jam)
- Two numbers matter: bytes **before READY** (what the player waits for) and the **whole
  session** (the loader keeps fetching the rest of the container after READY). `webrun.py`
  reports both (`bytes.before_ready`, `bytes.total`). (Epic tool; jam)
- **Attribute before cutting** with unreal-trim's `scripts/trim_report.py --compare` against the
  previous stage; one lever per build. (Epic)
- **What paid, in order** (container 861 MB to 329 MB): (jam)
  1. **Content a plugin always-cooks and the game never reads: -319 MB.** Plugins ship their own
     `Config/Game.ini` with `+DirectoriesToAlwaysCook`; e.g. `MetaHumanLiveLink` always-cooks
     `/MetaHumanCoreTech` (four realtime face-solver models, 318.6 MB). Grep
     `DirectoriesToAlwaysCook` in `Engine/Plugins/**/Config/*.ini` for every enabled plugin.
  2. **Texture group caps in a web-only device profile: -138 MB.**
     `<Project>/Platforms/Wasm/Config/WasmDeviceProfiles.ini`, `+TextureLODGroups=(Group=...,MaxLODSize=1024,...)`
     under `[Wasm DeviceProfile]`. The cooker uses that profile, so the cap drops top mips
     from the container; Win64 never reads that folder.
  3. **Per-asset `max_texture_size` on virtual textures: -79 MB.** Group caps do **not** reach
     virtual textures. Never flip `virtual_texture_streaming` off from Python: materials that
     sample with Virtual sampler types stop compiling (`Sampler type is Virtual Color, should
     be Color`) and fall back to the default material. Use the editor's "Convert to Regular
     Texture" if a texture must stop being virtual.
- **Not worth it:** 132 face AnimSequences cooked to 3.22 MB, 142 voice lines to 6.7 MB, every
  skeletal mesh of six MetaHumans to 7.8 MB. (jam)
- **Texture pool.** The WebGPU RHI sizes `r.Streaming.PoolSize` itself at start: at most 192 MB
  on the mobile tiers, also on a 32 GB desktop (engine: `BaseWasmEngine.ini` comment). One
  untrimmed 2K MetaHuman overflowed it by 21 MB. Red `TEXTURE STREAMING POOL OVER n MiB BUDGET`
  means the streamer drops mips, not a crash. Cut demand with
  `r.Streaming.MaxEffectiveScreenSize=1080` (720 on `Wasm_Mobile`) and the caps above. (jam)
- **Gate it:** a package over budget should fail before anyone boots it; check the **largest
  single file** (the `.ucas`) against the host's per-file limit too.

### 5. What looks or behaves differently

- **Dark.** No Lumen means no bounce light; close-ups played nearly black. What shipped:
  `r.ExposureOffset` +1.5 EV set **from code** at `StartPlay`, only when Lumen is not running
  (feature level below SM5, or `r.DynamicGlobalIlluminationMethod` not 1), never in the editor,
  and only while the cvar is still 0 so a level reload does not stack it. It must be code: the
  cvar is `ECVF_Cheat` (engine: `SceneView.cpp`), so ini and console cannot set it in Shipping.
  +2 EV read flat. Fill lights fixed the shots the offset did not. (jam)
- **A sequence player can report "not playing" for one frame mid-sequence** on the web. Flow
  code that ended a scene on the first not-playing tick cut a 21 s scene at 14 s. End at the
  end time, or after the player has been stopped for well over a second. (jam)
- **MetaHumans on the mobile path:** teeth draw as a flat white band and skin reads wet; hair
  needs cards at every groom LOD or heads go bald in wide shots. Card-only hair is
  `r.HairStrands.Strands=0`; **`r.HairStrands.Enable=0` removes cards and meshes too** (engine:
  `GroomVisualizationData.cpp`, "affects all geometric representations"). Fixes: the
  `ue-metahuman-runtime` skill. (jam)

### 6. Audio and page settings

Browsers play no sound before a user gesture. With no cook running, in
`Config/DefaultEngine.ini`:

```ini
[/Script/WasmTargetPlatform.WasmTargetSettings]
PageTitle=My Game
; EWasmStartMode: Auto (default) or Click; the click is the sound and pointer gesture
StartMode=Click
```

Keep comments on their own lines in `.ini` files: text after a value is part of the value.

A scripted browser test must click too (one click about a second after READY, before any
screenshot). Keep the title in the ini, never in a `-ini:` override on the UAT line: a value
with a space reaches UBT unquoted and its second word is read as a target name. (engine:
`WasmTargetSettings.h`; jam)

### 7. Hosting: cross-origin isolation

The game runs on wasm threads, which need `SharedArrayBuffer`, which needs a cross-origin
isolated page in a secure context (HTTPS or `http://localhost`). (Epic: `Deploy.md`)

- **Headers:** `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
  require-corp` on `index.html` and `sw.js`; `Cross-Origin-Resource-Policy: same-origin` on
  every file. Range requests answered 206; **the host's own gzip off** for the game's files
  (the stage already has `.br`); `Cache-Control: no-cache`. Host templates:
  `Engine/Platforms/Wasm/Build/Tools/deploy/templates/` (`_headers`, `netlify.toml`,
  `nginx.conf`, `web.config`). (Epic)
- **Without isolation** the page stops at "The page is not cross-origin isolated" or, from
  `file://`, "SharedArrayBuffer is not defined". `file://` never works: serve the stage
  (`serve.py --root <stage>\Wasm --port 8900`). **`serve.py` sends the headers itself, so a local
  boot proves nothing about the host.** (Epic; jam)
- **itch.io and other iframe portals:** the game runs in an iframe on the portal's page, so
  `_headers` and the service-worker fallback cannot isolate it. On itch.io turn on **Edit game >
  Embed options > SharedArrayBuffer support**, save, and reopen the form to check it stayed on
  (the new-project form has dropped it). Upload a zip with `index.html` at its root
  (`deploy.py --host zip` writes the plan; it never uploads). (Epic; jam)
- **A top-level static host with no header control** (GitHub Pages): set
  `bInjectIsolationHeaders=True` and the service worker adds the headers (top-level pages
  only). Cloudflare Pages caps a file at 25 MiB; Epic's zip plan stops at 1000 files (engine:
  `deploy/hosts.json`). (Epic)
- **After it is live:** `webdoctor.py https://<host>/<prefix>/` for a top-level page, then a real
  boot with `webrun.py run --url ...`. Inside a portal iframe, check `crossOriginIsolated` in the
  console of the game's own frame. (Epic)

### 7b. Portal limits

Check your portal's own limits before sizing the budget. Jam notes read from a jam page (not
from itch.io's documentation): web build under 500 MB total and 200 MB per file; desktop zip
under 1 GB unless uploaded with itch's butler tool. See *Unverified*.

### 8. Smoke checklist (Shipping stage, served locally, then on the host)

1. `check_stage.py <stage>\Wasm` passes; a finding stops the ship (do not delete the finding).
   Only a Shipping stage goes public: the release scan blocks a Development one. (Epic)
2. The cover shows the title and waits for a click; after it, READY with no `UE_RUN ERROR` and
   0 WebGPU errors in the console.
3. **Sound** after the click: music and one voice line.
4. **First scene**: characters with hair and brows, picture not near black, teeth not a white band.
5. **Every scene that loads something by path** (cutscenes, data-driven screens, one voiced line).
6. **One full playthrough to the end** in the Shipping stage (the jam's first found two uncooked sequences).
7. **Both tiers**: `?tier=forward` and `?tier=deferred`. Shipping prints no tier line: confirm
   `tier.ran` on a Development stage of the same content.
8. On the host: isolation on, a cold-cache start, and a faster second visit.

Screenshots taken through DevTools can stall page timers: a moment missing from a capture is
not yet a bug. (jam)

### 9. Performance, and when to ship Windows instead

- **Measured** (desktop Chrome, 300 Mbit/s shaped, cold): six MetaHumans on one map, Shipping:
  READY about 20 s on both tiers, 340 MB download, 0 WebGPU errors. Empty project
  (Development): READY 12.85 s, 84 MB before READY. **No frame rate was recorded**: measure
  with `webrun.py` and follow `web-perf-hillclimb`. Desktop Chrome and Edge are the target;
  Firefox and phones: `SupportMatrix.md`. (jam; Epic)
- **Make Windows the main build when** the look depends on Lumen, Nanite or ray tracing and an
  exposure-lifted or baked version is not acceptable; the content cannot get under the portal's
  limits; the game needs a live network service; or a required feature fails on the mobile
  renderer with no time to replace it. Keep a trimmed Windows Shipping zip as a second download
  either way (the jam's was 1.4 GB until 556 MB of face-tracker models nothing read were
  never-cooked).

## Gotchas (error -> cause)

| Error / symptom | Cause | Fix |
|---|---|---|
| UBT exit 6, `Sdk: not found. Required version 6.0.10` | emsdk cloned, nothing installed | `emsdk install 6.0.10`, `emsdk activate 6.0.10`, set `WASM_EMSDK_ROOT` |
| UAT exit 19, `is a content-only project` | Blueprint-only project | add one C++ class |
| Cook exit 25, `/ToolsetRegistry/ToolsetManifestSeed/... not available on the platform` | in-memory manifest packages | never-cook `/ToolsetRegistry/ToolsetManifestSeed` |
| Cook ensure `Registered the path /X/ for two different domains` | a plugin root in `DirectoriesToNeverCook` | list a sub-folder; disable the plugin to drop all of it |
| `Content is missing from cook` | a never-cooked folder is referenced | remove it from the list; cook after each change |
| Every load aborts: `Failed to find shader map for default material ...` | ini changed during the cook | package again; never write ini during a cook |
| Development asserts at boot, Shipping has dead Anim BPs | an editor plugin (text-to-motion / Anim Mixer) extended Anim BPs at cook | disable it before cooking |
| Shows in PIE, missing in the package | asset loaded by path string | `DirectoriesToAlwaysCook` |
| `The page is not cross-origin isolated`, `SharedArrayBuffer is not defined` | COOP/COEP missing, `file://`, or a portal iframe | headers; serve over http(s); itch.io SharedArrayBuffer option |
| `TEXTURE STREAMING POOL OVER n MiB BUDGET` | demand above the 192 MB mobile-tier pool | `MaxEffectiveScreenSize`, group caps, per-asset VT caps |
| `Sampler type is Virtual Color, should be Color` | `virtual_texture_streaming` flipped by script | revert; cap with `max_texture_size`, or "Convert to Regular Texture" |
| Web far darker than PIE | no Lumen on the mobile tiers | exposure offset from code, fill lights |
| UBT reads a word of the page title as a target | `-ini:` override with a space | put `PageTitle` in `DefaultEngine.ini` |

## Unverified (do not state these as facts)

- Whether itch.io enforces 200 MB per file on a web zip: the jam's `.ucas` was 270 MB and no
  upload result is recorded. Splitting the container into chunks was planned and never tried.
- Whether pinning `r.Streaming.PoolSize` above 192 MB helps on the mobile tiers (set up, no result).
- Cook-time skeletal LOD stripping (`r.SkeletalMesh.StripMinLodDataDuringCooking` with a
  per-platform MinLOD) and dropping the 103 MB of denoiser models by disabling `NNEDenoiser`:
  named in the jam's notes or in Epic's trim skill, neither applied.
- Per-character chunks (`bGenerateChunks=True` plus one Primary Asset Label per character
  folder) so only the current scene downloads before READY: planned, never applied.
- Frame rate anywhere, and anything about phones, Safari or Firefox: only desktop Chrome was tested.
- That the `AssetReferenceRestrictions` plugin is what raised the plugin-root ensure in every
  project: the message comes from its source, but which plugin enabled it in the jam project
  was not traced.

## References & source material

Engine source and config (UE 5.9):
- `Engine/Platforms/Wasm/Source/Developer/WasmTargetPlatform/Public/WasmTargetSettings.h` —
  `UWasmTargetSettings`: `PageTitle`, `StartMode` (`EWasmStartMode::Auto|Click`), `QueryArgs`,
  `IntroShellScript`, `bInjectIsolationHeaders`.
- `Engine/Platforms/Wasm/Config/BaseWasmEngine.ini` — tiers (`bTargetMobileDeferredTier`),
  texture pool sizing comment, `net.SupportsListenServers=0`.
- `Engine/Platforms/Wasm/Config/BaseWasmDeviceProfiles.ini` — `Wasm`, `Wasm_Desktop`, `Wasm_Mobile` profile tree.
- `Engine/Platforms/Wasm/Config/DataDrivenPlatformInfo.ini` — `SP_WEBGPU_ES3_1`, `SP_WEBGPU_ES3_1_DEFERRED`, `SP_WEBGPU_SM5`.
- `Engine/Plugins/Editor/AssetReferenceRestrictions/Source/AssetReferenceRestrictions/Private/AssetReferencingDomains.cpp`
  — the "two different domains" ensure and the "Never Cooked Content" domain.
- `Engine/Source/Editor/UnrealEd/Private/Cooker/CookImportsChecker.cpp` — "Content is missing from cook".
- `Engine/Source/Developer/DeveloperToolSettings/Classes/Settings/ProjectPackagingSettings.h` —
  `DirectoriesToAlwaysCook`, `DirectoriesToNeverCook`.
- `Engine/Source/Runtime/Engine/Private/SceneView.cpp` — `r.ExposureOffset` (`ECVF_Cheat`).
- `Engine/Source/Runtime/Engine/Private/GroomVisualizationData.cpp` — `r.HairStrands.Enable`;
  `Engine/Source/Runtime/Renderer/Private/HairStrands/HairStrandsInterface.cpp` — `r.HairStrands.Strands`.
- `Engine/Plugins/Experimental/MovieSceneAnimMixer/Source/MovieSceneAnimMixerEditor/Public/AnimBlueprintExtension_SequencerMixerTarget.h`;
  dependency chain in `Engine/Plugins/Experimental/Animation/Kimodo/Kimodo.uplugin` and
  `Engine/Plugins/Experimental/Animation/AnimGenOffline/AnimGenOffline.uplugin`.
- `Engine/Plugins/MetaHuman/MetaHumanLiveLink/Config/Game.ini` — `+DirectoriesToAlwaysCook=(Path="/MetaHumanCoreTech")`.
- `Engine/Source/Runtime/Core/Public/GenericPlatform/GenericPlatformProperties.h` — `IniPlatformName()`.

Epic's in-engine procedure (UE 5.9): `Engine/Platforms/Wasm/Docs/` (`README.md`, `Deploy.md`,
`Troubleshooting.md`, `PageContract.md`, `Performance.md`, `SupportMatrix.md`),
`Engine/Platforms/Wasm/Skills/{web-deploy,web-perf-hillclimb,web-texture-sets}/SKILL.md`,
`Engine/Extras/AgentTools/Skills/unreal-trim/SKILL.md`, `Engine/Platforms/Wasm/Build/Tools/`.

Deep dive: [references/measured-and-config.md](references/measured-and-config.md) — size
ledger, config that worked (`.uproject`, `DefaultGame.ini`, `DefaultEngine.ini`,
`WasmDeviceProfiles.ini`), exposure and sequence-end code, a `webrun.py` fixture, failure log.

Related skills: `ue-packaging-and-deployment`, `ue-metahuman-runtime`,
`ue-lighting-and-lumen`, `ue-profiling-and-optimization`.
