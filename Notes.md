# Local Karaoke — Setup and Troubleshooting Notes

This project is a standalone Chrome side-panel application. It downloads a
YouTube video's existing timed captions, permits local lyric correction, burns
karaoke highlighting into the downloaded video with FFmpeg, and opens the
finished MP4 in a local browser tab. It keeps the source soundtrack and vocals.
It can additionally resolve an individual public Suno share page's real
Open Graph audio stream and save it as a titled MP3.

SAM, Whisper, diarization, FastAPI, cloud inference, and GPU models are not part
of this application.

## Components

- `extension/`: Manifest V3 Chrome side panel.
- `native_host.py`: trusted bridge between Chrome and local Python processes.
- `karaoke_core.py`: YouTube captions, Suno public-audio resolution, ASS
  subtitles, media download, validation, and FFmpeg rendering.
- `playback_server.py`: token-gated MP4 playback on `127.0.0.1:8765` with HTTP
  byte-range support for seeking.
- `wakeword_service.py`: CPU-only LiveKit wake-word listener using the bundled
  custom `Hey Jarvis` ONNX model.
- `setup.ps1`: creates the Python environment and registers the native host.
- `output/`: default timestamped run directories and completed artifacts.

## Extension build flavors

- `extension/` is the private development flavor. Its primary source panel is
  branded **Media**, while the separate Suno module remains available for local
  development and private testing.
- The public/store flavor is generated with:

  ```powershell
  .\.venv\Scripts\python.exe scripts\build_store_extension.py
  ```

- Store output is written to `dist/extension-store/`. The build physically
  removes the Suno panel, display-capture/MediaRecorder code, capture message
  handlers, Suno host permissions, and the `tabs`/`activeTab` permissions. It
  does not merely hide those controls.
- The generated `dist/` tree is ignored by Git and should be produced fresh for
  validation and packaging. The future Windows installer must package this
  public flavor rather than the private `extension/` source directory.

Chrome extensions cannot install native applications or write the Windows
registry themselves. The setup command is therefore an intentional one-time
user-authorized step. The side-panel setup button copies that command; it cannot
execute it silently.

## Prerequisites

Confirm these commands work in PowerShell:

```powershell
python --version
node --version
ffmpeg -version
ffprobe -version
```

Chrome 141 or newer must be installed. Internet access is required during
initial setup, the first Cactus Needle model load, and while retrieving YouTube
metadata, captions, or source media. Wake-word detection, speech recognition,
command routing after model download, rendering, and playback are local.

## First-time unpacked installation

1. Extract the application to a permanent location, preferably
   `C:\Projects\karaoke_Agent`. If the folder is moved later, rerun setup so
   Chrome's native-host registration receives the new absolute path.
2. Open PowerShell and run:

   ```powershell
   cd C:\Projects\karaoke_Agent
   Set-ExecutionPolicy -Scope Process Bypass
   .\setup.ps1
   ```

   Setup creates `.venv`, installs yt-dlp, Cactus Needle 3, LiveKit Wake Word,
   ONNX Runtime, and PyAudio, builds the hidden `KaraokeNativeHost.exe`, writes
   the native-host manifest, and registers it under the current user's `HKCU`
   registry hive. Administrator access is normally unnecessary.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select
   `C:\Projects\karaoke_Agent\extension` (select the directory, not the ZIP).
6. Confirm Chrome displays extension ID
   `chophfbioppiikhicgkkhingjdhcejdl`, then pin the extension to the toolbar.
   Setup derives this ID from `extension/manifest.json` automatically and saves
   it to `state/extension_id.txt`; it does not need to be copied manually.
7. Click the extension icon to open the side panel. If Chrome still reports a
   missing native host, click **Reload** on the extension. If necessary, close
   every Chrome window, reopen Chrome, and reload it again.
8. When the Media Deck first opens, allow microphone access for
   `http://127.0.0.1:8765` and make the intended headset microphone the Windows
   default input device.

The player does not require a separate launch command. The extension starts the
native host, and the native host starts the loopback-only Media Deck server when
media is opened, downloaded, or rendered. The server listens only at
`http://127.0.0.1:8765`.

The extension uses a checked-in public key to keep this unpacked ID stable:

```text
chophfbioppiikhicgkkhingjdhcejdl
```

Chrome computes the ID deterministically from that public key. `setup.ps1`
uses the same algorithm, stores the result, and writes it into the native-host
`allowed_origins`. The optional `-ExtensionId` parameter remains available only
as a recovery override if a deliberately repackaged extension uses another key.

The matching native host is:

```text
com.local.youtube_karaoke
```

The private signing key is local-only and ignored by source control. Do not
place `extension_private_key.pem` inside the distributed extension directory.

## Successful setup state

The following paths should exist:

```text
C:\Projects\karaoke_Agent\.venv\Scripts\python.exe
C:\Projects\karaoke_Agent\KaraokeNativeHost.exe
C:\Projects\karaoke_Agent\host_manifest.json
C:\Projects\karaoke_Agent\models\hey_jarvis_v0.1.onnx
```

The Windows registry should point Chrome to the host manifest:

```powershell
Get-Item 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.youtube_karaoke'
Get-ItemPropertyValue `
  -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.youtube_karaoke' `
  -Name '(default)'
```

Expected value:

```text
C:\Projects\karaoke_Agent\host_manifest.json
```

The host manifest's `allowed_origins` must contain exactly:

```text
chrome-extension://chophfbioppiikhicgkkhingjdhcejdl/
```

The extension log should report `Karaoke native host connected`. A running
Media Deck should show `LOCAL MEDIA READY`, `NEEDLE · LOCAL · PRIVATE`, and
`HEY JARVIS ON`. After LiveKit opens the Windows default input, its status
changes to `LISTENING · SAY “HEY JARVIS”`. Say the wake phrase, wait for the
microphone icon to turn red, and then speak the command. Ctrl+Space and the
microphone button remain manual push-to-talk alternatives.

## Normal workflow

1. Navigate to a YouTube video.
2. Open the Local YouTube Karaoke side panel.
3. Use the detected URL or click **Use Current YouTube Tab**.
4. Click **Fetch Timed Transcript**.
5. Review every cue. Correct recognition errors, adjust start/end seconds, and
   clear **Use** for non-lyric cues.
6. Select right-side rolling or classic-bottom lyrics.
7. Choose an output folder or retain the project output folder.
8. Click **Build Karaoke MP4**.
9. The completed MP4 is saved and opened automatically in a new Chrome tab.

Each run normally contains:

```text
source.mp4
transcript.json
lyrics.ass
<YouTube or edited title> - Karaoke.mp4
```

### Lyric presentation

- **Modern Karaoke** is the default clean presentation: a 60/40 stage with the
  complete current lyric in yellow and up to two previous and two upcoming
  phrases in muted gray. Short trailing caption fragments are merged into a
  complete phrase before layout, preventing orphan rows such as `black.` or
  `already know.`. All visible phrases share one compact, normally spaced text
  block. Across its five phrase positions the type scales small → larger →
  largest active → larger → small, producing a rolling-wheel depth cue without
  adding blank space. It has no progressive sweep, movement, or active-line marker.
- **Split Stage** uses the same fixed 1920×1080 canvas, reserving the left
  60% for an aspect-preserving video image and the right 40% for lyrics on
  black. The image is inset within that stage to preserve a clear black gutter
  before the lyric column. It displays only the previous, active, and next phrases. The active
  phrase uses 64 px bold progressive highlighting; context uses 44 px type.
- Split Stage uses a smooth 450 ms (or proportionally shorter) upward roll at
  each cue transition. Existing phrases glide into their next positions while
  the upcoming phrase enters below; the lyric block is not replaced abruptly.
- In **Split Stage**, a stationary yellow active-line marker identifies the `sing now` position.
  Lyrics roll through that guide so the next entrance is visually predictable,
  even before its progressive word highlighting begins.
- A `GET READY TO SING` message and 3–2–1 count-in occupy the final four
  seconds before the first lyric. A shorter intro compresses the sequence so
  the first lyric remains synchronized; the soundtrack is never delayed. The
  preparation label uses a restrained 38 px size and the numbers use 64 px so
  the count-in does not overpower the lyric panel. The complete first lyric is
  visible beneath the message throughout the count-in, giving the singer time
  to read it before progressive highlighting begins. Long first lyrics wrap at
  word boundaries inside the panel rather than clipping at the canvas edge.
  The message and lyric preview are continuous overlays; only the yellow
  countdown number changes, preventing once-per-second text flicker.
- **Classic** retains the source video's full frame and places conventional
  lyrics along the bottom.
- Layout selection changes only the render. It does not refetch captions or
  discard transcript corrections.
- Caption context annotations such as `[Singing]`, `[Music]`, `[Applause]`,
  `[Laughter]`, `[gasps]`, and `[Background noise]` are removed automatically. If an
  annotation shares a cue with real words, only the annotation is removed.
  Any cue made entirely from a square-bracket stage direction is also discarded.
- YouTube speaker-change markers (`>>`, `»`, or `›`) are stripped. Marker-only
  cues are discarded and never occupy a lyric scrolling slot.

### Build progress and playback

- The side panel reports preparation, download, encoding, and playback
  registration milestones on a 0–100% progress bar.
- YouTube downloads stream yt-dlp's real percentage, transfer speed, and ETA
  into that bar. Combined MP4 video/audio downloads are treated as two phases,
  preventing the UI from moving backward when the second stream begins.
- A completed render does not autoplay or open a browser tab. The user starts
  local playback explicitly with **Play in New Tab**.
- **Download MP4** and **Download MP3** operate directly from the URL without
  requiring caption retrieval. They use the same selected save folder and
  create a titled, timestamped run directory. The media filename is derived
  from the sanitized YouTube title, such as `Where the Road Goes Quiet.mp4` or
  `Where the Road Goes Quiet.mp3`. Direct downloads never autoplay.
- Karaoke renders use a persistent source cache keyed by YouTube video ID.
  Before downloading, the host checks the cache, earlier karaoke `source.mp4`
  files, and earlier direct `video.mp4` downloads. A corrected rerender saves a
  new `transcript.json`, `lyrics.ass`, and title-based karaoke MP4 while reusing
  the original source video. The source is hard-linked when possible to avoid both
  another network download and another full disk copy.
- Before an MP3 request downloads audio, it checks for a titled direct MP4,
  the shared source cache, and earlier karaoke source files for the same video
  ID. When found, FFmpeg extracts the MP3 locally and YouTube is not downloaded
  again.
- The Title, nested Lyrics editor, layout selector, and render action live in
  one outer **Build Karaoke** collapsible panel beneath the direct downloads.
- The extension side panel shares the local playback deck's dark-metal and
  cyan-blue theme. Green remains reserved for completed, locally saved download
  buttons so state is distinguishable from ordinary primary actions.
- Successful direct-download buttons turn green and change to **Play MP4** or
  **Play MP3**. The saved paths persist by YouTube URL in extension storage;
  clicking a green button validates and plays the local file without another
  download. Changing the URL restores the saved state for that URL or resets
  the controls when no matching download exists.

## “Specified native messaging host not found”

This means Chrome could not find the registered host. It is not a caption or
YouTube error.

Check, in order:

1. Run `setup.ps1` and wait for it to finish.
2. Verify the registry key and manifest paths shown above.
3. Verify the extension ID on `chrome://extensions` is
   `chophfbioppiikhicgkkhingjdhcejdl`.
4. Reload the unpacked extension after setup.
5. Fully restart Chrome if its service worker cached the pre-setup state.
6. Ensure `run_host.bat` has not been moved away from the path stored in
   `host_manifest.json`.

Running setup again is safe and repairs the environment, manifest origin, and
registry registration:

```powershell
cd C:\Projects\karaoke_Agent
.\setup.ps1
```

## Native host connects and then disconnects

Run the host launcher directly from PowerShell to expose startup errors:

```powershell
& 'C:\Projects\karaoke_Agent\.venv\Scripts\python.exe' `
  'C:\Projects\karaoke_Agent\native_host.py'
```

The process will wait silently for a native-messaging packet when healthy; use
`Ctrl+C` to stop that manual diagnostic. Common failures are a missing virtual
environment, missing yt-dlp, antivirus blocking the batch launcher, or invalid
JSON in `host_manifest.json`.

## Captions unavailable

The application prefers uploader-provided English captions and falls back to
English automatic captions. It reports an error when neither exists.

This is expected for videos whose owner disabled captions, private or
age-restricted videos that require authenticated cookies, live streams whose
captions are not finalized, and videos with no English caption track.

Automatic captions are not authoritative lyrics. Always review homophones,
punctuation, repeated rolling-caption fragments, music markers, and missing
outros before rendering. `[music]`, `[applause]`, `[laughter]`, and
`[instrumental]` cues are excluded by default but remain visible for review.

## YouTube or yt-dlp errors

YouTube changes frequently. Update the project-local downloader before changing
application code:

```powershell
& 'C:\Projects\karaoke_Agent\.venv\Scripts\python.exe' `
  -m pip install --upgrade 'yt-dlp[default]'
```

Node.js is used by yt-dlp for current YouTube JavaScript challenges. Confirm
`node --version` succeeds in a newly opened PowerShell window.

## Suno MP3 downloads

The app does not rely on yt-dlp's generic Suno page handling. The installed
yt-dlp release may not expose a dedicated Suno extractor, and generic HTML5
extraction has historically selected Suno's silence placeholder. Instead, the
native host reads an individual public `/song/` or `/s/` page, resolves its
song-ID-matched public stream and downloads it with real byte/speed/ETA
progress. Open Graph values such as `sil-100.mp3` are explicitly ignored.
Valid public M4A/Opus streams are converted to a genuine MP3 and checked with
FFmpeg. Tiny, invalid, private, or effectively silent responses fail with an
explicit error and are not retained as completed MP3s.

As of September 2026, some current Suno pages advertise a CloudFront `.m4a`
whose body is protected/non-playable data without an MP4 `ftyp` header. It is
not a damaged or incomplete download, and FFmpeg cannot convert it. The app
detects that response before FFmpeg and directs the user to Suno's official
Download command. We do not attempt to bypass Suno's protection. The downloaded
official audio can then be used as a local file.

### User-controlled Suno tab recording

The side panel's **Record Suno Tab** section is the supported fallback for a
song the user owns or is authorized to capture. It uses Chrome's explicit
`getDisplayMedia` chooser only after the user presses Start. The user selects
the Suno tab and enables **Share tab audio**; `suppressLocalAudioPlayback: false`
keeps the tab audible. The side panel records its audio track as WebM/Opus with
`MediaRecorder`. Capture requests stereo at 48 kHz with echo cancellation,
noise suppression, and automatic gain control disabled. Chrome's actual
channel count and sample rate are logged when recording begins. The Opus
recorder targets Opus's 510 kbps maximum and the final MP3 uses 320 kbps CBR,
the highest standard MP3 bitrate. Stop sends 512 KiB base64
chunks through the persistent native-messaging port. The host enforces chunk
order and a 1 GiB safety limit, converts the completed WebM to a titled MP3
with FFmpeg, deletes the intermediate file, and registers local playback.

Closing the side panel or tab during recording stops capture and may discard
the unfinished recording. This is a real-time recording of audible output, not
an extraction of Suno's protected media or an original lossless master.

Start remains disabled until the user visibly confirms: **I own this audio or
have permission to capture and save it.** The confirmation applies only to the
current side-panel session and is not silently persisted.

### Beat-reactive audio player

The MP3 performance monitor derives a short-lived pulse from low-frequency
energy and bass transients already available to its Web Audio analyser. The
center artwork and surrounding background glow respond with a restrained
scale/brightness decay using only the branded cyan `#16d9ff` and deep blue
`#087da1`. Reduced-motion preferences disable the animated scaling and hold a
static low-intensity glow.

The broader visual direction is vintage high-end power amplification: a glossy
black faceplate, saturated blue meter glass, dark engraved scale markings,
green signal lettering, and wide analog needle travel. The player uses its own
green script **Media Deck** wordmark rather than reproducing another brand's
trademark. Stereo tracks drive independent left/right RMS needles with fast
attack and slower mechanical-looking return; mono sources mirror both meters.

If YouTube extraction begins failing after a site change, upgrade the
project-local yt-dlp package using the command in the preceding section. Suno
downloads use our own resolver, so upgrading yt-dlp alone will not repair a
future Suno page-format change; update the extension/native host instead.

This path sends no Suno or browser login cookies. It is unauthenticated, but it
is not network-anonymous: Suno can still observe the downloader's public IP and
ordinary request metadata. Download only songs the user owns or is authorized
to save.

## FFmpeg render errors

Confirm both tools are visible to the native host environment:

```powershell
where.exe ffmpeg
where.exe ffprobe
```

Typical failures include FFmpeg missing from `PATH`, the FFmpeg build lacking
the `subtitles`/libass filter, an output directory without write permission,
insufficient disk space, or a source format that could not be converted to a
browser-compatible MP4.

Check subtitle-filter support with:

```powershell
ffmpeg -hide_banner -filters | Select-String subtitles
```

## Playback tab does not open or cannot seek

The native host starts a detached loopback-only server on:

```text
http://127.0.0.1:8765
```

Check it with:

```powershell
Invoke-WebRequest http://127.0.0.1:8765/health
```

If port 8765 is occupied, identify its owner:

```powershell
Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, State, OwningProcess
```

Playback URLs use random tokens stored in `state/playback_registry.json`.
Unknown tokens return 404, and the server binds only to `127.0.0.1`; it is not
exposed to the network.

### Local performance console

`/play/<token>` is an HTML performance console rather than a raw browser media
page. It wraps the saved output in a local hi-fi deck with real transport,
seeking, volume/mute, fullscreen, download, elapsed/duration clocks, animated
Web Audio frequency bars, and left/right output meters. The compact telemetry
shares the clock row in the track deck; there is no separate decorative tape
engine. The media bytes remain on the separate `/media/<token>` endpoint so
browser range requests and seeking continue to work.

The two output meters use the reusable original SVG face at
`assets/vu-meter-face.svg`. JavaScript does not redraw the face; it overlays
and rotates the red needles from the live Web Audio analyzer level, preserving
real meter movement with a sharper instrument-style background.

The visual language is an original HTML/CSS implementation inspired by vintage
hi-fi component stacks. No Magnetofon QML, C++ code, or graphic assets are
copied into this project.

The playback server is a detached process. After changing
`playback_server.py`, stop the existing loopback process or restart Windows;
the next Play action will start the updated server automatically.

## Validation after changes

```powershell
cd C:\Projects\karaoke_Agent
& 'C:\Users\Jim\miniconda3\envs\sam-audio-v2\python.exe' `
  -m unittest discover -s tests -p 'test_*.py'
node --check extension\sidepanel.js
node --check extension\background.js
Get-Content extension\manifest.json -Raw | ConvertFrom-Json | Out-Null
```

## Sharing and packaging

For development, distribute the project folder and use Load unpacked plus
`setup.ps1`. A Chrome Web Store extension still cannot install its native host.
A consumer release therefore needs a signed companion installer that installs
the Python/native executable, writes the host manifest with the installed path,
registers `com.local.youtube_karaoke`, and provides clean uninstall/upgrade
behavior. The extension should detect missing-host state and link to that
installer; it must never attempt silent installation.
# Source panels

- YouTube and Suno have separate URL inputs and controls in the extension side panel.
- The YouTube section is expanded by default because it is the primary workflow.
- The Suno section is collapsed by default and contains both direct MP3 download and authorized tab-recording controls.
- Saved download/play state is tracked independently for each source URL, so results do not leak between the YouTube and Suno buttons.

# Local media and album splitting

- The Local Media panel can remember and recursively scan a user-selected directory for MP3 and MP4 files.
- **Choose One File** can open an MP3, an original MP4, or a rendered karaoke MP4 without changing the saved library directory.
- The selected local file opens in the same token-gated Media Deck player used by downloaded media.
- Album Splitter accepts plain or Markdown-linked timestamp/title lists and writes numbered MP3 tracks to a sibling `<album> - Tracks` directory.
- A newly downloaded or recorded MP3 is automatically selected as the Album Splitter source and opens the relevant UI sections.
- Splits use FFmpeg stream copy, avoiding another lossy MP3 encode; boundaries therefore follow MP3 frame granularity.

# Local natural-language commands

- Media Deck uses the pinned Cactus Needle 3 runtime for local tool routing.
- The command panel supports playback, seeking, volume, mute, built-in EQ presets, library filtering/sorting, saved-media selection, and panel expansion.
- Needle output never executes directly. `media_commands.py` validates names, enums, strings, and numeric ranges against an explicit allowlist; unknown calls are dropped.
- Recognized commands run immediately; failed or unsupported commands return a
  visible error so the user can try again.
- `NEEDLE_TELEMETRY=0` and `DO_NOT_TRACK=1` are set before Needle is imported.
- The model downloads into the user's Hugging Face cache on first use. Once cached, inference is local; no cloud model API is involved.
- If the panel reports `NEEDLE · SETUP REQUIRED`, rerun `setup.ps1`, restart the local player, and refresh the player page.
- LiveKit Wake Word uses the bundled custom `Hey Jarvis` ONNX model locally on
  the CPU. It releases the microphone before Chrome captures a command and
  resumes listening after command handling finishes. Silero is not used.
- Push-to-talk uses Chrome's on-device Web Speech API only. Hold the microphone
  icon or Ctrl+Space until the icon turns red, speak, and release to transcribe
  and route the command.
- Release includes a short local decoding tail so the final word is not clipped. Empty results distinguish missing microphone audio, undetected speech, and an undecoded transcript.
- The player preflights Chrome's local speech-pack availability on startup,
  caches the selected quality, and prepares a standby recognition object.
  Microphone acquisition and speech readiness then proceed concurrently.
- LiveKit detections use a blocking local wait endpoint that wakes immediately
  when the detection sequence changes. The previous 500 ms browser poll is no
  longer used.
- Push-to-talk retains a 450 ms final-word capture tail and a 200 ms
  transcript-finalization window. This is a trailing decode buffer, not a PCM
  pre-roll; LiveKit still releases microphone ownership before Chrome acquires
  the command stream.
- `processLocally = true` is mandatory; Media Deck does not fall back to server-based speech recognition. The first use can install a local command-quality language pack.
- Media playback is temporarily paused while the microphone is recording to
  reduce self-capture, then restored unless the command changes playback.
- When the browser locale is not English and Chrome's Translator API is available, the recognized text is translated locally to English before routing.
- PocketTTS and other spoken confirmations are intentionally deferred; this phase is speech-to-text only.

# Download progress

- YouTube transfer progress occupies the main download range through 90%.
- yt-dlp post-processing now reports explicit FFmpeg conversion/merge messages above 90%, followed by validation/finalization at 98% and completion at 100%.

# Hidden native host

- Chrome launches `KaraokeNativeHost.exe`, a windowless stdio proxy, instead of invoking `run_host.bat` through a visible Windows console.
- `setup.ps1` builds the launcher with the Windows .NET Framework C# compiler and writes its path into the native-messaging manifest.
- The launcher does not contain application logic; it transparently connects Chrome's native-messaging pipes to `native_host.py`.
