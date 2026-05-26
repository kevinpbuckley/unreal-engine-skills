# GameMode and GameState — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `AGameModeBase`/`AGameMode` class
hierarchy, default-class properties, the match-state machine, `AGameStateBase`/`AGameState`
replication, and how to configure a GameMode per-project or per-map. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/GameFramework/GameModeBase.h`,
`GameMode.h`, `GameStateBase.h`, `GameState.h`) and the official
[Game Mode and Game State](https://dev.epicgames.com/documentation/unreal-engine/game-mode-and-game-state-in-unreal-engine)
doc.

## GameMode class hierarchy

```
AInfo (no physical rep, no collision)
└── AGameModeBase    (GameModeBase.h:47) — lean, modern default
    └── AGameMode    (GameMode.h:35)     — adds match-state machine
```

`AInfo` itself derives from `AActor` but strips physical presence (collision, movement). Both
`AGameModeBase` and `AGameMode` carry `notplaceable` and `Transient` in their `UCLASS` macros,
which is why they cannot be placed in a level and do not serialize to disk.

## Default class properties

`AGameModeBase` declares five `TSubclassOf<>` properties used to instantiate the other framework
actors. All five are `EditAnywhere, NoClear, BlueprintReadOnly` so designers can override them
in Blueprint subclasses without recompiling:

| Property | Header line | Spawned actor |
|---|---|---|
| `PlayerControllerClass` | `GameModeBase.h`:96 | `APlayerController` per player |
| `GameStateClass` | `GameModeBase.h`:92 | `AGameStateBase`, one per map |
| `PlayerStateClass` | `GameModeBase.h`:100 | `APlayerState` per connected player |
| `HUDClass` | `GameModeBase.h`:104 | `AHUD` per local player |
| `DefaultPawnClass` | `GameModeBase.h`:108 | `APawn` spawned by `RestartPlayer` |

Set them in the GameMode constructor — Blueprint defaults can still override them in the Details
panel. The `GameSessionClass` property (`GameModeBase.h`:88) controls the `AGameSession`
used for online login verification; rarely overridden in small projects.

## Overridable login/spawn hooks

All hooks are declared on `AGameModeBase` and are C++ virtual or `BlueprintNativeEvent`:

```cpp
// AMyGameMode.h (excerpt)
UCLASS()
class MYGAME_API AMyGameMode : public AGameModeBase
{
    GENERATED_BODY()
protected:
    // Override to filter which pawn class a specific controller gets
    virtual UClass* GetDefaultPawnClassForController_Implementation(
        AController* InController) override;

    // Override to choose a custom spawn point
    virtual AActor* ChoosePlayerStart_Implementation(AController* Player) override;

    // Called at the very end of PostLogin; safe to call replicated functions
    virtual void OnPostLogin(AController* NewPlayer) override;
};
```

`GetDefaultPawnClassForController` is a `BlueprintNativeEvent` (`GameModeBase.h`:84), so the
C++ override is the `_Implementation` suffix variant. `ChoosePlayerStart` is similarly a
`BlueprintNativeEvent` (`GameModeBase.h`:411). `OnPostLogin` is a plain `virtual` protected
member (`GameModeBase.h`:334) — note that `DispatchPostLogin` was deprecated in 5.6
(`GameModeBase.h`:329–330).

## Match-state machine (AGameMode only)

`AGameMode` adds a replicated `FName MatchState` (`GameMode.h`:69) and a state machine that
drives it. Valid states are constants in the `MatchState` namespace (`GameMode.h`:17–26):

| State | Meaning |
|---|---|
| `EnteringMap` | Level loading; actors not yet ticking |
| `WaitingToStart` | Actors tick; players haven't spawned |
| `InProgress` | Main gameplay; `BeginPlay` has been called on all actors |
| `WaitingPostMatch` | Match ended; no new joins |
| `LeavingMap` | Transitioning out |
| `Aborted` | Unrecoverable failure |

Control methods: `StartMatch` (`GameMode.h`:51), `EndMatch` (`GameMode.h`:55),
`AbortMatch` (`GameMode.h`:63), `SetMatchState` (`GameMode.h`:72).
Query methods: `GetMatchState` (`GameMode.h`:43), `IsMatchInProgress` (`GameMode.h`:47),
`HasMatchStarted`/`HasMatchEnded` (`GameModeBase.h`:163/167).

When using `AGameMode`, pair it with `AGameState` (not `AGameStateBase`) so the `MatchState`
field is replicated to clients through `AGameState::MatchState` (`GameState.h`:35) and its
`OnRep_MatchState` callback (`GameState.h`:61).

Override `ReadyToStartMatch` / `ReadyToEndMatch` (declared on `AGameMode` — search `GameMode.h`)
to implement condition-based transitions instead of calling `StartMatch`/`EndMatch` manually.

## AGameStateBase and AGameState

`AGameStateBase` (`GameStateBase.h`:32) replicates to all clients and is the correct place for
global state every machine needs. Key members:

- `PlayerArray: TArray<TObjectPtr<APlayerState>>` (`GameStateBase.h`:55) — maintained on server
  and clients; all `PlayerState` instances are always relevant (no culling).
- `GetServerWorldTimeSeconds()` (`GameStateBase.h`:72) — synchronized server time; use this
  instead of `GetWorld()->GetTimeSeconds()` for cross-machine comparisons.
- `HasBegunPlay()` (`GameStateBase.h`:76) — true after `BeginPlay` ran on all actors.
- `AddPlayerState` / `RemovePlayerState` (`GameStateBase.h`:112/115) — called by GameMode;
  rarely called directly.

`AGameState` extends with `MatchState` (`GameState.h`:35), `ElapsedTime` (`GameState.h`:57),
and `DefaultTimer` (`GameState.h`:68) which fires every second and increments `ElapsedTime`.

### Replicating custom game state

```cpp
// MyGameState.h
UCLASS()
class MYGAME_API AMyGameState : public AGameStateBase
{
    GENERATED_BODY()
public:
    // Replicated to all; read on any machine, write on server only
    UPROPERTY(ReplicatedUsing=OnRep_TeamScore, BlueprintReadOnly, Category=GameState)
    int32 TeamScore = 0;

    UFUNCTION()
    void OnRep_TeamScore();

    virtual void GetLifetimeReplicatedProps(
        TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};
```

Use `ReplicatedUsing=OnRep_X` when clients need to react immediately to the change (update UI,
play sound). Use plain `Replicated` when the value is polled. See `networking-and-replication`.

## Setting the GameMode per-project or per-map

Priority order (last wins):

1. `[/Script/EngineSettings.GameMapsSettings] GlobalDefaultGameMode=...` in `DefaultEngine.ini`.
2. World Settings → **GameMode Override** in the editor (writes per-map override).
3. URL option `?game=MyGameMode` passed on the command line or in `ServerTravel`.

URL and map-prefix aliases can also be configured in `DefaultEngine.ini` under
`GameModeMapPrefixes` / `GameModeClassAliases` for project-wide shorthand names.

## Pausing

`AGameModeBase::SetPause(PC, CanUnpauseDelegate)` (`GameModeBase.h`:176) pauses the game if the
controller has permission. The game unpauses when all registered `CanUnpause` delegates return
true (`ClearPause`, `GameModeBase.h`:184). Only the server should call `SetPause`; clients
request pause via a server RPC on their `APlayerController`.
