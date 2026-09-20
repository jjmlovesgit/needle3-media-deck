# Media Deck

Media Deck is a local-first Chrome side-panel and Windows playback system for
downloading authorized media, editing timed lyrics, rendering karaoke video,
organizing a local MP3/MP4 library, and controlling playback with local voice
commands.

The application uses Chrome, a Python native-messaging host, yt-dlp, FFmpeg,
Cactus Needle 3, and a CPU-only LiveKit **Hey Jarvis** wake-word model. It does
not require CUDA or a GPU, and it does not use Whisper, diarization, FastAPI,
or a cloud model API.

> [!IMPORTANT]
> The current source installation targets Windows and Google Chrome. A packaged
> Windows installer is planned; today, installation uses PowerShell and
> Chrome's **Load unpacked** workflow.

## What Media Deck provides

- A dark audiophile-style local player for MP3, original MP4, and karaoke MP4.
- YouTube MP3/MP4 downloads with real transfer and FFmpeg progress.
- Editable timed captions and local FFmpeg karaoke rendering.
- Reuse of previously downloaded source media when rebuilding or extracting MP3.
- A dynamic local library with format, album, search, and sort controls.
- Album-length MP3 splitting from timestamp/title lists without another lossy encode.
- Linked stereo equalizer channels, genre presets, and named custom presets.
- CPU-only local command routing with Cactus Needle 3.
- Local Chrome speech recognition and optional **Hey Jarvis** wake-word activation.
- A loopback-only, token-gated playback server with seeking and byte-range support.

## Requirements

Install the following before running setup:

- Windows 10 or Windows 11
- Google Chrome 141 or newer
- Python available as `python`
- Node.js available as `node`
- FFmpeg and FFprobe available on `PATH`
- Internet access during setup, initial model download, and online media retrieval

Confirm the required commands in a new PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Test-MediaDeckPrerequisites.ps1
```

The validator reports each resolved executable, its version, whether Python can
create virtual environments, and whether FFmpeg includes the
`subtitles`/libass filter. It exits with code 0 when the computer is ready and
code 1 when a prerequisite needs attention. JSON output is also available:

```powershell
.\Test-MediaDeckPrerequisites.ps1 -Json
```

No NVIDIA driver, CUDA toolkit, or GPU-specific installation is required.

## Install from source

### 1. Clone the repository

Install to a permanent path. If the directory is moved later, rerun
`setup.ps1` so the native-host registration receives the new absolute path.

```powershell
cd C:\Projects
git clone https://github.com/jjmlovesgit/mediadeck.git karaoke_Agent
cd C:\Projects\karaoke_Agent
```

The repository is currently private, so GitHub authentication is required.

### 2. Run the one-time Windows setup

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
```

Setup performs the following operations for the current Windows user:

1. Creates `.venv` when it does not already exist.
2. Installs the pinned Python dependencies from `requirements.txt`.
3. Builds the windowless `KaraokeNativeHost.exe` launcher.
4. Derives the stable Chrome extension ID from the public key in the manifest.
5. Writes `host_manifest.json` with the correct absolute paths and allowed origin.
6. Registers `com.local.youtube_karaoke` under the current user's `HKCU` hive.

Administrator access is normally unnecessary. Running setup again is safe and
repairs the environment, generated manifest, extension origin, and registry
registration.

### 3. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `C:\Projects\karaoke_Agent\extension`.
5. Confirm that Chrome displays this extension ID:

   ```text
   chophfbioppiikhicgkkhingjdhcejdl
   ```

6. Pin **Media Deck** to the Chrome toolbar.
7. Click the Media Deck icon to open the side panel.

The extension ID is deterministic. `setup.ps1` calculates it directly from
`extension/manifest.json`, stores it in `state/extension_id.txt`, and registers
the corresponding native-host origin automatically. You should not need to
copy the ID into the setup command.

If Chrome intentionally assigns a different ID to a repackaged extension, use
the recovery override:

```powershell
.\setup.ps1 -ExtensionId THE_ID_SHOWN_BY_CHROME
```

### 4. Complete first-run permissions

1. Reload Media Deck from `chrome://extensions` after setup.
2. Reopen the side panel.
3. Open or play local media so the player starts at `http://127.0.0.1:8765`.
4. Allow microphone access when Chrome requests it.
5. In Windows Sound settings, select the intended headset or microphone as the
   default input device.

The player does not need a separate start command. Chrome starts the native
host, and the host starts the loopback Media Deck server when it is needed.

## Confirm a successful installation

These generated paths should exist after setup:

```text
C:\Projects\karaoke_Agent\.venv\Scripts\python.exe
C:\Projects\karaoke_Agent\KaraokeNativeHost.exe
C:\Projects\karaoke_Agent\host_manifest.json
C:\Projects\karaoke_Agent\models\hey_jarvis_v0.1.onnx
```

Check the native-host registry registration:

```powershell
Get-Item 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.youtube_karaoke'
Get-ItemPropertyValue `
  -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.youtube_karaoke' `
  -Name '(default)'
```

The expected manifest path is:

```text
C:\Projects\karaoke_Agent\host_manifest.json
```

The side-panel activity log should report:

```text
Karaoke native host connected
```

The player should show `LOCAL MEDIA READY`, `NEEDLE · LOCAL · PRIVATE`, and
`HEY JARVIS ON`. Wake-word status changes to `LISTENING · SAY “HEY JARVIS”`
after LiveKit opens the Windows default microphone.

## Development and public extension builds

This repository deliberately has two extension flavors:

- `extension/` is the private development flavor. It includes the separate
  Suno panel for local development and authorized testing.
- `dist/extension-store/` is the generated public flavor. It contains the
  **Media** workflow but removes the Suno UI, recording implementation, capture
  handlers, Suno host origins, and the `tabs`/`activeTab` permissions.

Generate and validate the public extension with:

```powershell
cd C:\Projects\karaoke_Agent
.\.venv\Scripts\python.exe scripts\build_store_extension.py
node --check dist\extension-store\sidepanel.js
```

To inspect the public flavor locally, remove the development extension from
`chrome://extensions`, click **Load unpacked**, and select:

```text
C:\Projects\karaoke_Agent\dist\extension-store
```

The two flavors use the same stable ID and therefore cannot be loaded in Chrome
at the same time. The generated `dist/` directory is intentionally excluded
from Git and should be rebuilt for packaging. A future public Windows installer
must also package a correspondingly sanitized native-host payload.

## First use

### Create a karaoke video

1. Navigate to a supported video with English manual or automatic captions.
2. Open the Media Deck side panel.
3. Use the detected address or paste the media URL.
4. Fetch the timed transcript.
5. Correct the lyrics, timing, and included cues.
6. Choose the karaoke presentation.
7. Select an output folder or keep the default `output` directory.
8. Build the karaoke MP4.
9. Start playback explicitly when rendering finishes.

A normal render directory contains:

```text
source.mp4
transcript.json
lyrics.ass
<media title> - Karaoke.mp4
```

Edited lyrics are preserved in `transcript.json` and `lyrics.ass`. Rebuilding
reuses an existing source download whenever possible.

### Use local voice commands

- Say **Hey Jarvis**, wait for the microphone icon to turn red, and speak.
- Alternatively, hold the microphone button or hold **Ctrl+Space**.
- Release the button or shortcut to transcribe and immediately run the command.

Chrome's on-device Web Speech API is mandatory; Media Deck does not fall back
to cloud speech recognition. The first use may install a local command-quality
language pack. Cactus Needle model files are also downloaded and cached on the
first command; subsequent routing is local. Needle telemetry is disabled.

Playback temporarily ducks to 5% while voice capture is active to reduce music
self-capture, then restores the prior level unless the command sets a new volume.

## Updating

Update the source and repair the local environment with:

```powershell
cd C:\Projects\karaoke_Agent
git pull
.\setup.ps1
```

Then click **Reload** for Media Deck at `chrome://extensions` and reopen the
side panel.

If YouTube extraction fails after a site change, update the project-local
downloader:

```powershell
& '.\.venv\Scripts\python.exe' -m pip install --upgrade 'yt-dlp[default]'
```

## Build the Windows installer

Build the signed-ready preview installer with:

```powershell
cd C:\Projects\karaoke_Agent
.\installer\build-installer.ps1
```

The EXE and SHA-256 checksum are written to `installer\dist`. The installer
embeds the generated public/no-Suno extension, installs the companion per-user
under `%LOCALAPPDATA%\MediaDeck`, runs native-host setup, and registers an
Apps & Features uninstall entry.

The current preview installer requires Chrome, Python, Node.js, FFmpeg, and
FFprobe to be installed already. See [installer/README.md](installer/README.md)
for validation, signing, and release-hardening notes.

## Troubleshooting installation

### “Specified native messaging host not found”

This means Chrome cannot find the local host registration.

1. Run `.\setup.ps1` again and let it finish.
2. Verify that the extension ID matches the stable ID above.
3. Verify the registry and manifest paths from the confirmation section.
4. Reload the unpacked extension.
5. If necessary, close every Chrome window, reopen Chrome, and reload Media Deck.

### Native host connects and immediately disconnects

Run the Python host directly to expose startup errors:

```powershell
& 'C:\Projects\karaoke_Agent\.venv\Scripts\python.exe' `
  'C:\Projects\karaoke_Agent\native_host.py'
```

A healthy host waits silently for a native-messaging packet. Press `Ctrl+C` to
end this diagnostic. Common causes include a missing virtual environment,
missing dependency, antivirus interference, or invalid generated manifest.

### FFmpeg or rendering fails

```powershell
where.exe ffmpeg
where.exe ffprobe
ffmpeg -hide_banner -filters | Select-String subtitles
```

Check for missing PATH entries, missing libass support, insufficient free disk
space, or an output directory without write permission.

### The player does not open

The playback service binds only to the local computer:

```powershell
Invoke-WebRequest http://127.0.0.1:8765/health
```

If port 8765 is occupied:

```powershell
Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, State, OwningProcess
```

Playback URLs use random tokens stored under `state/`. Unknown tokens return
404, and the service is not exposed to the local network or Internet.

### Speech recognition does not hear the intended microphone

Check the input device in Windows Sound settings first. Media Deck uses the
browser/Windows default microphone. Hold push-to-talk until the microphone icon
turns red before speaking. The Activity Log reports the selected device and
recognizer state.

## Validate a source checkout

```powershell
cd C:\Projects\karaoke_Agent
.\.venv\Scripts\python.exe tests\test_karaoke_core.py
node --check extension\sidepanel.js
node --check extension\background.js
Get-Content extension\manifest.json -Raw | ConvertFrom-Json | Out-Null
```

The current suite contains 51 tests.

## Storage, privacy, and security

- Downloads and renders default to `output/`; the directory is excluded from Git.
- Runtime indexes, playback tokens, and extension identity state stay under
  local ignored directories.
- Private keys, generated executables, host manifests, caches, and media files
  are excluded from source control.
- Playback listens only on `127.0.0.1` and requires a registered random token.
- Command routing is restricted to a validated allowlist before browser controls
  can be invoked.
- Wake-word detection, speech recognition, command routing after model download,
  rendering, equalization, visualization, and playback run locally.
- The development Suno workflow must only be used for audio the user owns or is
  authorized to save. It does not bypass protected media.

## Acknowledgments and citation

Media Deck uses [Cactus Needle 3](https://github.com/cactus-compute/needle) for
local natural-language tool routing. If you reference this integration in
academic or technical work, cite the Needle project as follows:

```bibtex
@misc{needle3_2026,
  title        = {Needle: Automation Foundation Model for Tiny Devices},
  author       = {Ndubuaku, Henry and Mosoyan, Karen and Mroz, Jakub and
                  Cylich, Noah and Kumar, Satyajit and Sandhu, Parkirat and
                  Shemet, Roman and Lee, Justin H.},
  year         = {2026},
  organization = {Cactus Compute, Inc.},
  howpublished = {\url{https://github.com/cactus-compute/needle}}
}
```

For implementation details, operational behavior, and deeper recovery steps,
see [Notes.md](Notes.md).
