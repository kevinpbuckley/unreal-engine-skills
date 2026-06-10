---
skill: networking-and-replication
title: Replicated health + server-authoritative damage RPC
---

## Prompt

In an Unreal Engine 5.7 C++ project module named `EvalScratch`, create a pawn class with
server-authoritative health for multiplayer: health replicates to all clients and drives
a client-side `OnHealthChanged` reaction when it arrives; clients request damage through
a validated server call; and all mutation happens only on the server.

## Acceptance criteria

- `bReplicates` enabled (constructor) and `Health` declared
  `UPROPERTY(ReplicatedUsing = OnRep_Health)`.
- `GetLifetimeReplicatedProps` overridden with `DOREPLIFETIME` (or
  `DOREPLIFETIME_CONDITION`) for `Health`; includes `Net/UnrealNetwork.h`.
- `OnRep_Health` is a `UFUNCTION()` and is also invoked manually (or logic shared) on the
  server path, since RepNotify does not fire on the server.
- Damage entry point is `UFUNCTION(Server, Reliable, WithValidation)` with both
  `_Implementation` and `_Validate` bodies.
- Mutation guarded by authority (`HasAuthority()`), not by `IsLocallyControlled` or
  `GetNetMode` string checks.
- No use of the removed multicast-everything pattern for state (health is property
  replication, not a NetMulticast RPC).

## Common baseline failures

Forgetting `GetLifetimeReplicatedProps` (silently never replicates), missing
`WithValidation`/`_Validate` (compile error), calling `OnRep` only on clients and
desyncing listen servers, or marking the server RPC `BlueprintCallable` but never
checking authority.
