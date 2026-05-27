---
name: uds-time
description: Control Time of Day on Ultra Dynamic Sky — setting/animating time, day/night cycles, the runtime functions (Set Time with Time Code, Set Time of Day with String, Transition Time of Day), the getter functions (Get Time of Day, Get Time Code, Get Date Time, Is It Daytime), and the event dispatchers (Sunrise, Sunset, Midnight, Hourly, Current Hour Changed, Every Minute, Custom Time). Use any time the user asks about time-of-day cycles, day/night transitions, animating time, triggering events at sunrise/sunset/midnight, displaying a clock, setting time programmatically, time speed / Day Length / Night Length, or syncing game events to the in-game time — even if they don't mention UDS in a project that already uses it.
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: time
  source-docs: https://www.ultradynamicsky.com/Documentation/V9/9-5
---

# UDS time of day

UDS has a single canonical time variable, three categories of runtime control (set / animate / transition), four getter functions, and a complete event-dispatcher system for game logic that needs to react to time. For real-world astronomical positioning (lat/long/date), see `uds-simulation`.

| Concern | Mechanism |
| --- | --- |
| Set the time | `Time of Day` variable (0–2400 float) or `Time of Day String` ("3PM", "15:45") |
| Day/night cycle | **Animate Time of Day** category: Day Length + Night Length (minutes) |
| One-off runtime change | `Set Time with Time Code`, `Set Date and Time`, `Set Time of Day With String` |
| Smooth transition over time | `Transition Time of Day(targetValue, duration)` |
| Read the time | `Get Time of Day`, `Get Time Code`, `Get Date Time`, `Is It Daytime?` |
| React at specific times | Event dispatchers: Sunrise/Sunset/Midnight/Hourly/Custom Time |
| Display the time | Built-in clock widgets in the widget designer palette |

## When to use this skill

- Setting up a day/night cycle.
- Triggering game events at sunrise, sunset, midnight, hourly, or arbitrary custom times.
- Setting time programmatically from gameplay code (instantly or as a transition).
- Reading the current time in HH/MM/SS form, or just checking "is it day".
- Putting a clock on screen.
- Syncing game time across multiplayer.

## Setting the time

`Time of Day` is a float on UDS, 0–2400, in the **Basic Controls** category. You can also type a string like `"3PM"` or `"15:45"` into `Time of Day String`. Setting `Time of Day` directly at runtime instantly changes the time.

## Animating time (day/night cycle)

In the **Animate Time of Day** category, enable **Animate Time of Day**. Then:

| Setting | Unit | Meaning |
| --- | --- | --- |
| `Day Length` | minutes of real time | Between sunrise and sunset |
| `Night Length` | minutes of real time | Between sunset and sunrise |

When `Simulate Real Sun` is enabled (see `uds-simulation`), Day Length / Night Length are ignored — speed comes from **Simulation Speed** in the Simulation category (`1` = roughly real-time).

## Runtime control functions

Get a UDS reference with the shared `Get Ultra Dynamic Sky` function. Then call:

| Function | What it does |
| --- | --- |
| `Set Time with Time Code(TimeCode)` | Set time from an hours/minutes/seconds Time Code struct |
| `Set Date and Time(DateTime)` | Set time using a Date Time struct (incl. simulation date) |
| `Set Time of Day With String(string)` | Parse `12:34 PM`, `18:30`, `5AM`, etc. See function description for full list. |
| `Transition Time of Day(target, duration)` | Animate to `target` over `duration` seconds |

Direct `UDS.TimeOfDay = X` also works for instant changes.

## Sampling the current time

| Function | Output |
| --- | --- |
| `Get Time of Day` | Float 0–2400 |
| `Get Time Code` | Time Code struct (h/m/s) |
| `Get Date Time` | Date Time struct (h/m/s + simulation date) |
| `Is It Daytime?` | Boolean — true when the sun is up |

`Is It Daytime?` is the right call when you only need day-vs-night, not the exact time.

## Display widgets

Two clock widgets in the widget designer palette under **Ultra Dynamic Sky Widgets**. Drop into a UMG widget for a quick on-screen clock.

## Event dispatchers

Bind events from your blueprints. Pattern:

```
UDS = GetUltraDynamicSky()
UDS.OnSunrise.AddDynamic(this, &MyActor::OnSunrise)
// Or in Blueprint: Bind to Sunrise → Custom Event
```

| Dispatcher | When it fires | Output |
| --- | --- | --- |
| `Sunrise` | Minute the sun crosses horizon going up | — |
| `Sunset` | Minute the sun crosses horizon going down | — |
| `Midnight` | Time of Day passes 0/2400 | — |
| `Hourly` | Each hour. Fires for *every* hour skipped over by an instant time change. | Current hour (int) |
| `Current Hour Changed` | Like Hourly but fires *once* for the new current hour after an instant skip | Current hour (int) |
| `Every Minute` | Each minute | Current minute (int 0–59) |
| `Custom Time` | Time of Day crosses any value in the `Custom Time Dispatchers` float array | Array index that triggered (int) |

### Offsetting Sunrise / Sunset

`Sunrise Event Offset` and `Sunset Event Offset` in **Animate Time of Day** shift the trigger minute relative to the actual horizon cross.

### Event check frequency

`Time Event Dispatcher Check Period` (Animate Time of Day) — how often the dispatcher logic checks for triggers. Default: every second whenever Time of Day is actively changing.

### Hourly vs Current Hour Changed

If a fast `Transition Time of Day` skips from 14:00 to 18:00:

| Dispatcher | Times it fires | Best for |
| --- | --- | --- |
| `Hourly` | 4 times (15, 16, 17, 18) | "Tick the clock for each hour passed" |
| `Current Hour Changed` | 1 time (18) | "React to the new current time" |

### Custom Time example

In **Animate Time of Day**, set `Custom Time Dispatchers` to `[630, 1230, 2200]`. Bind to `Custom Time`. The bound event fires:

| Index | At Time of Day |
| --- | --- |
| 0 | 06:30 |
| 1 | 12:30 |
| 2 | 22:00 |

Use the index in a Switch to branch per scheduled time.

## Material functions for time

Search the material palette:

| Function | What it does |
| --- | --- |
| `Day to Night Float` | Interpolates between two float inputs based on whether sun is up. Inputs offset horizon threshold and widen/sharpen the transition. |
| `Day to Night Color` | Same for colors. |

Good for materials that switch (e.g. emissive on at night) without involving a blueprint. For *light components* that turn on at night (not just materials), use the **Light Day/Night Toggle** component — see `uds-lighting-and-shadows`.

## Sequencer

To keyframe Time of Day in Sequencer:

1. **Disable Animate Time of Day** on UDS (otherwise it overrides your keys).
2. Keyframe `Time of Day` directly. Going past 2400 is fine — UDS rolls into the next day.

Many UDS variables are exposed for cinematics, but not all are re-applied dynamically every frame. If a keyframed value doesn't update at runtime, mark it `Expose to Cinematics` in the UDS blueprint and call the matching `Static Properties - <Category>` function each frame. (Weather state has its own Sequencer notes — see `udw-setup-and-state`.)

## Multiplayer replication

`Time of Day` and `Date` are replicated.

| Variable | Replication behavior |
| --- | --- |
| `Replicated Time of Day` | Updated periodically; on change, clients sync `Time of Day` to it |
| `Day Length`, `Night Length`, `Time Speed`, `Simulation Speed` | Replicated themselves |

Clients tick time locally between resyncs the same way the server does. Brief desync between resyncs is normal; the periodic `Replicated Time of Day` update realigns them.

## Gotchas

- **`Time of Day` won't change at runtime** — the sun is **static or stationary mobility**. Time-of-day cannot change at runtime with non-movable sun. See `uds-lighting-and-shadows`.
- **Keyframes in Sequencer have no effect** — `Animate Time of Day` is still on and overriding. Disable it.
- **Sunrise/Sunset firing at the wrong time** — `Simulate Real Sun` is on, which uses real horizon crossing rather than `Dusk Time` / `Dawn Time`. (See `uds-simulation`.) Or there's a Sunrise/Sunset Event Offset configured.
- **Hourly firing many times after `Transition Time of Day`** — that's `Hourly`'s intended behavior (every hour passed). Use `Current Hour Changed` for "once for the new hour".
- **Custom Time never fires** — `Custom Time Dispatchers` array is empty. Add values.
- **Animation speed feels wrong despite Day Length / Night Length** — `Simulate Real Sun` is enabled and overriding to use `Simulation Speed` instead.

## References & source material

Docs (Ultra Dynamic Sky 9.5):
- [Controlling Time of Day](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-24) (incl. Animate Time of Day, time-control functions)
- [Getting and Displaying Time of Day](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-25)
- [Triggering Events at Specific Times](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-49) (dispatchers)
- [Sky Utility Material Functions](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-50) (Day to Night, Active Sun or Moon Vector)
- [Technical Notes — Replication (UDS)](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-176)

Plugin asset paths:
- `Blueprints/Utilities/` — Light Day/Night Toggle component (the light-component partner of the material `Day to Night` functions)
- Widget designer palette → **Ultra Dynamic Sky Widgets** category — clock widgets

Related skills: `uds-simulation`, `uds-sun-moon-stars`, `uds-lighting-and-shadows`, `uds-cinematics-rendering`, `udw-setup-and-state`.
