# Root motion & LaunchCharacter — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `FRootMotionSource` types,
`LaunchCharacter`, animation-driven root motion, and network considerations.
Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/GameFramework/RootMotionSource.h` and
`CharacterMovementComponent.h`).

## Two root motion systems

| System | What drives it | Replicated? |
|--------|---------------|-------------|
| **Anim root motion** | Animation clip with root bone motion | Yes — via `RepRootMotion` montage struct (`Character.h:1037`) |
| **Root motion sources (RMS)** | `FRootMotionSource` objects applied to CMC | Yes — via `FRootMotionSourceGroup` in `FSavedMove_Character` |

Both systems feed into `UCharacterMovementComponent::CurrentRootMotion`
(`CMC.h:2727`) which CMC evaluates inside `PerformMovement` (`CMC.h:2252`).

## Animation root motion

Animation clips with root bone motion extracted will be applied when the
montage's `RootMotionMode` is not `ERootMotionMode::NoRootMotionExtraction`.

- For networked characters, `IsPlayingNetworkedRootMotionMontage()` (`Character.h:1070`)
  indicates that CMC's prediction loop accounts for the montage.
- `AnimRootMotionTranslationScale` (`Character.h:481`, `Replicated`) scales the
  translation component of anim root motion — useful for speed multipliers without
  changing the animation.
- `HasAnyRootMotion()` (`Character.h:1063`) returns true for both anim and source
  root motion.

Anim root motion on **simulated proxies** is handled via `SimulatedRootMotionPositionFixup`
(`Character.h:1052`) and the `RepRootMotion` replicated struct (`Character.h:1037`).

## FRootMotionSource types

All types live in `GameFramework/RootMotionSource.h`. The most useful:

| Type | Purpose |
|------|---------|
| `FRootMotionSource_ConstantForce` | Constant velocity offset per tick |
| `FRootMotionSource_RadialForce` | Velocity toward/away from a world point |
| `FRootMotionSource_MoveToForce` | Smooth linear move to a target position |
| `FRootMotionSource_MoveToDynamicForce` | Same but target can change each tick |
| `FRootMotionSource_JumpForce` | Parabolic arc; used for jump animations |

All sources share base fields:
- `InstanceName` (`FName`) — used to look up or remove the source later.
- `Duration` (`float`) — seconds; negative means indefinite.
- `Priority` (`uint16`) — higher priority sources override lower when conflicting.
- `AccumulateMode` — `Additive` (stacks with others) vs `Override` (replaces).

### Example: Move to a target position

```cpp
TSharedPtr<FRootMotionSource_MoveToForce> MoveSource =
    MakeShared<FRootMotionSource_MoveToForce>();
MoveSource->InstanceName     = FName("DodgeRoll");
MoveSource->StartLocation    = GetActorLocation();
MoveSource->TargetLocation   = TargetPoint;
MoveSource->Duration         = 0.35f;
MoveSource->bRestrictSpeedToExpected = true;   // clamp to keep arc clean

uint16 SourceID = GetCharacterMovement()->ApplyRootMotionSource(MoveSource);
// CMC.h:2739 — returns ID for later removal
```

Remove when cancelled:
```cpp
GetCharacterMovement()->RemoveRootMotionSourceByID(SourceID); // CMC.h:2754
// OR by name:
GetCharacterMovement()->RemoveRootMotionSource(FName("DodgeRoll")); // CMC.h:2751
```

## LaunchCharacter

`ACharacter::LaunchCharacter` (`Character.h:791`) sets a pending launch velocity
on CMC, which is applied in the next `PerformMovement` tick and transitions the
character to `MOVE_Falling`:

```cpp
// Fire the player upward and preserve XY velocity:
LaunchCharacter(FVector(0.f, 0.f, 800.f),
    /*bXYOverride=*/false,
    /*bZOverride=*/true);
```

- `bXYOverride = true` — replaces lateral velocity entirely.
- `bXYOverride = false` — adds the XY component to current velocity.
- `bZOverride = true` — replaces Z velocity (avoids doubling up on jump force).

`LaunchCharacter` fires `OnLaunched` Blueprint event (`Character.h:795`) after
setting the velocity. It is replicated via CMC's prediction — do not manually
set `Velocity` on the client for launches.

## Networking root motion sources

When a server applies a root motion source, CMC synchronizes it to the client
via the `FSavedMove_Character` serialization path:
- Server sends `ServerCorrectionRootMotion` (`CMC.h:2730`) in corrections.
- Client applies `ConvertRootMotionServerIDsToLocalIDs` (`CMC.h:2757`) to
  reconcile server-assigned IDs with locally assigned ones after replay.

Because IDs can differ between server and client, always look up sources by
**name** rather than by ID on the client side.

For **animation root motion** on networked characters:
- Call `PlayAnimMontage` only on the server (or locally controlled client for
  autonomous proxy); CMC's replication handles simulated proxy playback.
- Do not manually call `PlayAnimMontage` on simulated proxies — they receive
  updates through `RepRootMotion`.

## Custom gravity and root motion

When `GravityDirection` is non-default, CMC transforms root motion translation
into gravity-relative space before applying it. Sources authoring positions in
world space should be aware that `bRelativeToParent` and coordinate-space flags
affect how the translation is applied. Test carefully on characters with custom
gravity if using `FRootMotionSource_MoveToForce`.

## Version notes

- Root motion source IDs are `uint16` and assigned locally; they are **not**
  globally unique across server and client — always use `InstanceName` for
  cross-system lookups.
- `FRootMotionSource_MoveToDynamicForce` was added in UE 4.20 and is stable
  in 5.x; the `bTargetBasedPosition` flag distinguishes absolute world space
  from relative-to-base-component targets.
- `AnimRootMotionTranslationScale` (`Character.h:481`) is replicated, so scaling
  root motion translation on the server propagates correctly to simulated proxies.
