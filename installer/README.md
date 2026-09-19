# Media Deck Windows installer

Build the current preview installer from the repository root:

```powershell
.\installer\build-installer.ps1
```

The signed-ready EXE and SHA-256 checksum are written to `installer/dist/`.
Generated staging, payload, and distribution files are ignored by Git.

The installer embeds the generated public/no-Suno extension and the local Media
Deck companion. It installs per-user to `%LOCALAPPDATA%\MediaDeck`, runs the
normal dependency/native-host setup, registers an Apps & Features uninstall
entry, and opens the installed extension folder alongside
`chrome://extensions`.

Uninstall removes the registered host and installed application files. If the
default installed `output` folder contains media, it is first moved to a dated
`Media Deck\Recovered from uninstall ...` folder under the user's Windows
Music directory. Media saved to other user-selected directories is untouched.

This preview expects Chrome, Python, Node.js, FFmpeg, and FFprobe to already be
installed. It is not code-signed yet. A consumer release should bundle or
bootstrap the prerequisites, use the final Chrome Web Store extension ID, use a
sanitized public native-host payload, and be Authenticode signed.

Validate the embedded payload without installing:

```powershell
& '.\installer\dist\MediaDeck-Setup-0.1.0.exe' /verify
Get-Content (Join-Path $env:TEMP 'MediaDeckInstallerVerify.log')
```
