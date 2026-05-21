---
name: importing-content
description: Import external art into Unreal correctly — meshes (FBX/glTF/OBJ), textures, and
  audio via the Interchange pipeline (and the legacy FBX importer), the import settings that
  matter (units/scale, axis, lightmap UVs, normals, sRGB, compression, skeleton), reimport, and
  asset naming conventions. Use when bringing in DCC content, troubleshooting wrong scale/rotation/
  shading after import, or setting up a repeatable import workflow.
metadata:
  engine-version: "5.7"
  category: content-assets
---

# Importing content

Most "it looks wrong in Unreal" problems are import-settings problems, not engine bugs. Know the
formats, the settings that change geometry/shading/textures, and the conventions so imports are
correct and repeatable.

## When to use this skill

- Importing meshes, textures, or audio from external tools (Blender, Maya, Substance, etc.).
- Wrong scale, rotation, flipped normals, or washed-out/oversaturated textures after import.
- Setting up skeletal mesh + skeleton imports.
- Defining a consistent, reimportable content pipeline.

## Pipelines: Interchange vs legacy

- **Interchange** is the modern, extensible import framework (default for many formats in 5.x).
  It uses translators → pipelines → factories and is configurable/scriptable.
- The **legacy FBX importer** (`UFactory`-based) still exists and handles classic FBX flows.
- Either way, the *settings* below are what determine correctness.

## Formats

| Content | Formats | Notes |
|---|---|---|
| Static/skeletal mesh | FBX, glTF/GLB, OBJ, USD | FBX most common; glTF increasingly first-class |
| Texture | PNG, TGA, EXR, HDR, JPEG, DDS, PSD | EXR/HDR for HDR data; PNG/TGA for color/masks |
| Audio | WAV (PCM) | import as WAV; build cues/MetaSounds in-engine |

## Units, scale, and axes (the usual culprits)

- Unreal world units are **centimeters**; 1 UU = 1 cm. Author/export at the right scale (e.g.
  Blender: apply scale, set unit scale; FBX export at 1.0 and check "Import Uniform Scale").
- Unreal is **left-handed, Z-up**. FBX axis conversion on export/import flips models if mismatched
  — fix at export, or use the importer's transform settings, consistently.
- Apply transforms/freeze rotation in the DCC before export to avoid baked-in offsets.

## Mesh import settings that matter

- **Combine Meshes** — merge multiple meshes in the file into one static mesh (or keep separate).
- **Generate Lightmap UVs** — needed for baked lighting (not for pure Lumen/dynamic).
- **Normals/Tangents** — "Import Normals" (trust DCC) vs "Compute" (let UE generate); mismatch
  causes shading seams.
- **Collision** — auto-generate simple collision or author it; complex (per-poly) collision is
  costly (see `meshes-static-and-skeletal`).
- **Skeletal**: pick/create the **Skeleton** asset; reuse one skeleton across compatible meshes so
  animations are shareable; import morph targets if present.
- **Materials/Textures** — import or skip; often better to assign engine materials than import DCC ones.

## Texture settings that matter

- **sRGB**: ON for color/albedo; **OFF** for data maps (normal, roughness, metallic, masks) — a
  very common mistake that makes materials look wrong.
- **Compression**: `Default` (BC1/3) for color, `Normalmap` (BC5) for normals, `Masks`/`HDR` as
  appropriate; `UserInterface2D` for UI.
- **Virtual Textures / mip gen / flip green** for normal maps depending on DCC convention.

## Reimport & source control

- Assets remember their **source file path**; right-click → Reimport pulls updated art with the
  same settings. Keep source files in a known location (or alongside, per team convention).
- `.uasset` is binary (see `unreal-project-structure`); coordinate edits / use LFS.

## Naming conventions (common Epic/community prefixes)

`SM_` static mesh · `SK_` skeletal mesh · `T_` texture · `M_` material · `MI_` material instance ·
`A_`/`S_` sound · `BP_` Blueprint · `DA_` data asset · `DT_` data table. Consistent names make
content browsable and scriptable.

## Gotchas

- **Wrong scale** — almost always DCC export units; fix at source, not by scaling actors.
- **sRGB left on for normal/data maps** → wrong lighting; turn it off for non-color data.
- **Reimporting against a different skeleton** breaks animations; keep skeletons consistent.
- **Importing DCC materials** often yields messy graphs; prefer engine materials + instances.
- **Missing lightmap UVs** with baked lighting → splotchy shadows; generate or author them.

## References & source material

Engine source (UE 5.7):
- `Editor/UnrealEd/Classes/Factories/Factory.h` — `UFactory`, the classic import factory base.
- Interchange framework: `Engine/Plugins/Interchange/` (translators, pipelines, factories).

Official docs (UE 5.7): Working with Content —
<https://dev.epicgames.com/documentation/unreal-engine/working-with-content-in-unreal-engine>

Related: `meshes-static-and-skeletal`, `materials-and-shaders`, `asset-management`.
