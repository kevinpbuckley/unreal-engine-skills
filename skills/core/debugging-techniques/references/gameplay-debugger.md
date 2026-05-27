# Gameplay Debugger — custom categories

Deep dive for [../SKILL.md](../SKILL.md). Grounded in UE 5.7
(`Engine/Source/Runtime/GameplayDebugger/Public/`).

## Architecture overview

The Gameplay Debugger is a live in-game overlay that presents data organized into named
**categories**. Categories have two sides:

- **Auth side** (`CollectData`) — runs on the machine with authority (server or standalone).
  Gathers data by calling `AddTextLine` and `AddShape`, or by populating a custom replicated
  data struct. This data is automatically sent to the client.
- **Local side** (`DrawData`) — runs on the local client every frame. Renders the replicated
  text lines and shapes, then adds any custom drawing on top.

This split means the Gameplay Debugger works correctly in networked games without any extra
replication code for basic text and shape data.

## Module and build setup

Add to your module's `Build.cs`:

```csharp
// Conditionally adds the GameplayDebugger dependency (respects bUseGameplayDebugger target setting)
SetupGameplayDebuggerSupport(Target);
```

This sets `WITH_GAMEPLAY_DEBUGGER` (full tool including menu) and/or `WITH_GAMEPLAY_DEBUGGER_CORE`
(just the core, user-registered categories only). Guard **all** category code:

```cpp
#if WITH_GAMEPLAY_DEBUGGER
// category includes and class bodies go here
#endif
```

## Implementing a category

```cpp
// MySystemCategory.h
#pragma once
#if WITH_GAMEPLAY_DEBUGGER
#include "GameplayDebuggerCategory.h"

class FMySystemCategory : public FGameplayDebuggerCategory
{
public:
    FMySystemCategory();
    static TSharedRef<FGameplayDebuggerCategory> MakeInstance()
    {
        return MakeShared<FMySystemCategory>();
    }

    virtual void CollectData(APlayerController* OwnerPC, AActor* DebugActor) override;
    virtual void DrawData(APlayerController* OwnerPC,
                          FGameplayDebuggerCanvasContext& CanvasContext) override;

    // Optional: replicate a custom struct
    struct FRepData
    {
        float MyValue = 0.f;
        FString MyString;
        void Serialize(FArchive& Ar) { Ar << MyValue << MyString; }
    };
    FRepData RepData;
};
#endif
```

```cpp
// MySystemCategory.cpp
#if WITH_GAMEPLAY_DEBUGGER
#include "MySystemCategory.h"
#include "GameplayDebuggerTypes.h"

FMySystemCategory::FMySystemCategory()
{
    bShowOnlyWithDebugActor = true;   // only draw when an actor is selected
    SetDataPackReplication<FRepData>(&RepData);  // register struct for replication
}

void FMySystemCategory::CollectData(APlayerController* OwnerPC, AActor* DebugActor)
{
    // AddTextLine supports {color} tags: {red}, {green}, {yellow}, {white}, {grey}
    AddTextLine(FString::Printf(TEXT("{yellow}MyValue: {white}%.2f"), RepData.MyValue));

    // AddShape renders geometry on the local side automatically
    FVector Loc = DebugActor ? DebugActor->GetActorLocation() : FVector::ZeroVector;
    AddShape(FGameplayDebuggerShape::MakeSphere(Loc, 60.f, FColor::Green, TEXT("Radius")));
}

void FMySystemCategory::DrawData(APlayerController* OwnerPC,
                                 FGameplayDebuggerCanvasContext& CanvasContext)
{
    // Replicated lines and shapes from CollectData are drawn before this function runs.
    // Add extra client-local rendering here if needed.
    CanvasContext.Print(TEXT("Extra local info"));
}
#endif
```

## Registering and unregistering

```cpp
// YourModule.cpp — StartupModule:
#if WITH_GAMEPLAY_DEBUGGER
    IGameplayDebugger& GDB = IGameplayDebugger::Get();
    GDB.RegisterCategory(
        TEXT("MySystem"),
        IGameplayDebugger::FOnGetCategory::CreateStatic(
            &FMySystemCategory::MakeInstance),
        EGameplayDebuggerCategoryState::EnabledInGameAndSimulate,
        /*SlotIdx=*/INDEX_NONE   // auto-assign slot; 0–9 map to numeric keys
    );
    GDB.NotifyCategoriesChanged();
#endif

// YourModule.cpp — ShutdownModule:
#if WITH_GAMEPLAY_DEBUGGER
    if (IGameplayDebugger::IsAvailable())
    {
        IGameplayDebugger& GDB = IGameplayDebugger::Get();
        GDB.UnregisterCategory(TEXT("MySystem"));
        GDB.NotifyCategoriesChanged();
    }
#endif
```

`EGameplayDebuggerCategoryState` options:
- `EnabledInGameAndSimulate` — available in both PIE and Simulate In Editor.
- `EnabledInGame` — only active during full PIE.
- `EnabledInSimulate` — only active during Simulate.
- `Disabled` — registered but off by default (user must toggle it on).

## Replication for custom structs

Use `SetDataPackReplication<T>(&MyStruct)` to replicate any struct that implements `Serialize`.
The struct is compared by CRC before sending; call `MarkDataPackDirty()` if you change it but
the CRC comparison misses the change (e.g. floating-point-equal values that differ logically).

## Custom key bindings in a category

```cpp
// In the category constructor:
BindKeyPress(EKeys::Q, FGameplayDebuggerInputModifier::Shift,
             this, &FMySystemCategory::OnKeyPressed,
             EGameplayDebuggerInputMode::Local);
```

Key bindings are active only while the category is displayed, preventing conflicts with game
input.

## Shape helpers

`FGameplayDebuggerShape` provides static factory methods:

```cpp
FGameplayDebuggerShape::MakeSphere(Center, Radius, Color, OptLabel)
FGameplayDebuggerShape::MakeBox(Center, Extent, Color, OptLabel)
FGameplayDebuggerShape::MakeCapsule(Center, HalfHeight, Radius, Color, OptLabel)
FGameplayDebuggerShape::MakeSegment(Start, End, Color, OptLabel)
FGameplayDebuggerShape::MakeCylinder(Start, End, Radius, Color, OptLabel)
```

Source: `Runtime/GameplayDebugger/Public/GameplayDebuggerTypes.h`.

## Source references (UE 5.7)

- `Runtime/GameplayDebugger/Public/GameplayDebugger.h` — `IGameplayDebugger`:50,
  `RegisterCategory`:78, `UnregisterCategory`:79, `NotifyCategoriesChanged`:80.
- `Runtime/GameplayDebugger/Public/GameplayDebuggerCategory.h` — `FGameplayDebuggerCategory`:48,
  `CollectData`:56, `DrawData`:59, `AddTextLine`:68, `AddShape`:71, `SetDataPackReplication` and
  `MarkDataPackDirty` declared in the protected section.
- `Runtime/GameplayDebugger/Public/GameplayDebuggerTypes.h` — `FGameplayDebuggerShape` factory
  methods and `EGameplayDebuggerCategoryState` enum.
- `Runtime/GameplayDebugger/Public/GameplayDebuggerAddonBase.h` — `BindKeyPress`,
  `EGameplayDebuggerInputMode`.
