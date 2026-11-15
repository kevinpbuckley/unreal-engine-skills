# Web builds: measured numbers, config that worked, failure log

Everything here was measured in a 48-hour UE 5.9 game-jam project (2026-11): a C++ game, one
map, six MetaHumans (Optimized Medium build, card hair), 142 voice lines, 132 baked face
animations, packaged for Wasm on an installed engine. MB = 10^6 bytes. Use the numbers for
order of size, not as what another project will get. Placeholders: `<Project>`, `<Folder>`.

## 1. Size ledger

Development stages, Chrome, 300 Mbit/s shaped, 1920x1080, the `boot` fixture of `webrun.py`,
the real game map. One lever kind per row.

| Row | Change | `.ucas` MB | Before READY MB (deferred / forward) | READY s (d / f) | Total fetched MB (d / f) |
|---|---|---:|---:|---:|---:|
| 0 | nothing trimmed | 861 | 187.0 / 179.9 | 23.81 / 22.49 | 664.7 / 650.8 |
| 1 | never-cook the realtime face-solver models + web device profile (World and Character texture groups 1K, streaming and hair cvars) | 404 | 164.5 / 157.3 | 21.60 / 21.30 | 565.0 / 557.9 |
| 2 | per-asset `max_texture_size` on the characters' virtual textures (bodies 1024, faces 2048) | 325 | 167.0 / 160.6 | 22.06 / 21.34 | 487.4 / 481.3 |
| 3 | groom LOD fill (hair at every LOD; costs bytes, fixes bald heads) | 329 | 166.5 / 157.6 | 23.15 / 22.86 | 491.0 / 482.1 |

All rows passed on both tiers with 0 WebGPU errors. "Total" is about before-READY plus the
whole `.ucas`, because the loader keeps fetching the container after READY. A later stage
with World normal maps at 512: 270 MB `.ucas`, 561.8 MB on disk, **330.9 MB download**.
Shipping packages after that: 339 to 341 MB download, READY about 20 s.

Where the bytes were (unreal-trim `trim_report.py --compare`):

| Item | Before MB | After MB | Lever |
|---|---:|---:|---|
| Four realtime face-solver NNE models under `/MetaHumanCoreTech` (always-cooked by the `MetaHumanLiveLink` plugin's `Config/Game.ini`) | 318.6 | 0 | never-cook two sub-folders |
| MetaHuman default garments `/MetaHumanCharacter/Optional/Clothing` (4K/8K) | 123.2 | 20.7 | texture group caps |
| Plugin groom atlases | 28.1 | 13.9 | texture group caps |
| Eye / teeth / skin-mask textures | 17.7 / 11.5 / 6.7 | 12.7 / 3.6 / 5.2 | texture group caps |
| The game's six character folders | 255.1 | 175.6 | per-asset caps on virtual textures (an 8K body base colour: 6-7 MB cooked to under 0.2 MB) |
| Windows build only: MetaHuman Animator footage trackers `/MetaHuman/GenericTracker` | 556 | 0 | never-cook; container 1176 to 646 MB |
| Windows build only: path-tracer denoiser models `/NNEDenoiser` | 103 | 103 | plugin root, could not be never-cooked; left in |

Small things, measured so nobody trims them: 132 face AnimSequences 3.22 MB cooked (largest
95 KB; the 232 MB in the editor is source curve data); 142 voice SoundWaves 6.7 MB; every
skeletal mesh of six characters 7.8 MB. One untrimmed 2K MetaHuman added about 168 MB of
container and 2 to 4.5 s of READY.

Boot references (Development, cold): empty project READY 12.85 s, 84.1 MB before READY, 399 MB
total, `.wasm` 210 MB raw and 42.5 MB Brotli, `.ucas` 356 MB (engine and plugin content before
any trim). One MetaHuman on a test map: READY 15.1 s deferred / 17.4 s forward, 112.5 / 105.6
MB before READY. Wasm heap peak 512 MiB in every run. The browser harness leaves a Chrome
profile of several hundred MB in its output folder; delete it after each run.

## 2. Config that worked

`.uproject` plugin entries (pattern):

```json
{ "Name": "ToolsetRegistry", "Enabled": true, "TargetAllowList": [ "Editor" ], "PlatformDenyList": [ "Wasm" ] },
{ "Name": "OnlineSubsystemUtils", "Enabled": true, "PlatformDenyList": [ "Wasm" ] },
{ "Name": "OnlineSubsystemNull", "Enabled": true, "PlatformDenyList": [ "Wasm" ] },
{ "Name": "PythonScriptPlugin", "Enabled": true, "TargetAllowList": [ "Editor" ] },
{ "Name": "MetaHuman", "Enabled": true, "SupportedTargetPlatforms": [ "Win64", "Linux", "Mac" ] },
{ "Name": "Kimodo", "Enabled": false }
```

`Config/DefaultGame.ini`:

```ini
[/Script/UnrealEd.ProjectPackagingSettings]
; every folder the game loads by path string (the cooker follows references, not strings)
+DirectoriesToAlwaysCook=(Path="/Game/<Project>/Audio/VO")
+DirectoriesToAlwaysCook=(Path="/Game/<Project>/Cinematics")
+DirectoriesToAlwaysCook=(Path="/Game/<Project>/Data")
; editor-only intermediates
+DirectoriesToNeverCook=(Path="/Game/<Project>/Editor")
; realtime face solving, unused when face animation is baked (MetaHumanLiveLink always-cooks /MetaHumanCoreTech)
+DirectoriesToNeverCook=(Path="/MetaHumanCoreTech/RealtimeMono")
+DirectoriesToNeverCook=(Path="/MetaHumanCoreTech/GenericTracker")
; MetaHuman Animator footage trackers (reached the Windows build)
+DirectoriesToNeverCook=(Path="/MetaHuman/GenericTracker")
; in-memory manifest packages of the AI toolset registry cannot cook for Wasm; a plugin ROOT here fails the cook
+DirectoriesToNeverCook=(Path="/ToolsetRegistry/ToolsetManifestSeed")
```

`Config/DefaultEngine.ini` (set before the first web cook, never during one):

```ini
[/Script/WasmTargetPlatform.WasmTargetSettings]
PageTitle=My Game
StartMode=Click
; optional: a page script staged from <Project>/Build/Wasm/Template/ that turns ?myoption= into game arguments
IntroShellScript=my-shell.js

[/Script/Engine.RendererSettings]
; MetaHuman's required project settings
r.GPUSkin.Support16BitBoneIndex=True
r.GPUSkin.UnlimitedBoneInfluences=True
```

`<Project>/Platforms/Wasm/Config/WasmDeviceProfiles.ini` (web only; Win64 never reads this
folder; `Config/Wasm/WasmDeviceProfiles.ini` is the equivalent location in the config hierarchy). Engine profile
tree: `Wasm` is the parent of `Wasm_Desktop` and `Wasm_Mobile`
(`Engine/Platforms/Wasm/Config/BaseWasmDeviceProfiles.ini`).

```ini
[Wasm DeviceProfile]
+TextureLODGroups=(Group=TEXTUREGROUP_World,MinLODSize=1,MaxLODSize=1024,LODBias=0,MinMagFilter=aniso,MipFilter=point,MipGenSettings=TMGS_SimpleAverage)
+TextureLODGroups=(Group=TEXTUREGROUP_WorldNormalMap,MinLODSize=1,MaxLODSize=512,LODBias=0,MinMagFilter=aniso,MipFilter=point,MipGenSettings=TMGS_SimpleAverage)
+TextureLODGroups=(Group=TEXTUREGROUP_WorldSpecular,MinLODSize=1,MaxLODSize=1024,LODBias=0,MinMagFilter=aniso,MipFilter=point,MipGenSettings=TMGS_SimpleAverage)
+TextureLODGroups=(Group=TEXTUREGROUP_Character,MinLODSize=1,MaxLODSize=1024,LODBias=0,MinMagFilter=aniso,MipFilter=point,MipGenSettings=TMGS_SimpleAverage)
+TextureLODGroups=(Group=TEXTUREGROUP_CharacterNormalMap,MinLODSize=1,MaxLODSize=1024,LODBias=0,MinMagFilter=aniso,MipFilter=point,MipGenSettings=TMGS_SimpleAverage)
+TextureLODGroups=(Group=TEXTUREGROUP_CharacterSpecular,MinLODSize=1,MaxLODSize=1024,LODBias=0,MinMagFilter=aniso,MipFilter=point,MipGenSettings=TMGS_SimpleAverage)
+CVars=r.Streaming.MaxEffectiveScreenSize=1080
+CVars=r.Streaming.MipBias=0
+CVars=r.Streaming.LimitPoolSizeToVRAM=1
; card hair only; NOT r.HairStrands.Enable=0, which turns off strands, cards and meshes alike
+CVars=r.HairStrands.Strands=0
+CVars=r.HairStrands.Simulation=0

[Wasm_Mobile DeviceProfile]
+CVars=r.Streaming.MaxEffectiveScreenSize=720
; already the engine default for Wasm_Mobile, restated so it is not lost
+CVars=r.VT.PoolSizeScale=0.5
```

Per-asset cap for virtual textures (editor Python). This changes the asset for **every**
platform, so pick textures whose full size no platform needs (body skin under clothes):

```python
import unreal
for path in unreal.EditorAssetLibrary.list_assets('/Game/<Project>/Characters', recursive=True):
    name = path.rsplit('/', 1)[-1]
    if name.startswith('T_Body_'):                          # your own filter
        tex = unreal.load_asset(path)
        tex.set_editor_property('max_texture_size', 1024)   # leave virtual_texture_streaming alone
        unreal.EditorAssetLibrary.save_loaded_asset(tex)
```

## 3. Code that worked

Exposure lift when Lumen is not running (game mode, first thing in `StartPlay`):

```cpp
// r.ExposureOffset is ECVF_Cheat: ini and console cannot set it in Shipping, code can.
if (UWorld* World = GetWorld(); World && !GIsEditor)
{
    IConsoleManager& Console = IConsoleManager::Get();
    const IConsoleVariable* GI = Console.FindConsoleVariable(TEXT("r.DynamicGlobalIlluminationMethod"));
    const bool bLumen = World->GetFeatureLevel() >= ERHIFeatureLevel::SM5 && (GI ? GI->GetInt() : 1) == 1;
    IConsoleVariable* Offset = Console.FindConsoleVariable(TEXT("r.ExposureOffset"));
    if (!bLumen && Offset && Offset->GetFloat() == 0.f)          // only from 0: a level reload must not stack it
    {
        Offset->Set(TEXT("1.5"), ECVF_SetByCode);                 // tuned by eye in a Development web build; 2.0 read flat
    }
}
```

Sequence end test (the web reported one not-playing frame mid-sequence):

```cpp
if (Player->IsPlaying()) { bSeenPlaying = true; StoppedSeconds = 0.f; }
else if (bSeenPlaying)
{
    StoppedSeconds += DeltaTime;
    // UMovieSceneSequencePlayer::GetCurrentTime / GetEndTime return FQualifiedFrameTime
    const double Now = Player->GetCurrentTime().AsSeconds(), End = Player->GetEndTime().AsSeconds();
    if (Now >= End - 0.1 || StoppedSeconds > 1.5f) { bDone = true; }   // never on the first not-playing tick
}
```

Hide Quit in a browser tab:

```cpp
const bool bIsWeb = FCString::Strcmp(ANSI_TO_TCHAR(FPlatformProperties::IniPlatformName()), TEXT("Wasm")) == 0;
```

A project fixture file for Epic's harness (`webrun.py run --fixtures <file> --fixture play`):
one click for the audio gesture one second after READY, then page screenshots.

```json
{ "fixtures": { "play": {
    "args": "-log {harness} {time_origin} {frame_log} {marker_log} -dpcvars=t.MaxFPS=60",
    "stop_after_ready": 80, "stop_after": 0, "timeout": 400,
    "page": ["--input-anchor", "READY", "--input", "1:click=960,540;8:shot=s08;16:shot=s16;32:shot=s32"],
    "expect": { "ready": true }, "frames": false, "net": "300mbit" } } }
```

Read `result.json`: `pass`, `markers_s.ready`, `bytes.before_ready`, `bytes.total`,
`tier.ran` (empty on Shipping), `counters.webgpu_errors`.

## 4. Failure log, in the order it happened

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | UBT exit 6, `Sdk: not found. Required version 6.0.10` | emsdk cloned, nothing installed | `emsdk install 6.0.10`, `emsdk activate 6.0.10` |
| 2 | Cook exit 25 `Error_UnknownCookFailure`, `Failed to cook /ToolsetRegistry/ToolsetManifestSeed/_Generated_/...` | the registry plugin makes packages in memory at cook start; `PlatformDenyList` does not stop that | never-cook that sub-folder |
| 3 | Cook ensure `Registered the path /ToolsetRegistry/ for two different domains: Plugin:ToolsetRegistry and Never Cooked Content` | a plugin root listed as never-cook | list a sub-folder, never the root |
| 4 | Package builds, every load aborts: `Failed to find shader map for default material DefaultDeferredDecalMaterial` | `DefaultEngine.ini` changed 40 s into the cook | package again; nothing writes ini during a cook |
| 5 | UBT treats a word of the page title as a target | `-ini:` override with a space on the UAT line | title in `DefaultEngine.ini` |
| 6 | Archive lands under the engine folder | relative `-archivedirectory` | make it absolute |
| 7 | Shipping stage: cutscene shows an empty set, a screen stays grey | sequences and tables loaded by path string were not cooked | `DirectoriesToAlwaysCook` for those folders |
| 8 | Web far darker than PIE | no Lumen on the mobile tiers | exposure offset from code (section 3), fill lights |
| 9 | Windows Shipping build raised a firewall prompt | `AppleARKitFaceSupport` reads `bEnableLiveLinkForFaceTracking` (true in `BaseEngine.ini`) and opened a UDP listener (port 11111) | `[/Script/AppleARKit.AppleARKitSettings] bEnableLiveLinkForFaceTracking=False` in `DefaultEngine.ini` (see `ue-metahuman-runtime`) |
| 10 | Skin wet, teeth a white band on the web | MetaHuman materials on the mobile path | run-time material overrides (see `ue-metahuman-runtime`) |
| 11 | Development build asserts at boot; Shipping boots with dead Animation Blueprints | text-to-motion plugins enabled during the cook added an Anim BP extension the Wasm runtime lacks | plugins disabled before any cook |
| 12 | A 21 s scene ended at 14 s, web only | scene ended on the first not-playing tick of its sequence player | end at end time or after 1.5 s stopped |
| 13 | A package failed after assets were created mid-cook | the cook's asset scan missed them | no asset writes during a cook |
| 14 | Windows container 1.2 GB | 556 MB of footage tracker models and 103 MB of denoiser models cooked | never-cook `/MetaHuman/GenericTracker` |

Other notes: an editor-only StateTree task member broke the Game, Shipping and Wasm targets
until it sat inside `#if WITH_EDITORONLY_DATA`. Scene-flow log lines were raised to `Display` so
a Development page's console showed them.

## 5. Planned, never applied (unverified)

- Per-character chunks (`bGenerateChunks=True` plus one Primary Asset Label per character
  folder) so only the current scene's content downloads before READY.
- Cook-time skeletal LOD stripping (`r.SkeletalMesh.StripMinLodDataDuringCooking=1` with a
  per-platform MinLOD). The characters had only 3 body/face LODs and 7.8 MB of mesh in all, so
  it was dropped.
- `r.SkeletalMesh.LODBias=2` on the web: rejected, it would put every face on its last LOD in close-ups.
- A baked-lighting pass instead of the exposure offset.
