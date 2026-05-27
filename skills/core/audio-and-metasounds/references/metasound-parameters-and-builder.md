# MetaSound parameters & Builder API — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers runtime input parameters, output
watching via `UMetasoundGeneratorHandle`, and the MetaSound Builder API for
constructing or modifying graphs at runtime. Grounded in UE 5.7 engine source
under `Engine/Plugins/Runtime/Metasound/`.

## UMetaSoundSource class

`UMetaSoundSource` (declared `MetasoundSource.h`:88) extends `USoundWaveProcedural`
and implements `FMetasoundAssetBase` and `IMetaSoundDocumentInterface`. It contains
a `FMetasoundFrontendDocument` (`RootMetasoundDocument`) that describes the node
graph. At play time, `CreateSoundGenerator` instantiates a
`FMetasoundGenerator` on the audio render thread.

## Runtime input parameters

All parameter writes go through `ISoundParameterControllerInterface`
(`SoundParameterControllerInterface.h`:24), which `UAudioComponent` implements:

| Method | Parameter type | Notes |
|---|---|---|
| `SetFloatParameter(FName, float)` | Float | Continuous value |
| `SetBoolParameter(FName, bool)` | Boolean | Toggle state |
| `SetIntParameter(FName, int32)` | Integer | Discrete index/selector |
| `SetTriggerParameter(FName)` | Trigger | Stateless one-shot pulse |
| `SetWaveParameter(FName, USoundWave*)` | Wave | Swap the wave asset a node plays |
| `SetStringParameter(FName, FString)` | String | Less common; for named variants |
| `SetObjectParameter(FName, UObject*)` | Object | Arbitrary UObject inputs |

All methods are declared `SoundParameterControllerInterface.h`:32–41.

### Rules for parameter correctness

- Input names are **case-sensitive FNames**. An incorrect name produces no
  warning and no effect. Check the MetaSound graph's Input node names carefully.
- `SetTriggerParameter` is stateless — it fires one sample-accurate event in the
  graph then resets. Calling it repeatedly at the same frame is safe.
- Parameters set **before** `Play()` are queued as defaults; parameters set
  **while** playing are forwarded immediately to the active generator.
- If `UAudioComponent::bDisableParameterUpdatesWhilePlaying` is true, parameter
  calls while the sound is playing are dropped. Check this flag if params seem
  ignored.
- The interface supports array variants: `SetFloatArrayParameter`,
  `SetIntArrayParameter`, `SetObjectArrayParameter`, etc. — useful for driving
  multi-element MetaSound nodes.

### Setting multiple params at once

```cpp
TArray<FAudioParameter> Params;
Params.Add(FAudioParameter(TEXT("Speed"),   70.f));
Params.Add(FAudioParameter(TEXT("Surface"), 1));
Params.Add(FAudioParameter(TEXT("Wet"),     true));
AC->SetParameters(MoveTemp(Params));
```

`FAudioParameter` wraps any typed value and carries a `EAudioParameterType` tag.
The array version avoids per-param overhead when updating several inputs at once.

## Reading MetaSound outputs at runtime

MetaSound outputs (declared in the graph as Output nodes with public access) are
readable through `UMetasoundGeneratorHandle`. Obtain a handle while the sound is
playing:

```cpp
UMetaSoundSource* MS = Cast<UMetaSoundSource>(AC->Sound);
if (MS)
{
    TWeakPtr<Metasound::FMetasoundGenerator> GenWeak =
        MS->GetGeneratorForAudioComponent(AC->GetAudioComponentID());

    if (TSharedPtr<Metasound::FMetasoundGenerator> Gen = GenWeak.Pin())
    {
        float OutLevel = 0.f;
        Gen->GetOutputValue(TEXT("VULevel"), OutLevel);
    }
}
```

`GetGeneratorForAudioComponent` (`MetasoundSource.h`:296) returns a weak pointer —
the generator is destroyed when the sound stops. Always `Pin()` and check validity.

The `UMetasoundGeneratorHandle` Blueprint wrapper (`MetasoundGeneratorHandle.h`)
provides a simpler Blueprint-callable interface for the same purpose.

## MetaSound Builder API

The Builder API (`MetasoundBuilderSubsystem.h`) lets gameplay code create or
modify MetaSound graphs at runtime or edit-time without the editor UI. It is a
**Beta** feature as of UE 5.7; do not rely on it for shipped content without
thorough testing.

### Entry point: UMetaSoundBuilderSubsystem

```cpp
// Get the subsystem (Engine subsystem, always available):
UMetaSoundBuilderSubsystem* BuilderSS =
    GEngine->GetEngineSubsystem<UMetaSoundBuilderSubsystem>();
```

### Creating a new MetaSound Source at runtime

```cpp
EMetaSoundBuilderResult Result;
FMetaSoundBuilderNodeInputHandle OnFinishedInput;
FMetaSoundBuilderNodeOutputHandle OnPlayOutput;
FMetaSoundBuilderNodeOutputHandle AudioLeftOutput, AudioRightOutput;

UMetaSoundSourceBuilder* Builder = BuilderSS->CreateSourceBuilder(
    TEXT("MyDynamicSound"),         // base name
    OnFinishedInput,                // out: graph's OnFinished input handle
    OnPlayOutput,                   // out: graph's OnPlay output handle
    AudioLeftOutput,                // out: audio output left
    AudioRightOutput,               // out: audio output right
    Result,
    EMetaSoundOutputAudioFormat::Stereo,
    /*bIsOneShot*/ false);
```

### Adding nodes and connections

```cpp
// Add a WavePlayer node (using its registered native class name):
FMetaSoundNodeHandle WavePlayerNode = Builder->AddNodeByClassName(
    { TEXT("MetaSound"), TEXT("WavePlayer") }, Result);

// Find an input/output pin on the node:
FMetaSoundBuilderNodeInputHandle WaveInput =
    Builder->FindNodeInputByName(WavePlayerNode, TEXT("Wave Asset"), Result);
FMetaSoundBuilderNodeOutputHandle AudioOut =
    Builder->FindNodeOutputByName(WavePlayerNode, TEXT("Audio"), Result);

// Connect WavePlayer audio out → graph audio output left:
Builder->ConnectNodes(AudioOut, AudioLeftOutput, Result);
```

### Auditioning changes live

```cpp
// Play the builder's managed MetaSound on an audio component,
// with live graph updates enabled:
FOnCreateAuditionGeneratorHandleDelegate AuditionDelegate;
Builder->Audition(this, AudioComponent, AuditionDelegate,
    /*bLiveUpdatesEnabled*/ true);
```

Live updates (buffer crossfade support) allow the graph topology to change while
the sound is playing, without pops or clicks. This is a beta feature as of 5.5.

### Adding inputs for runtime parameter control

```cpp
// Add a named float input to the graph:
FMetaSoundBuilderNodeOutputHandle FloatInputNode =
    Builder->AddGraphInputNode(TEXT("RPM"), TEXT("Float"), FAudioParameter(TEXT("RPM"), 0.f), Result);
```

Once a named input is present, use the standard `UAudioComponent::SetFloatParameter`
to drive it at runtime after the sound is playing.

## MetaSound Pages

**MetaSound Pages** (`MetasoundPages` plugin, `MetaSound Pages` doc) allow a
MetaSound graph to have multiple quality tiers selected per platform or device.
Each page overrides a subset of graph parameters or nodes. Pages are authored in
the editor and selected via `UMetaSoundSettings::GetQualityNames()`. In C++ the
active quality page is chosen at `InitResources`/cook time via
`UMetaSoundSource::QualitySetting` (`MetasoundSource.h`:150).

Official doc: <https://dev.epicgames.com/documentation/unreal-engine/metasound-pages-in-unreal-engine>

## Module dependencies

Add to your `*.Build.cs` to use MetaSound APIs:

```csharp
// For runtime parameter control and UMetaSoundSource:
PrivateDependencyModuleNames.AddRange(new string[] {
    "MetasoundEngine",      // UMetaSoundSource, MetasoundSource.h
    "MetasoundFrontend",    // FMetasoundFrontendDocument, builder structs
    "AudioMixer",           // UQuartzSubsystem, FQuartzClockHandle
});

// Public if you expose MetaSound types in your public headers:
// PublicDependencyModuleNames.Add("MetasoundEngine");
```

## Version notes

- The Builder API is Beta as of UE 5.7; API stability is not guaranteed between
  minor releases.
- `OnGeneratorInstanceCreated` and `OnGeneratorInstanceDestroyed` are deprecated
  in UE 5.6 (`MetasoundSource.h`:308–311). Use `OnGeneratorInstanceInfoCreated`
  and `OnGeneratorInstanceInfoDestroyed` instead.
- `UMetaSoundSource::EnableSubmixSendsOnPreview` is deprecated in UE 5.7
  (`MetasoundSource.h`:287).
- MetaSound Pages (`MetasoundPages` plugin) reached general availability in UE 5.4.
- Output watching via `GetGeneratorForAudioComponent` was available from UE 5.0;
  the `UMetasoundGeneratorHandle` Blueprint wrapper was formalized in 5.4.
