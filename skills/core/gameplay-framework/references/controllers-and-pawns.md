# Controllers and Pawns — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `AController` / `APlayerController`
lifecycle, the possession API, what belongs in the controller vs the pawn, the `APawn` vs
`ACharacter` choice, `APlayerState` data design, and `AHUD`. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/GameFramework/Controller.h`,
`PlayerController.h`, `Pawn.h`, `Character.h`, `PlayerState.h`, `HUD.h`).

## AController

`AController` (`Controller.h`:40) is an abstract, `NotBlueprintable` base for both
`APlayerController` and `AAIController`. Key design points:

- Non-physical: no mesh, no collision, no transform that matters for gameplay.
- Owns a `TObjectPtr<APawn> Pawn` (`Controller.h`:71, private; accessed via `GetPawn()`:230).
- Owns a `TObjectPtr<APlayerState> PlayerState` (`Controller.h`:50); AI controllers may have a
  PlayerState too (`bIsABot` will be true).
- Broadcasts `OnPossessedPawnChanged` (`Controller.h`:62) on both server and clients whenever
  the possessed pawn changes.

`AController::ControlRotation` drives the viewing/aiming direction; it is separate from the
pawn's actor rotation and is what camera-pitch-input modifies.

## Possession API

`Possess` and `UnPossess` are `virtual final` since UE 4.22 (`Controller.h`:281/285). The
intended override points are:

| Override | When it fires |
|---|---|
| `OnPossess(APawn*)` (`Controller.h`:296) | after the pawn is attached; pawn and PlayerState are valid |
| `OnUnPossess()` (`Controller.h`:303) | before the pawn reference is cleared |
| `APawn::PossessedBy(AController*)` (`Pawn.h`:359) | symmetric, fires on the pawn |
| `APawn::UnPossessed()` (`Pawn.h`:366) | pawn side of unpose |

Blueprint equivalents: `ReceivePossess` / `ReceiveUnPossess` (`Controller.h`:290/300).

```cpp
void AMyController::OnPossess(APawn* InPawn)
{
    Super::OnPossess(InPawn);
    // EnhancedInput setup, ability system wiring, etc. go here
    // InPawn->GetPlayerState<AMyPlayerState>() is valid at this point
}
```

`bCanPossessWithoutAuthority` (`Controller.h`:112) controls whether non-authority instances may
possess (useful in split-screen / local multiplayer edge cases).

## APlayerController responsibilities

`APlayerController` (`PlayerController.h`:260) is the bridge between human input and a pawn. It
persists through the entire play session while pawns come and go.

Owned objects (all accessed through the PC):
- `PlayerCameraManager` (`PlayerController.h`:285) — manages view/FOV/post-process blending.
- `MyHUD` (`PlayerController.h`:278) — the legacy `AHUD` instance; null for AI controllers.
- `Player` (`PlayerController.h`:270) — `ULocalPlayer` (local) or `UNetConnection` (remote).

### Input and UI

```cpp
// Show a cursor for menu interaction; hide for gameplay
SetShowMouseCursor(true);           // PlayerController.h:2134

// Switch input mode — UI-only, game-only, or game+UI
SetInputMode(FInputModeUIOnly());   // PlayerController.h:1644
```

For input binding in 5.7, prefer Enhanced Input (`enhanced-input`) over the legacy
`InputComponent->BindAxis/Action` approach. The PlayerController or Pawn can both hold an
`UInputComponent`; the Pawn's component is deactivated when unpossessed.

### Camera management

The `APlayerCameraManager` is spawned during `PostInitializeComponents` of the PlayerController
via `SpawnPlayerCameraManager` (`PlayerController.h`:1912). It reads the pawn's
`GetActorEyesViewPoint` and blend targets to compute the final view. Override
`CalcCamera` on your pawn/character (inherits from `AActor`) to supply a custom view point.

### Replication scope

PlayerController properties replicate **only to the owning client**. This makes it the right
place for:
- Client RPCs that deliver one-way information to the specific player.
- Server RPCs that deliver player intent (e.g. ability activation requests).
- Per-player camera, HUD, and input state.

## APawn vs ACharacter

| Feature | APawn | ACharacter |
|---|---|---|
| Base class | `AActor` + `INavAgentInterface` | `APawn` |
| Default collision | none (you choose) | `UCapsuleComponent` |
| Movement | `UPawnMovementComponent` (if added) | `UCharacterMovementComponent` (always) |
| Skeleton | none (you choose) | `USkeletalMeshComponent` (always) |
| Network move smoothing | manual | built-in (CMC handles prediction/correction) |
| When to use | vehicles, turrets, abstract agents | bipedal/swimming/flying characters |

`APawn` is the right base when you need full control over the physics representation and
movement. `ACharacter` adds the capsule + skeletal mesh + CMC bundle and the full network
prediction stack. See `character-and-movement` for `UCharacterMovementComponent` detail.

Key pawn accessors:
- `GetMovementComponent()` (`Pawn.h`:55) — returns the first `UPawnMovementComponent`; override
  for type-specific access.
- `GetController()` (`Pawn.h`:249/595) — inline; returns null when not possessed.
- `GetPlayerState<T>()` (`Pawn.h`:182) — convenience template forwarding through the controller.
- `IsLocallyControlled()` — true on the machine that has authority over input.
- `bUseControllerRotationPitch/Yaw/Roll` (`Pawn.h`:62/66/70) — synchronize pawn rotation to
  controller rotation channels.

## APlayerState data design

`APlayerState` is always relevant (never culled) on all clients; keep it lean. Use it for:
- Data every client displays for every player (name, team, score, ping).
- Data that must outlive the pawn (score, flags captured).

Avoid storing large objects, per-frame transient data, or server-only secrets on `PlayerState`.

Built-in replicated fields (all declared with `Replicated`/`ReplicatedUsing` on `PlayerState`):

| Field | Accessor | Header |
|---|---|---|
| `Score` | `GetScore()` / `SetScore()` | `PlayerState.h`:309/315 |
| `PlayerNamePrivate` | `GetPlayerName()` / `SetPlayerName()` | `PlayerState.h`:232/225 |
| `PlayerId` (unique per session) | `GetPlayerId()` | `PlayerState.h` |
| `CompressedPing` | `GetCompressedPing()` | `PlayerState.h` |
| `bIsSpectator` | `IsSpectator()` | `PlayerState.h` |
| `bIsABot` | `IsABot()` | `PlayerState.h` |

Custom replicated state:

```cpp
UCLASS()
class MYGAME_API AMyPlayerState : public APlayerState
{
    GENERATED_BODY()
public:
    UPROPERTY(ReplicatedUsing=OnRep_TeamIndex, BlueprintReadOnly, Category=Player)
    int32 TeamIndex = 0;

    UFUNCTION() void OnRep_TeamIndex();

    virtual void GetLifetimeReplicatedProps(
        TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};
```

### InactivePlayerArray and seamless travel

When a player disconnects, `AGameModeBase` moves their `PlayerState` to
`AGameStateBase::InactivePlayerArray` (managed internally) so it can be matched and restored if
the player reconnects within the idle timeout. During seamless travel, PlayerState instances
carry across the transition; `bFromPreviousLevel` (`PlayerState.h`:97) flags them until the
player fully transitions.

## AHUD

`AHUD` (`HUD.h`:36) is the legacy canvas-based overlay system. Each
`APlayerController` owns one (`PlayerController.h`:278). It draws to a 2D canvas before the
frame is presented. Override `DrawHUD()` (declared on `AHUD`) to issue canvas draw calls.

For any non-trivial UI — menus, health bars, inventory — use UMG (`UUserWidget`) instead.
`AHUD` is still useful for quick debug overlays and for hosting `DrawDebugX` calls that don't
belong in a widget. The `bShowHUD` flag (`HUD.h`:50) toggles all rendering.

Key `AHUD` members:
- `PlayerOwner` (`HUD.h`:42) — back-pointer to the owning `APlayerController`.
- `PostRenderedActors` (`HUD.h`:79) — actors that want a `PostRender` call for world-space
  debug overlays.

See `umg-and-slate` for UMG widget architecture.
