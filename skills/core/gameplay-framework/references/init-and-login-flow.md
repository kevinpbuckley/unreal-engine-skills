# Init and login flow — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Documents the step-by-step server-side sequence from
map load through player login, pawn spawn, and possession, along with seamless travel actor
persistence and common respawn patterns. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/GameFramework/GameModeBase.h`) and the official
[Game Mode and Game State](https://dev.epicgames.com/documentation/unreal-engine/game-mode-and-game-state-in-unreal-engine)
doc.

## Map load and GameMode initialization

When `UGameEngine::LoadMap` completes:
1. The `AGameModeBase` instance is spawned. Its class is resolved by (priority, last wins):
   URL `?game=`, World Settings override, `GlobalDefaultGameMode` in `DefaultEngine.ini`.
2. `AGameModeBase::InitGame(MapName, Options, ErrorMessage)` fires **before** any actor's
   `PreInitializeComponents` — the earliest safe hook for GameMode setup (`GameModeBase.h`:62).
3. `AGameModeBase::InitGameState()` (`GameModeBase.h`:69) spawns the `AGameStateBase` instance
   using `GameStateClass`, then calls `AGameStateBase::PostInitializeComponents`.
4. The world calls `BeginPlay` on all already-loaded actors.
5. `AGameModeBase::StartPlay()` (`GameModeBase.h`:159) triggers `BeginPlay` for deferred actors
   and, for `AGameMode` subclasses, transitions from `EnteringMap` → `WaitingToStart`.

## Player login sequence (server)

When a remote client (or a local player in standalone) joins:

```
PreLogin
  └── Login  ──> creates APlayerController + APlayerState
       └── PostLogin  ──> first safe place for replicated calls
            └── OnPostLogin (protected virtual, replaces deprecated DispatchPostLogin)
                 └── HandleStartingNewPlayer  ──> override to control what happens
                      └── RestartPlayer
                           └── FindPlayerStart / ChoosePlayerStart
                                └── SpawnDefaultPawnAtTransform
                                     └── PC->Possess(Pawn)
                                          └── Controller::OnPossess / Pawn::PossessedBy
```

### PreLogin

`PreLogin(Options, Address, UniqueId, ErrorMessage)` (`GameModeBase.h`:293) is called before
any state is allocated for the player. Set `ErrorMessage` to a non-empty string to reject the
connection. Async variant: `PreLoginAsync` (`GameModeBase.h`:303) — must call `OnComplete` or
the connection will hang.

### Login

`Login(NewPlayer, InRemoteRole, Portal, Options, UniqueId, ErrorMessage)` (`GameModeBase.h`:323)
creates the `APlayerController` via `SpawnPlayerController` and creates the `APlayerState` via
`PlayerStateClass`. Returning null from `Login` (or setting `ErrorMessage`) fails the login.
Avoid heavy game logic here; it runs before the controller is fully net-initialized.

### PostLogin / OnPostLogin

`PostLogin(NewPlayer)` (`GameModeBase.h`:326) is called after the controller is net-initialized.
This is the first place replicated functions on the `PlayerController` can be called safely.

In 5.7 the old `DispatchPostLogin(AController*)` is deprecated (`GameModeBase.h`:329) with a
UE_DEPRECATED(5.6) annotation. Override `OnPostLogin(AController* NewPlayer)` (protected
virtual, `GameModeBase.h`:334) for server-side post-login logic. The Blueprint event
`K2_PostLogin(APlayerController*)` (`GameModeBase.h`:339) fires from the same path for BP overrides.

### HandleStartingNewPlayer

`HandleStartingNewPlayer(PC)` (`GameModeBase.h`:367) is the primary override point for
controlling what happens to new players. It is a `BlueprintNativeEvent`, so override
`HandleStartingNewPlayer_Implementation` in C++. By default it calls `RestartPlayer`.

Override use cases:
- Skip spawning for spectators (`MustSpectate` check, `GameModeBase.h`:371).
- Defer spawning until a lobby countdown completes.
- Spawn a spectator pawn first, then transition to gameplay pawn.

### RestartPlayer and spawn

`RestartPlayer(NewPlayer)` (`GameModeBase.h`:441) is the canonical respawn entry point. It:
1. Calls `PlayerCanRestart(PC)` — a `BlueprintNativeEvent`; return false to block.
2. Calls `FindPlayerStart(Controller, IncomingName)` (`GameModeBase.h`:422), which calls the
   `BlueprintNativeEvent` `ChoosePlayerStart` (`GameModeBase.h`:411) for custom selection.
3. Calls `SpawnDefaultPawnFor(Controller, StartSpot)` → or `SpawnDefaultPawnAtTransform` for
   transform-based spawn (`GameModeBase.h`:467).
4. Calls `PC->Possess(Pawn)`, which internally calls `OnPossess` / `PossessedBy`.
5. Calls `SetPlayerDefaults(Pawn)` (`GameModeBase.h`:478) — override to initialize health,
   ammo, etc. on a freshly spawned/respawned pawn.

For transform-only spawn (no PlayerStart actor): call `RestartPlayerAtTransform(PC, Transform)`
(`GameModeBase.h`:449) directly.

## Seamless travel

Seamless travel (`ServerTravel` with `?listen` or `UWorld::SeamlessTravel`) keeps the server
running while clients transition. The GameMode hooks:

- `GetSeamlessTravelActorList(bToTransition, ActorList)` (`GameModeBase.h`:239) — return actors
  that should persist through the transition (PlayerControllers and their pawns move
  automatically; add game-logic actors here).
- `PostSeamlessTravel()` (`GameModeBase.h`:268) — called on the *new* GameMode after all clients
  have arrived; re-initialize players that carried over.
- `HandleSeamlessTravelPlayer(Controller)` (`GameModeBase.h`:262) — called for each controller
  that arrives after the server; re-run any per-player init that Login/PostLogin did.
- `SwapPlayerControllers(OldPC, NewPC)` (`GameModeBase.h`:248) — called when the new GameMode
  has a different `PlayerControllerClass`; handles replacing the controller instance.

PlayerState instances are preserved through seamless travel: `bFromPreviousLevel`
(`PlayerState.h`:97) is set until the transition completes.

## Common respawn patterns

### Timer-based respawn

```cpp
// In AMyGameMode (server only)
void AMyGameMode::OnPlayerDied(APlayerController* PC)
{
    // Unpossess the dead pawn (or let health component destroy it)
    if (APawn* DeadPawn = PC->GetPawn())
    {
        PC->UnPossess();
        DeadPawn->Destroy();
    }

    // Queue respawn after a delay
    FTimerHandle Handle;
    FTimerDelegate Delegate;
    Delegate.BindUObject(this, &AMyGameMode::RespawnPlayer, PC);
    GetWorldTimerManager().SetTimer(Handle, Delegate, RespawnDelay, false);
}

void AMyGameMode::RespawnPlayer(APlayerController* PC)
{
    RestartPlayer(PC);  // finds a start, spawns, possesses
}
```

### Spectator → gameplay transition

```cpp
void AMyGameMode::HandleStartingNewPlayer_Implementation(APlayerController* NewPlayer)
{
    // Spawn a spectator pawn immediately so the player can fly around
    // while waiting; call RestartPlayer later (e.g. on match start)
    NewPlayer->StartSpectatingOnly();
}

void AMyGameMode::OnMatchStarted()
{
    for (FConstPlayerControllerIterator It = GetWorld()->GetPlayerControllerIterator(); It; ++It)
    {
        APlayerController* PC = It->Get();
        if (PC && PC->IsInState(NAME_Spectating))
        {
            RestartPlayer(PC);
        }
    }
}
```

### Checking server authority before spawning

```cpp
void AMyActor::TryRespawnPlayer(APlayerController* PC)
{
    // Always guard: only the server has a valid GameMode
    if (!HasAuthority()) { return; }

    AMyGameMode* GM = GetWorld()->GetAuthGameMode<AMyGameMode>();
    if (GM)
    {
        GM->RestartPlayer(PC);
    }
}
```

## GameInstance Init and Shutdown

`UGameInstance` lifecycle hooks:
- `Init()` (`GameInstance.h`:217) — called once when the game instance is created (after engine
  init, before the first map loads). Set up cross-session systems, load config, initialize
  subsystems manually if needed.
- `Shutdown()` (`GameInstance.h`:224) — called on clean exit; release resources, flush saves.
- `ReceiveInit` / `ReceiveShutdown` — Blueprint-callable equivalents (UFUNCTION
  BlueprintImplementableEvent).

`OnPawnControllerChangedDelegates` (`GameInstance.h`:191) fires whenever any pawn's controller
is set, making it a lightweight cross-system hook for ability system or analytics integrations
that need to react to possession changes without coupling to individual actors.
