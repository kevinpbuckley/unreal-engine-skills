---
name: umg-and-slate
description: Build game UI in Unreal — UMG user widgets (UUserWidget), the widget tree (buttons,
  text, images, panels), creating/showing widgets from C++, the BindWidget pattern to wire C++ to
  a Widget Blueprint, event handling and data binding, Slate underpinnings, and CommonUI for
  input-routed/multiplatform UI. Use when creating HUDs/menus/widgets, wiring UI to gameplay in
  C++, handling button/input events, or choosing UMG vs Slate vs CommonUI.
metadata:
  engine-version: "5.7"
  category: ui
---

# UMG & Slate

Game UI is built with **UMG**: a Widget Blueprint defines a `UUserWidget` whose tree of `UWidget`s
(buttons, text, images, panels) you lay out visually. Underneath sits **Slate** (the C++ UI
framework). The clean pattern is a **C++ `UUserWidget` base** that binds to named widgets and holds
logic, with the Widget Blueprint doing layout/styling.

## When to use this skill

- Building a HUD, menu, inventory, or any on-screen widget.
- Wiring UI to gameplay data and handling button/input events in C++.
- Creating and showing/hiding widgets at runtime.
- Choosing UMG vs raw Slate vs CommonUI.

## The model

- **`UUserWidget`** — a reusable widget (the class behind a Widget Blueprint).
- **Widget tree** — `UWidget`s: `UButton`, `UTextBlock`, `UImage`, `UProgressBar`, and panels
  (`UCanvasPanel`, `UHorizontalBox`, `UVerticalBox`, `UGridPanel`, `UOverlay`).
- **Slate** — the immediate-ish C++ UI layer (`SWidget`) UMG is built on; you rarely write Slate
  for game UI (more for editor tools), but it's what runs under the hood.

## C++ base + Widget Blueprint (the BindWidget pattern)

Expose named widgets from the Blueprint to C++ with `meta=(BindWidget)` — the variable name must
match the widget's name in the Blueprint:

```cpp
// MyHUDWidget.h
#include "Blueprint/UserWidget.h"
#include "MyHUDWidget.generated.h"

UCLASS()
class MYGAME_API UMyHUDWidget : public UUserWidget
{
    GENERATED_BODY()
protected:
    virtual void NativeConstruct() override;          // like BeginPlay for widgets

    UPROPERTY(meta=(BindWidget)) TObjectPtr<class UTextBlock> ScoreText;     // name "ScoreText" in BP
    UPROPERTY(meta=(BindWidget)) TObjectPtr<class UButton>    StartButton;

    UFUNCTION() void OnStartClicked();
public:
    void SetScore(int32 Score);
};

// MyHUDWidget.cpp
void UMyHUDWidget::NativeConstruct()
{
    Super::NativeConstruct();
    if (StartButton) StartButton->OnClicked.AddDynamic(this, &UMyHUDWidget::OnStartClicked);
}
void UMyHUDWidget::SetScore(int32 Score)
{
    if (ScoreText) ScoreText->SetText(FText::AsNumber(Score));   // FText for display (core types skill)
}
```
`meta=(BindWidgetOptional)` if the widget may be absent. This gives programmers typed access while
designers own layout.

## Creating and showing widgets

```cpp
UMyHUDWidget* W = CreateWidget<UMyHUDWidget>(GetWorld(), HUDWidgetClass /*TSubclassOf<UUserWidget>*/);
// or CreateWidget(PlayerController, ...) to own it by a player
W->AddToViewport();          // show it
// W->RemoveFromParent();    // hide/remove
```
Hold the widget pointer in a `UPROPERTY` if you keep it around. Expose `HUDWidgetClass` as a
`UPROPERTY(EditAnywhere)` so designers assign the Widget Blueprint (`blueprint-cpp-integration`).

## Data binding & updates

- **Push from gameplay** (preferred): call setter functions like `SetScore` when values change —
  cheaper and clearer than polling.
- **Property bindings** in UMG (a function returning the value) are convenient but evaluate every
  frame — avoid for many widgets.
- For larger UIs, the **UMG Viewmodel (MVVM)** plugin provides a clean view-model binding system.

## Input & focus

- Widgets can receive keyboard/gamepad input via focus; override `NativeOnKeyDown` etc. for custom
  handling.
- For menus, set input mode via the PlayerController (`SetInputModeUIOnly`/`GameAndUI`) and manage
  the mouse cursor.

## CommonUI (recommended for real games)

The **CommonUI** plugin builds on UMG for production UI: consistent **input routing** across
keyboard/mouse/gamepad/touch, **activatable widgets** and a widget stack (menus/layers), styled
buttons, and multiplatform focus handling. Use it for anything beyond a trivial HUD; base your
widgets on `UCommonUserWidget`/`UCommonActivatableWidget`.

## Slate (when)

Reach for raw Slate for **editor tools/extensions** and bespoke widgets not expressible in UMG.
For game UI, stay in UMG/CommonUI.

## Gotchas

- **`BindWidget` name mismatch** → compile/load error ("not found"); the C++ name must equal the BP
  widget name (or use `BindWidgetOptional`).
- **Per-frame property bindings** across many widgets → CPU cost; push updates instead.
- **Widget not in a `UPROPERTY`** but kept around → GC'd (`unreal-memory-and-gc`).
- **Building text with `FString`** for display — use `FText` for localization (`unreal-core-types-and-containers`).
- **Gamepad/menu navigation pain** with plain UMG → use CommonUI for input routing.
- **Forgetting input mode/cursor** → menu doesn't receive clicks.

## References & source material

Engine source (UE 5.7):
- `Runtime/UMG/Public/Blueprint/UserWidget.h` — `UUserWidget`, `NativeConstruct`, `BindWidget`.
- `Runtime/UMG/Public/Components/Button.h`, `TextBlock.h`, `Image.h`, panel widgets — the `UWidget`s.
- CommonUI: `Engine/Plugins/Runtime/CommonUI/Source/CommonUI/Public/CommonUserWidget.h`.

Official docs (UE 5.7): Creating User Interfaces (UMG/Slate) —
<https://dev.epicgames.com/documentation/unreal-engine/creating-user-interfaces-with-umg-and-slate-in-unreal-engine>
