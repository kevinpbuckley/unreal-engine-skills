# Visual Logger — full reference

Deep dive for [../SKILL.md](../SKILL.md). Grounded in UE 5.7
(`Engine/Source/Runtime/Engine/Public/VisualLogger/VisualLogger.h`).

## What the Visual Logger records

The Visual Logger stores a **per-actor timeline** of text entries, spatial shapes, and histogram
data, each stamped with the world time at the moment of recording. After a play session (or
during one) you can open the Visual Logger window and scrub the timeline to replay exactly what
any actor saw, decided, and drew at every recorded moment. This makes it ideal for:

- AI bugs that only manifest after a sequence of decisions.
- Intermittent "this happens once every few minutes" issues.
- Verifying that a spatial calculation was correct at the frame it fired.

All `UE_VLOG*` macros evaluate to nothing unless `ENABLE_VISUAL_LOG` is defined (it is defined
in Editor, Development, and DebugGame builds, not in Shipping or Test by default). Inside a
recording session, every macro short-circuits on `FVisualLogger::IsRecording()` so inactive
sessions have zero overhead.

## Macro reference

### Text macros

| Macro | Description |
|---|---|
| `UE_VLOG(Owner, Cat, Verb, Fmt, ...)` | Text entry on Owner's timeline row |
| `UE_CVLOG(Cond, Owner, Cat, Verb, Fmt, ...)` | Conditional — logs only when `Cond` is true |
| `UE_VLOG_UELOG(Owner, Cat, Verb, Fmt, ...)` | Emits to both Visual Logger and `UE_LOG` |

### Spatial shape macros (selection)

| Macro | Shape |
|---|---|
| `UE_VLOG_LOCATION(Owner, Cat, Verb, Loc, Radius, Color, Fmt, ...)` | Sphere at a point |
| `UE_VLOG_SPHERE(Owner, Cat, Verb, Loc, Radius, Color, Fmt, ...)` | Solid sphere |
| `UE_VLOG_WIRESPHERE(Owner, Cat, Verb, Loc, Radius, Color, Fmt, ...)` | Wire sphere |
| `UE_VLOG_SEGMENT(Owner, Cat, Verb, Start, End, Color, Fmt, ...)` | Line segment |
| `UE_VLOG_SEGMENT_THICK(Owner, Cat, Verb, Start, End, Color, Thick, Fmt, ...)` | Thick segment |
| `UE_VLOG_ARROW(Owner, Cat, Verb, Start, End, Color, Fmt, ...)` | Arrow (arrowhead at End) |
| `UE_VLOG_BOX(Owner, Cat, Verb, Box, Color, Fmt, ...)` | Solid axis-aligned box |
| `UE_VLOG_WIREBOX(Owner, Cat, Verb, Box, Color, Fmt, ...)` | Wire axis-aligned box |
| `UE_VLOG_OBOX(Owner, Cat, Verb, Box, Matrix, Color, Fmt, ...)` | Solid oriented box |
| `UE_VLOG_CONE(Owner, Cat, Verb, Origin, Dir, Len, Angle, Color, Fmt, ...)` | Solid cone |
| `UE_VLOG_WIRECONE(Owner, Cat, Verb, Origin, Dir, Len, Angle, Color, Fmt, ...)` | Wire cone |
| `UE_VLOG_CYLINDER(Owner, Cat, Verb, Start, End, Radius, Color, Fmt, ...)` | Solid cylinder |
| `UE_VLOG_CAPSULE(Owner, Cat, Verb, Base, HH, Radius, Rot, Color, Fmt, ...)` | Solid capsule |
| `UE_VLOG_CIRCLE(Owner, Cat, Verb, Center, UpAxis, Radius, Color, Fmt, ...)` | Disc/circle |

Every spatial macro has a conditional `UE_CVLOG_*` counterpart with a leading `Condition`
parameter, e.g. `UE_CVLOG_SPHERE`.

### Histogram macros

```cpp
// Record a scalar time series visible as a 2D graph in the Visual Logger window
UE_VLOG_HISTOGRAM(this, LogMyAI, Verbose, TEXT("Health"), TEXT("HP"), FVector2D(Time, HP));
```

## Redirecting an actor's log to another

If you have a subsystem that doesn't own an `AActor` but you want its entries on the controller's
timeline row:

```cpp
// Redirect all logs from SubsystemObj to the owning actor's row
REDIRECT_OBJECT_TO_VLOG(SubsystemObj, ControllerActor);

// Or from 'this' to another object:
REDIRECT_TO_VLOG(ControllerActor);
```

`FVisualLogger::Redirect` is the underlying call (`VisualLogger.h`:763). Redirection is
per-object and per-session; it does not persist between play sessions.

## Recording to file and Rewind Debugger

```cpp
// Programmatically start/stop recording (e.g. in a test harness):
FVisualLogger::Get().SetIsRecording(true);
FVisualLogger::Get().SetIsRecordingToFile(true);   // also saves .vlog file

// Check recording state without going through the singleton every call:
if (FVisualLogger::IsRecording()) { /* ... */ }
```

In UE 5.7 the Visual Logger can also stream to Unreal Insights for **Rewind Debugger** playback:
`FVisualLogger::Get().SetIsRecordingToTrace(true)`. This is the preferred workflow when you need
to correlate Visual Logger data with CPU traces.

Source: `Runtime/Engine/Public/VisualLogger/VisualLogger.h` — `SetIsRecording`:801,
`IsRecording` (static inline):803, `SetIsRecordingToFile`:806, `SetIsRecordingToTrace`:813,
`FVisualLogger::Get()`:746.

## Common mistakes

- **Passing a null `Owner`** — the entry is silently dropped; always pass a valid `UObject*`
  (usually `this` from an `AActor` or `UActorComponent`).
- **Logging on a non-game thread** — `UE_VLOG*` macros are not thread-safe by default; call
  only from the game thread unless you know your log device is thread-safe.
- **Using deprecated geometry macros** — `GeometryShapeLogf` variants (deprecated 5.4) and
  `ArrowLogf`/`CircleLogf` (deprecated 5.6) still compile but emit warnings; use
  `SegmentLogf`, `ArrowLineLogf`, and `DiscLogf` respectively.
- **`UE_VLOG` without a recording session started** — entries are dropped; the Visual Logger
  window must have recording active (or `SetIsRecording(true)` called) to capture anything.
