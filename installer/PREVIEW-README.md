# Media Deck 0.1.0 Preview 1

This is an **unsigned Windows preview** for testing Media Deck on a second
computer. It installs the local Media Deck companion and the public/no-Suno
Chrome extension for the current Windows user.

The GitHub repository and release are private. Sign into GitHub with an account
that has access to `jjmlovesgit/mediadeck` before downloading the assets.

## Download these files

From the release's **Assets** section, download:

1. `Test-MediaDeckPrerequisites.ps1`
2. `MediaDeck-Setup-0.1.0.exe`
3. `MediaDeck-Setup-0.1.0.exe.sha256` (optional checksum file)

Keep the files together in the Windows Downloads folder.

## 1. Validate the laptop

Open PowerShell and run:

```powershell
cd $HOME\Downloads
Unblock-File .\Test-MediaDeckPrerequisites.ps1
Set-ExecutionPolicy -Scope Process Bypass
.\Test-MediaDeckPrerequisites.ps1
```

The validator checks:

- Google Chrome 141 or newer
- Python 3.11 or newer
- Python's standard `venv` module
- Node.js
- FFmpeg
- FFmpeg's `subtitles`/libass filter
- FFprobe

Continue when the final line says:

```text
READY: This PC meets the Media Deck installation prerequisites.
```

If a check fails, install or update that item, open a new PowerShell window so
its PATH changes are available, and run the validator again.

Optional machine-readable output:

```powershell
.\Test-MediaDeckPrerequisites.ps1 -Json
```

## 2. Verify the installer checksum

```powershell
cd $HOME\Downloads
(Get-FileHash .\MediaDeck-Setup-0.1.0.exe -Algorithm SHA256).Hash
```

Expected SHA-256:

```text
A33B84B8D7859F76D7A99FF6D7D277132C70FC98E221838265CB71E9E88F8EF1
```

## 3. Install Media Deck

1. Close every Chrome window.
2. Double-click `MediaDeck-Setup-0.1.0.exe`.
3. Windows SmartScreen may warn because this preview has not been code-signed.
   Choose **More info**, verify the filename, and select **Run anyway**.
4. Click **Install**.
5. Leave the installer open while it creates the Python environment, installs
   local dependencies, builds the hidden native host, and registers Chrome's
   local bridge. This can take several minutes.
6. When installation completes, click **Open Chrome Setup**.

Media Deck installs per-user under:

```text
%LOCALAPPDATA%\MediaDeck
```

Administrator access should not be required.

## 4. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select:

   ```text
   %LOCALAPPDATA%\MediaDeck\extension
   ```

   The usual expanded path is:

   ```text
   C:\Users\YOUR_NAME\AppData\Local\MediaDeck\extension
   ```

5. Confirm that Chrome shows extension ID:

   ```text
   chophfbioppiikhicgkkhingjdhcejdl
   ```

6. Pin **Media Deck** to the Chrome toolbar and open its side panel.

This preview contains the public extension flavor. The Suno interface and tab
recording permissions are intentionally absent.

## 5. Smoke-test the installation

Confirm the following:

- The Activity Log reports `Karaoke native host connected`.
- The Suno panel is not present.
- Local Media can scan a chosen directory.
- An MP3 plays in the Media Deck performance monitor.
- Original and karaoke MP4 files play with their aspect ratio preserved.
- Playback, seek, volume, equalizer, meters, and oscilloscope controls work.
- Holding **Ctrl+Space** or the microphone button records a local voice command.
- **Hey Jarvis** activates push-to-talk after wake-word status becomes listening.
- A permitted media URL can download MP3 or MP4 with live progress.
- Closing and reopening the side panel preserves its interface state.

Confirm the installed native-host path in PowerShell:

```powershell
Get-ItemPropertyValue `
  -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.youtube_karaoke' `
  -Name '(default)'
```

Expected result:

```text
C:\Users\YOUR_NAME\AppData\Local\MediaDeck\host_manifest.json
```

## Logs to share when something fails

Installer and native setup log:

```text
%LOCALAPPDATA%\MediaDeck\install.log
```

For playback, download, microphone, or voice-command failures, use **Clear Log**
in the Media Deck side panel, reproduce the problem once, and copy the resulting
Activity Log.

Also include:

- The failed prerequisite-check output
- The Chrome version from `chrome://version`
- The exact button or command used
- Whether the microphone icon turned red

Do not post private media, cookies, credentials, or signing keys.

## Repair or update

Run `MediaDeck-Setup-0.1.0.exe` again and click **Repair**. Then reload Media
Deck at `chrome://extensions`.

## Uninstall

Open:

```text
Windows Settings → Apps → Installed apps → Media Deck → Uninstall
```

The uninstaller removes the installed companion and Chrome native-host
registration. If the default installed `output` folder contains media, it is
first moved to:

```text
Music\Media Deck\Recovered from uninstall <date>
```

Media saved to another user-selected directory is not removed. Remove the
unpacked Media Deck extension from `chrome://extensions` separately.

## Preview limitations

- The EXE is not yet Authenticode signed.
- Chrome, Python, Node.js, FFmpeg, and FFprobe are not bundled.
- The extension must be loaded manually in Developer mode.
- The final Chrome Web Store identity and consumer installer are not finalized.
- The current public extension excludes Suno, while final public native-host
  payload hardening remains release work.

Report test results against release `v0.1.0-preview.1` and include the date the
assets were downloaded.
