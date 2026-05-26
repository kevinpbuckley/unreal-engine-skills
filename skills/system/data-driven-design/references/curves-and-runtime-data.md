# Curves and Runtime Data — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `UCurveFloat`, `UCurveTable`,
`FRuntimeFloatCurve`, and `FCurveTableRowHandle`. Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Classes/Curves/CurveFloat.h`,
`Engine/Source/Runtime/Engine/Classes/Engine/CurveTable.h`).

## UCurveFloat

`UCurveFloat` (`CurveFloat.h`:30) is `UCLASS(BlueprintType, MinimalAPI)` and inherits from
`UCurveBase`. It wraps a `FRichCurve FloatCurve`:36, an interpolated keyframe sequence.

```cpp
UPROPERTY(EditAnywhere, Category="Tuning")
TObjectPtr<UCurveFloat> XPPerLevel;

float GetXPRequired(int32 Level) const
{
    return XPPerLevel ? XPPerLevel->GetFloatValue(static_cast<float>(Level)) : 0.f;
}
```

`GetFloatValue(float InTime)`:44 evaluates the curve at the given input. The `FRichCurve`
supports several interpolation modes per tangent pair: `RCIM_Constant`, `RCIM_Linear`,
`RCIM_Cubic`. The default is Cubic with auto-tangents.

`UCurveFloat` is a `BlueprintCallable` — Blueprint graphs can call `GetFloatValue` directly
on a curve reference.

## UCurveTable

`UCurveTable` (`CurveTable.h`:40) stores multiple named curves in one asset, keyed by `FName`.
The internal map is `TMap<FName, FRealCurve*>`:76, where `FRealCurve` is the common base of
`FRichCurve` and `FSimpleCurve`.

```cpp
UPROPERTY(EditAnywhere) TObjectPtr<UCurveTable> WeaponDamageCurves;

float GetWeaponDamage(FName WeaponName, float Range) const
{
    if (FRichCurve* Curve = WeaponDamageCurves->FindRichCurve(WeaponName, TEXT("WpnDmg")))
        return Curve->Eval(Range);
    return 0.f;
}
```

API:
- `FindCurve(RowName, Context)`:129 — returns `FRealCurve*` (common base; works for both modes).
- `FindRichCurve(RowName, Context)`:148 — asserts if the table is in `SimpleCurves` mode.
- `FindSimpleCurve(RowName, Context)`:159 — asserts if the table is in `RichCurves` mode.
- `GetCurveTableMode()`:57 — returns `ECurveTableMode` (`Empty`, `SimpleCurves`, `RichCurves`).

`SimpleCurves` mode only supports two keyframes (linear interpolation between two points), so
use `RichCurves` mode (the default) when you need tangent control.

## FCurveTableRowHandle

`FCurveTableRowHandle` (`CurveTable.h`:260) is the picker equivalent of `FDataTableRowHandle`
for curves. Expose it in `UPROPERTY` so designers can select the table and curve name:

```cpp
UPROPERTY(EditAnywhere, BlueprintReadWrite)
FCurveTableRowHandle DamageCurveHandle;

float GetDamage(float Distance) const
{
    return DamageCurveHandle.Eval(Distance, TEXT("Damage"));
}
```

`Eval(XValue, Context)`:303 returns 0.f if the handle points to nothing; `IsNull()`:283 checks
for an unset handle; `GetRichCurve(Context)`:293 returns the `FRichCurve*` for advanced use.

## FRuntimeFloatCurve

`FRuntimeFloatCurve` (`CurveFloat.h`:12) is a `USTRUCT` that embeds a `FRichCurve` inline
*and* optionally points to an external `UCurveFloat`. The intent is to give designers the
flexibility to author the curve directly in the Details panel or swap in a shared asset.

```cpp
UPROPERTY(EditAnywhere, Category="Motion")
FRuntimeFloatCurve SpeedOverTime;

float GetCurrentSpeed(float ElapsedTime) const
{
    // GetRichCurveConst uses the external asset if set, else the inline data
    const FRichCurve* C = SpeedOverTime.GetRichCurveConst();
    return C ? C->Eval(ElapsedTime) : 0.f;
}
```

Fields in `FRuntimeFloatCurve`:
- `EditorCurveData FRichCurve`:17 — the inline keyframe data (editor-only; see note below).
- `ExternalCurve TObjectPtr<UCurveFloat>`:20 — if set, runtime evaluation uses this instead.

`GetRichCurve()`:25 — mutable accessor; returns the external curve's `FloatCurve` if
`ExternalCurve` is set, otherwise returns `&EditorCurveData`.
`GetRichCurveConst()`:26 — const version; prefer this in `const` methods.

**Important**: `EditorCurveData` is marked `UPROPERTY()` without `EditAnywhere` — it stores
the curve but the edit widget is shown because `FRuntimeFloatCurve` implements
`FCurveOwnerInterface`. In packaged builds, `EditorCurveData` is cooked along with the struct.

## Curve evaluation internals (FRichCurve)

`FRichCurve` is in `Engine/Source/Runtime/Engine/Classes/Curves/RichCurve.h`. Key operations:

- `Eval(InTime, DefaultValue)` — evaluates at `InTime`; returns `DefaultValue` if no keys.
- `AddKey(InTime, InValue)` — adds a key; use in editor tooling, not runtime gameplay.
- `SetKeyInterpMode(KeyHandle, Mode)` — sets per-key interpolation.
- `GetNumKeys()`, `GetFirstKey()`, `GetLastKey()` — navigation.

The evaluation path is O(log N) binary search on the keyframe array; suitable for per-frame
calls in gameplay.

## Choosing the right curve type

| Situation | Use |
|---|---|
| One shared named curve, referenced by multiple actors | `UCurveFloat` asset + `TObjectPtr<UCurveFloat>` |
| Many curves grouped by weapon/enemy/ability name | `UCurveTable` + `FCurveTableRowHandle` |
| Per-instance curve (each enemy has its own tuning) | `FRuntimeFloatCurve` member |
| Procedural curve built at runtime | Construct `FRichCurve` on the stack, call `Eval` |

## Module dependency

`UCurveFloat` and `FRuntimeFloatCurve` are in the `Engine` module. `UCurveTable` is also in
`Engine`. No additional `Build.cs` dependency is required beyond what a standard gameplay
module already has.

## Version notes

- `GetRichCurveConst()` was added to `FRuntimeFloatCurve` in UE5 to resolve const-correctness
  issues; UE4 code used only the mutable `GetRichCurve()`.
- `ECurveTableMode` was added to `UCurveTable` in UE4.20 to distinguish simple vs rich curve
  storage. Always check with `GetCurveTableMode()` before calling `FindRichCurve` vs
  `FindSimpleCurve` to avoid the runtime check assert.
- `FSimpleCurve` mode is more memory-efficient for two-point linear interpolations (e.g.,
  stat-scaling that just goes from A to B linearly over a range). Use Rich mode when you need
  tangent control.
