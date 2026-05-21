---
name: navigating-engine-source
description: Locate, read, and cite exact Unreal Engine APIs in the on-disk engine source
  instead of guessing. Use when you need a real function signature, class hierarchy,
  UPROPERTY/UFUNCTION specifier, module name, or include path; when verifying that an API
  exists in UE 5.7; or when an API changed between engine versions. Covers where the source
  lives, how it is organized (Runtime/Editor/Developer/Plugins), and fast search patterns.
metadata:
  engine-version: "5.7"
  category: meta
---

# Navigating the Unreal Engine source

Unreal's own C++ source is the ground truth. Before asserting any signature, include path,
or specifier, **verify it in the source**. Memory is often a version or two stale.

## When to use this skill

- You need the *exact* signature of a UFUNCTION/UPROPERTY/virtual, or its specifiers.
- You're unsure whether an API exists, was renamed, or moved in 5.7.
- You need the correct `#include` path or the module to add to `*.Build.cs`.
- You want to see how Epic implements or uses a class before writing similar code.

## Where the source lives (this machine)

| Version | Root | Notes |
|---|---|---|
| **5.7** (primary) | `E:\Program Files\Epic Games\UE_5.7\Engine` | Binary install; ships full C++ source under `Source/` and `Plugins/` |
| 5.5.1 | `E:\Repo\Git\UE_5_5_1_Fresh\UnrealEngine\Engine` | Full source build |
| 5.8 | `E:\Repo\UE5-8\Engine` | Full source build (bleeding edge) |

Default to **5.7**. Use the others only to compare behavior across versions.

Confirm the active version any time:
`E:\Program Files\Epic Games\UE_5.7\Engine\Build\Build.version` → `MajorVersion`/`MinorVersion`/`PatchVersion`.

## Source tree organization

Under `Engine\Source\`:

- `Runtime/` — runtime modules shipped in games (`Engine`, `Core`, `CoreUObject`,
  `SlateCore`, `UMG`, `GameplayAbilities`, `EnhancedInput`, `NetCore`, …). **Most gameplay
  APIs live here.**
- `Editor/` — editor-only modules (`UnrealEd`, `Kismet`, `BlueprintGraph`, `LevelEditor`).
  Anything here is unavailable in a packaged game.
- `Developer/` — tooling/automation modules.
- `Programs/` — standalone tools (UBT, UHT, etc.).
- `ThirdParty/` — bundled third-party libs.

Plugins (often where newer systems live) are under `Engine\Plugins\` (e.g. `Animation`,
`AI`, `Niagara`, `Runtime`, `Experimental`). Game/engine plugin source mirrors the same
`Source/<Module>/{Public,Private,Classes}` layout.

A module's headers are in its `Public/` and `Classes/` folders; implementation in `Private/`.
For the core `Engine` module, gameplay class headers are under
`Runtime\Engine\Classes\<Category>\` (e.g. `GameFramework\Actor.h`).

## Fast search patterns

Use Grep/Glob scoped to a version root. Examples (5.7):

```
# Find a class declaration
rg -n "^class .*\bACharacter\b" "E:/Program Files/Epic Games/UE_5.7/Engine/Source"

# Find a function signature within a header
rg -n "virtual void BeginPlay" ".../Runtime/Engine/Classes/GameFramework/Actor.h"

# Where is a type defined (header)?
**/<TypeName>.h        # via Glob, then read

# What module exposes a symbol? Look for the *_API macro and the module's Build.cs
rg -n "ENGINE_API .*FunctionName"
```

Resolve the **module → include → Build.cs** chain:
1. Find the header (e.g. `GameFramework/Actor.h` in module `Engine`).
2. The `#include` you write is relative to the module's `Public`/`Classes` root
   (e.g. `#include "GameFramework/Actor.h"`).
3. Add the module to `PublicDependencyModuleNames`/`PrivateDependencyModuleNames` in your
   `*.Build.cs` (here: `"Engine"`). Find the module name from the folder under `Source/`
   that contains a `<Module>.Build.cs`.

## Reading API surface efficiently

- Headers can be thousands of lines. Grep for the symbol first, then read a focused range
  around the match — don't read whole files.
- The `*_API` prefix (e.g. `ENGINE_API`, `GAMEPLAYABILITIES_API`) marks the exported symbol
  and tells you the owning module's macro.
- `UFUNCTION(...)`/`UPROPERTY(...)` lines directly above a member are the reflection
  specifiers an agent must reproduce to expose things to Blueprints/replication.
- `meta=(...)` clauses carry editor/Blueprint behavior; copy them faithfully when relevant.

## Verified examples (UE 5.7)

- `Runtime/Engine/Classes/GameFramework/Actor.h`
  - `:2128 ENGINE_API virtual void BeginPlay();`
  - `:2135 ENGINE_API virtual void EndPlay(const EEndPlayReason::Type EndPlayReason);`
  - `:3059 ENGINE_API virtual void Tick(float DeltaSeconds);`
  - `:3126 ENGINE_API virtual void PostInitializeComponents();`
- `Runtime/Engine/Classes/GameFramework/GameModeBase.h:47 class AGameModeBase : public AInfo`
- `Runtime/Engine/Classes/GameFramework/Character.h:241 class ACharacter : public APawn`

(Line numbers drift between patch releases — confirm by reading, but the paths/classes are stable.)

## Gotchas

- **Editor vs runtime:** code under `Source/Editor/...` or in `WITH_EDITOR` blocks cannot be
  called from packaged-game code. Check before depending on it.
- **Plugin gating:** an API may exist only when its plugin is enabled in the `.uproject`.
- **Version skew:** if a signature differs from memory, the source wins. Note the difference
  in the skill/code you produce.
- **Don't confuse `Classes/` headers with generated `*.generated.h`** — never edit generated files.

## References & source material

This skill *is* about source material. The roots to read (this machine):
- UE 5.7 (primary): `E:\Program Files\Epic Games\UE_5.7\Engine\Source` and `...\Engine\Plugins`.
- Cross-version: `E:\Repo\Git\UE_5_5_1_Fresh\UnrealEngine\Engine` (5.5.1), `E:\Repo\UE5-8\Engine` (5.8).
- Version file: `Engine\Build\Build.version`.

Official docs (UE 5.7): documentation index —
<https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-7-documentation>
