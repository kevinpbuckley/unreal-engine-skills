---
name: networking-and-replication
description: Implement server-authoritative multiplayer in Unreal C++ — network roles and
  authority (HasAuthority, GetLocalRole, GetRemoteRole, ROLE_Authority/AutonomousProxy/SimulatedProxy),
  actor replication setup (bReplicates, SetReplicates, bAlwaysRelevant, NetDormancy,
  NetUpdateFrequency), property replication (UPROPERTY Replicated/ReplicatedUsing,
  GetLifetimeReplicatedProps, DOREPLIFETIME/DOREPLIFETIME_CONDITION/DOREPLIFETIME_WITH_PARAMS),
  RepNotify callbacks (OnRep_), RPCs (UFUNCTION Server/Client/NetMulticast, Reliable/Unreliable,
  WithValidation, _Implementation/_Validate), replication conditions (COND_*), Push Model
  (MARK_PROPERTY_DIRTY_FROM_NAME, FDoRepLifetimeParams::bIsPushBased), FFastArraySerializer,
  and the Iris replication system. Use when replicating state across clients, adding RPCs, fixing
  multiplayer authority bugs, choosing replication conditions, or diagnosing "works in single player
  but not multiplayer" issues.
metadata:
  engine-version: "5.7"
  category: systems
---

# Networking & replication

Unreal multiplayer is **server-authoritative**: the server holds the ground truth and replicates
state to clients; clients send intent to the server via RPCs. Nearly every multiplayer bug is an
authority or replication-setup mistake. Design state ownership first (`gameplay-framework`), then
replicate it correctly.

## When to use this skill

- Replicating actor state (health, ammo, doors, scores) to all clients.
- Letting a client ask the server to act (fire, interact, ability use) via an RPC.
- Choosing between `Replicated` vs `ReplicatedUsing`, or picking a `COND_*` condition.
- Setting up dormancy, net update frequency, or relevancy for performance at scale.
- Diagnosing "it works in PIE single-player but breaks in multiplayer".
- Adopting Push Model or `FFastArraySerializer` for efficient high-scale replication.

## Authority and roles

Every actor copy has a role on each machine:

| Role constant | Where it appears | Meaning |
|---|---|---|
| `ROLE_Authority` | Server (or standalone) | Authoritative copy — make decisions here |
| `ROLE_AutonomousProxy` | Client — your own pawn | Locally controlled; can predict |
| `ROLE_SimulatedProxy` | Client — others' actors | Simulated from received replication |

```cpp
if (HasAuthority())   // true on server / standalone
{
    // authoritative gameplay change
}
bool bIsLocallyControlled = (GetLocalRole() == ROLE_AutonomousProxy);
```

`HasAuthority()` inlines to `GetLocalRole() == ROLE_Authority`
(`GameFramework/Actor.h`:1941, :4964).

Server RPCs execute on the server; state changes must happen on the server and replicate down.
Clients send *intent*, not *state*.

## Actor replication setup

```cpp
AMyActor::AMyActor()
{
    bReplicates = true;          // enable replication
    SetReplicateMovement(true);  // replicate transform (non-Character actors)
    NetUpdateFrequency = 10.f;   // updates/sec (use SetNetUpdateFrequency in 5.5+)
    NetDormancy = DORM_DormantAll; // start dormant; call FlushNetDormancy before changing props
}
```

`bReplicates` (`Actor.h`:556), `SetReplicates` (`Actor.h`:722), `NetDormancy` (`Actor.h`:832),
`bAlwaysRelevant` (`Actor.h`:300), `NetUpdateFrequency`/`SetNetUpdateFrequency` (`Actor.h`:876,
:4622).

Key actors by design: GameMode is server-only. GameState and PlayerState are built to replicate
(`gameplay-framework`). `SetReplicates(true)` at runtime triggers a replication start callback
— in 5.7 Iris projects, override `OnReplicationStartedForIris` rather than the deprecated
`OnReplicationStarted`.

## Property replication

Mark the property and register it in `GetLifetimeReplicatedProps`. Replication flows
**server → clients** only.

```cpp
// MyActor.h
UPROPERTY(ReplicatedUsing=OnRep_Health)
float Health = 100.f;

UPROPERTY(Replicated)
int32 Ammo = 30;

UFUNCTION()                        // must be UFUNCTION
void OnRep_Health(float OldHealth);// optional previous-value param

virtual void GetLifetimeReplicatedProps(
    TArray<FLifetimeProperty>& OutLifetimeProps) const override;
```

```cpp
// MyActor.cpp
#include "Net/UnrealNetwork.h"

void AMyActor::GetLifetimeReplicatedProps(
    TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);
    DOREPLIFETIME(AMyActor, Health);
    DOREPLIFETIME_CONDITION(AMyActor, Ammo, COND_OwnerOnly);
}

void AMyActor::OnRep_Health(float OldHealth)
{
    // Fires on clients when Health arrives. Use it to react:
    // update UI, play hit FX, etc. OldHealth is the pre-update value.
}
```

- Set replicated properties **on the server** only; changes on a client are local and discarded.
- `DOREPLIFETIME` expands to `DOREPLIFETIME_WITH_PARAMS` with default `FDoRepLifetimeParams`
  (`UnrealNetwork.h`:259).
- `DOREPLIFETIME_CONDITION(Class, Prop, COND_*)` saves bandwidth — see
  [references/replication-conditions-and-push-model.md](references/replication-conditions-and-push-model.md).
- Full macro reference and `DOREPLIFETIME_WITH_PARAMS_FAST` (compile-time, no arrays):
  [references/property-replication.md](references/property-replication.md).

## RPCs (remote procedure calls)

```cpp
// MyPawn.h — declare only; UHT generates the thunk
UFUNCTION(Server, Reliable, WithValidation)
void ServerFire(FVector_NetQuantize HitLocation);   // client → server

UFUNCTION(Client, Reliable)
void ClientPlayEffect(int32 EffectId);              // server → owning client

UFUNCTION(NetMulticast, Unreliable)
void MulticastSpawnFX(FVector Loc);                 // server → server + all clients
```

```cpp
// MyPawn.cpp — implement as _Implementation; validate as _Validate
void AMyPawn::ServerFire_Implementation(FVector_NetQuantize HitLocation)
{
    // runs on server — do authoritative hit processing here
}

bool AMyPawn::ServerFire_Validate(FVector_NetQuantize HitLocation)
{
    // return false to disconnect the cheating client
    return HitLocation.Z > -10000.f;
}

void AMyPawn::ClientPlayEffect_Implementation(int32 EffectId)
{
    // runs on the owning client only
}

void AMyPawn::MulticastSpawnFX_Implementation(FVector Loc)
{
    // runs on server AND all relevant clients — use for cosmetic FX only
}
```

RPC rules:
- **Server** RPC — called on a client, runs on the server. The actor must be **owned** by that
  client (its pawn or PlayerController, or an actor whose Owner chain reaches them). Calling on a
  non-owned actor is silently dropped.
- **Client** RPC — called on the server, runs on the **owning client**.
- **NetMulticast** — called on the server, executes on the server and all currently relevant
  clients. Not replayed for late joiners; use a replicated property + OnRep for persistent state.
- **Reliable** — guaranteed delivery with ordering; reserve for gameplay-critical calls.
  **Unreliable** — fire and forget; use for frequent cosmetic calls. Flooding reliable RPCs can
  saturate the channel.
- `WithValidation` is required by Epic coding standards for all Server RPCs that accept parameters
  from untrusted clients. Returning `false` from `_Validate` disconnects the caller.

Full RPC reference and execution matrix: [references/rpcs.md](references/rpcs.md).

## Ownership & relevancy

- **Owner**: determines which client can invoke Server RPCs on the actor, and which client
  receives `COND_OwnerOnly` data. Set with `SetOwner` or `FActorSpawnParameters::Owner`.
- **Relevancy**: an actor only replicates to connections for which it is relevant (`bAlwaysRelevant`
  bypasses the check). Override `IsNetRelevantFor` to customize.
- **Net dormancy**: actors set to `DORM_DormantAll` are skipped entirely during replication
  consideration — the most impactful server-side optimization. Call `FlushNetDormancy()` before
  changing any replicated property while dormant.
- **NetUpdateFrequency** / **NetCullDistanceSquared**: tune per actor class to balance fidelity
  vs bandwidth.

## Movement replication

`ACharacter` + `UCharacterMovementComponent` handle movement with client prediction automatically
(`character-and-movement`). Do not manually `SetActorLocation` every tick on a networked character
— drive input through CMC.

## Multiplayer testing

PIE: set **Number of Players > 1** and **Net Mode** to "Play As Listen Server" or "Play As Client"
to run a multi-machine session locally. Always test authority paths in multi-player PIE, not
standalone — standalone makes every actor authoritative and hides ownership bugs.

Console: `net.DormancyEnable 0` to disable dormancy while debugging; `NetEmulation.PktLag 100`
to simulate 100ms latency.

## Gotchas

- **Changing replicated state on a client** — does not propagate; only the server's change
  replicates.
- **Forgot `GetLifetimeReplicatedProps`/`DOREPLIFETIME`** — property never replicates, silently.
- **Server RPC on a non-owned actor** — dropped without error; check ownership chain.
- **Multicast for late-joiner state** — multicasts don't replay. Use a replicated property +
  `OnRep` so new clients receive the state on join.
- **Reliable RPC flood** — every Reliable RPC occupies a slot; flooding saturates the channel and
  stalls all replication for that connection.
- **Modifying replicated property while dormant** — the change is present locally but skipped by
  the replication system until `FlushNetDormancy` is called (and even then may be lost); always
  call `FlushNetDormancy()` before changing props on a dormant actor.
- **GameMode server-only** — putting client-observable state in GameMode means clients can't see
  it; use GameState.
- **RepNotify not firing on server** — `OnRep_X` only fires automatically on clients; if the
  server needs the same side-effect, call `OnRep_X()` explicitly after setting the value.

## Version notes

- **5.5+**: `NetUpdateFrequency` direct write is deprecated; use `SetNetUpdateFrequency()` /
  `GetNetUpdateFrequency()` (`Actor.h`:874).
- **5.7 / Iris**: The Iris replication system is the new default in 5.7. It coexists with the
  existing property/RPC model — existing `DOREPLIFETIME` and RPC code continues to work. Iris
  replaces `OnReplicationStarted` with `OnReplicationStartedForIris`. For Push Model with Iris,
  use `DOREPLIFETIME_WITH_PARAMS_FAST` + `bIsPushBased = true`. See
  [references/replication-conditions-and-push-model.md](references/replication-conditions-and-push-model.md).

## References & source material

Engine source (UE 5.7, under `Engine/Source/`):
- `Runtime/Engine/Public/Net/UnrealNetwork.h` — `DOREPLIFETIME*` macros (:231–293),
  `FDoRepLifetimeParams` (:134), `DOREPLIFETIME_CONDITION_NOTIFY` (:286),
  `DOREPLIFETIME_ACTIVE_OVERRIDE` (:311), `RegisterReplicatedLifetimeProperty` (:360).
- `Runtime/Engine/Classes/GameFramework/Actor.h` — `bReplicates`:556, `SetReplicates`:722,
  `GetLocalRole`:739, `GetRemoteRole`:743, `HasAuthority`:1941 (inlined :4964),
  `bAlwaysRelevant`:300, `NetDormancy`:832, `NetUpdateFrequency`:876,
  `SetNetDormancy`:3173, `FlushNetDormancy`:3177.
- `Runtime/CoreUObject/Public/UObject/CoreNetTypes.h` — `ELifetimeCondition` enum (:19),
  `COND_None`–`COND_NetGroup` (:21–38), `ELifetimeRepNotifyCondition` (:42).
- `Runtime/CoreUObject/Public/UObject/CoreNet.h` — `FLifetimeProperty` (:299).
- `Runtime/Net/Core/Public/Net/Core/PushModel/PushModel.h` — `MARK_PROPERTY_DIRTY_FROM_NAME`
  (:454), `MARK_PROPERTY_DIRTY_FROM_NAME_STATIC_ARRAY` (:460), `FNetPushObjectId` (:289).
- `Runtime/Net/Core/Public/Net/Core/PushModel/PushModelMacros.h` — `WITH_PUSH_MODEL` (:5).
- `Runtime/Net/Core/Classes/Net/Serialization/FastArraySerializer.h` — `FFastArraySerializer`,
  `FFastArraySerializerItem`, usage pattern (:60–134).

Official docs (UE 5.7, all fetched and verified):
- Networking Overview —
  <https://dev.epicgames.com/documentation/unreal-engine/networking-overview-for-unreal-engine>
- Networking and Multiplayer (index) —
  <https://dev.epicgames.com/documentation/unreal-engine/networking-and-multiplayer-in-unreal-engine>
- Replicate Actor Properties —
  <https://dev.epicgames.com/documentation/unreal-engine/replicate-actor-properties-in-unreal-engine>
- Remote Procedure Calls —
  <https://dev.epicgames.com/documentation/unreal-engine/remote-procedure-calls-in-unreal-engine>
- Actor Network Dormancy —
  <https://dev.epicgames.com/documentation/unreal-engine/actor-network-dormancy-in-unreal-engine>
- Iris Replication System —
  <https://dev.epicgames.com/documentation/unreal-engine/iris-replication-system-in-unreal-engine>

Deep-dive references in this skill:
- [references/property-replication.md](references/property-replication.md) — full property
  replication workflow, DOREPLIFETIME macro family, RepNotify parameter overloads.
- [references/rpcs.md](references/rpcs.md) — RPC types, execution matrix, reliability,
  WithValidation, Blueprint RPCs.
- [references/replication-conditions-and-push-model.md](references/replication-conditions-and-push-model.md)
  — all `COND_*` values, Push Model opt-in, `DOREPLIFETIME_WITH_PARAMS_FAST`.
- [references/fast-arrays.md](references/fast-arrays.md) — `FFastArraySerializer` step-by-step,
  `MarkItemDirty`, per-element callbacks.

Related: `gameplay-framework`, `actors-and-components`, `character-and-movement`,
`gameplay-ability-system`.
