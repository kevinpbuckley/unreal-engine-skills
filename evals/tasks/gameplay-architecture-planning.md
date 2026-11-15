---
skill: ue-gameplay-architecture-planning
title: Multiplayer inventory architecture and implementation plan
---

## Prompt

I am building a four-player co-op extraction game in Unreal Engine 5.9. Design an item pickup and
inventory architecture before we implement it. Inventory must survive pawn death and respawn but
reset when the match ends. The server must validate pickups, other players should see a pickup
disappear, only the owning player needs full inventory contents, designers need to author item
definitions without C++, and the HUD must update immediately. Compare sensible alternatives, map
the Unreal classes and communication flow, define the C++/Blueprint split, and give the coding
agent an ordered implementation plan.

## Acceptance criteria

- Identifies `APlayerState` or a replicated component owned by PlayerState as the natural owner of
  match-lifetime inventory state; explicitly rejects Pawn-only ownership because death replaces it.
- Keeps authoritative pickup validation on the server and identifies a connection-owned RPC path,
  rather than trusting a client or assuming the pickup Actor can receive arbitrary client RPCs.
- Separates designer-authored immutable item definitions from runtime inventory entries, using
  Data Assets/Primary Data Assets or a justified equivalent.
- Distinguishes public pickup world state from owner-only inventory contents and proposes an
  appropriate replication condition or owner-relevant state path.
- Uses replicated state for late-join-safe inventory/world truth and a local delegate, RepNotify,
  or view-model notification for HUD refresh rather than making the widget authoritative.
- Compares at least two genuinely viable inventory representations, such as a replicated
  PlayerState component versus fields directly on PlayerState, and evaluates coupling,
  reuse, replication, and complexity.
- Provides a responsibility/lifetime map plus a sender-to-receiver communication flow covering
  interact request, authority validation, pickup consumption, inventory mutation, replication,
  and HUD observation.
- Defines concrete C++ responsibilities and concrete Blueprint/asset extension points.
- Produces an ordered vertical-slice implementation plan with observable verification after each
  phase, including dedicated-server or multiplayer PIE tests, death/respawn, late join, rejection,
  and match reset.
- Avoids unnecessary global GameInstance state, per-item inventory Actors, Tick-based polling,
  multicast-only state synchronization, and premature framework adoption without requirements.

## Common baseline failures

Agents commonly put the inventory on the Character, use GameInstance to survive respawn, allow the
client to destroy pickup Actors, represent every held item as an Actor, drive the HUD by polling,
or send multicast RPCs without replicated state for late joiners. Plans also tend to list files
without resolving ownership, authority, or verification order.
