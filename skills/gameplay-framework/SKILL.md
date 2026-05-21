---
name: gameplay-framework
description: Implement Unreal's gameplay framework in C++ — GameInstance, GameModeBase/GameMode,
  GameStateBase/GameState, PlayerController, Pawn/Character, PlayerState, and HUD — and how
  they fit together (ownership, possession, spawn flow, network roles). Use when setting up
  game rules, default classes, player possession/spawning, the core gameplay loop, or deciding
  which framework class some logic belongs in.
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Gameplay framework

The gameplay framework is the set of base classes Unreal spawns and wires together to run a
game. Putting logic in the *right* class is the single biggest design decision in UE gameplay
code. This skill maps the classes, their relationships, and the spawn/possession flow.

## When to use this skill

- Setting up a new game's rules, default pawn/controller, or spawn logic.
- Deciding "where does this belong?" (GameMode vs PlayerController vs Pawn vs GameState…).
- Implementing possession, respawn, match state, or persistent-per-player data.
- Configuring default classes in C++ (and via designer-facing Blueprint subclasses).

## The classes and what each is for

| Class (prefix) | Lives where | Owns / responsibility | Network |
|---|---|---|---|
| `UGameInstance` | one per running game, **persists across level loads** | app-lifetime state, subsystems, save slots, session | not replicated |
| `AGameModeBase` / `AGameMode` | **server only** | rules, default classes, login/spawn, match flow | server-authoritative, not on clients |
| `AGameStateBase` / `AGameState` | server + replicated to all | game-wide state visible to everyone (score, match time) | replicated |
| `APlayerController` | one per player (on its owning client + server) | input, player intent, UI, possession | replicated to owner |
| `APlayerState` | one per player, replicated to all | per-player replicated data (name, score, team) | replicated |
| `APawn` / `ACharacter` | the avatar in the world | physical representation, movement | replicated |
| `AHUD` | client only | legacy canvas HUD (prefer UMG for real UI) | local |

Class hierarchy (verified in 5.7 source):
- `AGameModeBase : public AInfo` (`GameFramework/GameModeBase.h:47`); `AGameMode : public AGameModeBase` (`GameMode.h:35`).
- `AGameStateBase : public AInfo` (`GameStateBase.h:32`); `AGameState : public AGameStateBase`.
- `ACharacter : public APawn` (`Character.h:241`); `APawn : public AActor`.
- `APlayerController : public AController`; `APlayerState : public AInfo`.

**Base vs non-base:** `*Base` classes (`AGameModeBase`, `AGameStateBase`) are the lean modern
defaults. The richer `AGameMode`/`AGameState` add match-state machinery (`MatchState`,
`bDelayedStart`, spectators) inherited from UE3-era multiplayer. Start from `*Base` unless you
need match states.

## Ownership / relationship map

```
UGameInstance (persists)
└── UWorld (current level)
    ├── AGameModeBase            (server only — rules & spawning)
    ├── AGameStateBase           (replicated — global state)
    │   └── TArray<APlayerState> (one per connected player)
    └── per player:
        APlayerController ──possesses──> APawn/ACharacter
              │                              └── components (movement, mesh, …)
              └── PlayerState (also referenced by GameState)
```

Key accessors:
- From any actor: `GetWorld()`, `GetGameInstance()` (via world), `AGameStateBase* GetWorld()->GetGameState()`.
- `GetWorld()->GetAuthGameMode()` — **server only**, null on clients.
- Controller ↔ pawn: `AController::GetPawn()`, `APawn::GetController()`.
- `APawn::GetPlayerState()`, `AController::PlayerState`.

## Spawn & possession flow (who creates whom)

On the **server**, when a player joins, `AGameModeBase` drives it:
1. `InitGame` → `PreLogin` → `Login` (creates the `APlayerController`).
2. `PostLogin(PC)` → game decides spawning.
3. `RestartPlayer(PC)` → `SpawnDefaultPawnFor` (spawns the Pawn at `ChoosePlayerStart`).
4. `PC->Possess(Pawn)` → binds input/movement to the pawn.

Override points you'll commonly use on `AGameModeBase`:
- `GetDefaultPawnClassForController`, `ChoosePlayerStart`, `SpawnDefaultPawnAtTransform`.
- `PostLogin`, `HandleStartingNewPlayer`, `RestartPlayer`.

## Setting default classes (C++)

```cpp
// MyGameMode.h
UCLASS()
class MYGAME_API AMyGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    AMyGameMode();
};

// MyGameMode.cpp
#include "MyGameMode.h"
#include "MyCharacter.h"
#include "MyPlayerController.h"

AMyGameMode::AMyGameMode()
{
    DefaultPawnClass      = AMyCharacter::StaticClass();
    PlayerControllerClass = AMyPlayerController::StaticClass();
    // GameStateClass / PlayerStateClass / HUDClass set the same way
}
```
Then select the GameMode per-project (Project Settings → Maps & Modes) or per-level
(World Settings → GameMode Override). These map to `DefaultEngine.ini` `[/Script/EngineSettings.GameMapsSettings]`.

## Where does my logic go? (decision guide)

- **Rules, win/lose, who spawns where, scoring authority** → GameMode (server only).
- **State everyone must see (scores, timer, match phase)** → GameState.
- **Per-player replicated facts (name, team, kills)** → PlayerState.
- **Input handling, camera, opening menus, "what this player wants"** → PlayerController.
- **Physical abilities/movement of the avatar** → Pawn/Character (+ components).
- **Cross-level/app-wide (audio settings, save game, current profile)** → GameInstance / a subsystem.

If it must survive a level change → GameInstance or a `UGameInstanceSubsystem`
(see `unreal-subsystems`). If only the server may decide it → GameMode.

## C++ base + Blueprint subclass pattern

The idiomatic setup is a **C++ base class with a thin Blueprint subclass**:
- Put logic, replicated state, and the core API in C++ (`AMyGameMode`, `AMyCharacter`, …).
- Use Blueprint subclasses (`BP_GameMode`, `BP_Character`, …) for designer-tweakable defaults
  and asset references (meshes, input assets, tunable numbers).
- Assign them as defaults in Project Settings → Maps & Modes, or per-level via World Settings
  → GameMode Override (which writes `[/Script/EngineSettings.GameMapsSettings]` in
  `Config/DefaultEngine.ini`). See `blueprint-cpp-integration`.

## Network roles (essential context)

- GameMode exists **only on the server**; never put client logic there.
- GameState/PlayerState are **replicated**: read them on clients, write on the server.
- PlayerController is replicated to its **owning** client only — good place for client RPCs.
- Use `HasAuthority()` / `GetLocalRole() == ROLE_Authority` to branch server vs client.
See `networking-and-replication` for property/RPC mechanics.

## Gotchas

- **Calling `GetAuthGameMode()` on a client** returns null — guard with `HasAuthority()`.
- **Putting persistent state on the Pawn** loses it on death/respawn; use PlayerState/GameInstance.
- **Possession ≠ spawn**: a controller can possess different pawns over time; don't assume 1:1 lifetime.
- **`AGameMode` vs `AGameModeBase` mismatch**: match-state code (`MatchState`) only exists on
  `AGameMode`; don't reference it from a `AGameModeBase` subclass.
- **HUD for modern UI**: `AHUD` is legacy canvas; build real UI with UMG (see `umg-and-slate`).

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/Engine/Classes/`):
- `GameFramework/GameModeBase.h` / `GameMode.h`, `GameStateBase.h` / `GameState.h`
- `GameFramework/PlayerController.h`, `Controller.h`, `Pawn.h`, `Character.h`, `PlayerState.h`, `HUD.h`
- `Engine/GameInstance.h`

Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>

Read the GameModeBase login/spawn methods before overriding them; confirm signatures with
`navigating-unreal-engine-source`.
