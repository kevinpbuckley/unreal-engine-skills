# Engine module map

Deep-dive companion to [../SKILL.md](../SKILL.md). Grounded in UE 5.7 at
`E:\Program Files\Epic Games\UE_5.7\Engine\Source` (version confirmed via
`Engine\Build\Build.version`: MajorVersion 5, MinorVersion 7, PatchVersion 4).

This reference lists the most frequently needed modules, what they own, and
where their headers live. Use it to resolve "which module do I add to Build.cs?"

---

## Engine\Source layout at a glance

```
Engine\Source\
  Runtime\     — code that runs in shipping games (gameplay, rendering, audio, net, …)
  Editor\      — editor-only code; not available in packaged builds
  Developer\   — build tools, profiling, automation helpers (not shipping code)
  Programs\    — standalone executables (UBT, UHT, UnrealLightmass, …)
  ThirdParty\  — vendored third-party source and headers
```

Plugins live under `Engine\Plugins\` and mirror the same internal layout. A
plugin module is distinguished by an adjacent `*.uplugin` file and appears under
a named subdirectory (e.g. `Engine\Plugins\EnhancedInput\`).

---

## Core Runtime modules (always ship)

| Module | Build.cs name | Header root | Key types |
|---|---|---|---|
| **Core** | `"Core"` | `Runtime\Core\Public\` | `TArray`, `TMap`, `TSet`, `FString`, `FName`, `FVector`, `FQuat`, `FTransform`, `TSharedPtr`, `FDelegateHandle` |
| **CoreUObject** | `"CoreUObject"` | `Runtime\CoreUObject\Public\UObject\` | `UObject`, `UClass`, `UPackage`, `FObjectInitializer`, `TSubclassOf<>` |
| **Engine** | `"Engine"` | `Runtime\Engine\Classes\` + `Runtime\Engine\Public\` | `AActor`, `UActorComponent`, `UWorld`, `UGameInstance`, `UGameEngine`, `AGameModeBase`, `APlayerController`, `APawn`, `ACharacter`, `UKismetSystemLibrary` |
| **GameplayTags** | `"GameplayTags"` | `Runtime\GameplayTags\Classes\` | `FGameplayTag`:44, `FGameplayTagContainer`:250 |
| **SlateCore** | `"SlateCore"` | `Runtime\SlateCore\Public\` | Slate geometry, brush, input, widget base |
| **Slate** | `"Slate"` | `Runtime\Slate\Public\` | Concrete widget types |
| **UMG** | `"UMG"` | `Runtime\UMG\Public\` | `UUserWidget`, `UWidgetComponent`, Blueprint widget bindings |
| **AIModule** | `"AIModule"` | `Runtime\AIModule\Classes\` | `AAIController`, `UBehaviorTreeComponent`, `UBlackboardComponent`, `UEnvQueryManager` |
| **AssetRegistry** | `"AssetRegistry"` | `Runtime\AssetRegistry\Public\` | `IAssetRegistry`, `FAssetData`, `FAssetRegistryModule` |
| **RenderCore** | `"RenderCore"` | `Runtime\RenderCore\Public\` | Render-thread utilities, `FRenderCommandFence` |
| **Renderer** | `"Renderer"` | `Runtime\Renderer\Public\` | `FSceneInterface`, material shaders, mesh draw |
| **Net\Core** | `"NetCore"` | `Runtime\Net\Core\Public\` | `FNetworkGUID`, reliability layer |

### Engine\Classes category layout (under `Runtime\Engine\Classes\`)

| Category folder | Representative headers |
|---|---|
| `GameFramework\` | `Actor.h`, `Character.h`, `GameModeBase.h`, `PlayerController.h`, `Pawn.h`, `GameStateBase.h`, `PlayerState.h`, `GameState.h`, `GameMode.h`, `SaveGame.h`, `SpringArmComponent.h` |
| `Components\` | `ActorComponent.h`, `SceneComponent.h`, `PrimitiveComponent.h`, `StaticMeshComponent.h`, `SkeletalMeshComponent.h`, `CapsuleComponent.h`, `BoxComponent.h`, `SphereComponent.h`, `AudioComponent.h`, `SplineComponent.h`, `TimelineComponent.h` |
| `Engine\` | `World.h`, `EngineTypes.h`, `EngineBaseTypes.h`, `Blueprint.h`, `AssetManager.h`, `Canvas.h` |
| `Camera\` | `CameraComponent.h`, `PlayerCameraManager.h`, `CameraActor.h`, `CameraShakeBase.h` |
| `AI\` | `AISystemBase.h`, `NavigationSystemBase.h`, `NavigationSystemConfig.h` |
| `Animation\` | `AnimInstance.h`, `AnimMontage.h`, `BlendSpace.h`, `AnimSequence.h`, `AnimBlueprint.h` |
| `Kismet\` | `GameplayStatics.h`, `BlueprintFunctionLibrary.h`, `KismetMathLibrary.h`, `KismetSystemLibrary.h` |
| `PhysicsEngine\` | `BodyInstance.h`, `BodySetup.h`, `ConstraintInstance.h` |
| `Sound\` | `SoundBase.h`, `SoundCue.h`, `SoundWave.h`, `AudioSettings.h` |
| `Particles\` | (legacy Cascade emitters) |

---

## Editor-only modules (not available in packaged games)

| Module | Build.cs name | Key types / purpose |
|---|---|---|
| **UnrealEd** | `"UnrealEd"` | `UEditorEngine`, `FEditorDelegates`, import/export pipeline |
| **BlueprintGraph** | `"BlueprintGraph"` | Blueprint compiler, graph nodes |
| **Kismet** | `"Kismet"` | Blueprint editor windows |
| **LevelEditor** | `"LevelEditor"` | Viewport, toolbar, details panel |
| **Blutility** | `"Blutility"` | Editor Utility Widgets and Blueprints |
| **AnimationEditor** | `"AnimationEditor"` | Animation asset editor |
| **ContentBrowser** | `"ContentBrowser"` | Content browser UI and data layer |

Code compiled inside `#if WITH_EDITOR` or `#if WITH_EDITORONLY_DATA` blocks in
Runtime modules is also editor-only and stripped from packaged builds.

---

## Plugin modules (important gameplay plugins)

Plugin modules require the plugin to be enabled in the `.uproject` file. Their
source mirrors the Public/Private/Classes pattern.

| Plugin | Location | Primary module(s) | Key types |
|---|---|---|---|
| **EnhancedInput** | `Engine\Plugins\EnhancedInput\` | `EnhancedInput`, `InputEditor` | `UInputAction`, `UInputMappingContext`, `UEnhancedInputComponent` |
| **GameplayAbilities** | `Engine\Plugins\Runtime\GameplayAbilities\` | `GameplayAbilities`, `GameplayAbilitiesEditor` | `UGameplayAbility`, `UAbilitySystemComponent`, `UAttributeSet`, `UGameplayEffect` |
| **Niagara** | `Engine\Plugins\FX\Niagara\` | `Niagara`, `NiagaraCore`, `NiagaraEditor` | `UNiagaraSystem`, `UNiagaraComponent`, `UNiagaraDataInterface` |
| **AISupport** | `Engine\Plugins\AI\AISupport\` | (EQS editor support) | |
| **ControlRig** | `Engine\Plugins\Animation\ControlRig\` | `ControlRig` | `UControlRig`, Control Rig graph |
| **CommonUI** | `Engine\Plugins\Runtime\CommonUI\` | `CommonUI` | `UCommonActivatableWidget`, routing |
| **PCG** | `Engine\Plugins\PCG\` | `PCG` | Procedural Content Generation graph |

---

## Developer/tooling modules (compile-time only, not shipped)

| Module | Purpose |
|---|---|
| `TargetPlatform` | Platform abstraction for cooking/packaging |
| `CollectionManager` | Asset collection management |
| `FunctionalTesting` | High-level functional test framework |
| `AutomationController` | Remote test orchestration |
| `DirectoryWatcher` | File-system watcher |
| `DesktopPlatform` | Dialog boxes, file browsers for editor |

---

## Programs (standalone tools)

| Program | Source path |
|---|---|
| `UnrealBuildTool` | `Engine\Source\Programs\UnrealBuildTool\` |
| `UnrealHeaderTool` (now part of UBT) | `Engine\Source\Programs\UnrealBuildTool\` |
| `AutomationTool` | `Engine\Source\Programs\AutomationTool\` |
| `UnrealLightmass` | `Engine\Source\Programs\UnrealLightmass\` |

---

## ThirdParty

Vendored external libraries under `Engine\Source\ThirdParty\`. Examples include
PhysX (legacy, replaced by Chaos in UE5), zlib, libcurl, Ogg/Vorbis. Game code
almost never needs to reference ThirdParty directly — use the engine module that
wraps the library instead.

---

## Module → include → Build.cs resolution recipe

1. You need a type, e.g. `FGameplayTag`.
2. Grep the source root for the declaring header:
   `rg -l "struct FGameplayTag"` → `GameplayTagContainer.h` in module `GameplayTags`.
3. The `#include` path is relative to that module's `Public`/`Classes` root:
   `#include "GameplayTagContainer.h"` (it's in `Classes\`, which is a Public root).
4. Add `"GameplayTags"` to `PublicDependencyModuleNames` or
   `PrivateDependencyModuleNames` in your `*.Build.cs`.
5. If the module is a plugin, also enable the plugin in the `.uproject`.

See [../SKILL.md](../SKILL.md) for the full "find a class" workflow and
[finding-apis.md](finding-apis.md) for search strategies.
