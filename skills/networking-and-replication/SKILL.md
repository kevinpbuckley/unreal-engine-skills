---
name: networking-and-replication
description: Build multiplayer in Unreal's server-authoritative model — network roles and authority,
  actor and property replication (bReplicates, Replicated/ReplicatedUsing, GetLifetimeReplicatedProps,
  DOREPLIFETIME), RPCs (Server/Client/NetMulticast, Reliable/Unreliable, WithValidation), ownership
  and relevancy. Use when replicating state across clients, adding RPCs, fixing "works in single
  player but not multiplayer" bugs, or reasoning about authority.
metadata:
  engine-version: "5.7"
  category: systems
---

# Networking & replication

Unreal multiplayer is **server-authoritative**: the server owns the truth and replicates state down
to clients; clients ask the server to do things via RPCs. Almost every multiplayer bug is an
authority or replication-setup mistake. Decide *where* each piece of state and logic lives
(`gameplay-framework`) and then replicate it correctly.

## When to use this skill

- Making actor state visible to all clients (health, score, doors).
- Letting a client request a server action (fire, interact) via an RPC.
- Diagnosing "it works in PIE single player but not in multiplayer".
- Reasoning about who is allowed to change what.

## Roles & authority

Each actor has a role on each machine:
- `ROLE_Authority` — the authoritative copy (the server; or any actor on a standalone game).
- `ROLE_AutonomousProxy` — the locally-controlled client copy (your own pawn) — can predict.
- `ROLE_SimulatedProxy` — a client copy of someone else's actor — simulated from replication.

Branch on authority: `if (HasAuthority()) { /* server-only authoritative change */ }`. Make
gameplay decisions on the server; clients send intent.

## Actor replication

```cpp
AMyActor::AMyActor()
{
    bReplicates = true;                 // this actor replicates
    SetReplicateMovement(true);         // replicate transform (non-Character)
}
```
GameMode is server-only and never replicates; GameState/PlayerState are designed to replicate
(`gameplay-framework`).

## Property replication

Mark properties and register them; replication is **server → clients** only:
```cpp
// .h
UPROPERTY(ReplicatedUsing=OnRep_Health)
float Health = 100.f;
UPROPERTY(Replicated)
int32 Ammo = 0;
UFUNCTION() void OnRep_Health();        // runs on clients when Health arrives

// .cpp
#include "Net/UnrealNetwork.h"
void AMyActor::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& Out) const
{
    Super::GetLifetimeReplicatedProps(Out);
    DOREPLIFETIME(AMyActor, Health);
    DOREPLIFETIME_CONDITION(AMyActor, Ammo, COND_OwnerOnly);   // only to the owning client
}
```
- `ReplicatedUsing=OnRep_X` calls `OnRep_X` on clients when the value changes — use it to react
  (update UI, play FX). Set the value on the **server**; the OnRep fires on clients (and you
  typically call it manually on the server too if needed).
- `DOREPLIFETIME_CONDITION` with `COND_*` (e.g. `COND_OwnerOnly`, `COND_SkipOwner`,
  `COND_InitialOnly`) limits who receives it and saves bandwidth.

## RPCs (remote procedure calls)

```cpp
UFUNCTION(Server, Reliable, WithValidation)
void ServerFire(FVector_NetQuantize Target);     // client → server
UFUNCTION(Client, Reliable)
void ClientNotify(int32 Code);                   // server → owning client
UFUNCTION(NetMulticast, Unreliable)
void MulticastPlayFx(FVector Loc);               // server → all clients
```
Rules:
- **Server** RPC: called on a client, **executes on the server**; only valid on an actor the client
  **owns** (its pawn/PlayerController, or an actor whose Owner chain reaches them).
- **Client** RPC: called on the server, executes on the **owning client**.
- **NetMulticast**: called on the server, executes on the server **and all clients** (use for
  cosmetic/transient effects).
- **Reliable** for gameplay-critical calls; **Unreliable** for frequent cosmetic ones. Add
  `WithValidation` to Server RPCs and implement `_Validate` to reject cheats.
- Implement the body in `Func_Implementation` (UHT generates the send thunk).

## Ownership & relevancy

- An actor's **Owner** determines which client can call its Server RPCs and receives `COND_OwnerOnly`
  data. `SetOwner` / spawn with an owner.
- **Relevancy / net update frequency / net cull distance** control whether and how often an actor
  replicates to a given client (perf at scale).

## Movement

Characters replicate movement with prediction via `UCharacterMovementComponent`
(`character-and-movement`). Don't manually `SetActorLocation` every tick on a networked character —
drive input and let CMC replicate.

## Testing

PIE "Number of Players" + Net Mode (Play As Listen Server/Client) runs multiplayer locally — always
test gameplay there, not just standalone, or you'll miss authority bugs.

## Gotchas

- **Changing replicated state on a client** does nothing authoritative — change it on the server.
- **Forgot `GetLifetimeReplicatedProps`/`DOREPLIFETIME`** → property never replicates.
- **Server RPC on a non-owned actor** is dropped — call it on an actor the client owns.
- **Multicast for important state** that late-joiners must see — use a replicated property + OnRep
  instead (multicasts don't replay for new clients).
- **Heavy/very frequent Reliable RPCs** can saturate the channel — prefer replicated properties /
  Unreliable for cosmetics.
- **Putting client logic in GameMode** — it doesn't exist on clients.

## References & source material

Engine source (UE 5.7):
- `Runtime/Engine/Public/Net/UnrealNetwork.h` — `DOREPLIFETIME*` macros, replication conditions.
- `Runtime/Engine/Classes/GameFramework/Actor.h` — `bReplicates`, roles, `HasAuthority`, RPCs.
- `Runtime/Engine/Classes/Engine/ActorChannel.h`, `Engine/NetDriver.h` — replication transport.

Official docs (UE 5.7): Gameplay Systems —
<https://dev.epicgames.com/documentation/unreal-engine/gameplay-systems-in-unreal-engine>

Related: `gameplay-framework`, `character-and-movement`, `gameplay-ability-system`.
