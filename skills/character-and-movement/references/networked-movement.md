# Networked character movement — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the CMC prediction loop,
`FSavedMove_Character`, custom move flags, network smoothing, and a comparison
with the experimental Mover plugin replication model. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/GameFramework/CharacterMovementComponent.h`
and `Character.h`).

## How CMC prediction works

CMC implements `INetworkPredictionInterface` (`CMC.h:135`). Every tick on the
**autonomous proxy** (locally controlled client):

1. `TickComponent` gathers input and calls `ReplicateMoveToServer`.
2. `ReplicateMoveToServer` calls `PerformMovement` (`CMC.h:2252`) locally,
   saves the result into a `FSavedMove_Character` (`CMC.h:2912`), then sends
   the move to the server via `ServerMovePacked` RPC (`Character.h:280`).
3. The **server** receives the RPC, runs `PerformMovement` with the same input,
   and compares its resulting position to the client's reported position.
4. If the positions agree within tolerance, the server acknowledges. If not, it
   sends a correction (`ClientMoveResponsePacked` `Character.h:289`).
5. On correction, the **client** calls `ClientUpdatePosition`, replays all
   unacknowledged saved moves from the saved-moves buffer, and re-simulates
   forward from the correction point.

**Simulated proxies** receive replicated position/velocity/movement-mode updates
and use `NetworkMaxSmoothUpdateDistance` (`CMC.h:838`) to decide whether to
interpolate (smooth) or teleport (snap) to the replicated state. Reduce this
threshold to snap more aggressively; increase it to smooth jitter over longer
distances.

## FSavedMove_Character — extending prediction

To include custom state in the prediction loop, subclass both
`FSavedMove_Character` and `FNetworkPredictionData_Client_Character`.

```cpp
// Step 1: Extend FSavedMove_Character to save your extra state
class FSavedMove_My : public FSavedMove_Character
{
public:
    // Store custom flag (e.g. sprinting)
    uint8 bSavedIsSprinting : 1;

    virtual void Clear() override
    {
        Super::Clear();
        bSavedIsSprinting = 0;
    }

    virtual uint8 GetCompressedFlags() const override
    {
        uint8 Result = Super::GetCompressedFlags();
        if (bSavedIsSprinting) Result |= FLAG_Custom_0;
        return Result;
    }

    virtual bool CanCombineWith(const FSavedMovePtr& NewMove,
                                 ACharacter* Char, float MaxDelta) const override
    {
        const FSavedMove_My* Other = static_cast<const FSavedMove_My*>(NewMove.Get());
        if (bSavedIsSprinting != Other->bSavedIsSprinting) return false;
        return Super::CanCombineWith(NewMove, Char, MaxDelta);
    }

    virtual void SetMoveFor(ACharacter* Char, float DeltaTime,
                             FVector const& NewAccel,
                             FNetworkPredictionData_Client_Character& ClientData) override
    {
        Super::SetMoveFor(Char, DeltaTime, NewAccel, ClientData);
        // Read current sprint intent from character
        UMyMovementComponent* MC =
            Cast<UMyMovementComponent>(Char->GetCharacterMovement());
        bSavedIsSprinting = MC ? MC->bWantsToSprint : false;
    }

    virtual void PrepMoveFor(ACharacter* Char) override
    {
        Super::PrepMoveFor(Char);
        UMyMovementComponent* MC =
            Cast<UMyMovementComponent>(Char->GetCharacterMovement());
        if (MC) MC->bWantsToSprint = bSavedIsSprinting;
    }
};
```

```cpp
// Step 2: Return your custom data class from CMC override
class FNetworkPredictionData_Client_My
    : public FNetworkPredictionData_Client_Character
{
public:
    FNetworkPredictionData_Client_My(const UCharacterMovementComponent& CMC)
        : FNetworkPredictionData_Client_Character(CMC) {}

    virtual FSavedMovePtr AllocateNewMove() override
    {
        return MakeShared<FSavedMove_My>();
    }
};

// In UMyMovementComponent:
FNetworkPredictionData_Client* GetPredictionData_Client() const override
{
    if (!ClientPredictionData)
        ClientPredictionData =
            new FNetworkPredictionData_Client_My(*this);
    return ClientPredictionData;
}
```

On the **server**, `UpdateFromCompressedFlags` reads the compressed byte and
restores intent; override it in your CMC subclass to handle `FLAG_Custom_0`.

## Compressed flags

CMC's default flag bits (see `FSavedMove_Character`):
- `FLAG_JumpPressed` — jump button held this move.
- `FLAG_WantsToCrouch` — crouch button held.
- `FLAG_Reserved_1`, `FLAG_Reserved_2` — reserved by engine.
- `FLAG_Custom_0` – `FLAG_Custom_3` — four free bits for project use.

Map your boolean intents to these bits in `GetCompressedFlags` and read them
back in `UpdateFromCompressedFlags` so the server can reproduce the same state.

## ReplicatedMovementMode

`ACharacter::ReplicatedMovementMode` (`Character.h:593`, `UPROPERTY(Replicated)`,
`uint8`) carries a packed representation of `EMovementMode` and
`CustomMovementMode` down to simulated proxies. It lets them switch their local
physics without receiving an RPC. It is packed/unpacked via
`PackNetworkMovementMode` / `UnpackNetworkMovementMode` (`CMC.h:1283-1284`).

## Network smoothing

When a simulated proxy receives a correction, CMC interpolates the mesh toward
the replicated capsule position over time rather than snapping instantly.
Relevant properties:

| Property | CMC.h line | Effect |
|----------|-----------|--------|
| `NetworkMaxSmoothUpdateDistance` | 838 | Max distance to smooth. Beyond this → teleport. |
| `NetworkSimulatedSmoothLocationTime` | (see header) | Seconds to smooth location corrections. |
| `NetworkSimulatedSmoothRotationTime` | (see header) | Seconds to smooth rotation corrections. |

To disable smoothing (e.g. for fast-paced shooters): set
`NetworkMaxSmoothUpdateDistance = 0`.

## Mover vs CMC — replication model comparison

| Aspect | CMC | Mover (experimental) |
|--------|-----|----------------------|
| Who drives move timing | Client RPCs | Server (shared timeline) |
| What client sends | Input + partial state | Inputs only |
| Correction direction | Server → client (state block) | Server broadcasts to all, clients rollback |
| State access | Open — properties directly settable | Guarded — use modes/effects |
| Network library | Built-in RPC system | Network Prediction Plugin or Chaos Networked Physics |
| Production readiness | Battle-tested | Experimental; APIs may change |

The CMC approach gives lower latency for the local player at the cost of
potential disagreements between client and server (corrected by replays).
The Mover approach uses a shared simulation timeline — all participants
simulate the same inputs — which can reduce correction frequency but adds
complexity in input handling.

## Common gotchas

- **Direct `SetActorLocation` on network character** — CMC does not know about
  the change and will snap back on the next reconciliation. Use
  `MoveUpdatedComponent` inside a physics function or `LaunchCharacter` instead.
- **Custom state not in `GetCompressedFlags`** — the server cannot reproduce
  moves that depend on state it never received, causing jitter/corrections.
- **`CanCombineWith` returning true when state differs** — CMC combines
  successive identical moves to reduce bandwidth; if your custom state differs
  between moves and you return `true`, you lose that state.
- **High `NetworkMaxSmoothUpdateDistance`** — simulated proxies appear to glide
  through walls as their mesh lags behind capsule corrections.
- **`SetMovementMode` from a non-authority context** — on simulated proxies,
  mode is driven by `ReplicatedMovementMode`; manually calling `SetMovementMode`
  there will be overwritten.

## Version notes

- The prediction RPC pair changed from `ServerMove`/`ClientAdjustPosition` to
  `ServerMovePacked`/`ClientMoveResponsePacked` for bandwidth efficiency. The old
  names are `DEPRECATED_CHARACTER_MOVEMENT_RPC`-marked in 5.7 (`CMC.h:2572`).
  Existing code using the old names still compiles but should migrate.
- Mover's networked physics backend (Chaos) is separate from the Network
  Prediction Plugin backend; choose at plugin configuration time.
