# Remote procedure calls — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers all RPC types, the execution matrix, reliability,
`WithValidation`, parameter types, Blueprint RPCs, and the `Remote` RPC type. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/GameFramework/Actor.h`) and the official
[Remote Procedure Calls](https://dev.epicgames.com/documentation/unreal-engine/remote-procedure-calls-in-unreal-engine)
doc.

## RPC types

| UFUNCTION specifier | Calling machine | Executes on |
|---|---|---|
| `Server` | Client (that owns actor) | Server |
| `Client` | Server | Owning client |
| `NetMulticast` | Server (or client, but local-only if called from client) | Server + all relevant clients |
| `Remote` | Client (that owns actor) or server | The *other* side only |

`Remote` is less common: it behaves like `Server` when called from a client and like `Client`
when called from the server. It is not exposed to Blueprints.

## Declaration pattern

```cpp
// Header — declare the callable name only. UHT generates the dispatch thunk.
UFUNCTION(Server, Reliable, WithValidation)
void ServerRequestPickup(AActor* TargetActor);

// Source — implement as _Implementation; validate as _Validate
void AMyPawn::ServerRequestPickup_Implementation(AActor* TargetActor)
{
    if (!TargetActor || !TargetActor->ActorHasTag(TEXT("Pickup"))) return;
    // authoritative pickup logic
}

bool AMyPawn::ServerRequestPickup_Validate(AActor* TargetActor)
{
    // Must return true to allow execution; false disconnects the caller.
    return IsValid(TargetActor);
}
```

**Never** call `ServerRequestPickup_Implementation` or `_Validate` directly. Call the base name
`ServerRequestPickup(...)` and UHT's generated thunk serializes and routes it.

## RPC execution matrix

The executing machine depends on the RPC type, calling machine, and the actor's owning connection:

### Server RPCs

| Called from | Actor owning connection | Executes on |
|---|---|---|
| Client | Invoking client | Server |
| Client | Different client or none | Dropped silently |
| Server | Any | Server (local call) |

### Client RPCs

| Called from | Actor owning connection | Executes on |
|---|---|---|
| Server | Owning client | Owning client |
| Server | Server / none | Server (local call) |
| Client | Any | Invoking client (local call) |

### NetMulticast RPCs

| Called from | Executes on |
|---|---|
| Server | Server + all clients the actor is relevant for |
| Client | Invoking client only |

## Reliability

```cpp
UFUNCTION(Server, Reliable, WithValidation)   // gameplay-critical, e.g. fire, interact
void ServerFire(FVector_NetQuantize HitPos);

UFUNCTION(NetMulticast, Unreliable)           // cosmetic, called frequently
void MulticastPlayHitSpark(FVector Loc);
```

`Reliable` RPCs are retransmitted until acknowledged; all subsequent RPCs on the channel queue
behind them. Use sparingly — flooding reliable RPCs causes channel saturation and can block all
replication for that connection.

`Unreliable` RPCs are best-effort, no ordering guarantee. Suitable for cosmetics called inside
`Tick` or at high frequency.

## WithValidation

Mandatory for all Server RPCs whose parameters come from untrusted client input. The validate
function has the same signature as the RPC but returns `bool`:

```cpp
bool AMyPawn::ServerSpendAmmo_Validate(int32 Amount)
{
    // Reject impossible values; returning false severs the client connection.
    return Amount > 0 && Amount <= 999;
}
```

If `WithValidation` is omitted on a Server RPC, UHT generates a default `_Validate` that always
returns true (a security gap for production titles).

## Parameter types for RPCs

Use quantized types to reduce bandwidth:
- `FVector_NetQuantize` — centimeter precision, 10 bits/component
- `FVector_NetQuantize10` — 0.1 cm precision
- `FVector_NetQuantize100` — 0.01 cm precision
- `FRotator` / `FQuat` are automatically quantized by the net serializer

Avoid passing raw `TArray` or heap-allocated containers in high-frequency RPCs; prefer structs
with fixed-size members.

## Blueprint RPCs

In Blueprint, add a **Custom Event**, then in its Details panel set **Replicates** to
"Reliable/Unreliable Multicast", "Run on Server", or "Run on owning Client". The Blueprint
system generates the equivalent of `UFUNCTION(Server, Reliable)` etc.

Blueprint RepNotify `Set` calls on a replicated property automatically invoke the RepNotify if one
is defined for that property. This does *not* apply to `ActorComponent` blueprints in 5.7.

`Remote` RPC is not exposed to Blueprint.

## Ownership — the most common RPC pitfall

A Server RPC can only be called on an actor that the invoking client **owns** — meaning the
actor's `Owner` chain (via `GetOwner()`) must reach a `PlayerController` whose `UNetConnection`
is the invoking client's connection.

Typical owned actors: the client's `Pawn`, their `PlayerController`, and any actor explicitly
spawned with `Params.Owner = PlayerController`.

Calling a Server RPC on an unowned actor is silently dropped — no error, no log at default
verbosity. Enable `net.RPC.Debug 1` to see drops.

## Source references (UE 5.7)

- `Runtime/Engine/Classes/GameFramework/Actor.h` — `HasAuthority` :1941, `GetLocalRole` :739,
  `GetRemoteRole` :743, `bReplicates` :556.
- Official doc — Remote Procedure Calls:
  <https://dev.epicgames.com/documentation/unreal-engine/remote-procedure-calls-in-unreal-engine>
