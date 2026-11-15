---
name: ue-metahuman-runtime
description: >
  Ship MetaHumans in a real UE 5.9 game - run time, low-end and web (mobile renderer, WebGPU).
  A face AnimBP that plays baked face clips (plugin ABP_Face has no Slot node), the
  HeadControlSwitch head snap, offline lip sync from audio, blinks,
  AlwaysTickPoseAndRefreshBones under root motion, leader-pose bounds, LODSyncComponent, groom
  LOD holes (bald at LOD 4/6), r.HairStrands.Strands=0 (cards only) vs r.HairStrands.Enable=0
  (no hair at all), the ~318 MB /MetaHumanCoreTech models a plugin always-cooks, never-cook
  subfolders, virtual-texture caps, mobile-path teeth and skin fixes, the ARKit face-tracking
  UDP listener in Shipping, wardrobe and accessory rules. Use when a MetaHuman goes into a
  packaged or web build, or on "the face does not move", "lip sync plays in Sequencer but not in
  game", "the head jumps when a line starts", "they never blink", "hair disappears at
  distance", "teeth glow white", "skin looks wet", "the character vanishes mid-scene", "the
  build is huge".
metadata:
  engine-version: "5.9"
  category: metahuman
  aliases: "metahuman runtime, metahuman shipping, metahuman low end, metahuman web, metahuman wasm, metahuman mobile, face animbp, lip sync, blinks, metahuman cook size, groom lod, bald at distance, metahuman wardrobe"
---

# MetaHumans at run time and on low-end targets

The three authoring skills (`ue-metahuman-creator`, `ue-metahuman-animator`,
`ue-metahuman-live-link`) end when a MetaHuman Blueprint is built and an AnimSequence exists. This
skill is what happens after: making the face play baked clips in a running game, keeping the
character visible and its hair on at every distance, cutting the cook, making the face read right
without Lumen, and dressing it without see-through bodies.

Provenance: everything marked **(jam)** was measured or made to work in a 48-hour UE 5.9
game-jam project (2026-11) that shipped six MetaHumans (Optimized Medium build, card hair, baked
lip sync, 132 voiced lines) to Windows and to the browser. Everything else was read in the 5.9
engine source or config cited at the end. "Unverified" lists what neither covers.

## When to use this skill

- A MetaHuman is going into a packaged game, a low-end PC target, or a Wasm/WebGPU web build.
- Face clips (lip sync, expressions) play in Sequencer or the editor but not in the game.
- Hair, brows or the whole character disappear at some distance or during a move.
- The packaged build is far bigger than the content you made.
- Dressing MetaHumans in marketplace garments and accessories for close-up cameras.

## Mental model

| Piece | What it is at run time | The trap |
|---|---|---|
| Face component (`SKM_Face`) | Skeletal mesh on `/MetaHumanCharacter/Face/Face_Archetype_Skeleton`, Anim Class `ABP_Face` | `ABP_Face` is Copy Pose From Mesh with **no Slot node**: a face clip played on a slot is silently ignored |
| `ABP_Face_PostProcess` | Post-process AnimBP: RigLogic, head IK gated by the `HeadControlSwitch` curve | A clip exported with head movement turns the gate on and the head snaps |
| Body | Skeletal mesh driven by your locomotion/sequence; post-process AnimBP drives ~60 corrective bones | Poses sampled from the asset are not the poses in game (up to 14 cm off, jam) |
| Grooms | `UGroomComponent`s with an LOD table of strands / cards / meshes | Optimized builds leave LODs with nothing to draw when strands are off |
| `ULODSyncComponent` | Drives the LOD of every part from one source | Garments you add are not in it until you add them |
| Plugin content | `/MetaHumanCharacter`, `/MetaHumanCoreTech`, `/MetaHuman` mounts | Some of it is always-cooked whether you use it or not |

## 1. Face animation that plays at run time

1. **Make your own face AnimBP** on `Face_Archetype_Skeleton` (do not duplicate the plugin's):

   ```
   Copy Pose From Mesh (attached parent, copy curves) ------------------------+--> base pose
   Copy Pose From Mesh (second copy) --> Slot 'DefaultSlot' --> blend pose 0 -+
       Layered Blend Per Bone: branch filter FACIAL_C_FacialRoot, curve blend = Override
     --> Modify Curve (apply mode Scale): HeadControlSwitch x 0
     --> Layered Blend Per Bone (no bones, curve blend = Use Max Value) over a looping
         Sequence Player of a blink-only clip                  (optional, section 3)
     --> Output Pose
   ```

   - **Copy pose first**, so the face follows the body's head and neck.
   - **The Slot goes inside a layered blend, not after the copy.** An exported face clip is a
     root plus about 260 curves; a plain Slot after the copy replaces the copied pose and snaps
     head and neck to the reference pose. Blending below `FACIAL_C_FacialRoot` with curves on
     Override keeps the body-driven head and adds the face. (jam)
   - **`HeadControlSwitch` x 0.** A clip exported with head movement drives `HeadControlSwitch`,
     which gates head IK in `ABP_Face_PostProcess`. It acts as on/off (0.35 behaved as off), and on
     snaps the head to the archetype pose (about 4.4 cm forward and down on one character).
     Scaling the head yaw/pitch/translation curves does not remove it; zeroing the switch did.
     (jam)
2. **Set it as the Face component's Anim Class on every built character Blueprint.** A Creator
   rebuild sets the plugin class back: check after every rebuild. (jam)
3. **Play a line** on the Face component's anim instance and start the voice in the same frame:

   ```cpp
   // Face = the USkeletalMeshComponent named "Face" on the character
   if (UAnimInstance* FaceAnim = Face ? Face->GetAnimInstance() : nullptr)
   {
       FaceAnim->PlaySlotAnimationAsDynamicMontage(Clip, TEXT("DefaultSlot"),
           /*BlendIn*/ 0.1f, /*BlendOut*/ 0.2f);
   }
   else
   {
       UE_LOG(LogTemp, Error, TEXT("%s: no face anim instance, line plays without lips"), *GetName());
   }
   UGameplayStatics::SpawnSoundAttached(Voice, Face);
   ```

   Log the failure: an AnimBP without a Slot gives no error at all. **Never fall back to
   `PlayAnimation` (single-node mode)** on a face that has an AnimBP: it replaces the AnimBP
   instance for the whole line and a seated character's head drops off the neck. (jam)
4. **Never duplicate a plugin AnimBP into `/Game`** (`ABP_Face`, `ABP_MH_LiveLink`) as a test
   fixture. Deleting the copy could not unload a package that references MetaHuman Control Rig
   classes, and the editor hit a fatal `RigVMHost` cast. (jam)
5. Python cannot finish this graph for you: an AnimGraph node's `show_pin_for_properties` change
   is not applied from Python (no node reconstruction), so prefer nodes configured by property
   maps (Modify Curve's curve map). (jam)

Full graph notes and the C++: [references/face-animation-and-lip-sync.md](references/face-animation-and-lip-sync.md).

## 2. Lip sync: bake it offline

Run-time solving needs the realtime solver models (section 6), an audio or video source and Live
Link; a browser has none of that path. If the lines are known ahead, **bake**:

- 5.9 ships the bake as two AI-toolset tools in the experimental `MetaHumanAnimatorToolset`
  plugin (`UMetaHumanAnimatorPerformanceTools::GenerateAnimationFromAudio(SoundWave, Params,
  OutputLocation)` then `UMetaHumanAnimatorExportTools::ExportPerformanceAnimationSequence(
  Performance, Options)`), callable from editor Python through the 5.9 toolset registry. The C++
  equivalents are `UMetaHumanPerformance` with `InputType` Audio and
  `UMetaHumanPerformanceExportUtils` (see `ue-metahuman-animator`).
- Export the face AnimSequence against `/MetaHumanCharacter/Face/Face_Archetype_Skeleton`
  (`TargetSkeletonOrSkeletalMesh`), `bExportFace` true, `bExportBody` false. Audio solving runs on
  the CPU. Use mono WAVs. (jam: 132 lines)
- **Cheap to ship:** 132 clips cooked to 3.22 MB, largest 95 KB; the 232 MB they take in the
  editor is source curve data. (jam)
- **Verify every bake by numbers:** clip length within 0.1 s of the audio, and the jaw-open curve
  (`CTRL_expressions_jawOpen`) peaking above 0.3. Then one line per character in PIE, voice and
  lips together. (jam)
- **Keep the Performance assets in an editor-only folder that is never cooked** (277 MB for 132
  lines). (jam)

Batch design (temp-name export then swap, a per-line hash state file, batches of 10, stop after 3
failures): [references/face-animation-and-lip-sync.md](references/face-animation-and-lip-sync.md).

## 3. Blinks

The audio-driven bake barely blinks: blink curves peaked at 0.05 and many clips had no blink key,
so faces stare. Two fixes together (jam):

- **In the clips:** add linear keys on `CTRL_expressions_eyeBlinkL` / `CTRL_expressions_eyeBlinkR`
  every 2.8-4.2 s where the bake has none within 1.2 s, placed deterministically per asset name
  so a re-run adds nothing. Curve names read back lowercased: compare case-insensitively.
- **In the AnimBP, for silence between lines:** the last layered blend in section 1 (curves Use
  Max Value) over a looping blink-only clip. One loop blinks every character in phase.

Shape and engine calls: [references/face-animation-and-lip-sync.md](references/face-animation-and-lip-sync.md).

## 4. Characters that vanish or freeze

- **Root motion far from the actor origin:** set Body and Face to
  `EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones`
  (`USkinnedMeshComponent::VisibilityBasedAnimTickOption`; Python
  `unreal.VisibilityBasedAnimTickOption.ALWAYS_TICK_POSE_AND_REFRESH_BONES`). With
  `OnlyTickPoseWhenRendered` the bounds went stale once a clip carried the character metres from
  its origin; the mesh stopped updating and dropped out of the shot. (jam)
- **Leader-pose garments use their own rest-pose bounds** unless
  `bUseBoundsFromLeaderPoseComponent` is set; without it they were frustum-culled in close-ups.
  Garments can stay on tick-when-rendered. (jam)
- **`ULODSyncComponent` drives every part's LOD** (`ComponentsToSync`, `ESyncOption::Drive` /
  `Passive`). Add every garment you attach (the jam used Passive). For a close-up capture set
  `ForcedLOD` 0 rather than trusting distance. (jam)
- **Check the placed actor, not a fresh spawn.** A level instance kept an old per-instance Body
  mesh override: holes in every real shot while every wardrobe check on fresh spawns passed. (jam)

## 5. LODs and hair at distance

- **Count the LODs you have.** An Optimized Medium build had **3** skeletal LODs for body and face
  and 4 for outfits, not 8. `r.SkeletalMesh.LODBias=2` would have put every face on its last LOD
  in close-ups, and all skeletal meshes of six characters were 7.8 MB cooked, so no LOD bias or
  stripping paid. (jam)
- **Optimized grooms have holes in the LOD table**: strands at LOD 0-1, cards only at LOD 3,
  helmet meshes only at LOD 5 and 7, brows hidden at LOD 5-7. With strands off, **LOD 4 and 6 drew
  no hair** (LOD 4 began at screen size 0.0625, i.e. any wide shot) and brows vanished from LOD 4.
  Fill every empty LOD with the nearest cards/meshes and make brow LODs visible cards: +4 MB for
  15 grooms. (jam) Procedure and groom fields: `ue-hair-and-grooms`, "Cards, helmets and LOD holes".
- **Cards only is `r.HairStrands.Strands=0`. `r.HairStrands.Enable=0` turns off the whole groom
  system** ("This affects all geometric representations (i.e., strands, cards, and meshes)"):
  every character loses hair, brows and beard. Add `r.HairStrands.Simulation=0` on low-end.
- Check: `r.HairStrands.Strands 0`, then `r.HairStrands.MinLOD 0` .. `7`, looking at each step. An
  editor scene capture once drew no hair on five of six characters: judge hair in PIE or a build.
- **A Creator rebuild rewrites grooms** (LOD fill, card edits, brow opacity): keep each fix as a
  re-runnable script. (jam)

## 6. Cook size

Measured on the jam's builds (jam; ini lines read in the 5.9 install):

| Content | Cooked | Why it is there | Lever |
|---|---:|---|---|
| `/MetaHumanCoreTech/RealtimeMono` + `/MetaHumanCoreTech/GenericTracker` (HeadPoseTracker 119.4, GenericRigSolver 87.9, StereoHMCRigSolver 87.9, FaceDetector 23.4 MB) | 318.6 MB | `MetaHumanLiveLink`'s own `Config/Game.ini` has `+DirectoriesToAlwaysCook=(Path="/MetaHumanCoreTech")` | never-cook the two subfolders when face animation is baked |
| `/MetaHuman/GenericTracker` (MetaHuman Animator footage trackers) | 556 MB (Windows build) | reached the cook through the editor plugin | never-cook it |
| `/MetaHumanCharacter/Optional/Clothing` default garments (4K/8K) | 123.2 → 20.7 MB | referenced by the built characters | texture LOD group caps |
| Six character folders (8K body virtual textures) | 255.1 → 175.6 MB | your content | per-asset `MaxTextureSize` |

```ini
; Config/DefaultGame.ini
[/Script/UnrealEd.ProjectPackagingSettings]
+DirectoriesToNeverCook=(Path="/MetaHumanCoreTech/RealtimeMono")
+DirectoriesToNeverCook=(Path="/MetaHumanCoreTech/GenericTracker")
+DirectoriesToNeverCook=(Path="/MetaHuman/GenericTracker")
; editor-only intermediates: Performances, fit tests, backups (ini has no trailing comments)
+DirectoriesToNeverCook=(Path="/Game/<Project>/Editor")
```

- **Never list a plugin root** (`/MetaHumanCoreTech`): the cook fails on an ensure ("Registered the
  path ... for two different domains"). Name folders inside it; to drop all of a plugin's content,
  disable the plugin. (jam)
- **Virtual textures are not capped by texture LOD groups.** The body uses 8K VTs
  (`T_Body_BC_VT`, `_N_VT`, `_Scatter_VT`, `_SRMF_VT`). Body skin sits under clothes: cap those at
  1024 and the face `T_Head_LOD3_*_VT` at 2048 with the per-asset `MaxTextureSize`
  (`max_texture_size` in Python; it applies to every platform). One untrimmed 2K MetaHuman added
  about 168 MB of container and overflowed a 192 MB web texture pool. (jam)
- **Never flip `virtual_texture_streaming` off from Python**: materials that sample with Virtual
  sampler types stop compiling ("Sampler type is Virtual Color, should be Color") and the body
  falls back to the default material. Convert in the Content Browser if a texture must stop
  being virtual. (jam)
- **Marketplace garments are 4K.** Copy the meshes, materials and textures you use into your own
  folder, cap the copies, point the mesh copy's slot at the copied material; otherwise the cook
  pulls the pack's 4K material in through the mesh. (jam)
- Required project settings, set once and **never while a cook runs**:
  `r.GPUSkin.Support16BitBoneIndex=True` and `r.GPUSkin.UnlimitedBoneInfluences=True` under
  `[/Script/Engine.RendererSettings]`.

Web specifics (device-profile texture caps, the WebGPU pool, measuring the Brotli download):
`ue-web-wasm-webgpu`.

## 7. The look on the mobile shading path (web, low end)

Found in the first full web playthrough; PIE and Win64 with Lumen looked right. (jam)

- **Teeth draw as a flat white band.** The MetaHuman teeth material's value and occlusion
  parameters do not reach its low-quality path. Fix: at run time give the slot whose name starts
  with `teeth` a simple lit material: the character's own baked teeth texture (texture parameter
  `Basecolor Baked` on the slot's current material) times a warm grey (0.5, 0.465, 0.4),
  roughness 0.55, specular 0.15. That material is loaded by path, so always-cook its folder.
- **Skin reads wet.** On slots whose names start with `head_`, a dynamic instance with
  `Roughness Global Offset Post-Bake` +0.2 and `Specular Global Multiply Post-Bake` 0.55.
- **Apply both only when Lumen is not running** (feature level below SM5, or
  `r.DynamicGlobalIlluminationMethod` not 1), at start and to characters spawned later; desktop
  keeps the approved look.
- **Tune in the real target.** The first values (+0.15, x0.6, parameters on the stock teeth
  material) failed in the web build; the shipped numbers came from a console command changed live
  in a Development web build.
- The whole scene is darker without Lumen; `r.ExposureOffset` is `ECVF_Cheat`, so in Shipping
  only code can set it (`ue-web-wasm-webgpu`).

C++ for the face look: [references/face-animation-and-lip-sync.md](references/face-animation-and-lip-sync.md).

## 8. Shipping safety: the face-tracking listener

`BaseEngine.ini` ships `[/Script/AppleARKit.AppleARKitSettings] bEnableLiveLinkForFaceTracking=true`,
and `AppleARKitFaceSupport` starts a Live Link publisher when it is true
(`LiveLinkPublishingPort` defaults to 11111). With that plugin enabled, the jam's **Shipping**
Windows game opened a UDP listener and Windows Firewall prompted on first launch. Fix in
`Config/DefaultEngine.ini`:

```ini
[/Script/AppleARKit.AppleARKitSettings]
bEnableLiveLinkForFaceTracking=False
```

After the change the repackaged Shipping build had no UDP or TCP endpoints and no prompt. (jam)

## 9. Wardrobe and accessories (rules)

Method, measured numbers and the accessory table:
[references/wardrobe-and-accessories.md](references/wardrobe-and-accessories.md).

- **Do not delete skin under an open garment or a dress; push it inward.** Deleted skin showed as
  holes from low cameras. Deleting is right only where a closed garment always covers (legs in
  trousers, feet in shoes). (jam)
- **Solve fits on poses dumped from the running game.** The body's post-process AnimBP drives
  about 60 corrective bones that asset sampling does not evaluate: up to 14 cm difference. (jam)
- **Weight garments only to bones the body keeps at every LOD**, or the garment streaks at LOD 1-2.
  (jam)
- **A rebuild regenerates the Blueprint and rewrites built assets**: the hidden default outfit came
  back, hidden garments became visible. Dump the Blueprint's components before, diff after,
  restore. Turn `bShowTopUnderwear` off (`FMetaHumanCharacterSkinProperties`, default `true`) before
  a build that shows skin, or the grey sports top is baked into the body and neck textures. (jam)
- **Head accessories rigid on the Face `head` socket; chest accessories skinned (leader pose).**
  Rigid pieces on `spine_05` floated off the body when seated. (jam)

## 10. Pre-ship checklist

1. Every built Blueprint: Face Anim Class is your slot AnimBP; one voiced line per character
   shows lips in PIE.
2. No head jump when a line starts; blinks during a 10 s hold.
3. Hair and brows at every groom LOD (`r.HairStrands.Strands 0`, `r.HairStrands.MinLOD 0..7`).
4. Characters stay visible through every root-motion move; garments do not pop in close-ups.
5. Each scene through the game's own cameras with the placed actors, seated and standing, LOD
   0-2: no holes, no skin through cloth, no streaks, hands on surfaces.
6. Never-cook lists in place; the size report shows no solver or tracker models, no 4K pack
   textures.
7. Virtual textures capped per asset; no sampler-type errors, no grey default bodies.
8. On the real low-end or web target: teeth, skin sheen, exposure, hair.
9. Windows Shipping first launch: no firewall prompt.

## Gotchas

- An AnimBP without a Slot gives **no error** when a montage is played on it.
- The editor viewport is not the truth for MetaHumans driven by Sequencer: grooms and faces lag
  the body there and `bHiddenInGame` is ignored. Judge in PIE.
- A build leaves a few dirty `T_PreBakedGroom_*` packages that are not on disk; saving them fails.
  They clear after a level change plus garbage collection. (jam)
- Saving a groom binding while it is still building can stall the editor (`ue-hair-and-grooms`).

## Unverified

- Exporting face clips **without** head movement (`bEnableHeadMovement` false) instead of zeroing
  `HeadControlSwitch`: not tried in the jam. The 5.9 toolset header documents the option as "the
  head curves are still written but the head-movement switch curve is keyed 0"
  (`FPerformanceAnimationExportOptions`, `MetaHumanAnimatorExportTools.h`), which is the same
  result as the Modify Curve node in section 1 if it behaves as documented.
- Per-character phase offsets for the looping blink: not built.
- Whether marketplace garment packs leak 4K textures into a cook through their Skeleton or
  Physics Asset preview references: flagged in the jam's notes, no result recorded.
- Anything about strand hair at run time: the jam shipped cards only.
- That the web cook strips strand data for the mobile tiers: observed (strand LODs drew cards), not
  traced in source.

## References & source material

Engine source and content (UE 5.9):
- `Engine/Source/Runtime/Engine/Classes/Animation/AnimInstance.h`:591 — `PlaySlotAnimationAsDynamicMontage`.
- `Engine/Source/Runtime/Engine/Classes/Components/SkinnedMeshComponent.h`:815 — `VisibilityBasedAnimTickOption`; 859 — `bUseBoundsFromLeaderPoseComponent`.
- `Engine/Source/Runtime/Engine/Classes/Components/LODSyncComponent.h`:63 — `ULODSyncComponent`; 74 — `ForcedLOD`; 86 — `ComponentsToSync`.
- `Engine/Source/Runtime/Engine/Private/GroomVisualizationData.cpp`:13-15 — `r.HairStrands.Enable` (all representations).
- `Engine/Source/Runtime/Renderer/Private/HairStrands/HairStrandsInterface.cpp`:33 — `r.HairStrands.Strands`; 53 — `r.HairStrands.Simulation`.
- `Engine/Plugins/Runtime/HairStrands/Source/HairStrandsCore/Private/GroomManager.cpp`:47 — `r.HairStrands.MinLOD`; 2368 — `ConvertLODGeometryType`.
- `Engine/Source/Runtime/Engine/Private/GPUSkinVertexFactory.cpp`:38 — `r.GPUSkin.Support16BitBoneIndex`; 53 — `r.GPUSkin.UnlimitedBoneInfluences`.
- `Engine/Source/Runtime/Engine/Private/SceneView.cpp`:157-160 — `r.ExposureOffset` (`ECVF_Cheat`).
- `Engine/Plugins/MetaHuman/MetaHumanLiveLink/Config/Game.ini` — `+DirectoriesToAlwaysCook=(Path="/MetaHumanCoreTech")`.
- `Engine/Plugins/MetaHuman/MetaHumanCharacter/Source/MetaHumanCharacter/Public/MetaHumanCharacterSkin.h`:31 — `bShowTopUnderwear = true`.
- `Engine/Plugins/Runtime/AR/AppleAR/AppleARKitFaceSupport/Source/AppleARKitFaceSupport/Private/AppleARKitFaceSupportModule.cpp`:44-49 — reads `bEnableLiveLinkForFaceTracking`.
- `Engine/Plugins/Runtime/AR/AppleAR/AppleARKit/Source/AppleARKit/Public/AppleARKitSettings.h`:51 — `LiveLinkPublishingPort(11111)`.
- `Engine/Plugins/Experimental/Toolsets/MetaHumanAnimatorToolset/Source/MetaHumanAnimatorToolset/Private/MetaHumanAnimatorPerformanceTools.h`:100 — `GenerateAnimationFromAudio`.
- `Engine/Plugins/Experimental/Toolsets/MetaHumanAnimatorToolset/Source/MetaHumanAnimatorToolset/Private/MetaHumanAnimatorExportTools.h`:22 — `FPerformanceAnimationExportOptions`; 169 — `ExportPerformanceAnimationSequence`.
- Config: `Engine/Config/BaseEngine.ini` (`[/Script/AppleARKit.AppleARKitSettings]`
  `bEnableLiveLinkForFaceTracking=true`); `Engine/Platforms/Wasm/Config/BaseWasmEngine.ini`
  (texture pool sizing comment: at most 192 MB on the mobile tier).
- Content (`Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Face/`): `ABP_Face`,
  `ABP_Face_PostProcess` (contains `HeadControlSwitch`), `Face_Archetype_Skeleton`,
  `Face_LODSettings*`. Realtime solver models: `Engine/Plugins/MetaHuman/MetaHumanCoreTechLib/Content/RealtimeMono/`,
  `.../GenericTracker/` (mounted as `/MetaHumanCoreTech`); footage trackers:
  `Engine/Plugins/MetaHuman/MetaHumanAnimator/Content/GenericTracker/` (mounted as `/MetaHuman`).

Deep-dive references in this skill:
- [references/face-animation-and-lip-sync.md](references/face-animation-and-lip-sync.md) — face
  AnimBP graph, offline bake calls and batch rules, blink pass, mobile-path face look in C++.
- [references/wardrobe-and-accessories.md](references/wardrobe-and-accessories.md) — body under
  clothes, runtime poses, garment weights and LODs, rebuilds, dresses and sitting, accessories.

Related skills: `ue-metahuman-creator`, `ue-metahuman-animator`, `ue-metahuman-live-link`,
`ue-hair-and-grooms`, `ue-web-wasm-webgpu`, `ue-packaging-and-deployment`, `ue-animation-system`.
