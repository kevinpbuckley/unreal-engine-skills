# Ability Tasks and Gameplay Cues

> Deep-dive reference for `UAbilityTask` and the Gameplay Cue system. Grounded in UE 5.7 source at
> `Engine/Plugins/Runtime/GameplayAbilities/Source/GameplayAbilities/Public/`.
> Return to [../SKILL.md](../SKILL.md) for the entry-level overview.

## Ability Task fundamentals

`UAbilityTask` (`Abilities/Tasks/AbilityTask.h:90`) extends `UGameplayTask` with ability-specific
wiring. Tasks are the primary mechanism for async work inside an ability: waiting for animation,
input, a delay, an attribute threshold, or a target selection.

**Pattern for using any task:**

1. Call the task's static factory function to create it (does not start it).
2. Bind output delegates (usually `DECLARE_DYNAMIC_MULTICAST_DELEGATE`-based).
3. Call `ReadyForActivation()` to start the task.
4. The task fires its delegates when done; handle them in `UFUNCTION` methods on the ability.
5. The task auto-ends when the parent ability ends, or ends itself via `EndTask()`.

```cpp
// Inside ActivateAbility
UAbilityTask_WaitDelay* DelayTask = UAbilityTask_WaitDelay::WaitDelay(this, 2.0f);
DelayTask->OnFinish.AddDynamic(this, &UGA_Example::OnDelayFinished);
DelayTask->ReadyForActivation();
```

`NewAbilityTask<T>` (`AbilityTask.h:136`) is the internal factory used by built-in tasks:
```cpp
template <class T>
static T* NewAbilityTask(UGameplayAbility* ThisAbility, FName InstanceName = FName());
```
Use this template when writing custom tasks; do not call `NewObject<T>` directly on `UAbilityTask`
subclasses.

## Task lifecycle

Tasks hold `TObjectPtr<UGameplayAbility> Ability` and `TWeakObjectPtr<UAbilitySystemComponent>
AbilitySystemComponent` (`AbilityTask.h:109,113`). When the ability ends, the ASC automatically
calls `EndTask` on all active tasks belonging to it, which calls `OnDestroy(true)`.

**Custom task checklist:**
- Override `Activate()` to begin work (not the factory function).
- Override `OnDestroy(bool bInOwnerFinished)` and call `Super::OnDestroy(...)` first; unregister
  all delegates and callbacks here to avoid dangling references.
- Output delegates must be `UPROPERTY()` `DECLARE_DYNAMIC_MULTICAST_DELEGATE` members; they fire
  into Blueprint execution pins.
- Use `ShouldBroadcastAbilityTaskDelegates()` before firing output delegates from callbacks to
  verify the owning ability is still active.

## Writing a custom task

```cpp
// MyAbilityTask_WaitInput.h
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnInputConfirmed);

UCLASS()
class UMyAbilityTask_WaitInput : public UAbilityTask
{
    GENERATED_BODY()
public:
    UPROPERTY(BlueprintAssignable) FOnInputConfirmed OnConfirmed;
    UPROPERTY(BlueprintAssignable) FOnInputConfirmed OnCancelled;

    // Factory
    UFUNCTION(BlueprintCallable, Category="Ability|Tasks",
        meta=(HidePin="OwningAbility", DefaultToSelf="OwningAbility", BlueprintInternalUseOnly=true))
    static UMyAbilityTask_WaitInput* WaitForInput(UGameplayAbility* OwningAbility);

    virtual void Activate() override;
    virtual void OnDestroy(bool bInOwnerFinished) override;

private:
    void OnConfirmCallback();
    void OnCancelCallback();
    FDelegateHandle ConfirmHandle;
    FDelegateHandle CancelHandle;
};
```

```cpp
// MyAbilityTask_WaitInput.cpp
UMyAbilityTask_WaitInput* UMyAbilityTask_WaitInput::WaitForInput(UGameplayAbility* OwningAbility)
{
    return NewAbilityTask<UMyAbilityTask_WaitInput>(OwningAbility);
}

void UMyAbilityTask_WaitInput::Activate()
{
    if (AbilitySystemComponent.IsValid())
    {
        ConfirmHandle = AbilitySystemComponent->GenericLocalConfirmCallbacks.AddUObject(
            this, &UMyAbilityTask_WaitInput::OnConfirmCallback);
        CancelHandle = AbilitySystemComponent->GenericLocalCancelCallbacks.AddUObject(
            this, &UMyAbilityTask_WaitInput::OnCancelCallback);
    }
}

void UMyAbilityTask_WaitInput::OnDestroy(bool bInOwnerFinished)
{
    if (AbilitySystemComponent.IsValid())
    {
        AbilitySystemComponent->GenericLocalConfirmCallbacks.Remove(ConfirmHandle);
        AbilitySystemComponent->GenericLocalCancelCallbacks.Remove(CancelHandle);
    }
    Super::OnDestroy(bInOwnerFinished);
}
```

## Built-in tasks (UE 5.7)

All live under `Abilities/Tasks/` in the plugin's Public folder.

| Task | Purpose |
|---|---|
| `UAbilityTask_WaitDelay` | Fires `OnFinish` after a timer |
| `UAbilityTask_PlayMontageAndWait` | Plays an `UAnimMontage`, fires `OnCompleted`/`OnBlendOut`/`OnInterrupted`/`OnCancelled` |
| `UAbilityTask_WaitGameplayEvent` | Fires `EventReceived(FGameplayEventData)` when a matching tag event occurs |
| `UAbilityTask_WaitTargetData` | Spawns a `AGameplayAbilityTargetActor` and fires `ValidData`/`Cancelled` |
| `UAbilityTask_WaitAttributeChange` | Fires when an attribute crosses a direction threshold |
| `UAbilityTask_WaitAttributeChangeThreshold` | Fires above/below a specific value |
| `UAbilityTask_WaitGameplayEffectApplied_Self` / `_Target` | Fires when a matching GE is applied |
| `UAbilityTask_WaitGameplayEffectRemoved` | Fires when a specific active GE is removed |
| `UAbilityTask_WaitInputPress` / `WaitInputRelease` | Input-driven tasks (legacy input binding) |
| `UAbilityTask_NetworkSyncPoint` | Synchronizes between client and server at a named point |
| `UAbilityTask_SpawnActor` | Spawns an actor; supports `ExposeOnSpawn` via deferred spawn |

For `WaitGameplayEvent`, fire from outside with `ASC->HandleGameplayEvent(Tag, &Payload)` or
`UAbilitySystemBlueprintLibrary::SendGameplayEventToActor`.

## Gameplay Cues

Gameplay Cues are cosmetic effects (VFX, SFX, decals, camera shakes) that are replicated
efficiently through the ASC. They are **not** meant to affect gameplay state — if the client misses
one, nothing breaks. Their tag must start with `GameplayCue.`

### Cue types

| Class | Use for |
|---|---|
| `UGameplayCueNotify_Static` (`GameplayCueNotify_Static.h:19`) | Stateless, one-shot cues: hit sparks, damage numbers. Override `OnExecute`, `OnActive`, `OnRemove`. No actor spawned. |
| `AGameplayCueNotify_Actor` (`GameplayCueNotify_Actor.h:20`) | Spawns a reusable actor in the world; handles `OnActive`, `WhileActive`, `OnRemove`. Good for looping effects (burning aura). |
| `UGameplayCueNotify_Burst` | Simplified static one-shot (inherits `UGameplayCueNotify_Static`). |
| `UGameplayCueNotify_Looping` | Simplified actor-based looping cue. |

### Triggering cues

From the ASC (replicated automatically):
```cpp
FGameplayEffectContextHandle Ctx = ASC->MakeEffectContext();

// One-shot (maps to OnExecute)
ASC->ExecuteGameplayCue(FGameplayTag::RequestGameplayTag("GameplayCue.FireHit"), Ctx);

// Persistent add/remove (maps to OnActive/OnRemove)
ASC->AddGameplayCue(FGameplayTag::RequestGameplayTag("GameplayCue.Burning"), Ctx);
ASC->RemoveGameplayCue(FGameplayTag::RequestGameplayTag("GameplayCue.Burning"));
```

`ExecuteGameplayCue`:881, `AddGameplayCue`:885, `RemoveGameplayCue`:892 in `AbilitySystemComponent.h`.

Cues can also be embedded directly in a `UGameplayEffect` as `GameplayCues` entries; they
automatically fire `OnActive`/`OnRemove` when the GE is applied/removed.

### Cue routing and the GameplayCue manager

`UGameplayCueManager` (`GameplayCueManager.h`) scans configured paths at startup to build a
mapping from `GameplayCue.*` tags to `UGameplayCueNotify` classes. Configure scan paths in
Project Settings → GameplayAbilities → Gameplay Cue Notify Paths (defaults to `/Game`). In large
projects, restrict the path to avoid scanning all content.

For `Minimal` replication mode, use `AddGameplayCue_MinimalReplication` so the cue replicates
correctly even though full GE data is not.

### Async Gameplay Cue nodes

`UAbilityAsync_WaitGameplayEvent` (`Abilities/Async/`) provides Blueprint-accessible async nodes
that work outside of an ability context (in actor Blueprints).
