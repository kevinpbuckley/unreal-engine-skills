---
name: navigating-engine-source
description: Locate, read, and cite exact Unreal Engine APIs in the on-disk engine source
  instead of guessing. Use when you need a real function signature, class hierarchy,
  UPROPERTY/UFUNCTION specifier, module name, or include path; when verifying that an API
  exists in UE 5.7; when resolving "which module do I add to Build.cs?"; or when an API
  changed between engine versions. Covers the full source tree layout (Runtime/Editor/
  Developer/Plugins), the Public/Private/Classes folder convention, UHT-generated files,
  naming prefixes as navigation hints, IWYU include rules, and repeatable search patterns
  for finding any class, function, or type from first principles.
metadata:
  engine-version: "5.7"
  category: meta
---

# Navigating the Unreal Engine source

The engine's own C++ source is the ground truth for every signature, specifier,
and include path. Before asserting any API detail, **verify it in the source**.
Memory is often a version or two stale.

## When to use this skill

- You need the *exact* signature of a `UFUNCTION`/`UPROPERTY`/virtual override,
  or its specifiers and `meta=(...)` clauses.
- You are unsure whether an API exists, was renamed, or moved in 5.7.
- You need the correct `#include` path or the module name to add to `*.Build.cs`.
- You want to see how Epic structures a class before writing similar code.
- You are resolving a build error ("unresolved external", "identifier not found")
  caused by a missing `#include` or missing `Build.cs` dependency.

## Source tree on this machine

| Version | Root | Notes |
|---|---|---|
| **5.7** (primary) | `E:\Program Files\Epic Games\UE_5.7\Engine` | Binary install; ships full C++ source |
| 5.5.1 | `E:\Repo\Git\UE_5_5_1_Fresh\UnrealEngine\Engine` | Full source build |
| 5.8 | `E:\Repo\UE5-8\Engine` | Full source build (bleeding edge) |

Default to **5.7**. Use the others only to compare signatures across versions.

Confirm the exact version any time:
`E:\Program Files\Epic Games\UE_5.7\Engine\Build\Build.version`
→ MajorVersion 5, MinorVersion 7, PatchVersion 4.

## Source tree organization

`Engine\Source\` has five top-level subdirectories:

| Folder | Purpose | In shipping builds? |
|---|---|---|
| `Runtime\` | Gameplay, rendering, audio, net, core — the most-needed code | Yes |
| `Editor\` | Editor tools (`UnrealEd`, `Kismet`, `BlueprintGraph`, `LevelEditor`) | No |
| `Developer\` | Build tooling, profiling helpers, automation | No |
| `Programs\` | Standalone executables (UBT, `UnrealLightmass`, `AutomationTool`) | No |
| `ThirdParty\` | Vendored external source | Varies |

Plugins (often where newer and optional systems live) are under `Engine\Plugins\`,
organized by category: `AI\`, `Animation\`, `EnhancedInput\`, `FX\` (Niagara),
`Runtime\` (GameplayAbilities, CommonUI, …), `Experimental\`, and more.

**Rule:** an API under `Source\Editor\` or behind `#if WITH_EDITOR` is unavailable
in a packaged game. Verify the path before depending on it.

## Module structure (Public / Private / Classes)

Every module is a folder under `Source\<Tier>\<ModuleName>\` containing:

```
<ModuleName>/
  Classes/              — reflected types (UCLASS/USTRUCT/UENUM headers)
  Public/               — public non-reflected headers
  Private/              — private headers and all *.cpp files
  <ModuleName>.Build.cs — declares the module; lists dependencies
```

The `Engine` module exemplifies all three roots. Its `Classes\` tree has category
subfolders grounded in the 5.7 tree:

- `Runtime\Engine\Classes\GameFramework\` — `Actor.h`, `Character.h`,
  `GameModeBase.h`, `PlayerController.h`, `Pawn.h`, `GameStateBase.h`,
  `PlayerState.h`, `SpringArmComponent.h`, `SaveGame.h`
- `Runtime\Engine\Classes\Components\` — `ActorComponent.h`,
  `SceneComponent.h`, `PrimitiveComponent.h`, `StaticMeshComponent.h`,
  `SkeletalMeshComponent.h`, `CapsuleComponent.h`, `AudioComponent.h`,
  `SplineComponent.h`, `TimelineComponent.h`
- `Runtime\Engine\Classes\Engine\` — `World.h`:917, `EngineTypes.h`,
  `AssetManager.h`, `Canvas.h`
- `Runtime\Engine\Classes\Kismet\` — `GameplayStatics.h`,
  `BlueprintFunctionLibrary.h`, `KismetMathLibrary.h`, `KismetSystemLibrary.h`
- `Runtime\Engine\Classes\Animation\` — `AnimInstance.h`, `AnimMontage.h`
- `Runtime\Engine\Classes\Camera\` — `CameraComponent.h`,
  `PlayerCameraManager.h`

Other key Runtime modules:
- `Runtime\Core\Public\` — `CoreMinimal.h`, `Containers\Array.h`,
  `Containers\Map.h`, `Math\Vector.h`, `Delegates\`
- `Runtime\CoreUObject\Public\UObject\Object.h` — `UObject`:94,
  `CreateDefaultSubobject`:125
- `Runtime\GameplayTags\Classes\GameplayTagContainer.h` — `FGameplayTag`:44,
  `FGameplayTagContainer`:250
- `Runtime\AIModule\Classes\` — `AIController.h`, `BehaviorTree\`,
  `EnvironmentQuery\`, `Perception\`
- `Runtime\UMG\Public\` — `UUserWidget`, `UWidgetComponent`, widget bindings

## Naming prefixes as navigation hints

UHT enforces naming conventions — knowing the prefix tells you what type you have
and roughly where to look:

| Prefix | Kind | Examples |
|---|---|---|
| `A` | Actor (`AActor` subclass) | `ACharacter`, `AGameModeBase`:47, `APlayerController` |
| `U` | UObject (non-actor) | `UActorComponent`, `UStaticMeshComponent`, `UWorld`:917 |
| `F` | Non-UObject struct/class | `FVector`, `FHitResult`, `FGameplayTag`:44 |
| `E` | Enum | `EEndPlayReason`, `ECollisionChannel` |
| `T` | Template class | `TArray`, `TObjectPtr`, `TSubclassOf`, `TWeakObjectPtr` |
| `I` | Interface | `IGameplayTaskOwnerInterface` |
| `G` | Global variable | `GWorld`, `GEngine` |

Prefixes are enforced by UHT — a mismatch is a compile error.

## The *_API macro tells you the module

Every exported symbol carries a `<MODULE>_API` macro. The module name is the
macro prefix, lowercased:

| Macro | Module (`Build.cs` name) |
|---|---|
| `ENGINE_API` | `"Engine"` |
| `CORE_API` | `"Core"` |
| `COREUOBJECT_API` | `"CoreUObject"` |
| `AIMODULE_API` | `"AIModule"` |
| `GAMEPLAYABILITIES_API` | `"GameplayAbilities"` |
| `GAMEPLAYTAGS_API` | `"GameplayTags"` |
| `UMG_API` | `"UMG"` |
| `SLATECORE_API` | `"SlateCore"` |

Confirm by finding `<ModuleName>.Build.cs` under the source folder.

## Repeatable "find X" workflow

### 1. Find a class header

Glob for `**/<ClassName>.h` under the source root, then confirm with Grep:
```
Glob("**/Character.h", path="E:/Program Files/Epic Games/UE_5.7/Engine/Source")
→ Runtime\Engine\Classes\GameFramework\Character.h

Grep("class ACharacter", path="...Character.h")
→ line 241: class ACharacter : public APawn
```

### 2. Find a function signature

Grep within the known file; read a ±10-line window — do not read the whole file:
```
Grep("virtual.*BeginPlay", path="...Actor.h", output_mode="content")
→ line 2128: ENGINE_API virtual void BeginPlay();

Read(path="...Actor.h", offset=2124, limit=15)  // read only the relevant range
```

### 3. Resolve module → include → Build.cs

1. **Find the header**: Glob or Grep for the type across `Engine\Source\`.
2. **Identify the module**: the source folder directly under `Source\<Tier>\`
   that contains the found file. Confirm by locating `<Module>.Build.cs` there.
3. **Write the `#include`**: relative to the module's `Public\`/`Classes\` root,
   e.g. `#include "GameFramework/Actor.h"` (not the absolute path).
4. **Add to Build.cs**: `PublicDependencyModuleNames` if the type appears in your
   public headers; `PrivateDependencyModuleNames` otherwise.

### 4. Plugin APIs

Plugin headers follow the same pattern under `Engine\Plugins\`. Also confirm:
- The plugin is enabled in `.uproject` (the `Plugins` array).
- The module name matches `<Module>.Build.cs` inside `Source\<Module>\`.

Example: `UAbilitySystemComponent` →
`Engine\Plugins\Runtime\GameplayAbilities\Source\GameplayAbilities\Public\AbilitySystemComponent.h`
→ module `"GameplayAbilities"`.

## Reading reflection specifiers

UPROPERTY and UFUNCTION lines directly above a member ARE the API contract.
Read them when you need to reproduce or override behavior:

```
Grep("ReplicatedUsing", path="...Actor.h", output_mode="content")
→ line 317: UPROPERTY(ReplicatedUsing=OnRep_ReplicateMovement, Category=Replication, EditDefaultsOnly)
```

The `meta=(...)` clause carries editor/Blueprint semantics — copy it faithfully
when implementing similar APIs:
```
line 330: UPROPERTY(Replicated, EditAnywhere, BlueprintReadOnly,
              meta=(AllowPrivateAccess="true", DisplayName="Actor Hidden In Game"))
```

`UCLASS(BlueprintType, Blueprintable, config=Engine, MinimalAPI)` (Actor.h:255)
is the canonical example of a full class specifier line.

## The *.generated.h contract

Every reflected header (`UCLASS`, `USTRUCT`, `UENUM`) must:
1. Include its `<ClassName>.generated.h` as the **last** `#include`.
2. Have `GENERATED_BODY()` as the **first** statement in the class body.

Never edit `*.generated.h` — it is produced by Unreal Header Tool (UHT) before
the C++ compiler runs and regenerated on every build. Generated files live under
the module's `Intermediate\` folder, not in `Source\`.

## Verified examples (UE 5.7)

All paths relative to `E:\Program Files\Epic Games\UE_5.7\Engine\Source\`:

**AActor** (`Runtime\Engine\Classes\GameFramework\Actor.h`):
- :255 `UCLASS(BlueprintType, Blueprintable, config=Engine, MinimalAPI)`
- :2128 `ENGINE_API virtual void BeginPlay();`
- :2135 `ENGINE_API virtual void EndPlay(const EEndPlayReason::Type EndPlayReason);`
- :3059 `ENGINE_API virtual void Tick(float DeltaSeconds);`
- :3123 `ENGINE_API virtual void PreInitializeComponents();`
- :3126 `ENGINE_API virtual void PostInitializeComponents();`
- :3448 `virtual void OnConstruction(const FTransform& Transform) {}`
- :3568 `ENGINE_API virtual void Destroyed();`

**ACharacter** (`Runtime\Engine\Classes\GameFramework\Character.h:241`)

**AGameModeBase** (`Runtime\Engine\Classes\GameFramework\GameModeBase.h:47`)

**UWorld** (`Runtime\Engine\Classes\Engine\World.h:917`)

**UObject** (`Runtime\CoreUObject\Public\UObject\Object.h:94`),
`CreateDefaultSubobject`:125

**FGameplayTag** (`Runtime\GameplayTags\Classes\GameplayTagContainer.h:44`),
`FGameplayTagContainer`:250

(Line numbers drift between patch releases — re-Grep to confirm, but paths and
class/function names are stable.)

## Gotchas

- **Editor vs Runtime**: code under `Source\Editor\` or in `WITH_EDITOR` blocks
  is stripped from packaged games. Check before depending on it.
- **Plugin gating**: a plugin API exists only when the plugin is enabled in the
  `.uproject`. If missing, the symbol will not compile.
- **Version skew**: if a signature differs from memory, the source wins. Note the
  difference when producing code or skill content.
- **Never read a whole large header**: `Actor.h` is ~4,500 lines; `World.h`
  exceeds 5,000. Grep first; then Read a focused offset+limit window.
- **`*.generated.h` last, `GENERATED_BODY()` first**: violating either rule
  produces cryptic UHT or compiler errors.
- **IWYU**: include only specific headers you use — not `Engine.h` or
  `UnrealEd.h`. The compiler will warn on monolithic includes.

## References & source material

Engine source (UE 5.7, under `E:\Program Files\Epic Games\UE_5.7\Engine\`):
- Version file: `Build\Build.version` (5.7.4, changelist 51494982).
- Primary source root: `Engine\Source\` → `Runtime\`, `Editor\`, `Developer\`,
  `Programs\`, `ThirdParty\`.
- Plugin root: `Engine\Plugins\` → `AI\`, `Animation\`, `EnhancedInput\`, `FX\`,
  `Runtime\`, `Experimental\`, and more.
- `Runtime\Engine\Classes\GameFramework\Actor.h` — canonical example of a large
  reflected class with all lifecycle hooks.
- `Runtime\Core\Public\CoreMinimal.h` — the ubiquitous minimal include set.
- `Runtime\CoreUObject\Public\UObject\Object.h` — `UObject` base class.

Official docs (UE 5.7, fetched and confirmed):
- Modules overview —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-modules>
- UnrealBuildTool —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-build-tool-in-unreal-engine>
- Unreal Header Tool —
  <https://dev.epicgames.com/documentation/unreal-engine/unreal-header-tool-for-unreal-engine>
- Include What You Use (IWYU) —
  <https://dev.epicgames.com/documentation/unreal-engine/include-what-you-use-iwyu-for-unreal-engine-programming>

Cross-reference sibling skills:
- `module-and-build-system` — full `*.Build.cs` / `*.Target.cs` authoring guide.
- `cpp-fundamentals` — `UCLASS`/`USTRUCT`/`UENUM`/`UPROPERTY`/`UFUNCTION` in depth.
- `coding-standards` — Epic naming conventions and prefix rules.

Deep-dive references in this skill:
- [references/module-map.md](references/module-map.md) — module-by-module table
  of what each module owns, its Build.cs name, and its header root.
- [references/finding-apis.md](references/finding-apis.md) — six repeatable
  workflows for locating any class, function, or type from first principles.
- [references/source-conventions.md](references/source-conventions.md) — naming
  prefixes, the Public/Private/Classes layout, `*.generated.h` mechanics, and
  IWYU include rules.
