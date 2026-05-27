# Dynamic delegates and Blueprint wiring — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `DECLARE_DYNAMIC_MULTICAST_DELEGATE`
mechanics, `AddDynamic`/`RemoveDynamic`/`BindDynamic`, the `UDELEGATE` specifier,
Blueprint event dispatcher wiring, serialization, and the performance trade-offs
of dynamic delegates. Grounded in UE 5.7
(`Engine/Source/Runtime/Core/Public/Delegates/DelegateSignatureImpl.inl`,
`Delegates/Delegate.h`, official
[Dynamic Delegates](https://dev.epicgames.com/documentation/unreal-engine/dynamic-delegates-in-unreal-engine)
doc).

## Why dynamic delegates exist

Dynamic delegates integrate with the UObject reflection system. Consequences:

- **Blueprint-visible**: a `UPROPERTY(BlueprintAssignable)` dynamic multicast delegate
  appears as an Event Dispatcher in Blueprint. Blueprint graphs can bind custom events
  to it with an `Assign` node and fire it (if also `BlueprintCallable`).
- **Serializable**: bindings can be saved to disk and restored; the engine identifies
  handlers by function name string rather than raw pointer.
- **Slower**: each call routes through the reflection system (name lookup) rather than
  a direct vtable/function pointer. For hot-path code (per-frame tight loops), prefer
  non-dynamic multicast.
- **`UFUNCTION` required**: every method bound to a dynamic delegate must be marked
  `UFUNCTION()`. The macro wrappers generate the function name string from the method
  pointer at compile time — binding a non-`UFUNCTION` is a compile or registration error.

## Declaring a dynamic multicast delegate

```cpp
// Named params required for reflection — type then name, for each param
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(
    FOnItemCollected,
    AItem*, Item,
    int32,  NewCount);

UCLASS()
class MYGAME_API AInventory : public AActor
{
    GENERATED_BODY()
public:
    // BlueprintAssignable exposes this as an Event Dispatcher in BP
    UPROPERTY(BlueprintAssignable, Category="Inventory")
    FOnItemCollected OnItemCollected;
};
```

## `AddDynamic`, `RemoveDynamic`, `BindDynamic`

These are macros — not direct function calls. They auto-generate the function name
string so you never have to pass `FName(TEXT("HandleItemCollected"))` manually.

```cpp
// The handler must have the EXACT signature and be a UFUNCTION()
UFUNCTION()
void HandleItemCollected(AItem* Item, int32 NewCount);

// In BeginPlay
Inventory->OnItemCollected.AddDynamic(this, &AMyHud::HandleItemCollected);

// Removing — must supply the same object and function pointer
Inventory->OnItemCollected.RemoveDynamic(this, &AMyHud::HandleItemCollected);

// For single-cast dynamic delegate (rare)
MyDelegate.BindDynamic(this, &AMyActor::HandleEvent);
```

`RemoveDynamic` finds the binding by name-string comparison, so the function pointer
must be exactly the same method that was passed to `AddDynamic`. You cannot
`RemoveDynamic` a non-dynamic binding or vice versa.

## UPROPERTY specifiers for event dispatchers

| Specifier | Effect |
|---|---|
| `BlueprintAssignable` | Exposes the delegate in Blueprint (Assign node, bind custom events) |
| `BlueprintCallable` | Allows Blueprint graphs to fire the event via a `Call` node |
| `BlueprintAuthorityOnly` | Delegate can only be bound/called on authority (server) |

Example with `UDELEGATE`:

```cpp
UDELEGATE(BlueprintAuthorityOnly)
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnServerEvent, FString, Message);

UPROPERTY(BlueprintAssignable, BlueprintCallable, Category="Net")
FOnServerEvent OnServerEvent;
```

`UDELEGATE` applies UFUNCTION-style specifiers to a dynamic delegate declaration.
It must immediately precede the `DECLARE_DYNAMIC_*` macro on the next line.

## Blueprint event dispatcher wiring

In Blueprint, a `BlueprintAssignable` dynamic multicast delegate appears under the
"Event Dispatchers" section. Blueprint can:

1. **Assign** a custom event to the dispatcher (equivalent to `AddDynamic`).
2. **Unbind** or **Unbind All** (equivalent to `RemoveDynamic` / `RemoveAll`).
3. **Call** the dispatcher if it is also `BlueprintCallable` (fires `Broadcast`).

On the C++ side, when Blueprint binds a custom event, the binding is stored as an
`FScriptDelegate` (a `TWeakObjectPtr<UObject>` + `FName`). This is why the function
name must be resolvable at runtime — it is looked up by name on the target Blueprint
object.

## Serialization

Dynamic delegate bindings on `UPROPERTY` members of `UObject`-derived classes are
serialized as part of the object's property serialization. When an actor with a
`UPROPERTY(BlueprintAssignable)` delegate is saved to a level, any Blueprint-created
bindings are saved too. This is unique to dynamic delegates — non-dynamic multicast
bindings are runtime-only and not persisted.

This also means dynamic delegate bindings participate in undo/redo in the editor.

## Performance notes

- Dynamic delegate function resolution involves a `FindFunction` call on the
  `UObject`'s class — roughly equivalent to a `TMap` lookup by name. Not suitable for
  per-frame use with many listeners.
- For performance-critical paths, bind at `BeginPlay` (once) and keep the binding for
  the object's lifetime. The overhead is in the lookup at bind time and in the virtual
  dispatch during `Broadcast`, not in storage.
- When maximum throughput matters and Blueprint visibility is not needed, replace
  `DECLARE_DYNAMIC_MULTICAST_DELEGATE` with `DECLARE_MULTICAST_DELEGATE` — all other
  code (declaring, broadcasting) stays the same.

## Worked example — inventory pickup with Blueprint notification

```cpp
// InventoryComponent.h
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnPickup, FName, ItemId);

UCLASS(ClassGroup=Inventory, meta=(BlueprintSpawnableComponent))
class MYGAME_API UInventoryComponent : public UActorComponent
{
    GENERATED_BODY()
public:
    UPROPERTY(BlueprintAssignable, Category="Inventory")
    FOnPickup OnPickup;

    void AddItem(FName Id)
    {
        Items.Add(Id);
        OnPickup.Broadcast(Id);   // notifies both C++ and Blueprint listeners
    }

private:
    TArray<FName> Items;
};

// PlayerHUD.h / .cpp
UFUNCTION()
void HandlePickup(FName ItemId);   // MUST be UFUNCTION

void APlayerHUD::BeginPlay()
{
    Super::BeginPlay();
    if (UInventoryComponent* Inv = GetOwner()->FindComponentByClass<UInventoryComponent>())
    {
        Inv->OnPickup.AddDynamic(this, &APlayerHUD::HandlePickup);
    }
}

void APlayerHUD::EndPlay(const EEndPlayReason::Type Reason)
{
    Super::EndPlay(Reason);
    if (UInventoryComponent* Inv = GetOwner()->FindComponentByClass<UInventoryComponent>())
    {
        Inv->OnPickup.RemoveDynamic(this, &APlayerHUD::HandlePickup);
    }
}
```

Blueprint graphs can simultaneously bind their own custom events to the same
`OnPickup` dispatcher using an Assign node — no C++ changes required.
