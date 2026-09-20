# Media Deck SPA

This directory contains the complete browser application, its loopback
development server, Needle 3 WASM integration, and tests.

## Run

With Node.js 22 or newer:

```powershell
node scripts\acquire-needle.mjs
npm start
```

Open <http://127.0.0.1:8080/>. No `npm install` step is required. The server
serves only `app` and the configured read-only media library.

The default source in `config/media-sources.json` resolves to the ignored
`demo` directory at the repository root. Relative source paths resolve from the
config directory; absolute paths are accepted for machine-specific libraries.
The browser file picker remains available independently of that indexed source.

## Architecture

- `app/scripts/application.js` exposes the application APIs used by controls
  and the Needle executor.
- `library.js`, `matching.js`, and `metadata.js` own media records,
  classification, and deterministic matching.
- `player.js` owns playback state around one persistent HTML media element for
  MP3 and MP4.
- `needle-client.js` and `needle-worker.js` run one persistent local WASM
  worker using the full 20-layer model.
- `tool-executor.js` validates complete tool batches and calls application APIs.
- `manual-voice.js` owns one-shot, on-device push-to-talk capture.
- `scripts/serve.mjs` provides the loopback-only static, library, and byte-range
  media endpoints.

Needle chooses `mp3`, `mp4`, or `any` for named playback. Both original and
karaoke videos are MP4 for playback routing while remaining separate library
classifications. Generic normalization removes a repeated trailing format word
and optional artist/album values only when they duplicate the normalized title;
it contains no catalog titles or catalog-specific routing rules.

## Browser boundaries

An ordinary web page cannot enumerate arbitrary local folders. The loopback
server provides the configured indexed library, while the file picker grants
session access only to files selected by the user. File picker selections do
not persist across reloads.

Manual speech requires Chrome or Edge on-device recognition and may require the
browser to install a language pack. The microphone is opened only while the
button or **Ctrl+Space** is held. VAD and wake-word activation are disabled.

Needle assets live in ignored `app/vendor/needle3`. The acquisition script pins
and verifies the official release; the server and worker verify installed
assets before use. The running SPA otherwise uses loopback requests only.

## Test

```powershell
npm test
npm run test:catalog
```

The first command runs focused module tests. The catalog regression dynamically
loads every configured media item in a Chromium browser, checks deterministic
MP3/MP4 matching and actual playback, and performs live Needle MP3/MP4 routes.
It embeds no real library titles. The generated report is ignored under
`demo/catalog-regression.json`.

Additional browser tests in `tests` use an existing Playwright installation:

```powershell
$env:PLAYWRIGHT_MODULE = '<path to an existing Playwright package>'
$env:TEST_ARTIFACTS_DIR = '<writable artifact directory>'
node tests\browser-smoke.cjs
```

See [Needle integration](docs/NEEDLE-INTEGRATION.md) for asset provenance,
execution boundaries, test coverage, and measured resource use.
