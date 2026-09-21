# Windows portable build

This packaging layer turns the local SPA into a portable Windows application without changing its execution model. `MediaDeck.exe` starts the bundled Node.js server on an unused loopback port and opens Google Chrome in app mode with a dedicated local profile. Closing that app window stops the server.

The package contains the SPA, the hash-verified Needle 3 WASM/model assets, a Node.js runtime, and the catalog editing API used by the Media Deck UI. It does not contain media, enrichment caches, Python, FFmpeg, download tools, browser extensions, or native messaging components.

## Build

From the repository root in Windows PowerShell:

```powershell
.\packaging\scripts\build-portable.ps1
```

The build creates:

- `packaging\dist\Needle3MediaDeck-portable\MediaDeck.exe`
- `packaging\dist\Needle3MediaDeck-portable.zip`

The build is pinned to Node.js 22.19.0 so the tested runtime and included license notices stay aligned. `-NodeExe` can select another copy of that exact Windows runtime.

## Run

Extract the complete ZIP and run `MediaDeck.exe`. On first launch, choose the folder containing the local MP3 and MP4 library. The selection is saved under `%LOCALAPPDATA%\Needle3MediaDeck\library.txt`.

To select another folder, delete that file or launch from PowerShell with an explicit folder:

```powershell
& '.\MediaDeck.exe' --library 'D:\Media'
```

Google Chrome must already be installed. The packaged application uses an isolated Chrome profile under `%LOCALAPPDATA%\Needle3MediaDeck\ChromeProfile`.

## Local smoke test

The smoke test starts the packaged server without opening Chrome, checks the app, verifies the local-only content policy, scans the selected media library, and stops the server:

```powershell
$test = Start-Process -FilePath '.\MediaDeck.exe' `
  -ArgumentList @('--smoke-test', '--library', 'D:\Media') -Wait -PassThru
if ($test.ExitCode -ne 0) { throw "Smoke test failed: $($test.ExitCode)" }
```

## Air-gap boundary

The page can load scripts, workers, media, and API calls only from its own loopback origin. Chrome is launched with background networking, component updates, sync, translation, proxy use, and domain reliability disabled. Runtime media access stays within the folder selected by the user.

Manual speech uses Chrome's on-device Web Speech support. The required local language pack must already exist in the dedicated app profile before moving the computer behind an air gap. This portable build is the validation stage for that prerequisite; it does not download a speech pack.

This is a developer preview, not an installer. Code signing, an installer, uninstall support, and a documented speech-pack provisioning procedure belong in the release packaging milestone.
