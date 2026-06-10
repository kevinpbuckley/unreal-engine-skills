---
skill: umg-and-slate
title: C++ HUD widget with BindWidget and dynamic updates
---

## Prompt

In an Unreal Engine 5.7 C++ project module named `EvalScratch`, build a HUD: a C++
`UUserWidget` base class with a health progress bar and an ammo text block that
designers lay out in the Blueprint subclass, a `SetHealth(float Current, float Max)` /
`SetAmmo(int32 Clip, int32 Reserve)` API, and player-controller code that creates the
widget at startup and shows it. Localization-safe text only.

## Acceptance criteria

- Build.cs adds `UMG` (and `Slate`/`SlateCore` if Slate types are referenced).
- Widget members declared `UPROPERTY(meta = (BindWidget))` with types/names that a UMG
  designer must match (`UProgressBar* HealthBar`, `UTextBlock* AmmoText` or TObjectPtr
  equivalents); no manual `GetWidgetFromName` calls.
- Initialization overrides `NativeConstruct` (calling `Super::NativeConstruct()`), not
  the Blueprint `Construct` event or constructor.
- Creation path: `CreateWidget<UMyHudWidget>(PlayerController, WidgetClass)` with a
  `TSubclassOf<UMyHudWidget>` UPROPERTY, then `AddToViewport()`; widget class checked
  for null.
- Ammo text built with `FText::Format`/`FText::AsNumber` (or `FText::FromString` of a
  formatted FString at minimum) — not `FText::FromString(FString::FromInt(...))`
  concatenation per frame in Tick; updates are event-driven via the setter API.
- Progress bar set via `SetPercent(Current / Max)` with divide-by-zero guard.

## Common baseline failures

Missing `meta=(BindWidget)` (null members at runtime), creating the widget in the pawn
constructor, forgetting `AddToViewport`, driving updates from `NativeTick`, or using
`FString` where `FText` is required.
