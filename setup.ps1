param(
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
$launcherSource = Join-Path $projectRoot 'native_host_launcher\KaraokeNativeHost.cs'
$launcherExe = Join-Path $projectRoot 'KaraokeNativeHost.exe'
$extensionManifestPath = Join-Path $projectRoot 'extension\manifest.json'

if (-not $ExtensionId) {
    $extensionManifest = Get-Content -LiteralPath $extensionManifestPath -Raw | ConvertFrom-Json
    if (-not $extensionManifest.key) {
        throw 'extension\manifest.json has no public key; the stable Chrome extension ID cannot be derived.'
    }
    $publicKey = [Convert]::FromBase64String([string]$extensionManifest.key)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha256.ComputeHash($publicKey)
    }
    finally {
        $sha256.Dispose()
    }
    $idBuilder = [Text.StringBuilder]::new(32)
    foreach ($value in $digest[0..15]) {
        [void]$idBuilder.Append([char](97 + ($value -shr 4)))
        [void]$idBuilder.Append([char](97 + ($value -band 15)))
    }
    $ExtensionId = $idBuilder.ToString()
}

$stateDirectory = Join-Path $projectRoot 'state'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
Set-Content -LiteralPath (Join-Path $stateDirectory 'extension_id.txt') -Value $ExtensionId -Encoding ASCII

if (-not (Test-Path -LiteralPath $venvPython)) {
    python -m venv (Join-Path $projectRoot '.venv')
}
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $projectRoot 'requirements.txt')

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
    throw 'The Windows C# compiler was not found; cannot build the hidden native-host launcher.'
}
& $csc /nologo /target:winexe /platform:anycpu /optimize+ "/out:$launcherExe" $launcherSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $launcherExe)) {
    throw 'Failed to build the hidden native-host launcher.'
}

$hostManifestPath = Join-Path $projectRoot 'host_manifest.json'
$hostManifest = [ordered]@{
    name = 'com.local.youtube_karaoke'
    description = 'Local Media Deck native host'
    path = $launcherExe
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$hostManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $hostManifestPath -Encoding UTF8

$chromeKey = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.local.youtube_karaoke'
New-Item -Path $chromeKey -Force | Out-Null
Set-Item -Path $chromeKey -Value $hostManifestPath

Write-Host 'Native host installed.' -ForegroundColor Green
Write-Host "Chrome extension ID: $ExtensionId" -ForegroundColor Cyan
Write-Host 'Reload the extension at chrome://extensions and reopen its side panel.'
