# Platform targets, Device Profiles, Client/Server split & DLC — full reference

Deep dive for [../SKILL.md](../SKILL.md). Covers multi-platform packaging, Device
Profiles, the Client/Server dedicated-server pattern, IoStore On-Demand streaming, and
patching/DLC workflows. Grounded in UE 5.7
(`Engine/Source/Runtime/Experimental/IoStore/OnDemandCore/Public/IO/IoStoreOnDemand.h`)
and the official
[Patching, Content Delivery, and DLC](https://dev.epicgames.com/documentation/unreal-engine/patching-content-delivery-and-dlc-in-unreal-engine)
doc.

## Platform packaging overview

Each target platform requires:
1. **SDK** — platform-specific toolchain and libraries installed on the build machine.
2. **Platform files** — `Engine/Source/Programs/UnrealBuildTool/Platforms/<Platform>/`
   (see `UEBuild<Platform>.cs` for SDK version requirements).
3. **Platform INI overrides** — `Config/<Platform>/<Platform>Game.ini` for
   per-platform `ProjectPackagingSettings` values (e.g. `bGenerateChunks`,
   `MaxChunkSize`, compression settings).

Platform selection in UAT is via `-platform=<name>` (e.g. `Win64`, `Mac`, `Linux`,
`Android`, `IOS`). Console platform names are platform-specific (not disclosed here
per NDA).

## Device Profiles

Device Profiles (`Config/DeviceProfiles.ini`, managed via Project Settings → Platforms →
Device Profiles) are the correct mechanism for per-platform rendering and scalability
settings. A Device Profile sets CVars, scalability groups, and texture streaming limits
for a specific device class.

**Never** hardcode `r.*` or `sg.*` CVars directly in C++ or Blueprint. The cooker bakes
per-platform Device Profile data into the cooked build; the runtime applies the matching
profile at startup before any world is loaded.

Example structure in `DeviceProfiles.ini`:

```ini
[Android_Mid DeviceProfile]
BaseProfileName=Android
+CVars=r.Shadow.MaxResolution=512
+CVars=sg.ShadowQuality=1
```

Profiling scalability differences between platforms should always start with Device
Profile audit, not code inspection.

## Client/Server split build

For multiplayer titles with a dedicated server:

1. Create `[ProjectName]Server.Target.cs` with `Type = TargetType.Server`. The Server
   target excludes rendering modules, UI, client-only gameplay code, and audio.
2. Create `[ProjectName]Client.Target.cs` with `Type = TargetType.Client` (no server
   code) or use the standard `Game` target if running a listen server.
3. Build and cook each target separately, or in a single UAT invocation with both
   `-platform=Win64 -clientconfig=Shipping -serverconfig=Shipping`.

**Server cook note:** the server cook strips all client-only content (UI textures,
client-side effects, audio) that has no server-side reference. Assets exclusively
referenced from client-only code paths must be explicitly excluded or they will
mistakenly enter the server cook via a reference chain. Use `DirectoriesToNeverCook`
in the server's platform-specific ini, or condition references with `WITH_SERVER_CODE`.

See `networking-and-replication` for replication, RPCs, and authority checks.

## IoStore On-Demand (streaming content from CDN)

The IoStore On-Demand system (`Runtime/Experimental/IoStore/OnDemand/`) enables a
shipped game to fetch content from a CDN at runtime without requiring the full install
upfront — the foundation for streaming installs and live-service drops.

Core interface (source: `Engine/Source/Runtime/Experimental/IoStore/OnDemandCore/Public/IO/IoStoreOnDemand.h`:36):

```cpp
namespace UE::IoStore
{
    class FOnDemandRequest
    {
    public:
        enum EStatus : uint8 { None, Pending, PendingCallbacks, Ok, Cancelled, Error };
    };

    class IOnDemandIoStore : public IModularFeature
    {
        // Mount/unmount on-demand containers, issue chunk requests
    };
}
```

The on-demand system requires chunks to be staged as IoStore containers (`bUseIoStore`
must be true) and hosted on a CDN or HTTP server. The client mounts the table of
contents (`.utoc`) eagerly and fetches `.ucas` blocks lazily as game code triggers loads.

**Configuration:** IoStore On-Demand is enabled per-platform in its INI section and
requires the `IoStoreOnDemand` plugin. The on-demand TOC is generated during packaging
when chunking is enabled — each chunk's `.utoc` can be hosted independently.

## Patching workflow

A patch is a new set of pak/IoStore containers that the game mounts in addition to the
base install. The updated pak takes priority over the base pak for any overlapping
packages.

**Patch generation with UAT:**
1. Cook a full release build and archive it as the "base" release.
2. After making changes, cook again and add:
   `-generatepatch -BasedOnReleaseVersion=<release_name> -CreateReleaseVersion=<new_name>`
   UAT diffs the new cooked output against the base release and produces a
   `pakchunk[N]-patch.pak` containing only changed packages.
3. Distribute the patch pak(s) via your CDN; the game mounts them at startup after
   the base paks.

Official doc: [General Patching Information](https://dev.epicgames.com/documentation/unreal-engine/general-patching-information-in-unreal-engine).

## DLC workflow

DLC content is built as a separate cook that excludes the base game content:

```
RunUAT.bat BuildCookRun -project=... -platform=Win64 -clientconfig=Shipping ^
  -cook -DLCName=MyDLC -BasedOnReleaseVersion=1.0 ^
  -stage -pak -archive -archivedirectory=...
```

The `-DLCName` cook excludes any package present in the base release and produces only
the new content. At runtime the game mounts the DLC pak after the base paks; DLC assets
are accessible via normal asset loading paths.

**DLC pak naming convention:** `pakchunk[N]optional-[Platform].pak` — the `optional`
marker signals to platforms and launchers that this pak is not required for the base game.

## ChunkDownloader plugin

For games that need fine-grained runtime control over chunk downloads, the
`ChunkDownloader` plugin provides a C++ and Blueprint API for:
- Downloading individual chunk pak files over HTTP.
- Tracking download progress.
- Mounting paks at runtime with priority ordering.

The plugin reads a manifest file hosted on a web server to discover which pak files
belong to which logical chunk IDs. Use when the platform's native streaming install
system is not sufficient or not available.

## Mount order and priority

When the game mounts multiple paks at startup (base + patches + DLC), paks are sorted
by priority (pak file name encodes the priority). A pak mounted later with higher
priority overrides packages present in an earlier pak. The default priority ordering is:
1. Base paks (pakchunk0, pakchunk1, …)
2. Patch paks (pakchunk0-patch, …)
3. DLC paks (optional paks)

Custom mount priority can be set explicitly via `FPakPlatformFile::Mount()` if your
code mounts paks at runtime.
