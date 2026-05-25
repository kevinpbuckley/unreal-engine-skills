---
name: gameplay-framework
description: Implement Unreal's gameplay framework in C++ — GameInstance, AGameModeBase/AGameMode,
  AGameStateBase/AGameState, APlayerController, APawn/ACharacter, APlayerState, and AHUD —
  including the server-only spawn/login flow, possession, controller-pawn lifecycle, and which
  class each piece of logic belongs in. Use when setting up game rules, default pawn/controller
  classes, player login/spawn/possession, replicated game or player state, match-state machines,
  respawn logic, or deciding "where does this code live?"
metadata:
  engine-version: "5.7"
  category: gameplay-framework
---

# Gameplay framework

The gameplay framework is the set of base classes Unreal spawns and wires together to run a
game. Choosing the *right* class for each piece of logic is the single most important design
decision in UE gameplay code.

## When to use this skill

- Creating a new game mode, game state, player controller, pawn, player state, or HUD class.
- Implementing player login, spawn, respawn, or possession logic.
- Deciding where a piece of state lives (server-only vs replicated vs per-player vs cross-level).
- Setting up default classes in C++ and exposing them to designers via Blueprint subclasses.
- Wiring the spawn/possession flow or implementing a match-state machine.

## The classes and their roles

| Class | Lives where | Core responsibility | Replicated? |
|---|---|---|---|
| `UGameInstance` | one per game, persists across level loads | app-lifetime state, subsystems, online sessions | no |
| `AGameModeBase` | **server only** | rules, default classes, login/spawn flow | no |
| `AGameMode` | **server only** | adds match-state machine on top of Base | no |
| `AGameStateBase` | server + all clients | game-wide visible state (score, timer, match phase) | yes |
| `AGameState` | server + all clients | adds `MatchState` replication to Base | yes |
| `APlayerController` | server + owning client | input, camera, UI, possession bridge | to owner only |
| `APlayerState` | server + all clients | per-player replicated data (name, score, team) | yes |
| `APawn` | server + clients | physical avatar in the world | yes |
| `ACharacter` | server + clients | bipedal pawn with movement, capsule, skeletal mesh | yes |
| `AHUD` | owning client only | legacy canvas overlay (prefer UMG for real UI) | local |

Class hierarchy (verified in 5.7 source):
- `AGameModeBase : public AInfo` (`GameModeBase.h`:47); `AGameMode : public AGameModeBase` (`GameMode.h`:35).
- `AGameStateBase : public AInfo` (`GameStateBase.h`:32); `AGameState : public AGameStateBase` (`GameState.h`:16).
- `APlayerController : public AController` (`PlayerController.h`:260); `AController : public AActor` (`Controller.h`:40).
- `APawn : public AActor` (`Pawn.h`:42); `ACharacter : public APawn` (`Character.h`:241).
- `APlayerState : public AInfo` (`PlayerState.h`:41); `AHUD : public AActor` (`HUD.h`:36).
- `UGameInstance : public UObject, public FExec` (`Engine/GameInstance.h`:151).

**Base vs non-base:** `AGameModeBase` and `AGameStateBase` are the lean modern defaults.
`AGameMode`/`AGameState` add the match-state machine (`MatchState`, `WaitingToStart`,
`InProgress`, `WaitingPostMatch`, …) inherited from UE3-era multiplayer. Start from `*Base`
unless you need match states.

## Ownership and relationship map

```
UGameInstance (persists across levels)
└── UWorld (current level)
    ├── AGameModeBase       (server only — rules and spawning)
    ├── AGameStateBase      (replicated — global visible state)
    │   └── PlayerArray: TArray<APlayerState*>   (one per connected player, replicated)
    └── per player:
        APlayerController ──possesses──> APawn / ACharacter
              │                              └── movement, mesh, collision components
              └── PlayerState  (also in GameState.PlayerArray)
```

Key accessors verified in 5.7 source:
- `GetWorld()->GetGameState<T>()` — replicated on all machines.
- `GetWorld()->GetAuthGameMode<T>()` — **server only**; returns null on clients.
- `GetGameInstance<T>()` — available via any `UObject` with a valid outer chain.
- `AController::GetPawn()` (`Controller.h`:230); `APawn::GetController()` (`Pawn.h`:249).
- `APawn::GetPlayerState<T>()` (`Pawn.h`:182); `AController::PlayerState` (`Controller.h`:50).

## Server spawn and login flow

On the server, `AGameModeBase` drives the sequence when a player joins:

1. `InitGame` (`GameModeBase.h`:62) — called before any actor `PreInitializeComponents`; spawn helper classes here.
2. `PreLogin` (`GameModeBase.h`:293) — reject players by setting `ErrorMessage` before any state is allocated.
3. `Login` (`GameModeBase.h`:323) — creates and returns the `APlayerController`; spawns `APlayerState`.
4. `PostLogin(PC)` (`GameModeBase.h`:326) — first safe place to call replicated functions on the PC.
5. `HandleStartingNewPlayer(PC)` (`GameModeBase.h`:367) — override in Blueprint or C++ to control what happens next.
6. `RestartPlayer(PC)` (`GameModeBase.h`:441) → `FindPlayerStart` → `SpawnDefaultPawnAtTransform` → `PC->Possess(Pawn)`.

Full login flow with seamless travel and `OnPostLogin` details:
[references/init-and-login-flow.md](references/init-and-login-flow.md).

## Possession

`AController::Possess(APawn*)` is `final` in 5.7; override `OnPossess` instead
(`Controller.h`:296). The symmetric unpossess override is `OnUnPossess` (`Controller.h`:303).

```cpp
// Override OnPossess to react to possession — NOT Possess() which is final
void AMyController::OnPossess(APawn* InPawn)
{
    Super::OnPossess(InPawn);
    // Safe to access InPawn here; PlayerState is already assigned
}

// On the pawn side, PossessedBy fires when a controller takes control
void AMyPawn::PossessedBy(AController* NewController)
{
    Super::PossessedBy(NewController);
    // Bind abilities, movement, etc. that depend on the controller
}
```

A controller can possess different pawns over its lifetime (death/respawn, vehicle enter/exit).
Do not store gameplay state on the pawn that must survive across possessions — use `PlayerState`
or `PlayerController` instead.

## Setting default classes in C++

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
#include "MyPlayerState.h"
#include "MyGameState.h"

AMyGameMode::AMyGameMode()
{
    DefaultPawnClass       = AMyCharacter::StaticClass();
    PlayerControllerClass  = AMyPlayerController::StaticClass();
    PlayerStateClass       = AMyPlayerState::StaticClass();
    GameStateClass         = AMyGameState::StaticClass();
    // HUDClass — set if you use legacy AHUD; omit for pure UMG
}
```

These five `TSubclassOf<>` properties are declared on `AGameModeBase` with
`EditAnywhere, NoClear, BlueprintReadOnly` (`GameModeBase.h`:87–108). Assign them in the
constructor so Blueprint subclasses can still override them in Blueprints editor defaults.

Then wire the GameMode per-project (Project Settings → Maps & Modes →
`DefaultGameMode`/`GlobalDefaultGameMode` in `DefaultEngine.ini`
`[/Script/EngineSettings.GameMapsSettings]`), or per-level (World Settings → GameMode Override).

## Where does my logic go? (decision guide)

| Logic | Belongs in |
|---|---|
| Rules, win/lose, who spawns where, scoring authority | `AGameModeBase` — server only |
| State everyone must see (scores, timer, match phase) | `AGameStateBase` / `AGameState` |
| Per-player replicated facts (name, team, kills) | `APlayerState` |
| Input handling, camera, opening menus, player intent | `APlayerController` |
| Physical movement, abilities of the avatar | `APawn` / `ACharacter` + components |
| Cross-level or app-lifetime (save game, audio settings, online session) | `UGameInstance` / a `UGameInstanceSubsystem` |

If it must survive a level load → `UGameInstance` or `UGameInstanceSubsystem`
(see `subsystems`). If only the server may decide it → `AGameModeBase`.

## GameInstance and subsystems

`UGameInstance` is created once on engine launch and destroyed when the application exits,
surviving all level transitions. Override `Init` (`GameInstance.h`:217) and
`Shutdown` (`GameInstance.h`:224) for setup/teardown. Access it from any actor via
`GetGameInstance<UMyGameInstance>()`.

For modular, dependency-isolated systems with the same lifetime:

```cpp
// Subsystem declared as UCLASS(), auto-created by GameInstance
class UMyOnlineSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()
public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
};

// Access from any actor
UMyOnlineSubsystem* Sub = GetGameInstance()->GetSubsystem<UMyOnlineSubsystem>();
```

`GetSubsystem<T>()` is declared on `UGameInstance` (`GameInstance.h`:440). See `subsystems`.

## PlayerState — per-player replicated data

`APlayerState` is created by `Login` and added to `AGameStateBase::PlayerArray`. It replicates
to all clients, making it the correct place for data every machine needs about each player.

```cpp
// MyPlayerState.h
UCLASS()
class MYGAME_API AMyPlayerState : public APlayerState
{
    GENERATED_BODY()
public:
    UPROPERTY(Replicated, BlueprintReadOnly, Category=Player)
    int32 TeamIndex = 0;

    virtual void GetLifetimeReplicatedProps(
        TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};
```

Built-in replicated fields on `APlayerState`: `Score` (getter `GetScore`, setter `SetScore`,
`PlayerState.h`:309/315), `PlayerNamePrivate` (accessed via `GetPlayerName`/`SetPlayerName`,
`PlayerState.h`:232/225), `PlayerId`, `CompressedPing`, `bIsSpectator`, `bIsABot`.

## Network roles

- `AGameModeBase` exists **only on the server**; never put client logic there.
- `AGameStateBase`/`APlayerState` are replicated — read on any machine, only write on server.
- `APlayerController` replicates to its owning client only — good for client RPCs and UI.
- `APawn`/`ACharacter` replicate to all clients; `HasAuthority()` determines who may change state.
- Use `HasAuthority()` or `GetLocalRole() == ROLE_Authority` to branch server vs client.

See `networking-and-replication` for property/RPC mechanics.

## C++ base + Blueprint subclass pattern

The idiomatic setup:
- Put logic, replicated state, and core API in C++ (`AMyGameMode`, `AMyCharacter`, …).
- Expose designer-facing defaults via Blueprint subclasses (`BP_GameMode`, `BP_Character`, …).
- Set the BP subclasses as defaults in Project Settings or World Settings.
- Use `UPROPERTY(EditDefaultsOnly)` for numbers/assets designers should tweak without requiring
  recompile. See `blueprint-cpp-integration`.

## Gotchas

- **`GetAuthGameMode()` on a client** returns null; always guard with `HasAuthority()`.
- **`Possess` is `final`** since UE 4.22; override `OnPossess`/`OnUnPossess` (`Controller.h`:296/303).
- **Persistent state on the Pawn** is lost on death/respawn; use `APlayerState` or `APlayerController`.
- **Possession ≠ spawn**: a controller can possess different pawns over time; don't assume 1:1 lifetime.
- **`AGameMode` vs `AGameModeBase` mismatch**: `MatchState` machinery only exists in `AGameMode`;
  don't reference it from an `AGameModeBase` subclass.
- **`DispatchPostLogin` deprecated in 5.6**: override `OnPostLogin(AController*)` instead
  (`GameModeBase.h`:334 — note the UE_DEPRECATED annotation at :329).
- **HUD for modern UI**: `AHUD` is legacy canvas drawing; build real UI with UMG (see `umg-and-slate`).
- **`APlayerState` outlives the pawn**: the state persists in `GameState.PlayerArray` even when
  the pawn is destroyed; that is by design so scores survive death.
- **GameInstance is not replicated**: the server and each client each have their own independent
  instance. Do not use it as a shared-state store in multiplayer.

## Version notes

- `AGameModeBase` introduced in UE 4.14; older projects may subclass `AGameMode` directly.
- `Possess`/`UnPossess` marked `virtual final` in UE 4.22; use `OnPossess`/`OnUnPossess`.
- `DispatchPostLogin` deprecated in UE 5.6; the replacement is `OnPostLogin` (protected virtual).
- The framework is stable across UE 5.x; line numbers in citations drift between patch releases
  but header paths and class names are stable.

## References & source material

Engine source (UE 5.7, under `Engine/Source/Runtime/Engine/Classes/`):
- `GameFramework/GameModeBase.h` — `AGameModeBase`:47, `InitGame`:62, `InitGameState`:69,
  `DefaultPawnClass`:108, `PlayerControllerClass`:96, `PlayerStateClass`:100, `GameStateClass`:92,
  `HUDClass`:104, `PreLogin`:293, `Login`:323, `PostLogin`:326, `OnPostLogin`:334,
  `HandleStartingNewPlayer`:367, `RestartPlayer`:441, `SpawnDefaultPawnAtTransform`:467,
  `ChoosePlayerStart`:411, `GetDefaultPawnClassForController`:84.
- `GameFramework/GameMode.h` — `AGameMode`:35, `MatchState` namespace:17, `GetMatchState`:43,
  `StartMatch`:51, `EndMatch`:55, `SetMatchState`:72.
- `GameFramework/GameStateBase.h` — `AGameStateBase`:32, `PlayerArray`:55, `GetServerWorldTimeSeconds`:72,
  `HasBegunPlay`:76, `AddPlayerState`:112, `RemovePlayerState`:115.
- `GameFramework/GameState.h` — `AGameState`:16, `MatchState`:35, `ElapsedTime`:57.
- `GameFramework/Controller.h` — `AController`:40, `PlayerState`:50, `GetPawn()`:230,
  `Possess` (final):281, `UnPossess` (final):285, `OnPossess`:296, `OnUnPossess`:303.
- `GameFramework/PlayerController.h` — `APlayerController`:260, `PlayerCameraManager`:285,
  `MyHUD`:278, `SetInputMode`:1644, `SetShowMouseCursor`:2134.
- `GameFramework/Pawn.h` — `APawn`:42, `GetController()`:249, `GetPlayerState<T>()`:182,
  `PossessedBy`:359, `UnPossessed`:366.
- `GameFramework/Character.h` — `ACharacter`:241.
- `GameFramework/PlayerState.h` — `APlayerState`:41, `Score`:48, `GetScore`:309, `SetScore`:315,
  `PlayerNamePrivate`:162, `GetPlayerName`:232, `SetPlayerName`:225.
- `GameFramework/HUD.h` — `AHUD`:36, `PlayerOwner`:42, `bShowHUD`:50.
- `Engine/GameInstance.h` — `UGameInstance`:151, `Init`:217, `Shutdown`:224,
  `GetSubsystem<T>()`:440.

Official docs (UE 5.7, all fetched and confirmed live):
- Gameplay Framework overview —
  <https://dev.epicgames.com/documentation/unreal-engine/gameplay-framework-in-unreal-engine>
- Game Mode and Game State —
  <https://dev.epicgames.com/documentation/unreal-engine/game-mode-and-game-state-in-unreal-engine>
- Player Controllers —
  <https://dev.epicgames.com/documentation/unreal-engine/player-controllers-in-unreal-engine>
- Pawn — <https://dev.epicgames.com/documentation/unreal-engine/pawn-in-unreal-engine>
- Controllers — <https://dev.epicgames.com/documentation/unreal-engine/controllers-in-unreal-engine>
- Gameplay Framework Quick Reference —
  <https://dev.epicgames.com/documentation/unreal-engine/gameplay-framework-quick-reference-in-unreal-engine>

Deep-dive references in this skill:
- [references/gamemode-and-state.md](references/gamemode-and-state.md) — GameMode class
  hierarchy, match-state machine, GameState replication, setting default classes per-map.
- [references/controllers-and-pawns.md](references/controllers-and-pawns.md) — controller
  lifecycle, possession API, PlayerController responsibilities, Pawn vs Character choice,
  PlayerState data design.
- [references/init-and-login-flow.md](references/init-and-login-flow.md) — step-by-step server
  login/spawn sequence, seamless travel, respawn patterns, `HandleStartingNewPlayer` override
  points.

Cross-references: `actors-and-components` (AActor lifecycle), `character-and-movement`
(ACharacter / UCharacterMovementComponent detail), `subsystems` (UGameInstanceSubsystem),
`networking-and-replication` (replication mechanics), `blueprint-cpp-integration`
(exposing C++ to designers).
