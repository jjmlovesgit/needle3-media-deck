# Media Deck — single-page WASM adaptation

This is the active browser app, adapted from the complete reference clone at commit `775fdff`.

## Run

From this directory, with Node 22+:

```powershell
node scripts/acquire-needle.mjs  # first setup only: downloads pinned official assets
npm start
```

Open [the local console](http://127.0.0.1:8080/). No package installation is needed. The server serves only `spa/app` plus indexed read-only media; it does not expose the rest of the clone.

## What is preserved

The original console markup, CSS, panel order, colors, EQ SVG, presets, meter artwork, spectrum, and oscilloscope are extracted from `../playback_server.py`. `app/styles/reference.css` is an unchanged unescaped extraction; only narrow-screen integration corrections live in `spa.css`. The existing baseline source is untouched.

The reference's Web Audio EQ and visualization code remains in `reference-console.js`. Necessary adaptations:
- one persistent video element decodes both MP3 and MP4; audio mode uses the original scope;
- source switches and library navigation stay in the page;
- monitor clicks toggle pause/resume;
- the side-panel icon now hides/shows the in-page library because no extension is required;
- the local-file link becomes a picker;
- the browser audio graph initializes before first playback, upmixes mono to both channels, and stops animation work when paused/hidden or reduced motion is requested;
- native/Python command and wake-word requests are removed from the active frontend, with honest unavailable states in the original command panel.

## Boundaries

The Node development adapter reads the generated demo library at `C:\Projects\needle3-media-deck-reference-clone\demo` through `config/media-sources.json`. It uses recursive canonical indexing, stable IDs, byte-range streaming, and no writes to media. Picker files remain supported independently.

With the local server running, `npm run test:catalog` drives every configured catalog item through deterministic metadata matching and real playback in an installed Chromium browser. It reports MP3, original MP4, and karaoke MP4 results separately and writes the generated report to `demo/catalog-regression.json`. The script reads the catalog dynamically and contains no media titles.

Typed JSDoc modules own player state, library records, matching, and browser media access. The reference renderer is an explicit compatibility module; its EQ DOM rendering is retained to preserve the UI and is not a model execution interface.

`needle-client.js` creates one persistent module worker running the real Needle 3 WASM engine and full 20-layer model. Typed and manually spoken commands use the tool schema, strict argument/request validation, and application APIs. Manual speech uses Chrome/Edge on-device recognition while the microphone button or Ctrl+Space is held. The UI shows measured routing metrics and validated calls. See [Needle integration](docs/NEEDLE-INTEGRATION.md) for provenance, tests, and current accuracy limits. VAD and wake-word integration remain disabled.

No Python process, native host, FFmpeg, media downloader, or Tauri runtime is used by this app. Manual push-to-talk captures one microphone command through the browser's on-device speech API; raw audio and transcripts are not persisted. The browser may need to install its local language pack on first use. Needle model assets are acquired once by the setup script; the running app otherwise makes only loopback requests. These original files still exist in the complete clone as inactive reference material.

## Current limits

Filename/folder metadata and reference track-folder albums are supported. Embedded tags, duration/bitrate sorting, and content-based duplicate matching are not implemented. The original technical sort options remain visibly disabled pending real metadata.

The shared folder requires the loopback development server. A pure static deployment supports the file picker and needs a future browser-permission adapter for directory indexing. This is not yet an installed offline distribution or a working voice demo.

## Validation

`npm test` runs focused checks for playback, classification, matching, source containment, reference CSS/artwork parity, and tool validation. `node tests/needle-integration.cjs` tests the actual installed model through the UI using the same Playwright environment variables below.

The browser smoke test uses an existing Playwright installation and Edge:

```powershell
$env:PLAYWRIGHT_MODULE = '<path to existing Playwright package>'
$env:TEST_ARTIFACTS_DIR = '<writable screenshot directory>'
node tests/browser-smoke.cjs
```

Verified against the shared library: real MP3/MP4 decoding, one persistent media element, no page navigation on switching, first-play scope pixels, linked Rock EQ, seek/stop/volume, library hide/show, album order, one worker, no voice/backend requests, no page errors, and no horizontal overflow at 390/320px. Desktop and narrow screenshots were visually inspected. The typed Needle test additionally covers real playback, volume, EQ, panels, ambiguity, rejected unintended arguments, warm offline inference, reload, and a single persistent worker. Voice lifecycle soak testing remains pending.

