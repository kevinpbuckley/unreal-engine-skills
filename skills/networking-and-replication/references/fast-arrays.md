# FFastArraySerializer — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the `FFastArraySerializer` step-by-step setup,
`MarkItemDirty` / `MarkArrayDirty`, per-element callbacks, and when to use fast arrays vs plain
`TArray`. Grounded in UE 5.7
(`Runtime/Net/Core/Classes/Net/Serialization/FastArraySerializer.h`).

## When to use FFastArraySerializer

A plain `UPROPERTY(Replicated) TArray<FMyStruct>` replicates the **entire array** when any
element changes. For large or frequently-modified arrays this wastes bandwidth and CPU.

`FFastArraySerializer` is a custom delta serializer that tracks changes per element using
stable IDs and replication keys. It sends only the changed/added/removed elements. It also
provides per-element callbacks on the client for adds, removals, and changes — impossible with
plain array replication.

Trade-offs:
- More setup code.
- Requires explicit dirty-marking (`MarkItemDirty`) at every write site.
- Element **order** is not guaranteed to match between server and client.
- Supports TArray only (not TMap/TSet).

## Step-by-step setup

### Step 1: Item struct — inherit FFastArraySerializerItem

```cpp
// MyInventoryTypes.h
#include "Net/Serialization/FastArraySerializer.h"
#include "MyInventoryTypes.generated.h"

USTRUCT()
struct FInventoryItem : public FFastArraySerializerItem
{
    GENERATED_BODY()

    UPROPERTY()
    int32 ItemId = 0;

    UPROPERTY()
    int32 Count = 0;

    // Optional: called on the client for per-element notifications.
    // Do NOT modify the array or rely on a fully consistent array state inside these.
    void PostReplicatedAdd(const struct FInventoryArray& InArray);
    void PostReplicatedChange(const struct FInventoryArray& InArray);
    void PreReplicatedRemove(const struct FInventoryArray& InArray);
};
```

### Step 2: Array wrapper — inherit FFastArraySerializer

```cpp
USTRUCT()
struct FInventoryArray : public FFastArraySerializer
{
    GENERATED_BODY()

    UPROPERTY()
    TArray<FInventoryItem> Items;        // MUST be named Items (convention; any name works
                                         // as long as it matches the template call below)

    bool NetDeltaSerialize(FNetDeltaSerializeInfo& DeltaParms)
    {
        return FFastArraySerializer::FastArrayDeltaSerialize<
            FInventoryItem, FInventoryArray>(Items, DeltaParms, *this);
    }
};

// Step 3: struct traits — enables the custom delta serializer
template<>
struct TStructOpsTypeTraits<FInventoryArray>
    : public TStructOpsTypeTraitsBase2<FInventoryArray>
{
    enum { WithNetDeltaSerializer = true };
};
```

### Step 4: Use it in the actor

```cpp
// AMyCharacter.h
UPROPERTY(Replicated)
FInventoryArray Inventory;

virtual void GetLifetimeReplicatedProps(
    TArray<FLifetimeProperty>& OutLifetimeProps) const override;
```

```cpp
// AMyCharacter.cpp
#include "Net/UnrealNetwork.h"

void AMyCharacter::GetLifetimeReplicatedProps(
    TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);
    DOREPLIFETIME(AMyCharacter, Inventory);   // register the wrapper, not the TArray
}
```

### Step 5: Modifying items — always mark dirty

```cpp
void AMyCharacter::AddItem(int32 ItemId, int32 Count)
{
    if (!HasAuthority()) return;

    FInventoryItem& New = Inventory.Items.AddDefaulted_GetRef();
    New.ItemId = ItemId;
    New.Count  = Count;
    Inventory.MarkItemDirty(New);    // REQUIRED after adding or modifying an element
}

void AMyCharacter::RemoveItem(int32 Index)
{
    if (!HasAuthority()) return;

    Inventory.Items.RemoveAt(Index);
    Inventory.MarkArrayDirty();      // REQUIRED after any removal
}

void AMyCharacter::UpdateItemCount(int32 Index, int32 NewCount)
{
    if (!HasAuthority()) return;

    Inventory.Items[Index].Count = NewCount;
    Inventory.MarkItemDirty(Inventory.Items[Index]);
}
```

Forgetting `MarkItemDirty` or `MarkArrayDirty` means the change is never sent to clients.

## Per-element callbacks

Implement these on the item struct. They run on the client after each delta is applied:

| Function | When called |
|---|---|
| `PostReplicatedAdd` | A new element arrived from the server |
| `PostReplicatedChange` | An existing element's data changed |
| `PreReplicatedRemove` | An element is about to be removed locally (before removal) |
| `PostReplicatedReceive` | Called once after all per-element callbacks for a single update |

These are called per element as the delta is processed — the array may not be fully consistent
when they fire. Do not modify `Items` from inside them.

## Fast arrays and Push Model

When using Push Model alongside `FFastArraySerializer`, marking the array dirty is handled by
`MarkItemDirty` / `MarkArrayDirty` internally. Register the property with `bIsPushBased = true`
in `GetLifetimeReplicatedProps`, and use `DOREPLIFETIME_WITH_PARAMS_FAST` (Iris also requires
`CreateAndRegisterReplicationFragmentFunction` to be set, which `FixupParams` handles
automatically for fast-array types in `UnrealNetwork.h`:379–390).

## Fast arrays vs alternatives

| Scenario | Best choice |
|---|---|
| Small, rarely-changed array (< 8 items) | Plain `UPROPERTY(Replicated) TArray<>` |
| Large or frequently-modified array | `FFastArraySerializer` |
| Need per-element add/remove events | `FFastArraySerializer` |
| Ability/task list (GAS) | `FFastArraySerializer` (GAS uses it internally) |
| Ordered collection where order matters | Plain replicated `TArray` (fast array order is not guaranteed) |

## Source references (UE 5.7)

- `Runtime/Net/Core/Classes/Net/Serialization/FastArraySerializer.h` — usage pattern :60–134,
  `FFastArraySerializer` :~300, `FFastArraySerializerItem`, `MarkItemDirty`, `MarkArrayDirty`,
  `FastArrayDeltaSerialize`, per-element callback signatures :83–85.
- `Runtime/Engine/Public/Net/UnrealNetwork.h`:379–390 — `FixupParams` for fast-array Iris
  registration.
