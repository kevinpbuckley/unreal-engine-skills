# Math types — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers `FVector`, `FRotator`, `FQuat`,
`FTransform`, `FMath`, and the Large World Coordinates (LWC) precision model introduced in
UE5. Grounded in UE 5.7 (`Runtime/Core/Public/Math/`).

## Large World Coordinates (LWC) — UE5 precision model

All primary math types are now `double`-precision in UE5. The type aliases live in
`Math/MathFwd.h`:

| Alias | Underlying type | Precision |
|---|---|---|
| `FVector` | `UE::Math::TVector<double>` (`:47`) | double |
| `FVector2D` | `UE::Math::TVector2<double>` (`:48`) | double |
| `FVector4` | `UE::Math::TVector4<double>` (`:49`) | double |
| `FQuat` | `UE::Math::TQuat<double>` (`:50`) | double |
| `FMatrix` | `UE::Math::TMatrix<double>` (`:51`) | double |
| `FTransform` | `UE::Math::TTransform<double>` (`:53`) | double |
| `FRotator` | `UE::Math::TRotator<double>` (`:57`) | double |

Float variants — `FVector3f`, `FQuat4f`, `FTransform3f` etc. — exist for rendering and
physics data that must remain 32-bit. Do **not** store gameplay world positions in `float`
variants; do not auto-assign them to `double` variants without an explicit conversion.

---

## FVector

`FVector` is `TVector<double>` (`Math/Vector.h`:50). Components are `double X, Y, Z`.

```cpp
FVector Origin(0.0, 0.0, 0.0);
FVector Forward = Actor->GetActorForwardVector();  // unit vector from rotation

// Arithmetic
FVector Midpoint = (A + B) * 0.5;

// Distance helpers — DistSquared is faster when only comparing magnitudes
double Dist  = FVector::Dist(A, B);          // Dist:1017
double Dist2 = FVector::DistSquared(A, B);   // DistSquared:1043

// Dot and cross
double Dot  = FVector::DotProduct(A, B);     // DotProduct:265
FVector Cross = FVector::CrossProduct(A, B); // CrossProduct:240

// Normalization
FVector Safe = Direction.GetSafeNormal();    // GetSafeNormal:649 — returns zero vector if near-zero
Direction.Normalize();                        // in-place, Normalize:632
```

**Common pitfalls:**
- `Normalize()` modifies in-place; `GetSafeNormal()` returns a new vector and is safe when
  the input may be near-zero.
- `FVector::Dist` takes two points, not a vector. To get the length of `V`, use `V.Length()`
  or `V.Size()`.

---

## FRotator

`FRotator` is `TRotator<double>` (`Math/Rotator.h`). Components are `double Pitch, Yaw, Roll`
in degrees.

```cpp
FRotator Rot = Actor->GetActorRotation();
Rot.Yaw += 45.0;                               // spin 45 degrees around Z

// Convert to/from quaternion
FQuat Q = Rot.Quaternion();
FRotator Back = Q.Rotator();

// Delta
FRotator Delta = (TargetRot - Rot).GetNormalized();  // clamped to [-180, 180]
```

**Gimbal lock:** `FRotator` is intuitive for single-axis rotations and Blueprint exposure,
but gimbal lock becomes an issue when composing rotations in multiple axes. Use `FQuat` for
composing rotations in gameplay code.

---

## FQuat

`FQuat` is `TQuat<double>` (`Math/Quat.h`:38). It represents a rotation without gimbal lock
and is the right type for composing / interpolating rotations.

```cpp
FQuat Q = Actor->GetActorQuat();
FQuat LocalRot = FQuat(FVector::UpVector, FMath::DegreesToRadians(45.0)); // axis-angle

// Composition (apply LocalRot then Q)
FQuat Combined = Q * LocalRot;

// Spherical interpolation — for smooth rotation blending
FQuat Blended = FQuat::Slerp(A, B, Alpha);          // Slerp:660

// Create from Euler angles (degrees)
FQuat FromEuler = FQuat::MakeFromEuler(FVector(Pitch, Yaw, Roll)); // MakeFromEuler:374

// Check alignment (avoid double-cover ambiguity)
if ((Q | Target) < 0.0) { Q = -Q; }  // ensure shortest-path Slerp
```

**UE quaternion convention:** `Q * V` rotates vector V by quaternion Q. Composition is
left-to-right: `A * B` applies A first, then B.

---

## FTransform

`FTransform` is `TTransform<double>` (`Math/TransformVectorized.h`:61). It stores rotation
as an aligned `FQuat`, translation as `FVector`, and scale as `FVector`. It is the full
object-to-world mapping used by actors and scene components.

```cpp
FTransform T = Actor->GetActorTransform();
FVector Loc  = T.GetLocation();    // GetLocation:602
FQuat   Rot  = T.GetRotation();
FVector Scale = T.GetScale3D();    // GetScale3D:1240

// Transform a world-space point to local space
FVector LocalPt = T.InverseTransformPosition(WorldPoint); // InverseTransformPosition:570

// Transform a local-space vector (direction, not position — ignores translation)
FVector WorldDir = T.TransformVector(LocalDir); // TransformVector:565

// Compose transforms: apply Inner then Outer
FTransform Composed = Inner * Outer;

// Construct from components
FTransform NewT(Rotation, Location, Scale);
```

**UPROPERTY exposure:** `FTransform` can be a `UPROPERTY(EditAnywhere)` — the editor
displays it as Location/Rotation/Scale fields. Set `meta=(MakeEditWidget)` on an `FVector`
subproperty to get an in-viewport manipulator.

---

## FMath

`FMath` (`Math/UnrealMathUtility.h`) is the global math utilities struct. All methods are
`static`.

```cpp
// Clamping & ranging
float C = FMath::Clamp(Value, 0.0f, 1.0f);   // Clamp:592
float M = FMath::Max(A, B);                   // templated
float R = FMath::RandRange(Min, Max);         // RandRange:289

// Interpolation
float L  = FMath::Lerp(A, B, Alpha);              // Lerp:1116
float FI = FMath::FInterpTo(Cur, Tgt, Dt, Speed); // FInterpTo:1502  — frame-rate independent
float FC = FMath::FInterpConstantTo(Cur, Tgt, Dt, Speed); // FInterpConstantTo:1483 — constant rate

// Angle helpers
float Rad = FMath::DegreesToRadians(Degrees);
float Deg = FMath::RadiansToDegrees(Radians);

// Vector lerp (same template as scalar)
FVector VL = FMath::Lerp(VA, VB, Alpha);
```

**`FInterpTo` vs `FInterpConstantTo`:** `FInterpTo` slows as it approaches the target
(exponential ease-in); `FInterpConstantTo` moves at a fixed rate per second.

---

## Common math gotchas

- **`FVector` components are `double`, not `float`.** Assigning to a `float` variable silently
  narrows. Use `(float)V.X` explicitly when passing to a float API.
- **Rotator + Rotator does not compose correctly** for all axes. Use quaternion multiplication
  for correct multi-axis rotation composition.
- **`Slerp` double-cover:** Two quaternions representing the same rotation may differ by sign.
  Dot-product check (`Q1 | Q2 < 0`) and negate one before Slerp for shortest-path blending.
- **Scale in `FTransform`:** Non-uniform scale is not preserved through all transform
  operations. When composing transforms with non-uniform scale, verify the results.
- **`FInterpTo` with `DeltaTime = 0`:** Returns current value unchanged — safe to call even
  when paused.

---

## Version notes

- **UE 4.x → UE 5.0:** `FVector` changed from `float` to `double`. Code that assumes
  `float` component arithmetic will produce narrowing-conversion warnings. The float
  variants (`FVector3f`, etc.) preserve old behaviour for rendering/physics payloads.
- `FTransform` was split into `FTransform3f` / `FTransform3d` aliases; `FTransform` always
  refers to the `double` version in UE5+.
