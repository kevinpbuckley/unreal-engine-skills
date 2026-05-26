# Collision channels and profiles — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the channel taxonomy, custom channel
setup, collision presets, `FCollisionResponseContainer`, and the per-component response API.
Grounded in UE 5.7 (`Engine/Source/Runtime/Engine/Classes/Engine/EngineTypes.h`) and the
official [Collision Overview](https://dev.epicgames.com/documentation/unreal-engine/collision-in-unreal-engine---overview)
doc.

## Channel taxonomy

`ECollisionChannel` (declared `EngineTypes.h`:1087) has two categories:

**Object channels** — what a component *is*:

| Enum constant | Typical use |
|---|---|
| `ECC_WorldStatic` | terrain, architecture, non-moving geometry |
| `ECC_WorldDynamic` | moving/dynamic actors (doors, vehicles, pickups) |
| `ECC_Pawn` | characters, player pawns |
| `ECC_PhysicsBody` | simulated rigid bodies |
| `ECC_Vehicle` | vehicles |
| `ECC_Destructible` | destructible meshes |

**Trace channels** — query categories (not assigned to objects):

| Enum constant | Default use |
|---|---|
| `ECC_Visibility` | generic line-of-sight / weapon traces |
| `ECC_Camera` | camera collision avoidance |

**Custom channels** occupy `ECC_GameTraceChannel1`–`ECC_GameTraceChannel18`. In Project
Settings → Collision you assign human-readable names (e.g. `Interactable`) and a default
response. At C++ level they remain `ECC_GameTraceChannel1`, etc. Use
`UEngineTypes::ConvertToCollisionChannel(ETraceTypeQuery)` and
`UEngineTypes::ConvertToObjectType(ECollisionChannel)` to convert between Blueprint-facing
enums and the runtime enum (`EngineTypes.h`:3824–3833).

## FCollisionResponseContainer

Each component stores its per-channel responses in an `FCollisionResponseContainer`
(`EngineTypes.h`:1346). The struct lays out one `TEnumAsByte<ECollisionResponse>` per built-in
channel as named fields (`WorldStatic`, `Pawn`, `Visibility`, etc.) plus unnamed slots for
custom channels. Read/write via the named methods on `UPrimitiveComponent` rather than
directly to keep the bookkeeping in sync.

```cpp
// Full response override — replaces all channels at once:
FCollisionResponseContainer Responses;
Responses.SetAllChannels(ECR_Ignore);
Responses.SetResponse(ECC_Pawn, ECR_Overlap);
MyComp->SetCollisionResponseToChannels(Responses);
```

`FCollisionResponseContainer::SetResponse(ECollisionChannel, ECollisionResponse)` is declared
at `EngineTypes.h`:1518.

## Collision presets (profiles)

Presets bundle `CollisionEnabled` mode, object type, and all channel responses. They are
registered in `DefaultEngine.ini` under `[/Script/Engine.CollisionProfile]` and loaded into
the engine collision profile system. Common built-in presets:

| Preset name | Enabled | Object type | Block | Overlap | Ignore |
|---|---|---|---|---|---|
| `BlockAll` | QueryAndPhysics | WorldStatic | All | — | — |
| `OverlapAllDynamic` | QueryOnly | WorldDynamic | — | All | — |
| `NoCollision` | NoCollision | WorldStatic | — | — | All |
| `Pawn` | QueryAndPhysics | Pawn | WorldStatic, WorldDynamic | Trigger | Camera |
| `PhysicsActor` | QueryAndPhysics | PhysicsBody | All | — | — |
| `Trigger` | QueryOnly | WorldDynamic | — | All | — |
| `Ragdoll` | QueryAndPhysics | PhysicsBody | WorldStatic, WorldDynamic | — | Pawn |

Apply with `SetCollisionProfileName(TEXT("Trigger"))`. **Important:** calling
`SetCollisionProfileName` resets all per-channel responses to the preset's values, then marks
the component as "using a profile". Any subsequent `SetCollisionResponseToChannel` calls
switch the component into "custom" mode, overriding only the specified channels and leaving
the preset as the baseline.

## Custom channel workflow

1. In Project Settings → Collision → Object Channels (or Trace Channels), add your channel
   with a name and default response.
2. UE maps it to the next available `ECC_GameTraceChannelN`.
3. Assign in C++ using the generated alias. Projects conventionally define an alias in a
   header:

```cpp
// MyCollisionChannels.h
#define ECC_Interactable ECC_GameTraceChannel1
```

4. Respond or trace using `ECC_Interactable` just like a built-in channel.

Custom channels must also set appropriate responses on every other component type that should
react to them — new channels default to the "default response" you set in Project Settings.

## Per-component response API summary

All on `UPrimitiveComponent` (`PrimitiveComponent.h`):

| Method | Line | Purpose |
|---|---|---|
| `SetCollisionEnabled(Type)` | 1943 | Enable/disable query/physics participation |
| `SetCollisionObjectType(Channel)` | 1964 | What this component is |
| `SetCollisionProfileName(Name)` | 1953 | Apply a named preset |
| `SetCollisionResponseToChannel(Ch, Resp)` | 2852 | Set one channel's response |
| `SetCollisionResponseToAllChannels(Resp)` | 2860 | Set all channels at once |
| `SetCollisionResponseToChannels(Container)` | 2867 | Bulk-set from a container |
| `SetGenerateOverlapEvents(bool)` | 373 | Enable/disable overlap callbacks |

## Interaction rules (summarized)

- `ECR_Block` on both sides → physical block; no events unless `bNotifyRigidBodyCollision`.
- `ECR_Overlap` on one side + `ECR_Overlap` or `ECR_Block` on the other + `bGenerateOverlapEvents`
  on both → overlap events fire.
- If either side is `ECR_Ignore`, no event fires regardless of the other side.
- Overlap events fire on enter/exit of overlap region; hit events fire on impact during
  blocking collision.
