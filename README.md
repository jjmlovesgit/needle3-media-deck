# Needle 3 Media Deck

Needle 3 Media Deck is a local-first, single-page MP3/MP4 player with local
natural-language command routing. The browser UI, media playback, library,
equalizer, manual push-to-talk input, and Needle 3 WASM inference all run on
the local computer.

The application does not require an npm dependency install. Its small Node.js
server serves the SPA, indexes one configured read-only media directory, and
supports byte-range playback. Needle model assets are downloaded separately
from a pinned official release and verified before the server starts.

## Requirements

- Windows 10 or 11
- Node.js 22 or newer
- Current Microsoft Edge or Google Chrome with WebAssembly support
- Internet access once to acquire the pinned Needle 3 assets
- Optional: browser support for on-device speech recognition for manual
  push-to-talk commands

The current distribution runs from source in the browser and is not packaged
as a desktop executable.

## Install and run

```powershell
git clone https://github.com/jjmlovesgit/needle3-media-deck.git
cd needle3-media-deck\spa
node scripts\acquire-needle.mjs
npm start
```

Open <http://127.0.0.1:8080/>. The acquisition command is needed only when the
verified assets are absent or the pinned asset revision changes.

## Add local media

The default library is the repository's ignored `demo` directory. Create it at
the repository root and place MP3 and MP4 files inside it:

```powershell
New-Item -ItemType Directory -Force ..\demo
Copy-Item 'C:\path\to\media\*.mp3' ..\demo
Copy-Item 'C:\path\to\media\*.mp4' ..\demo
```

Subdirectories are indexed recursively. The server reads media without
renaming, modifying, or exposing source paths. To use another directory, edit
`spa/config/media-sources.json`; relative paths resolve from that config file,
and absolute paths are also accepted.

The **Open Local File** button can play user-selected MP3 and MP4 files without
adding them to the indexed library. Browser security prevents a normal web page
from silently scanning arbitrary folders, so an indexed library requires the
local server and configured directory.

Catalog-backed library rows include **Edit**. The in-app song editor updates
title, artist, album, track, year, aliases, and MP4 classification in
`demo/catalog.json`; it never renames or rewrites the media file. Saved aliases
participate in voice matching and library search. Manually reviewed fields are
protected from later MusicBrainz enrichment.

## Playback and commands

The responsive Performance Monitor uses one persistent media element for both
formats. Video uses `object-fit: contain`, preserving the complete frame.
Controls include play/pause, stop, seeking, ±10 seconds, volume, elapsed time,
duration, equalization, and click-to-toggle playback on active media.

Wait for **NEEDLE 3 · WASM READY**, then type a command and select **Run
Command**. Example patterns use fictional media names:

- `Play Example Track Alpha MP3`
- `Play Example Video Delta MP4`
- `Pause playback`
- `Skip forward 10 seconds`
- `Set volume to 35 percent`
- `Show MP3 files`
- `Show the library`

Needle selects the application tool and the `mp3`, `mp4`, or `any` media type.
Validated calls invoke typed application APIs rather than manipulating the DOM.
The confirmation slider sets the confidence threshold: commands below it wait
for confirmation; a value of 0 executes every call that passes validation.

For manual microphone input, hold the microphone button or **Ctrl+Space**,
speak one command, and release. There is no wake word, VAD loop, or background
microphone owner. Availability depends on the browser's on-device speech
recognition and installed language pack.

## Validation

```powershell
cd spa
npm test
npm run test:catalog

cd ..\utilities\media-catalog
npm test
```

`npm test` covers playback state, media classification and matching, library
state, tool validation, source containment, and UI parity. `npm run
test:catalog` requires a populated configured library and an installed Chromium
browser; it dynamically checks every catalog item for the correct MP3/MP4 match
and real playback-clock advancement, then runs live Needle MP3 and MP4 probes.
The generated report is written to ignored `demo/catalog-regression.json`.

## Optional catalog preparation

`utilities/media-catalog` is a separate command-line utility for scanning a
source library, reviewing proposed metadata queries, optionally enriching
individual songs through MusicBrainz, staging a clean demo library, and editing
song-level catalog metadata in a loopback-only browser UI. Run `npm run edit`
from that directory to edit the default `demo/catalog.json`. It is not imported
by the SPA and never changes the source media files. See
[its README](utilities/media-catalog/README.md).

## Repository layout

- `spa/app` — single-page UI and typed browser application modules
- `spa/scripts` — verified asset acquisition, local server, and regression run
- `spa/schemas` — Needle tool schema
- `spa/tests` — focused unit and browser integration tests
- `spa/docs` — Needle integration and execution boundaries
- `utilities/media-catalog` — optional, separate catalog preparation utility

## Privacy and network behavior

Media playback and Needle routing stay local. The running SPA uses loopback
requests only. Raw microphone audio and transcripts are not persisted. Network
access is used by the explicit Needle asset acquisition command and, when the
user opts in, by the separate MusicBrainz catalog utility.

Needle 3 is provided by
[Cactus Compute](https://github.com/cactus-compute/needle) under Apache-2.0.
The pinned source revision, hashes, adaptation details, and current limitations
are documented in [spa/docs/NEEDLE-INTEGRATION.md](spa/docs/NEEDLE-INTEGRATION.md).
