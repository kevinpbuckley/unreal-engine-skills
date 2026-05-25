# AnimInstance & update pipeline — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the full per-frame update pipeline,
the game-thread / worker-thread split, the `UAnimInstanceProxy`, Property Access, and
writing thread-safe Blueprint functions. Grounded in UE 5.7
(`Runtime/Engine/Classes/Animation/AnimInstance.h`,
`Runtime/Engine/Public/Animation/AnimInstanceProxy.h`).

## The update pipeline

Each skeletal mesh tick drives the animation update in this order:

1. **`TickAnimation`** (game thread) — advances montage timers, queues notify events.
2. **`NativeUpdateAnimation(DeltaSeconds)`** (game thread) — your per-frame game-thread
   code; keep minimal; call `Super` first.
3. **`NativeThreadSafeUpdateAnimation(DeltaSeconds)`** (anim worker thread if
   `bUseMultiThreadedAnimationUpdate` is true, else game thread) — heavy per-frame
   logic goes here; no world queries, no spawning, no non-thread-safe calls.
4. **AnimGraph evaluation** (anim worker thread) — state machines, blend spaces, and all
   graph nodes evaluate the final pose using the variables written by steps 2–3.
5. **`NativePostEvaluateAnimation`** (game thread) — runs after the pose is computed;
   useful for reading back foot IK results.
6. **`NativeUninitializeAnimation`** — runs when the AnimInstance is torn down (mesh
   destroyed, class swap).

`bUseMultiThreadedAnimationUpdate` is set on the `UAnimBlueprint` asset (default: true).
Disabling it forces everything onto the game thread — do this only to isolate threading bugs,
not in production.

## Caching references safely

References to the owner actor or its components must be cached on the **game thread**. The
worker thread must only read them — never write to or acquire new UObject pointers there.

```cpp
void UMyAnimInstance::NativeInitializeAnimation()
{
    Super::NativeInitializeAnimation();
    // TryGetPawnOwner() / GetOwningActor() are safe here (game thread)
    OwnerCharacter = Cast<ACharacter>(TryGetPawnOwner());
    if (OwnerCharacter)
    {
        Movement = OwnerCharacter->GetCharacterMovement();
    }
}
```

If the owner changes (e.g. possession swap), re-cache in `NativeUpdateAnimation` with a
null-check before the heavy work in `NativeThreadSafeUpdateAnimation`.

## Property Access (thread-safe variable reading)

The **Property Access** system lets AnimGraph nodes read C++ / Blueprint properties safely
without requiring you to manually cache them in the update. In the AnimBP editor you bind
node pins to property paths; the compiler generates thread-safe copies automatically.

For C++ properties you want accessible via Property Access, mark them:

```cpp
UPROPERTY(BlueprintReadOnly, Category="Locomotion")
float Speed = 0.f;
```

Properties accessed via Property Access must not have non-trivially-destructible types
(prefer `float`, `bool`, `int32`, `FVector`, `FRotator`, `FGameplayTag`).

## Thread-safe Blueprint functions

To call a Blueprint-implemented function from inside the AnimGraph (which runs on the worker
thread), mark the `UFUNCTION` as `BlueprintThreadSafe`:

```cpp
UFUNCTION(BlueprintCallable, BlueprintThreadSafe, Category="Animation")
float ComputeBlendWeight() const;
```

Only thread-safe APIs may be called inside such functions. The engine validates this at
compile time in the AnimBP editor; violations appear as warnings.

## `UAnimInstanceProxy`

For plugins or advanced use-cases, `UAnimInstanceProxy` exposes the internal state of
`UAnimInstance` to the animation worker thread. Custom proxy types can store data that
the graph nodes read directly without going through the public property layer:

```cpp
class FMyAnimInstanceProxy : public FAnimInstanceProxy
{
public:
    // Override PreUpdate, Update, PostUpdate for thread-safe data marshaling
    virtual void PreUpdate(UAnimInstance* InAnimInstance, float DeltaSeconds) override;
};
```

Most game projects do not need a custom proxy; use `NativeThreadSafeUpdateAnimation` instead.

## Callbacks summary

| Override | Thread | Call Super? | Purpose |
|---|---|---|---|
| `NativeInitializeAnimation` | Game | Yes | Cache references, one-time setup |
| `NativeBeginPlay` | Game | Yes | Analog to actor `BeginPlay` for the anim instance |
| `NativeUpdateAnimation` | Game | Yes | Lightweight game-thread update |
| `NativeThreadSafeUpdateAnimation` | Worker | Yes | Heavy per-frame logic |
| `NativePostEvaluateAnimation` | Game | Yes | Read back computed pose data (e.g. IK results) |
| `NativeUninitializeAnimation` | Game | Yes | Cleanup on teardown |

## Related

- Engine source: `AnimInstance.h` lines 1372–1391 — all `Native*` virtual overrides.
- Engine source: `AnimInstanceProxy.h` — `FAnimInstanceProxy`, `PreUpdate`, `Update`.
- Official doc: [Animation Blueprints](https://dev.epicgames.com/documentation/unreal-engine/animation-blueprints-in-unreal-engine)
- Official doc: [How to Get Animation Variables](https://dev.epicgames.com/documentation/unreal-engine/how-to-get-animation-variables-in-animation-blueprints-in-unreal-engine)
