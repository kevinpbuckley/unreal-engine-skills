# Attachment and transforms — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the attachment APIs, transform rules, sockets,
mobility, and relative-vs-world transforms. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Components/SceneComponent.h`,
`GameFramework/Actor.h`, `Engine/Classes/Engine/EngineTypes.h`) and the official
[Components → Attachment](https://dev.epicgames.com/documentation/unreal-engine/components-in-unreal-engine#attachment)
doc.

## What can attach

Only `USceneComponent` and its children can attach — attachment needs a transform to express the
spatial relationship between child and parent. A component can have **any number of children** but
**only one parent** (or none, placed directly in the world). **Cycles are not allowed.** Attaching
the root component of actor B to a component of actor A effectively attaches actor B to actor A.

## The three attachment entry points

| API | When to use | Cite |
|---|---|---|
| `SetupAttachment(Parent, Socket)` | constructor / components not yet registered | `SceneComponent.h`:729 |
| `AttachToComponent(Parent, Rules, Socket)` | runtime; attaches immediately | `SceneComponent.h`:747 |
| `AttachToActor(Actor, Rules, Socket)` | runtime; attach this actor's root to another | `Actor.h`:2032 |

```cpp
// Constructor — defer the actual attach until registration:
Mesh->SetupAttachment(RootComponent);
Mesh->SetupAttachment(RootComponent, TEXT("HandSocket"));   // optional socket

// Runtime — attach/detach now:
Mesh->AttachToComponent(Target, FAttachmentTransformRules::SnapToTargetIncludingScale, TEXT("HandSocket"));
Mesh->DetachFromComponent(FDetachmentTransformRules::KeepWorldTransform);     // SceneComponent.h:781

// Whole actor:
AttachToActor(VehicleActor, FAttachmentTransformRules::KeepRelativeTransform);
DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);               // Actor.h:2065
```

`SetupAttachment` at runtime on a registered component does nothing — use `AttachToComponent`.

## Attachment & detachment rules

`FAttachmentTransformRules` (`EngineTypes.h`:74) controls, **per channel** (location, rotation,
scale), whether the child keeps its world transform or snaps to the parent/socket, plus whether
physics is woken. The common presets:

| Preset | Effect |
|---|---|
| `KeepRelativeTransform` | keep current relative transform; child's relative values are preserved |
| `KeepWorldTransform` | preserve world transform; relative values are recomputed |
| `SnapToTargetNotIncludingScale` | snap location+rotation to parent/socket, keep own scale |
| `SnapToTargetIncludingScale` | snap location+rotation+scale to parent/socket |

`FDetachmentTransformRules` (`EngineTypes.h`:121) is the mirror for detaching, typically
`KeepWorldTransform` (stay put in the world) or `KeepRelativeTransform`.

For full control, construct the rules per channel:
```cpp
FAttachmentTransformRules Rules(EAttachmentRule::SnapToTarget,   // location
                                EAttachmentRule::KeepWorld,      // rotation
                                EAttachmentRule::KeepRelative,   // scale
                                /*bWeldSimulatedBodies=*/false);
```

## Sockets

A **socket** is a named transform on a parent (commonly a skeletal mesh bone or a named socket on a
mesh/component). Passing a socket name attaches the child at that socket's transform and the child
follows it (e.g. a weapon on a hand bone). `NAME_None` attaches at the component's own origin.

## Mobility

`USceneComponent::Mobility` (`SceneComponent.h`:298, `EComponentMobility::Type`) governs whether a
component may move and how lighting treats it:

| Mobility | Can move at runtime? | Typical use |
|---|---|---|
| `Static` | no | baked geometry/lights that never move |
| `Stationary` | limited (lights) | lights that change color/intensity but not transform |
| `Movable` | **yes** | anything transformed during play |

Set transform only on `Movable` components at runtime — moving a `Static` component during play is
ignored/asserts. Set mobility with `SetMobility` (`SceneComponent.h`:1287); a child generally
shouldn't be "more static" than its parent.

## Relative vs world transforms

Scene components store a **relative** transform (relative to their attach parent) and derive a
world transform. Pick the setter that matches your intent:

```cpp
Comp->SetRelativeLocation(FVector(0, 0, 50));     // relative to parent
Comp->SetWorldLocation(FVector(100, 0, 0));       // absolute world (SceneComponent.h:556)
Comp->SetRelativeTransform(NewXf);                // SceneComponent.h:456
const FVector W = Comp->GetComponentLocation();   // resolved world location
const FVector R = Comp->GetRelativeLocation();
```

Setters take an optional `bSweep` (sweep for blocking collision while moving) and `ETeleportType`
(whether to "teleport" physics, skipping velocity computation). The root component's transform is
the actor's transform; moving the root moves the whole attached tree.

## Gotchas

- **Attaching before registration at runtime** — use `AttachToComponent`, not `SetupAttachment`.
- **Wrong rule keeps the object in the wrong place** — `KeepWorld` vs `SnapToTarget` is the usual
  mix-up; snap when attaching to a socket, keep-world when you want it to stay put.
- **Detaching without choosing a rule** — `KeepWorldTransform` is almost always what you want, so
  the component doesn't snap back to a stale relative transform.
- **Moving a `Static`/`Stationary` component at runtime** — set `Mobility = Movable` first.

## Version notes

- Attachment APIs and transform rules are stable across UE5. Line numbers drift between patches;
  re-grep `SceneComponent.h` / `EngineTypes.h` if a cite looks off.
