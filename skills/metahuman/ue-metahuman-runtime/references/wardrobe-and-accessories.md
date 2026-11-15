# Wardrobe and accessories for shipped MetaHumans

Deep dive for [../SKILL.md](../SKILL.md). Six MetaHumans dressed in marketplace skeletal garments
worn as leader-pose components on the built Blueprints, in a 48-hour UE 5.9 game-jam project
(2026-11). Numbers are measured there. The Creator-side wardrobe (wardrobe items, `WardrobePaths`,
item pipelines, Chaos outfits) is in `ue-metahuman-creator`; skin-weight tools are in
`ue-skin-weights`.

---

## 1. Body under the clothes: delete or push

| Garment | Do | Why |
|---|---|---|
| Closed, always covering (trousers, long sleeves under a jacket, shoes) | Delete the covered skin on a body copy | Cheap, and pocket openings let skin through every other approach. Feet were cut inside shoes smaller than the foot. |
| Open or loose (dress, gown, slit, open collar, short sleeves, bare back) | **Push the skin inward, do not delete** | Any camera that sees under or into the garment sees a hole. |

What deletion did on a dress: see-through at the crotch from a low camera; a black patch on an
upper arm where the trim removed 16 triangles next to the dress; 516 wrist and forearm triangles
taken in a first pass because the arms hang beside the skirt. A trimmed leg is hollow if a hem
ever rides up.

The push method:

1. Start from the **uncut full-topology body**. The built body already lacks the faces under the
   Creator's default tee and shorts; rebuild the full body from the character's body DNA.
2. Collect the poses the game really shows (section 2), every clip the character plays.
3. For each body LOD, find the skin vertices that come out through the garment in any pose and
   move them inward to just under it, at the bind pose. Limit the move where skin shows (0.8 cm
   on leg skin visible in a slit) and exclude regions that must keep their shape (nothing above
   the collarbones, so bare shoulders stay right).
4. Check: zero body vertices outside the garment over all poses, then look through the game's
   cameras.

Measured: a slip dress needed 551 / 249 / 98 vertices moved at LOD 0 / 1 / 2 over 8 clips; a
floor-length gown 1892 / 744 / 306 vertices, at most 4.0 cm.

Other body facts:

- The baked body and face textures carry the Creator's **grey sports top** unless
  `bShowTopUnderwear` (`FMetaHumanCharacterSkinProperties`, default `true`) is off before the
  build. On an open neckline it is a grey band and grey straps on the face mesh's neck skirt.
  Turning it off, and using the face and body skin texture pair of one preset, removed both the
  paint and a skin-tone step at the neck.
- The face mesh's neck skirt ends on the upper chest. With bare shoulders its edge shows as a faint
  shading line that no garment fix removes. Plan a neckline or a necklace over it.
- Body edits replace assets the Blueprint points at. Keep the uncut body and name each variant
  for its outfit, so a costume change is a pointer swap.

## 2. Poses must come from the running game

The body's post-process AnimBP (`ABP_Body_PostProcess`) drives about 60 corrective bones from the
pose (thigh forward/back/in/out, knee, latissimus). They are **not** evaluated when a script
samples an AnimSequence on the asset, or poses a script-spawned actor in the editor world.
Measured difference between the asset-evaluated pose and the pose in PIE: **up to 14 cm**.

So: start PIE, play the real clip on the real character, dump the component-space bone
transforms at the times that matter, and solve drape and body push on those. The final fits were
solved on runtime dumps, not on the 337 asset-evaluated poses collected first.

## 3. Garment weights and LODs

- **Streaks at LOD 1 and 2.** The body's LOD settings remove corrective and helper bones at lower
  LODs. A leader-pose garment weighted to a removed bone follows a bone that stopped updating, and
  the cloth streaks. Fix on every garment LOD: move each influence on a removed bone to its
  nearest kept ancestor. Forcing LOD 1 and 2 in a capture is the only way to see it before a
  player does.
- **Weight new garments to main bones only:** pelvis, `spine_01`-`05`, `neck_01`/`02`, clavicles,
  thighs, calves. No twist or corrective bones, nothing the body drops, nothing on the arms or
  head for a sleeveless dress.
- **Hand helper joints** (about 144 on an Optimized body) are never evaluated: sleeve cuffs
  weighted to them spike to the floor. Re-weight to evaluated bones.
- **Give garments real LODs.** A baked Chaos outfit came as one LOD (30.9k triangles at every
  distance). A hand-built dress got 3798 / 1898 / 948 / 474 triangles by decimating LOD 0 and
  keeping the weights.
- **A garment pack's skeleton can disagree with its mesh.** One pack's generic skeleton had a
  reference pose 4-8 cm off the mesh's bind pose. Skin from the mesh's own bone data.
- **A Chaos outfit made for another body shape balloons as a leader-pose garment** (collar over
  the face). Refit it by building it on a throwaway duplicate of the character and taking the
  baked outfit mesh from that build.

## 4. Rebuilds

A Creator rebuild regenerates the character Blueprint and rewrites the built body, grooms and
materials.

- With the preserving build every component and value survived **except**: the hidden default
  outfit component came back on with the default tee and shorts, hidden components were visible
  again, and an earlier brow groom and earlier override materials were re-applied. Dump the
  Blueprint's components to JSON before the build, dump again after, diff, and restore.
- Lost every time, because they are asset edits: body fits, groom LOD fill, edited hair cards,
  brow opacity. Keep each as a re-runnable script.
- Fix **before** the build rather than after: `bShowTopUnderwear` off; face and body skin from one
  preset; the final brows and hair.

## 5. Placed actors and sequences

- A character placed in the level kept a **per-instance override** of its Body mesh from before
  the wardrobe work. The Blueprint was right, every check on a fresh spawn passed, and every real
  shot showed holes. After any mesh change: read the placed actor's component values, clear
  overrides that differ from the Blueprint, and capture through the level's own actors.
- Sequences that bind or copy the character must be re-checked after the Blueprint changes.
- In the editor viewport a component hidden with `SetHiddenInGame` still draws. Judge
  pose-switched garments in PIE.

## 6. Dresses and sitting

- A skirt weighted to the legs cannot wrap crossed legs: the two halves pass through each other.
  What worked: a second mesh variant with the same triangles and UVs, draped over the seated pose
  and inverse-skinned so that in that pose it is exactly the drape. The character picks the
  variant each tick from its own thigh bones (seated = both thighs within about 25 degrees of
  horizontal) with `SetHiddenInGame`; other systems that toggle garments used `SetVisibility`,
  so the two never fought.
- Limits that stayed: the switch reads the previous frame's pose; a sit/stand transition inside
  one clip was not built; a wide standing stance spreads a narrow skirt like an A-line.
- Dark satin: fresnel-driven roughness 0.72 → 0.60 and specular 0.12 → 0.26. Roughness 0.62 →
  0.45 read as wet-look under a front light; specular 0.28 read grey under a key light.
- A pack's normal map can be stored sRGB-encoded (neutral 188 instead of 128). Linearise it
  before import.

## 7. Layers and the neck

- A shirt under a jacket flecks through it. Drop the inner garment's hidden triangles on a
  per-character copy, in the rest **and** the seated pose, and remove fragments of 40 triangles or
  fewer left by the cut.
- A knit hem over a belt: pulling the hem's vertices inside the waistband radius worked; cutting
  the hem (jagged), pushing the belt out (came through the jacket) and a normal-based tuck
  (flipped direction) did not.
- With a tie or scarf removed, the face mesh's neck skirt can show through an open collar as dark
  patches. Push the shirt front forward a little (0.9 cm, tapered inside the lapels) on every LOD.

## 8. Accessories

| Where it sits | Attach | Measured |
|---|---|---|
| On the head (glasses, earrings) | Static mesh on the Face component's `head` socket; mesh pivot at the bone origin; component rotation is the inverse of the bone's rest rotation (pitch -90) | offset to the head bone 0.00 cm while speaking |
| Round the neck (choker) | Static mesh on the Body's `neck_01` socket, vertices authored in that bone's reference space | within 0.4 cm while speaking; scaled 1.1 across after the throat came through with the head tilted back |
| On cloth, rigid (brooch, pocket square) | Leader-pose skeletal mesh with **one** weight set copied from the garment point under it | rides the lapel rigidly; a static mesh on `spine_05` floated once the lapel moved when seated |
| Hanging on cloth (tie, chain, scarf) | Leader-pose skeletal mesh, weights transferred by closest point from the garment it lies on | moves like the cloth; rigid on `spine_05` the neckband stood off the neck when seated |

Ties cost three rounds and were removed anyway: rigid ones floated; on open collars the neckband
smeared on the throat and the knot sat 10 cm down the chest; closest-point weights from both shirt
fronts kinked the tie until it was collapsed to the midline for the transfer. Lesson: an accessory
that lies along the body's centre line over an opening has no stable surface to follow. Choose
pieces that are rigid on one bone or sit on one patch of cloth, and prefer a marketplace mesh to a
hand-built one (procedural glasses frames were rejected on sight).

Glasses from a pack: skeletal meshes on their own skeletons and about 25 % too small. Each was
fitted in a DCC and re-imported as a static mesh with the head-bone pivot: scale between pupil
distance and head width, lens centres 3 mm under the pupils, pitch onto the ear tops, slide back
until the nose pads touch, splay the temples until no sample point is inside the head (count skin
crossings; a nearest-normal test gave false hits on eyelash cards). Import with Nanite off and
four LODs (100 / 50 / 25 / 12 %). Lenses: opacity 0.07, specular 0.2, roughness 0.10 kept eyes
readable with no blown highlight.

Before building any accessory, check it will be seen: earrings were hidden by long hair in every
shot, and a pocket square sat below the frame of the main close-up. Parameter-only materials (no
textures) cost nothing in the texture budget; dark sets tint metals (a silver read brown until
roughness went 0.16 → 0.28).

## 9. How to check

- Record the Blueprint (component dump) before and after each wardrobe step and diff.
- PIE on the real clips, seated and standing, front and three-quarter, chest crop and full figure,
  at LOD 0, 1 and 2. Contact sheets, looked at.
- One voiced line per character after every mesh change, reading the jaw-open value mid-line: a
  wardrobe step must not break the face.
- Hands: measure hand-to-body distance in the frames on screen. Seated hands 7-12 cm inside the
  thighs in one clip, floating in eight others: both were rejected.

## Source references (UE 5.9)

- `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacter/Public/MetaHumanCharacterSkin.h`:31 — `bShowTopUnderwear = true` (`FMetaHumanCharacterSkinProperties`).
- `Engine/Source/Runtime/Engine/Classes/Components/SkinnedMeshComponent.h`:859 — `bUseBoundsFromLeaderPoseComponent`.
- `Engine/Source/Runtime/Engine/Classes/Components/LODSyncComponent.h`:86 — `ComponentsToSync`.
- `Engine/Source/Runtime/Engine/Classes/Components/SceneComponent.h` — `SetHiddenInGame`, `SetVisibility`.
