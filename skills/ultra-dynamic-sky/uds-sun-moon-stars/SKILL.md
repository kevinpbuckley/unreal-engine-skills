---
name: uds-sun-moon-stars
description: Control the sun, moon, stars, aurora, sky glow, and space layer (planets/moons/nebula) in Ultra Dynamic Sky. Covers sun/moon path (Yaw, Pitch, Vertical Offset, Moon Orbit Offset), manual positioning with Sun/Moon Target widgets, sun appearance (scale/softness/color/eclipse), moon appearance and phases, Stars (tiling vs 360 starmap), 2D and Volumetric Aurora, Night Sky Glow + Light Pollution, and adding planets/moons/nebula via the Space Layer. Use whenever the user asks about sun/moon position, where the sun rises, manual sun placement, moon phases, stars not appearing, aurora effects, light pollution, or adding visible planets/moons — even phrased generally like "I want a giant moon" or "how do I get aurora borealis".
metadata:
  asset: Ultra Dynamic Sky (marketplace)
  category: celestial-bodies
  source-docs: https://www.ultradynamicsky.com/Documentation/V9/9-5
---

# UDS sun, moon, stars, aurora, space

UDS owns five distinct visual layers above the cloud layer — sun, moon, stars, aurora, and the Space Layer (planets/moons/nebula) — plus a global sky-glow contribution at night. For sun/moon as *directional lights*, see `uds-lighting-and-shadows`. For real-world astronomical positioning, see `uds-simulation`.

| Element | Category | Notes |
| --- | --- | --- |
| Sun position/path | **Sun** | Yaw/Pitch/Vertical Offset; Manually Position takes priority |
| Sun appearance | **Sun** | Scale, softness, color, intensity, Solar Eclipse, source angle |
| Moon position/path | **Moon** | Same axes plus `Moon Orbit Offset` |
| Moon appearance | **Moon** | Two textures (RGB + Phase Normal), `Render Moon Phases` toggle |
| Stars | **Stars** | Tiling stars by default; 360 star map when `Simulate Real Stars` is on |
| 2D Aurora | **Aurora** | Sky-material shader; needs `Use Auroras` + a compatible Sky Mode |
| Volumetric Aurora | Sky Mode = **Volumetric Aurora** | Full 3D, camera can fly through; disables clouds |
| Night Sky Glow | **Sky Glow** | Uniform light to the night sky and clouds (from above) |
| Light Pollution | **Sky Glow** | Light to night sky and clouds (from below) — urban glow |
| Space Layer | **Space Layer** | Planets/moons/nebula via DBuffer mesh decals |

## When to use this skill

- Setting where the sun rises/sets, or how high it goes.
- Disconnecting sun/moon position from time and placing it freely.
- Tuning the sun disc (scale, softness, color, eclipse behavior).
- Working with moon phases or swapping the moon texture.
- Replacing the stars texture or enabling the 360 star map.
- Adding aurora — 2D or volumetric.
- Keeping a night scene from going pitch black without moonlight (sky glow / light pollution).
- Adding visible planets, moons, or nebula in the sky.

## Sun and moon movement

Without `Simulate Real Sun/Moon` (the simulation overrides these), sun/moon paths come from these per-body settings:

| Setting | Effect |
| --- | --- |
| `Yaw` (Sun Yaw / Moon Yaw) | Yaw of the circular path in degrees (CW). Determines rise/set direction. |
| `Pitch` (Sun Pitch / Moon Pitch) | Pitches the path so zenith angles away from straight up. 0 = passes directly overhead. |
| `Vertical Offset` (Sun / Moon Vertical Offset) | Positive/negative shift, raises/lowers regardless of time |
| `Moon Orbit Offset` *(moon only)* | Offset in time from the sun. 0 = path is exactly opposite the sun's. |

All ignored when **simulation** is on (see `uds-simulation`).

## Manually positioning the sun / moon

To disconnect the body from time and place it freely:

1. In the **Sun** category, enable `Manually Position Sun Target` (or the moon equivalent in **Moon**).
2. In the level viewport with UDS selected, find the **blue diamond widget** labeled **Sun Target** or **Moon Target**.
3. Move the widget. The body points from the UDS actor toward the widget's position.

The widget drives `Sun Target` / `Moon Target` vectors in the advanced dropdown of the Sun/Moon categories. Setting them at runtime moves the body.

**Manually Position takes priority over the simulation** — it's the highest-priority positioning method.

## Sun appearance

Rendered as a radial gradient. Settings in the **Sun** category:

| Setting | Purpose |
| --- | --- |
| Scale, softness, color, intensity | Disc appearance |
| `Sun Source Angle Scale` | Multiplier over the calculated source angle. The angle drives shadow softness + specular size. |
| Solar Eclipse settings | What happens when the moon, or a Space Layer object, crosses in front |

For the filmic Sun Lens Flare effect (separate from engine post-process lens flare), see `uds-modifiers-configs-state`.

## Moon appearance and phases

Settings in **Moon**. Two textures:

| Texture | Purpose |
| --- | --- |
| `Moon Texture` | RGB color + alpha of the moon |
| `Moon Phase Normal` | RGB normal map for shading the lit/unlit sides during phase rendering |

To use a non-phased custom moon texture (e.g. a giant alien moon), disable **Render Moon Phases**.

`Moon Phase` controls the current phase. The Moon category has an option to change phase over time automatically. With `Simulate Real Moon`, phase is driven by the simulation.

## Stars

Settings in **Stars**.

| Texture variable | When used |
| --- | --- |
| `Tiling Stars` | Default; simple repeating texture |
| `Real Stars` | Used automatically when `Simulate Real Stars` is on; 360° star map |

Both swappable. Also in this category: stars color, intensity, atmospheric twinkling.

## Aurora

Two delivery methods sharing colors/movement settings in the **Aurora** category.

| Type | How to enable | Mental model |
| --- | --- | --- |
| **2D Aurora** | `Use Auroras` in **Aurora** category, with a compatible Sky Mode that isn't Volumetric Aurora | Sky-material shader effect drawn with textures. Settings in **Aurora** advanced dropdown. |
| **Volumetric Aurora** | Sky Mode = **Volumetric Aurora** | Rendered via the volumetric cloud component. Full 3D, camera can fly through. Disables clouds. |

## Sky Glow

Category: **Sky Glow** — adds illumination to the night sky independent of moon/sun.

| Setting | Effect |
| --- | --- |
| `Night Sky Glow` | Uniform light added to the sky material; subtly lights volumetric clouds from above. Imitates ambient starlight + atmospheric glow. Raise to keep night scenes from going too dark without moonlight. |
| `Light Pollution` | Adds light to the sky material; softly lights volumetric clouds from *below*. Imitates urban sky glow. |

## Space Layer (planets, moons, nebula)

Category: **Space Layer**. Renders into the sky layer with correct compositing: planets occlude stars, but clouds and aurora obscure them.

Add planets:

- Manually via the **Planets / Moons** array.
- Via **Add Planet / Moon Preset** for drop-in starting points.

| Per-planet setting | Effect |
| --- | --- |
| `Parent` | What the planet moves with: Sun, Moon, or unparented |
| `Relative Rotation` | Orientation relative to the parent |
| `Scale` | Visual size |
| `Terminator` | The line between lit and dark sides |
| `Light Vector` | What determines the lit side: sun, moon, or custom vector |
| `Glow` | Diffuse atmospheric glow around the planet. Brightness rises with how much of the lit side faces camera. Scaled globally by `Space Glow Brightness` in the Space Layer category. |

Unparented planets can be moved manually at runtime via the components in the `Space Roots` array on UDS.

### Nebula

Also in the **Space Layer** category. Rendered into the sky material the same way as planets/moons. Noise-based with adjustable colors, scale, intensity.

### Space Layer requirements (DBuffer Decals)

The Space Layer renders via **DBuffer mesh decals** sampled in the sky material — that's what allows correct compositing within the sky layers.

| Renderer | Project setting that must be on |
| --- | --- |
| Desktop | `DBuffer Decals` |
| Mobile | `Mobile DBuffer Decals` |

If Space Layer renders nothing, this is almost always the cause.

## Runtime / Blueprint scripting

Most positioning/appearance properties are **static properties** — runtime changes don't apply until you call `Static Properties - Sun`, `Static Properties - Moon`, etc. For an instant full refresh, `Hard Reset Cache`. See `uds-performance-mobile-troubleshooting`.

Animatable / responsive at runtime without extra calls:

- `Time of Day` (drives sun/moon position normally)
- `Sun Target`, `Moon Target` (when Manually Position is on)
- `Moon Phase`
- Active colors/intensities that vary with time (cache handles automatically)

For materials that need to know which body is currently the dominant light source: **Active Sun or Moon Vector** material function — outputs a unit vector pointing toward whichever body is up (sun by day, moon by night), plus a 0–1 mask that drops to 0 at the swap moment (multiply effects by it to hide pop artifacts).

## Gotchas

- **Planets/moons/nebula not rendering** — `DBuffer Decals` (or `Mobile DBuffer Decals`) project setting is off, or the platform doesn't support DBuffer mesh decals.
- **Stars look pixelated and tiled** — that's the default `Tiling Stars` texture. Enable `Simulate Real Stars` for the 360 star map. (Or swap `Tiling Stars` for a higher-res texture.)
- **Sun/moon position settings ignored** — `Simulate Real Sun/Moon` is on, which overrides them. Or `Manually Position Sun/Moon Target` is on, which overrides everything.
- **Moon phase wrong / not changing** — `Simulate Real Moon` is on, which controls phase from the simulated date.
- **Aurora not visible** in a mode that should support it — `Use Auroras` is off in the Aurora category, or the Sky Mode is Volumetric Aurora (which disables 2D aurora drawing).
- **Volumetric clouds invisible after switching to Volumetric Aurora** — expected; Volumetric Aurora disables clouds. Pick another mode if you need both (no UDS mode renders both volumetrically).
- **Setting `Sun Scale` at runtime has no visible effect** — Sun Scale is a static property; call `Static Properties - Sun`.

## References & source material

Docs (Ultra Dynamic Sky 9.5):
- [Adjusting Sun and Moon Movement](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-27)
- [Manually Positioning the Sun and Moon](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-28)
- [Sun Appearance](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-29)
- [Moon Appearance and Phase](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-30)
- [Stars](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-52)
- [Aurora](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-53) (2D + Volumetric)
- [Sky Glow](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-54)
- [Adding Planets / Moons / Nebula Using the Space Layer](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-55)
- [Common Issues — Space Layer Not Rendering](https://www.ultradynamicsky.com/Documentation/V9/9-5#section-160)

Plugin asset paths:
- Component list on the UDS actor: **Sun**, **Moon**, **Sky Light** light components
- `Space Roots` array on UDS — components that hold unparented Space Layer items at runtime

Related skills: `uds-simulation`, `uds-setup-and-modes`, `uds-time`, `uds-lighting-and-shadows`, `uds-modifiers-configs-state`.
