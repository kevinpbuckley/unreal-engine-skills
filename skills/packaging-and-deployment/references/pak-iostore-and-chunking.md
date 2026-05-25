# Pak files, IoStore, and chunking — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers the pak and IoStore container formats,
chunk assignment methods, compression, encryption, and chunk auditing. Grounded in UE 5.7
(`Engine/Source/Runtime/Core/Internal/IO/IoStore.h`,
`Engine/Source/Developer/DeveloperToolSettings/Classes/Settings/ProjectPackagingSettings.h`)
and the official
[Cooking and Chunking](https://dev.epicgames.com/documentation/unreal-engine/cooking-content-and-creating-chunks-in-unreal-engine)
doc.

## Classic pak (`.pak`)

The `.pak` format is a flat archive that maps virtual file paths to byte offsets within
the file. During staging, UAT calls UnrealPak to assemble all cooked files into one or
more `.pak` files. At runtime, the pak mount system makes the virtual file system
(UFS) transparently serve content from the archive.

Properties:
- One file per chunk (e.g. `pakchunk0-Windows.pak`, `pakchunk1-Windows.pak`).
- Optional compression (Zlib, Zstd, Oodle) and encryption per-pak.
- Supported on all platforms; the universal fallback format.

## IoStore (`.utoc` + `.ucas`)

IoStore is the modern container format introduced in UE5. Source:
`Engine/Source/Runtime/Core/Internal/IO/IoStore.h`.

Two files per container:
- **`.utoc`** — table of contents. Stores the `FIoStoreTocHeader` and per-chunk
  metadata (compressed block sizes, hash, compression method, etc.).
- **`.ucas`** — bulk payload. Raw compressed data blocks addressed by `FIoChunkId`.

`EIoStoreTocVersion` tracks the format version (`IoStore.h`:25); UE 5.7 uses `Latest`.

The IoDispatcher reads the `.utoc` to build a hash-addressed lookup, then fetches
`.ucas` blocks directly — avoiding path-based file system lookups. This is why IoStore
loads packages faster than classic pak on high-latency storage (optical media, HDDs,
streaming CDN).

Enable via: `UProjectPackagingSettings::bUseIoStore = true` (`ProjectPackagingSettings.h`:270)
or the `-iostore` flag to UAT.

**Zen Server** (`bUseZenStore = true`, requires `bUseIoStore`) hosts IoStore containers
on a local or remote server, letting multiple developers share a single cooked data store.
Effective only when `bUseIoStore` is also true (`GetUseZenStoreEffective()` in the header).

## Chunking

Chunking splits a project's content into numbered containers for independent distribution.
Each chunk produces one `pakchunkN-[Platform].pak` / `.utoc`/`.ucas` triplet.

**Chunk 0** is the base install — always present, always downloaded. Everything not
assigned to a higher chunk falls into chunk 0 by default.

**Chunks 1+** are downloaded separately (streaming install, DLC, patch, on-demand).

Key settings in `UProjectPackagingSettings`:
- `bGenerateChunks` (`ProjectPackagingSettings.h`:285) — enables chunk generation.
- `bGenerateNoChunks` — override to disable chunking on all platforms.
- `bChunkHardReferencesOnly` — when true, only hard-reference dependencies are pulled
  into a chunk alongside their owner; soft references stay in their original chunk.
- `bForceOneChunkPerFile` — ensures each file appears in exactly one chunk; the lowest
  chunk ID wins.
- `MaxChunkSize` — maximum bytes per chunk before it is split (e.g. `pakchunk0_s1`).

### Three ways to assign chunks

**1. Asset Manager rules (in Project Settings → Asset Manager)**

Set `ChunkId` on a Primary Asset Type or individual asset rule. All secondary assets
reachable from that primary asset inherit the chunk ID unless overridden.

**2. DefaultGame.ini rules overrides**

```ini
[/Script/Engine.AssetManagerSettings]
+PrimaryAssetRules=(PrimaryAssetId="Map:/Game/Maps/Level02",Rules=(Priority=-1,ChunkId=2,CookRule=Unknown))
```

Chunk 0 catch-all for the startup map (ensures early-loading content is always present):

```ini
+PrimaryAssetRules=(PrimaryAssetId="Map:/Game/Maps/FrontEnd",Rules=(Priority=-1,ChunkId=0,CookRule=AlwaysCook))
```

**3. Primary Asset Labels (Content Browser)**

Create a `UPrimaryAssetLabel` data asset. Set `ChunkId` and `Priority`, then list
explicit assets or check `Label Assets in My Directory` to tag everything in the folder.
Labels are a convenient editor-driven alternative to hand-editing `.ini` files.

### Dependency resolution

When an asset is chunked, the cook system also places its dependencies in the same chunk
— unless `bChunkHardReferencesOnly` is enabled, in which case only hard (load-time)
references follow; soft (string) references remain in their own chunk and are expected
to be downloaded before they are accessed.

## Auditing chunks

**Asset Audit window** (Editor → Window → Developer Tools → Asset Audit → Add Chunks):
shows each chunk's size and asset inventory. Right-click → Size Map for a visual
breakdown; right-click → Reference Viewer to trace why an asset landed in a chunk.

Use these tools before finalizing chunk assignments to detect oversized chunks or
unintended asset duplication across chunks.

## Compression

`bCompressed = true` enables compression for cooked packages. Configuration:

| Property | Effect |
|---|---|
| `PackageCompressionFormat` | Comma-separated list; first available is used (e.g. `Oodle`) |
| `PackageCompressionMethod` | Sub-method for the compressor (e.g. `Kraken`, `Mermaid` for Oodle) |
| `PackageCompressionLevel_DebugDevelopment` | Effort level for Debug/Development builds (lower = faster encode) |
| `PackageCompressionLevel_TestShipping` | Effort level for Test/Shipping (higher = better ratio) |
| `PackageCompressionLevel_Distribution` | Effort level for distribution builds |
| `CompressedChunkWildcard` | Only compress paks matching a pattern (e.g. `*pakchunk0*`) |

Source: `ProjectPackagingSettings.h`:343–383.

Oodle is the recommended compressor for most platforms (best ratio/speed tradeoff).
Setting `PackageCompressionMethod=Kraken` (balanced) is a good default; `Leviathan`
gives the best ratio at the cost of encode time.

## Encryption

Encryption is configured via the crypto key system (`CryptoKeys.json`, generated by the
engine or supplied by the project). The older `bEncryptIniFiles_DEPRECATED` and
`bEncryptPakIndex_DEPRECATED` fields are no-ops — they were replaced by the CryptoKeys
plugin. Configure encryption in Project Settings → Crypto.

## File output locations

After packaging, output lands in:
- Cooked content: `Saved/Cooked/[Platform]/[ProjectName]/`
- Staged build: `Saved/StagedBuilds/[Platform]/`
- Pak files: `Saved/StagedBuilds/[Platform]/[ProjectName]/Content/Paks/`
- Archived build (if `-archive`): wherever `-archivedirectory` points.

Pak filenames follow the pattern `pakchunk[N]-[Platform][_s#].pak` where `_s#` suffix
indicates a split chunk (when `MaxChunkSize` is hit).
