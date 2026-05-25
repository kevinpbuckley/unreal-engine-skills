# Movie Render Queue — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers Movie Render Pipeline concepts, scripting
renders via Blueprint/Python/C++, runtime build usage, and render passes. Grounded in UE 5.7
(`Engine/Plugins/MovieScene/MovieRenderPipeline/Source/MovieRenderPipelineCore/Public/`).

## Why MRQ over the legacy Render Movie button

The legacy "Render Movie" path in Sequencer writes frames sequentially in real time with
no temporal accumulation. Movie Render Queue (MRQ) provides:

- **Temporal anti-aliasing accumulation** — multiple sub-frame samples blended per output
  frame for clean motion blur and AA.
- **Warmup frames** — engine state (GI, reflections, temporal effects) can be "warmed up"
  before the first output frame is written.
- **Render pass separation** — beauty, depth, AO, normals, cryptomatte as separate EXR layers.
- **High-quality output formats** — PNG, EXR (16/32 bit), ProRes (on Mac/Linux), WAV audio.
- **CLI / automated rendering** — command-line invocation or Python/Blueprint scripting.

## Core types

| Type | Purpose |
|---|---|
| `UMoviePipelineQueue` | A list of jobs to render |
| `UMoviePipelineExecutorJob` | One sequence + config to render |
| `UMoviePipelinePrimaryConfig` | Render settings (output format, sampling, warmup) |
| `UMoviePipeline` | The runtime object that drives one render job |
| `UMoviePipelineExecutorBase` | Drives a queue — `UMoviePipelineInProcessExecutor` for in-editor |
| `UMoviePipelineQueueSubsystem` | Editor subsystem — the entry point for editor-side scripting |

Headers: `MovieRenderPipelineCore/Public/MoviePipelineQueue.h`,
`MoviePipelineExecutor.h`, `MoviePipelinePrimaryConfig.h`.

## Plugin and module setup

Enable the **Movie Render Queue** plugin in the `.uproject` plugins section.

```
// .Build.cs
PublicDependencyModuleNames.AddRange(new string[]
{
    "MovieRenderPipelineCore",
    "MovieRenderPipelineEditor",  // editor-only scripts only
});
```

## Editor-side scripting (Blueprint / Python)

The `UMoviePipelineQueueSubsystem` (editor-only) is the standard entry point. In Blueprint:

1. `GetEngine()->GetEngineSubsystem<UMoviePipelineQueueSubsystem>()` → `AllocateJob` → set
   sequence asset, primary config.
2. `RenderQueueWithExecutorInstance` with `UMoviePipelineInProcessExecutor`.
3. Bind `OnExecutorFinished` to know when the batch is done.

In Python (via `unreal` module in the editor):

```python
import unreal
queue = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
job.sequence = unreal.SoftObjectPath("/Game/Cinematics/MyCutscene")
job.job_name = "MyCutsceneRender"
# assign a primary config asset:
job.set_configuration(my_primary_config_asset)
executor = queue.render_queue_with_executor(unreal.MoviePipelinePIEExecutor)
```

See the official [Python Scripting in Sequencer](https://dev.epicgames.com/documentation/unreal-engine/python-scripting-in-sequencer-in-unreal-engine) doc for the full API.

## Runtime builds (packaged game)

From UE 5.0+ MRQ can run inside a packaged build, letting players or production pipelines
trigger renders on end-user machines. Required steps:

1. Enable **Movie Render Queue Runtime** (`MovieRenderPipelineRenderPasses`) in the plugin
   list with "Loaded by default" and "Enabled in packaged game".
2. Use `UMoviePipelineInProcessExecutor` (not the editor executor).
3. Create a `UMoviePipelineQueue` asset at runtime via `NewObject<UMoviePipelineQueue>`.
4. Call `UMoviePipeline::Initialize` and drive it via the executor.

Official doc: [Movie Render Queue in Runtime Builds](https://dev.epicgames.com/documentation/unreal-engine/movie-render-queue-in-runtime-in-unreal-engine).

## Render settings

`UMoviePipelinePrimaryConfig` holds a list of `UMoviePipelineSetting` subclasses. Common
settings to add programmatically:

| Setting class | Purpose |
|---|---|
| `UMoviePipelineImageSequenceOutput_PNG` | PNG frame output |
| `UMoviePipelineImageSequenceOutput_EXR` | EXR (multi-layer or single) |
| `UMoviePipelineAntiAliasingSetting` | Sample count, temporal samples, warmup frames |
| `UMoviePipelineHighResSetting` | Tiling for ultra-high resolutions |
| `UMoviePipelineOutputSetting` | Output directory, file-name format, frame range |
| `UMoviePipelineDeferredPassBase` | Base deferred shading pass |

```cpp
// Pseudocode — editor context only (no WITH_EDITOR guard needed in editor module):
UMoviePipelinePrimaryConfig* Config = NewObject<UMoviePipelinePrimaryConfig>();
Config->AddSetting(NewObject<UMoviePipelineAntiAliasingSetting>(Config));
UMoviePipelineOutputSetting* OutSetting =
    Config->FindOrAddSettingByClass<UMoviePipelineOutputSetting>();
OutSetting->OutputDirectory.Path = TEXT("/Game/Renders/");
```

## Movie Render Graph (MRG)

UE 5.4 introduced **Movie Render Graph** as a node-graph successor to the linear MRQ config.
In UE 5.7, MRG is the recommended path for new pipelines. MRQ configs still work and are
auto-converted by the "Transitioning to MRG" workflow. See:

- [Transitioning to Movie Render Graph from Movie Render Queue](
  https://dev.epicgames.com/documentation/unreal-engine/transitioning-to-the-movie-render-graph-from-movie-render-queue-in-unreal-engine)
- [Programming a Render in Movie Render Graph](
  https://dev.epicgames.com/documentation/unreal-engine/programming-a-render-in-mrg-in-unreal-engine)

`UMovieGraphConfig` is the graph asset type; `MoviePipelineQueue.h` references it for the
`UMoviePipelineExecutorShot::ShotGraphPreset` field.

## Render passes

Each pass is a `UMoviePipelineSetting`. Common pass types:

- **Beauty / Base Color / Diffuse** — via `UMoviePipelineDeferredPassBase` subclasses.
- **Depth / Normals** — additional deferred passes.
- **Object ID / Cryptomatte** — for compositing.
- **Audio** — `UMoviePipelineWaveOutput` for sync'd WAV export.

Passes write independent image sequences; compositing software (Nuke, After Effects) reads
EXR channels by name.

## Command-line rendering

```
UnrealEditor-Cmd.exe  MyProject.uproject  -game  -MoviePipelineConfig=/Game/Configs/MyConfig
    -MoviePipelineLocalExecutorClass=/Script/MovieRenderPipelineCore.MoviePipelinePIEExecutor
    -LevelSequence=/Game/Cinematics/MyCutscene  -windowed  -resx=1920  -resy=1080
    -nosplash  -nopause
```

See [Using Command Line Rendering with MRQ](
https://dev.epicgames.com/documentation/unreal-engine/using-command-line-rendering-with-move-render-queue-in-unreal-engine).

## Version notes

- UE 5.4+: Movie Render Graph (`UMovieGraphConfig`) is the successor to `UMoviePipelinePrimaryConfig`.
  Both are supported in 5.7; MRG is preferred for new work.
- `UMoviePipelineQueueSubsystem` is editor-only; never call it in packaged-game code.
- The `MovieRenderPipelineEditor` module (and all `WITH_EDITOR`-gated subsystem code) must not
  be linked from a `Runtime` module.
