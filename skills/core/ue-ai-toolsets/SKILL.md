---
name: ue-ai-toolsets
description: >
  The UE 5.9 AI toolset system - the ToolsetRegistry plugin, Epic's engine toolsets
  (EditorToolset, SlateInspectorToolset, AutomationTestToolset and about 40 more), the editor's built-in MCP server (Unreal MCP, ModelContextProtocol plugin,
  list_toolsets / describe_tools / call_tool), and agent skills (UAgentSkill classes and
  Markdown SKILL.md roots served by AgentSkillToolset ListSkills / GetSkills). Covers tool
  naming, writing your own toolset in C++ (UToolsetDefinition, meta=(AICallable),
  AIAccessMode, AIIgnore, AIRuntimeCallable, RegisterToolsetClass) or Python
  (unreal.ToolsetDefinition, toolset_registry.tool_call, Registration), shipping a skill
  folder, block/allow filters, and keeping the AI plugins out of game and Wasm cooks. Use when
  an agent talks to the editor over MCP, when adding project tools or skills,
  on "Toolset ... not found", "ToolsetIsNotRegistered", "is not AICallable", a cook that fails
  on /ToolsetRegistry/ToolsetManifestSeed, or a SKILL.md that does not show up in ListSkills.
metadata:
  engine-version: "5.9"
  category: tooling
  aliases: "AI toolsets, ToolsetRegistry, Unreal MCP, MCP server, Model Context Protocol, AICallable, agent skills, SKILL.md, AgentSkill, Unreal Assistant, AIAssistant, call_tool, execute_python"
---

# The UE 5.9 AI toolset system

UE 5.9 ships an experimental, engine-level way for AI agents to act on the editor: **toolsets** (classes whose
marked functions become tools with a JSON schema), a **registry** that names, filters and dispatches them, an
**MCP server** in the editor that exposes the registry to any MCP client, and **agent skills** (instructions the
agent loads on demand). Everything below was read in the 5.9 source; it is all `Experimental` and may change.

## When to use this skill

- An agent (Claude Code, Codex, Cursor, the in-editor Unreal Assistant) talks to a 5.9 editor over MCP and you
  need to know how tools are named, found, filtered and called.
- You want to give agents project-specific tools (C++ or Python) or project-specific instructions (skills).
- A tool or skill does not appear, a toolset name is "not found", or a cook fails on a toolset package.
- You are deciding which AI plugins may be enabled in a project that also ships a game (Win64, Wasm).

## Mental model

| Piece | Where (5.9) | What it is |
|---|---|---|
| ToolsetRegistry | `Engine/Plugins/Experimental/ToolsetRegistry` | Registry, schema baking, dispatch, `AgentSkillToolset`, Markdown skill loader, Python package `toolset_registry` |
| Engine toolsets | `Engine/Plugins/Experimental/Toolsets/<Name>` | One plugin per area (EditorToolset, BlueprintToolsets, SceneCaptureToolset, SlateInspectorToolset, WidgetFinder, InputToolset, ConsoleToolset, AutomationTestToolset, StateTreeToolset, NiagaraToolsets, PCGToolset, MetaSoundToolset, AnimationAssistantToolset, MetaHuman* toolsets, ...). `AllToolsets` and `AllMetaHumanToolsets` are meta-plugins that enable a whole set |
| Unreal MCP | `Engine/Plugins/Experimental/ModelContextProtocol` | HTTP MCP server inside the editor; default port 8000, path `/mcp` |
| Unreal Assistant | `Engine/Plugins/Experimental/AIAssistant` | Epic's in-editor chat agent, a consumer of the same registry |
| Engine agent tools | `Engine/Extras/AgentTools` | Scripts and Markdown skills for agents working *outside* the editor (build diagnosis, headless runs, log triage, size trimming) plus `ProjectTemplate/AGENTS.md` |

A **tool** is one function; its full name is `<ToolsetName>.<ToolName>`. A **toolset name** is derived from the
class (`FFunctionLibraryToolset::GetToolsetClassName`):

- C++: `<module>.<class name without prefix>`, from the class's `/Script/<Module>` package:
  `EditorToolset.EditorAppToolset`, `GameplayTagsToolset.GameplayTagsToolset`,
  `AutomationTestToolset.AutomationTestToolset`, `ToolsetRegistry.AgentSkillToolset`.
- Python: the dotted module path under the plugin's `Content/Python` plus the class:
  `editor_toolset.toolsets.python_scripting.PythonScriptingTools` (whose tool is `execute_python`).

A bare class name (`AutomationTestToolset`) is not a toolset name: that is the cause of most "not found" errors.

## Calling tools

- **Over MCP.** With `bEnableToolSearch` on (the default), the server's `tools/list` returns only four tools:
  `list_toolsets`, `describe_toolsets`, `describe_tools`, `call_tool`. The client discovers toolsets on demand and
  dispatches with `call_tool(toolset_name, tool_name, arguments)`. Off, every tool is registered natively at start.
  Object arguments over MCP are references (`{"refPath": "/Game/Path/Asset.Asset"}`).
- **From editor Python run by `execute_python`:** `await call_tool("EditorToolset.EditorAppToolset.StartPIE",
  options={...})` (the function is injected into the script and returns the value itself). The full contract of
  `execute_python` (script object shape, fresh namespace, rejected statements, timeouts) is in
  `ue-editor-scripting-and-python` → `references/execute-python-toolset.md`.
- **From any Python in the editor:** `await toolset_registry.execute_tool(toolset_name, tool_name, {...})`.
- **From C++ / Blueprint:** `UToolsetRegistry::ExecuteTool(ToolsetName, ToolName, JsonInput)` returns a
  `UAsyncFunctionResultString`; `GetAllToolsetJsonSchemas()` dumps every schema.
- **Argument names are the tool's own:** C++ tools take the C++ parameter names (camelCase as written, e.g.
  `maxResolution`, `nameFilter`, `skillPaths`); Python tools take the Python parameter names (snake_case). A wrong
  name is rejected with the list of valid ones: read it rather than guess again.
- **Access mode.** Each tool's schema carries `annotations.accessMode` = `read`, `write` or `execute`. Hosts use it
  to decide whether a call needs confirmation. Undeclared means `execute`.

## MCP server settings

`UModelContextProtocolSettings` (Editor Preferences, per user) and `UModelContextProtocolProjectSettings` (Project
Settings, `DefaultGame.ini`):

- `ServerPortNumber` (default 8000), overridden per process with `-ModelContextProtocolPort=N`. Give every extra
  editor (a headless second editor, a test host) its own port or it fights the first one for the listener.
- `bAutoStartServer`, `ServerUrlPath` (default `/mcp`), `AdditionalAllowedOrigins`, `bEnableToolSearch`,
  `bDumpMediaToDisk` (writes every image/audio block sent to `Saved/ModelContextProtocol`).
- **`Instructions`** exists on both classes: user instructions and **project instructions sent to every MCP client
  when it connects**. This is the place for "how agents work in this project" text that must reach every client,
  including a pointer to the skills it should load. Reconnect clients after changing it.

```ini
; Config/DefaultGame.ini - project instructions every MCP client receives on connect (one line)
[/Script/ModelContextProtocol.ModelContextProtocolProjectSettings]
Instructions=Before guessing an Unreal API, call AgentSkillToolset ListSkills and load the matching skill.
```

## Writing a toolset in C++

An editor module in a plugin that depends on `ToolsetRegistry`:

```json
// MyToolset.uplugin (excerpt)
"Modules": [ { "Name": "MyToolset", "Type": "Editor", "LoadingPhase": "PostEngineInit",
               "TargetAllowList": [ "Editor" ] } ],
"Plugins": [ { "Name": "ToolsetRegistry", "Enabled": true } ]
```

```csharp
// MyToolset.Build.cs
PrivateDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "ToolsetRegistry" });
```

```cpp
// MyProjectToolset.h
#include "ToolsetRegistry/ToolsetDefinition.h"
#include "MyProjectToolset.generated.h"

USTRUCT(BlueprintType)
struct FSpawnReport
{
	GENERATED_BODY()
	/** Actors found, as object paths. */
	UPROPERTY(BlueprintReadWrite, Category = "MyProject") TArray<FString> Actors;
};

/** Reads and edits this project's encounter setup. Use for questions about spawn points and waves. */
UCLASS(BlueprintType, Hidden)
class UMyProjectToolset : public UToolsetDefinition
{
	GENERATED_BODY()
public:
	/**
	 * Lists the spawn points in the open level.
	 * @param Tag Only spawn points with this actor tag; empty for all.
	 * @return Object paths of the matching spawn points.
	 */
	UFUNCTION(meta = (AICallable, AIAccessMode = "Read"), Category = "MyProject")
	static FSpawnReport ListSpawnPoints(const FString& Tag);

	/** Helper the reflection system needs but that is not a tool. */
	UFUNCTION(meta = (AIIgnore))
	static void InternalHelper();
};

// Module.cpp
void FMyToolsetModule::StartupModule()  { UToolsetRegistry::RegisterToolsetClass(UMyProjectToolset::StaticClass()); }
void FMyToolsetModule::ShutdownModule() { UToolsetRegistry::UnregisterToolsetClass(UMyProjectToolset::StaticClass()); }
```

Rules the registry enforces (`ToolsetDefinition.h`, `ToolsetDefinition.cpp`):

- Only functions marked `AICallable` (or `AIRuntimeCallable`, which implies it) become tools; unmarked functions are
  ignored. A marked function that cannot be a tool logs `UFunction '...' is not static on a class that does not opt
  into instance dispatch ... and will not be added as a Tool`. Tools are **static** unless the class overrides
  `IToolsetProvider::UsesInstanceDispatch()` or `UsesInstanceArgument()` (then the argument named `instance` names
  the object; a class cannot use both).
- `AIAccessMode = "Read" | "Write" | "Execute"` (case-insensitive); anything else logs a warning and becomes Execute.
- The **class tooltip is the toolset description and each function's doc comment is the tool description**; the
  `@param` lines describe the arguments. Agents choose tools by these texts: write them for an agent.
- Parameters and results go through the toolset JSON converter: use `FString`, numbers, `bool`, enums,
  `TArray`/`TMap`, `BlueprintType` structs and object references. Return a struct with named fields rather than a
  bare `bool` so the agent can read why something failed.
- `GetToolsToHide` / `IsToolsetHidden` (on `IToolsetProvider`) let a toolset withhold tools from a restricted host.

### Tools in a cooked game

Tool metadata is editor-only (`WITH_METADATA`). A toolset that must work in a **cooked** build marks its tools
`AIRuntimeCallable` and its module calls `UToolsetRegistry::EnableCookedRuntimeSupport(PluginName)` at the end of
`StartupModule`. At cook time the `/ToolsetRegistry/ToolsetManifestSeed` asset is split into one baked manifest
per such plugin (`/ToolsetRegistry/ToolsetManifestSeed/_Generated_/<Plugin>`). Python toolsets never work outside
the editor (`FFunctionLibraryToolset::CreateForClass` returns null when `GIsEditor` is false for Python classes).

## Writing a toolset in Python

```python
# <Plugin>/Content/Python/my_tools/toolsets.py
import unreal
import toolset_registry
from toolset_registry.registration import Registration

@unreal.uclass()
class EncounterTools(unreal.ToolsetDefinition):
    """Reads this project's encounter setup. Use for questions about spawn points."""

    @toolset_registry.tool_call(mode=unreal.ToolAccessMode.READ)
    @staticmethod
    def count_spawn_points(tag: str) -> int:
        """Counts spawn points in the open level.

        Args:
            tag: Only actors with this tag; empty for all.

        Returns:
            How many were found.
        """
        world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        actors = unreal.GameplayStatics.get_all_actors_with_tag(world, tag) if tag else []
        return len(actors)

_registration = Registration([EncounterTools])

# <Plugin>/Content/Python/init_unreal.py   (runs at editor start)
#   from my_tools import toolsets
#   toolsets._registration.register()
```

- `tool_call` requires annotations on every parameter and the return; the Google-style docstring becomes the
  tool and argument descriptions. `mode=None` means EXECUTE. Exceptions inside the tool are raised as script errors
  and come back to the agent as the tool's error.
- The toolset name is the module path plus class: `my_tools.toolsets.EncounterTools`.
- Python toolsets register from `init_unreal.py`, i.e. when the Python plugin runs start-up scripts, while C++
  toolsets register in `StartupModule`. In one jam session a Python toolset was "not found" six seconds after an
  editor start and found later, so wait and retry once before renaming anything (observed once, not traced).
- `toolset_registry.reload_module(my_tools)` reloads a package and re-registers its toolsets during development.

## Agent skills

Two kinds, both listed by `ToolsetRegistry.AgentSkillToolset.ListSkills` (`{path: description}`) and loaded by
`GetSkills(skillPaths=[...])` (`{path: {instructions}}`); both tools are `AIRuntimeCallable`, `Read`.

1. **Class skills:** a `UAgentSkill` subclass (Blueprint, or Python with `@toolset_registry.agent_skill.agent_skill`
   and an `instructions` class attribute; the docstring is the description). Path = the class path, e.g.
   `/AnimationAssistantToolset/Python/animation_toolset/skills/sequencer_core_PY.SequencerCoreSkill`. Use these for
   guidance tied to one toolset's tools. `CreateSkill` (into a content folder such as `/Game/Skills/`) and
   `UpdateSkill` write skill assets; their doc comments say to call them only with the user's permission.
2. **Markdown skills (5.9 only):** any `SKILL.md` found recursively under these roots
   (`MarkdownAgentSkills.h`):

| Root | Key |
|---|---|
| `<Plugin>/Skills/...` of every **enabled** plugin | `/Skills/<PluginName>/<sub folders>` |
| `Engine/Platforms/<Platform>/Skills/...` | `/Skills/Platforms/<Platform>/<sub folders>` |
| `Engine/Extras/AgentTools/Skills/<name>` | `/Skills/Engine/<name>` |
| any other `SKILL.md` under `Engine/Extras/AgentTools/` | `/Skills/Engine/AgentTools/<sub folders>` |
| `<Project>/Skills/...` | `/Skills/Project/<sub folders>` |
| a folder added with `MarkdownSkills::AddSearchRoot(Dir, Prefix)` | `/Skills/<Prefix>/<sub folders>` |

What the loader does (`MarkdownAgentSkills.cpp`), and what it means for authors:

- **Frontmatter is read line by line, one `key: value` per line.** Only `name` and `description` are used, one pair
  of surrounding quotes is stripped, and nothing is unescaped. A YAML block scalar (`description: >` with the text
  on the next lines) reaches the agent as the description `>`; a wrapped plain value keeps only its first line.
  **Write `description:` on one line** for in-engine use. No description at all: the first prose line of the body.
- A skill with an empty description is left out of `ListSkills`.
- `GetSkills` returns the body without the frontmatter, prefixed with the file location, and **rewrites relative
  Markdown links** (`[x](references/y.md)`) to absolute paths so the agent can open the pages and scripts beside it.
- Keys are de-duplicated: the first root that yields a key wins (plugins, then platforms, then engine, then project).
- Files are re-read on every call: a new or edited `SKILL.md` shows up without restarting the editor.

Epic's own rule for placement (`Engine/Extras/AgentTools/Skills/README.md`): engine-wide skills in AgentTools,
plugin skills in the plugin's `Skills/`, platform skills under the platform, and "don't create a plugin only to
carry a skill": project-wide guidance goes in `<Project>/Skills/`.

## Filtering what agents see

`UToolsetRegistrySettings` (Project Settings → Toolset Registry, `DefaultGame.ini`,
`[/Script/ToolsetRegistry.ToolsetRegistrySettings]`): `BlockedNames` / `AllowedNames` (shown as
ToolsetBlockedNames / ToolsetAllowedNames) and `AgentSkillBlockedNames` / `AgentSkillAllowedNames`. A pattern in
slashes is a regex (`/^Fake.*/`), anything else a case-insensitive substring; **block wins over allow**. A pattern
that matches a toolset name switches the whole toolset; others filter single tools by full name. Skill filters
apply to class skills and Markdown keys alike. `SetObjectPropertiesBlockedClasses` / `...Properties` stop the
generic property-setting tools from touching listed classes or properties.

## Keeping the AI plugins out of the game

The AI plugins are editor tools. In a project that ships a game:

- In the `.uproject`, give each enabled AI plugin (`AIAssistant`, `AllToolsets`, `AllMetaHumanToolsets`,
  `ToolsetRegistry`, `ModelContextProtocol`, `MCPClientToolset`, single toolset plugins) `"TargetAllowList":
  ["Editor"]`, and for web builds also `"PlatformDenyList": ["Wasm"]`.
- `ToolsetRegistry` still creates the manifest packages under `/ToolsetRegistry/ToolsetManifestSeed` when the cook
  starts; on a platform without the module the cook fails with `It imports class
  /Script/ToolsetRegistry.ToolsetRegistryManifest, which is in a module that is not available on the platform`.
  Add `+DirectoriesToNeverCook=(Path="/ToolsetRegistry/ToolsetManifestSeed")` - a sub folder, never the plugin root.
  Details: `ue-web-wasm-webgpu`.

## Gotchas

- **"Toolset ... not found" / `ToolsetIsNotRegistered`:** a bare class name instead of `<Module>.<Class>`, the
  plugin not enabled, a Python toolset not registered yet, or the toolset filtered by `BlockedNames`.
- **`describe_toolsets` / `describe_tools` return whole schemas.** Describe the one toolset you need.
- **Results are typed structs.** Read the field names from the tool's schema; do not guess `returnValue`,
  `results` or `id`.
- **A SKILL.md that does not appear:** its plugin is disabled, its description is empty, its key collides with an
  earlier root, or `AgentSkillBlockedNames` matches it. A wrapped YAML description shows up truncated.
- **Experimental.** Every plugin here is `IsExperimentalVersion`; re-check names after an engine update.

## References & source material

Engine source (UE 5.9):
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/ToolsetDefinition.h` — `UToolsetDefinition`, AICallable / AIRuntimeCallable / AIAccessMode / AIIgnore rules
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Private/ToolsetRegistry/ToolsetDefinition.cpp` — validation messages
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/ToolAccessMode.h` — `EToolAccessMode`, wire strings
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/UToolsetRegistry.h` — `RegisterToolsetClass`, `EnableCookedRuntimeSupport`, `ExecuteTool`, `GetAllToolsetJsonSchemas`
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Private/ToolsetRegistry/FunctionLibraryToolset.cpp` — `GetToolsetClassName` (toolset naming), Python toolsets need `GIsEditor`
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Private/ToolsetRegistry/ManifestBaker.cpp` — class tooltip as toolset description
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/ToolsetManifestSeed.h` — cook-time manifest packages
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/Toolset.h` — `FToolset`, name filters
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/ToolsetRegistrySettings.h` — block/allow settings
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/AgentSkill.h` — `UAgentSkill`, `UAgentSkillToolset` (`ListSkills`, `GetSkills`, `CreateSkill`, `UpdateSkill`)
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Public/ToolsetRegistry/MarkdownAgentSkills.h` — skill roots and keys
- `Engine/Plugins/Experimental/ToolsetRegistry/Source/ToolsetRegistry/Private/ToolsetRegistry/MarkdownAgentSkills.cpp` — frontmatter parsing, link rewriting, discovery order
- `Engine/Source/Runtime/ToolsetCore/Public/ToolsetCore/ToolsetProvider.h` — `IToolsetProvider` (instance dispatch, hiding tools)
- `Engine/Plugins/Experimental/ModelContextProtocol/Source/ModelContextProtocol/Public/ModelContextProtocolSettings.h` — server and project settings, `Instructions`, `bEnableToolSearch`
- `Engine/Plugins/Experimental/ModelContextProtocol/Source/ModelContextProtocol/Public/ModelContextProtocol.h` — default port 8000, path `/mcp`
- `Engine/Plugins/Experimental/ModelContextProtocol/Source/ModelContextProtocol/Private/ModelContextProtocolSettings.cpp` — `-ModelContextProtocolPort=`
- `Engine/Plugins/Experimental/Toolsets/GameplayTagsToolset/Source/GameplayTagsToolset/Private/GameplayTagsToolset/GameplayTagsToolset.h` — a small C++ toolset to copy
- `Engine/Plugins/Experimental/Toolsets/GameplayTagsToolset/Source/GameplayTagsToolset/Private/GameplayTagsToolset/Module.cpp` — registration in `StartupModule`

Python (not checked by the citation script): `Engine/Plugins/Experimental/ToolsetRegistry/Content/Python/toolset_registry/`
(`__init__.py` `tool_call` / `execute_tool` / `reload_module`, `registration.py`, `agent_skill.py`,
`tests/demo_toolset.py`), and `Engine/Plugins/Experimental/Toolsets/EditorToolset/Content/Python/init_unreal.py`
(registration at start-up). Docs on disk: `Engine/Extras/AgentTools/Skills/README.md`,
`Engine/Extras/AgentTools/ProjectTemplate/AGENTS.md`.

Related skills: `ue-editor-scripting-and-python` (the `execute_python` contract and the `unreal` Python API),
`ue-pie-python` (driving a running game), `ue-web-wasm-webgpu` (AI plugins and the Wasm cook),
`ue-plugins-and-modules` (plugin and module setup).
