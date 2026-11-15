# Converting hair cards to strands — deep reference

Deep dive for [../SKILL.md](../SKILL.md). Covers turning a card-hair pack (textured polygon
strips on a skeletal or static mesh) into Hair Strands grooms: reading cards and their textures,
fitting to a different head, growing strands, special cases, and the Alembic UE expects.
The conversion runs outside the engine; only the last section is engine behaviour. Grounded in
UE 5.8, re-checked against 5.9 (`HairStrandsCore`, `AlembicHairTranslator`, `MetaHumanSDKEditor` groom verification).

The method below is a working approach, not an Epic algorithm. The constants are starting
values that produced clean results on a commercial card pack (straight, short, curly and
dreadlock styles); they are observations, not engine rules.

---

## Inputs to gather

- The card meshes (one per style, plus any add-on pieces), the source head they were authored
  on, and the target head the grooms will be bound to.
- From each card material instance: the **alpha** (opacity) texture and the **root** texture
  (a gradient that is dark at the root and light at the tip), exported as full-resolution
  arrays. Packs usually share one atlas per hair type, so map material → texture set.
- Before converting, probe the pack: mesh bounds, UV layers, UV island sizes, and which V end
  of the atlas holds the roots. Atlases normally paint every strand vertically.

## 1. Cards are UV islands

Triangulate the mesh and flood-fill over shared edges in UV space: each UV island is one card.
Normalise each card's UV bounding box to (s, t), with t running along V (along the strands)
and s across.

**V flip.** FBX V runs opposite to image rows, so sample image row `(1 - v) * height`. Verify
on a known feature (for example where fuzz or flyaway tiles sit in the atlas) before trusting
any coverage numbers.

## 2. Coverage and root direction per card

- **Coverage:** sample a few hundred random barycentric points per card and average a
  box-blurred alpha. This separates dense cards from sparse fuzz.
- **Root end from the root map:** over samples with alpha above about 0.4, correlate V with
  the root texture. A clear negative correlation puts the root at high V, a clear positive one at
  low V (thresholds of ±0.3 worked).
- **Fallback:** some packs (dreadlocks especially) have a flat root map. Use a style-wide
  geometric vote instead: the area-weighted share of cards whose high-V end is nearer the scalp.
- **Do not use "the end nearer the scalp is the root" per card.** Outer layers and long locks
  hang with their tips near the body, and that rule flips them upside down.

## 3. Fitting to a different head

Card packs are authored on their own head. Fit the hair to the target head's cranium rather
than to the whole head:

- Take the **cranium cap**: vertices within about 8 cm of the top of each head.
- Scale **X and Y** by the ratio of the two caps' horizontal extents.
- Scale **Z** separately, by the ratio of crown-to-nose-tip heights (find the nose tip as the
  most forward midline vertex 8-20 cm below the crown).
- Map with `fit = (p - source_cap_top_centre) * scale + target_cap_top_centre`.

Why Z is separate: heads commonly differ in width and depth but not in crown-to-brow height.
Scaling Z by the X/Y average pushed slicked-back styles down onto the brows and turned them
into bobs.

## 4. Density

- Card weight = `area * max(coverage, 0.02)`; strands per card =
  `max(2, round(N * weight / sum(weights)))`, with N around 60,000 for a full head of scalp hair.
- **Fade and undercut cards** lie almost on the scalp (mean scalp distance under about 4 mm).
  At full density they render as a flat dark layer; reduce them to about 30%.

## 5. Growing strands inside a card

Do not fill the whole card. Grow each strand along t, from the root end, following the paint:

- Pick a column across the card (uniform in 0.03-0.97), then let it drift with a small random
  walk per step, clamped inside the card.
- Pick a per-strand alpha threshold (0.12-0.3). Start at the first painted sample and stop at
  the first gap of more than a few samples below the threshold. This gives soft hairlines,
  uneven tips and naturally sparse fades.
- Retry a few times if a strand comes out shorter than 4 points.
- Map (s, t) to 3D with a barycentric lookup in UV space, plus a small constant offset along
  the card normal (about ±2 mm) so strands from one card form a volume, not a sheet.

Filling whole cards produced bobs and fuzz, dropped strands, and caps that ran past the
painted area onto the face.

## 6. Dreadlocks and other rope locks

Dreadlock cards paint one or more vertical columns per card. Spread across the card, the
strands come out as flat ribbons.

- Average the alpha across the card on a coarse grid (for example 64 × 32) and find the runs
  above half the maximum: these are the painted columns.
- Pick a column weighted by its alpha, then wind each strand along it as a helix: radius
  proportional to `sqrt(u)` of a random `u`, a random phase, about one turn per 3.5 cm. One axis
  of the helix stays across the card inside the column; the other goes along the card normal.

## 7. Scalp and face

Use a BVH or closest-point query on the **target** head:

- **Face zone:** the front of the head between roughly 8.5 and 27 cm below the crown. Where a
  point (after the first few) goes under the skin there, **cut** the strand at that point.
  Pushing these points out leaves strands lying on the cheeks and brows, which render as dark
  speckle.
- **Elsewhere:** push points that go under the skin back out to a small margin (about 1.5 mm),
  so ponytails and long hair lie on the neck instead of being chopped. Cutting everywhere lost
  tens of thousands of strands on long styles.
- **Floating roots:** if a root is more than about 4 mm off the scalp, prepend the closest
  scalp point. MetaHuman's groom verification warns at the same distance.
- Drop strands with fewer than 4 points left.

## 8. Resample and write

- Resample every strand to a fixed point count by arc length (16-32 points; 24 worked).
- Write points **root first**, in the target mesh's component space, in centimetres.
- One output file per style; add-on pieces (tails, fringes) either as extra groups in the
  same file or merged into the style, since a MetaHuman Hair slot holds one groom.
- Review against the original: render the card hair and the strand groom on the same head,
  from the same angles, side by side.

---

## What UE expects of the resulting Alembic

- Curves only (`ICurves`), **no meshes** in the file, or the geometry importer claims it.
- The first point of each curve is the root. At most 255 points per curve, at most 4,194,303
  curves per group.
- `groom_width` or standard widths if you can write them; otherwise strands import at 0.01 cm
  and need `HairWidth_Override` on the groom.
- `groom_guide` curves are optional; without them guides are generated at 10%.
- `groom_root_uv` is optional for plain grooms, but MetaHuman groom verification warns when it
  is missing (and gives an info message for a missing `groom_width`). It treats root UV as
  V-flipped relative to the mesh UVs.
- Curve type is ignored: write evaluated polylines.
- With default conversion settings one unit = 1 cm and axes are taken as-is.
- Observed in 5.8: about 55-60k strands × 24 points made a 21-23 MB `.abc` per style, which
  imported with generated guides at about 10%.

## Source references (UE 5.9)

Engine source (UE 5.9):
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Private/GroomBindingBuilder.cpp`:164-172
  — the root is the curve's first point.
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsEditor/Private/GroomImportOptionsWindow.cpp`:178
  — point-count warning.
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Private/HairAttributes.cpp`:10-38
  — `groom_` attribute names.
- `Engine/Plugins/MetaHuman/MetaHumanSDK/Source/MetaHumanSDKEditor/Private/Verification/VerifyMetaHumanGroom.cpp`:176
  — root-to-surface distance; 183-186 — V-flipped root UV; 236-252 — attribute checks;
  402-417 — binding source and target; 428-475 — bounds and per-group limits.
- `Engine/Shaders/Shared/HairStrandsDefinitions.h`:28-30 — point and curve limits.
