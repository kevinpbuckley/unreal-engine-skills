---
skill: ue-web-wasm-webgpu
title: Diagnose a web build that cannot start its threads
---

Scoring note: layer 1 (compiles) is **N/A - config/diagnosis task**. Layer 2 (API truth)
checks header names, the `WasmTargetSettings` key and tool names against the UE 5.9 install
(`Engine/Platforms/Wasm/Docs/Deploy.md`, `.../WasmTargetSettings.h`). Layer 3 is the criteria
below.

## Prompt

A UE 5.9 game packaged for the web (`-platform=Wasm -clientconfig=Shipping`) passes
`check_stage.py` and boots fine on the developer's machine, where it was started with
`python Engine/Platforms/Wasm/Build/Tools/web/serve.py --root <stage>\Wasm --port 8900`.

The same stage fails in two places:

1. Uploaded as a zip to an itch.io HTML project, the page stops at "Checking the browser" with
   *"The page is not cross-origin isolated"*.
2. Copied to an nginx server the team controls (served at the top level of its own domain),
   the console shows `Uncaught ReferenceError: SharedArrayBuffer is not defined` and
   `crossOriginIsolated` is `false`. The nginx config has `gzip on;` for all files.

A tester also double-clicked `index.html` from a file explorer and got a blank page.

Explain why each case fails, why the local run worked, and what to change for each host.

## Acceptance criteria

- States that the game runs on wasm threads, which need `SharedArrayBuffer`, which needs a
  cross-origin isolated page in a secure context (HTTPS or `http://localhost`).
- For nginx: send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
  require-corp` on `index.html` and `sw.js`, and `Cross-Origin-Resource-Policy: same-origin` on
  every file; turn the host's own gzip off for the game's files (the stage already carries `.br`
  twins); points at Epic's host templates (`Engine/Platforms/Wasm/Build/Tools/deploy/templates/`,
  e.g. `nginx.conf`) or `webdoctor.py` to verify.
- For itch.io: the game runs in an iframe on itch's page, so headers or a `_headers` file in the
  zip cannot isolate it; turn on **Edit game > Embed options > SharedArrayBuffer support**, save,
  and re-open the form to confirm it stayed on.
- Explains that the local run proved nothing about the hosts because `serve.py` sends the
  isolation headers itself.
- `file://` never works; the stage must be served over http(s).
- Optionally (not required): for a top-level host with no header control,
  `bInjectIsolationHeaders=True` under `[/Script/WasmTargetPlatform.WasmTargetSettings]` lets the
  service worker add the headers; it does not help inside a portal iframe.
- Does not propose disabling threads, rebuilding with a different emscripten version, or
  re-cooking the content as the fix.

## Common baseline failures

Blaming WebGPU support or the browser version; adding `Access-Control-Allow-Origin: *` (CORS,
not isolation); suggesting a `_headers` file for itch.io; forgetting CORP on the assets so the
page is isolated but sub-resources are blocked; leaving host gzip on over `.br` files; treating
the successful `serve.py` boot as proof the stage is fine for any host.
