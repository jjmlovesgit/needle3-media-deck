# Local Karaoke

For detailed installation checks and failure recovery, see `Notes.md`.

The checked-in `extension/` directory is the private development flavor and
retains the optional Suno workflow. Public/store packages must be generated with
`python scripts/build_store_extension.py`; that output is branded **Media**,
removes the Suno UI and recording implementation, drops the Suno host origins,
and uses only `storage`, `nativeMessaging`, and `sidePanel` permissions. Generated
store files are written to `dist/extension-store/` and are not committed.

A standalone Chrome side-panel workflow that turns a YouTube video's existing
captions into an editable, locally rendered karaoke MP4. The finished file keeps
the original soundtrack and vocals. SAM, Whisper, diarization, and GPU models
are not used. Public Suno song/share URLs can also be saved directly as titled
MP3 files; Suno links do not enter the transcript or karaoke-render workflow.

For a Suno song that plays in Chrome but exposes only protected/non-playable
media, open **Record Suno Tab** in the side panel. Start recording, play audio
you own or are authorized to capture, then stop when the song ends. Chrome's
user-initiated tab-capture API records the audible output in real time, keeps
it audible, and the native host converts the recording to a titled MP3.

The extension identity uses the generated luminous microphone-`K` mark in
`extension/icons/`, with Chrome-ready 16, 32, 48, and 128 pixel variants.

## Workflow

1. Open a YouTube video and the extension side panel.
2. Fetch manual captions or fall back to English automatic captions.
3. Correct the lyric phrases in the side panel.
4. Choose right-side rolling or classic-bottom presentation.
5. Render with yt-dlp and FFmpeg through the native host.
6. The saved MP4 opens automatically in a new Chrome tab from the token-gated
   local playback server at `127.0.0.1:8765`.

## Install

1. Install FFmpeg and Node.js on `PATH`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load
   unpacked**. Select `C:\Projects\karaoke_Agent\extension`.
3. Copy the extension ID shown by Chrome.
4. In PowerShell run:

   ```powershell
   cd C:\Projects\karaoke_Agent
   .\setup.ps1
   ```

   The manifest pins the unpacked extension ID to
   `chophfbioppiikhicgkkhingjdhcejdl`. Setup derives that ID from the manifest's
   public key, stores it in `state/extension_id.txt`, and registers the matching
   native-host origin automatically, so no ID argument is normally required.
   The side panel also exposes a **Copy One-Time Setup Command** button whenever
   Chrome reports that the native host is missing.

5. Reload the extension. Its toolbar action opens the side panel.

Outputs default to `C:\Projects\karaoke_Agent\output`; the side panel can select
another folder. Every run saves the internal `source.mp4`, `transcript.json`,
`lyrics.ass`, and a user-facing `<title> - Karaoke.mp4` in a timestamped
subdirectory. Direct MP4/MP3 downloads likewise use the sanitized YouTube title.
Public Suno MP3 downloads use the song's Open Graph title and song-ID-matched
public media stream. Genuine M4A/Opus streams are converted to MP3; tiny,
silent, or protected/non-playable responses are rejected rather than saved.
For protected current songs, use Suno's official Download command and then use
the resulting local audio file.

## Local Media Deck commands

The player includes a **Media Deck Command** panel powered by Cactus Needle 3.
It converts plain-language requests into a fixed allowlist of local playback,
seek, volume, mute, equalizer, library, media-selection, and panel commands.
Low-confidence calls require confirmation, and unsupported or invented calls
are discarded before reaching the browser controls.

Needle telemetry is disabled with `NEEDLE_TELEMETRY=0` and `DO_NOT_TRACK=1`.
The first command downloads and caches the small model files; commands after
that run locally. `setup.ps1` installs the pinned `cactus-needle` dependency.

Hold the microphone button—or hold Space anywhere outside a text field—to
dictate a command; release it to transcribe and run. The microphone turns red
only after Chrome receives microphone audio. Media Deck requires
Chrome's on-device Web Speech API (`processLocally = true`) and never falls back
to cloud recognition. Chrome installs the selected locale's command-quality
speech pack on first use. Non-English transcripts use Chrome's local Translator
API when it is available. TTS/spoken responses are intentionally not enabled.

## Current boundary

The YouTube video must expose an English manual or automatic caption track.
Caption recognition errors should be corrected in the side panel before the
render. Word highlighting is estimated proportionally inside each caption cue
because YouTube commonly supplies phrase-level rather than word-level timing.
Suno support is limited to individual public `/song/` or `/s/` share links and
MP3 output. Private songs, playlists, Suno MP4, and Suno caption import are not
supported.
