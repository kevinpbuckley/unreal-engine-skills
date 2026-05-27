---
name: uds-simulation
description: Use Ultra Dynamic Sky's real-world astronomical simulation — Simulate Real Sun, Simulate Real Moon, Simulate Real Stars; latitude/longitude/time zone setup; North Yaw; daylight savings; city presets; the simulation date; Simulation Speed; and Use System Time (sync with the OS clock). Use any time the user mentions real-world sun position, latitude/longitude, city presets, accurate sunrise/sunset times for a real location, real star map, real moon phases matching a date, North direction in the level, daylight savings handling, or syncing in-game time to the player's actual system clock.
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: simulation
  source-docs: https://www.ultradynamicsky.com/Documentation/V9/9-5
---

# UDS astronomical simulation

UDS can position the sun, moon, and stars using real-world coordinates and dates instead of the simple yaw/pitch/offset settings. Three independent toggles + a location/date block + an OS-clock sync. All settings live in the **Simulation** category.

| Toggle | Overrides | Notes |
| --- | --- | --- |
| `Simulate Real Sun` | Sun Yaw / Pitch / Vertical Offset | Manually Position Sun Target *still* takes priority |
| `Simulate Real Moon` | Moon Yaw / Pitch / Vertical Offset / Moon Phase | Phase is driven by simulated date |
| `Simulate Real Stars` | Default tiling stars texture → 360° star map | Both textures exposed in **Stars** category |

## When to use this skill

- Need sunrise/sunset times accurate for a real location and date.
- Setting the sky for a specific city — Tokyo at noon on Aug 3rd, etc.
- Star positions matching real constellations.
- Moon phases matching a real date.
- Time of Day should reflect the player's actual wall-clock time.
- Defining what "north" means in the level (level rotation vs world rotation).

## Location setup

| Setting | Notes |
| --- | --- |
| `Latitude` | Degrees N/S |
| `Longitude` | Degrees E/W |
| `Time Zone` | UTC offset. **Critical** — wrong time zone offsets sun position by hours, because Time of Day is interpreted as local time at this location. |
| `North Yaw` | What world-space direction = north. Default: north is +X. Degrees, clockwise. |

### City presets

A **city preset** applies latitude, longitude, time zone, and daylight savings in one step. The fastest path for "set the sky correctly for City X."

## Date

| Setting | Effect |
| --- | --- |
| `Year`, `Month`, `Day` | Simulation date |
| Date auto-increment | At runtime, increments forward every night at midnight |

For setting date from code, `Set Date and Time` and `Get Date Time` handle Date Time structs — see `uds-time`.

## Time speed with simulation on

When `Simulate Real Sun` is on, **Day Length** and **Night Length** are ignored. Instead:

| Variable | Meaning |
| --- | --- |
| `Simulation Speed` | Scales runtime time progression. `1` = roughly real time (one real day per one real day) |

## Daylight savings time

DST options in the Simulation category. When enabled, Time of Day is interpreted with DST applied within the DST start/end times set in the advanced dropdown of the Simulation category.

## Use System Time

`Use System Time` (Simulation category) sets `Time of Day` and date values from the system clock's UTC time, offset by Time Zone.

**This works without enabling the rest of the simulation features** — you can use it solely to keep in-game time matching the player's wall clock, without simulating real sun positions.

## Simulation accuracy

The complete astronomical algorithms are too expensive in blueprint math, so UDS uses approximations.

| Body | Typical accuracy | Caveat |
| --- | --- | --- |
| Sun | Within fractions of a degree; worst case ~1° off | Leaves out Earth orbit eccentricity, Earth shape irregularity. Sufficient for almost all practical applications. |
| Moon | Calibrated using moon's position in 2017 | Generally accurate for dates within several decades. Moon appears in correct constellation with correct phase. |

If you find edge cases where deviation is worse, that's expected — it's an approximation.

## Interaction with other features

| Other system | Interaction |
| --- | --- |
| `Manually Position Sun/Moon Target` | Takes priority over simulation |
| `Dusk Time` / `Dawn Time` (Basic Controls) | **Ignored** when `Simulate Real Sun` is on — simulation determines horizon-crossing times |
| `Animate Time of Day` | Still works — uses `Simulation Speed` instead of Day Length / Night Length |

## Runtime / Blueprint control

The simulation toggles, location, date, and DST are mostly **static properties**. After runtime changes, call `Static Properties - Simulation` (or `Hard Reset Cache` for full refresh) so they apply immediately instead of waiting for the next cache cycle.

`Time of Day` and the date variables remain settable directly per the standard runtime time-control functions in `uds-time`; the simulation interprets them according to the configured location/DST.

## Gotchas

- **Sun in wrong position** for the location — check Time Zone. Most common error is leaving Time Zone default while changing latitude/longitude.
- **Sun position settings ignored** — that's by design when `Simulate Real Sun` is on. Disable it to use Yaw/Pitch/Vertical Offset again.
- **`Dusk Time` / `Dawn Time` having no effect** — the simulation overrides them.
- **Cycle speed feels wrong despite `Day Length` / `Night Length`** — `Simulate Real Sun` uses `Simulation Speed` instead.
- **Moon phase wrong** — `Simulate Real Moon` controls phase from the simulated date. To set phase manually, disable `Simulate Real Moon`.
- **Stars look like a low-res repeating texture** — `Simulate Real Stars` is off (default uses `Tiling Stars`). Enable it for the 360 star map.
- **Wrong moon position for a 2050+ date** — moon accuracy is calibrated for 2017; expect drift across many decades. Sun is fine.
- **North isn't where you expect** — `North Yaw` rotates the simulation. Default has north = +X.

## References & source material

Docs (Ultra Dynamic Sky 9.5):
- [Simulation of Real World Sun, Moon and Stars](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-40) (incl. accuracy notes)
- [Controlling Time of the Simulation](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-41)

Related skills: `uds-time`, `uds-sun-moon-stars`, `uds-setup-and-modes`.
