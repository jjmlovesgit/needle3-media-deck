param(
    [string]$Version = "0.1.0"
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installerRoot = $PSScriptRoot
$workRoot = Join-Path $installerRoot '.tmp'
$payloadRoot = Join-Path $workRoot 'payload'
$payloadZip = Join-Path $workRoot 'MediaDeckPayload.zip'
$distRoot = Join-Path $installerRoot 'dist'
$outputExe = Join-Path $distRoot "MediaDeck-Setup-$Version.exe"
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
$storeBuild = Join-Path $projectRoot 'dist\extension-store'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $installerRoot 'MediaDeckInstaller.cs'
$iconSource = Join-Path $projectRoot 'extension\icons\icon128.png'
$iconPath = Join-Path $workRoot 'MediaDeck.ico'
$installerPrefix = [IO.Path]::GetFullPath($installerRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$resolvedWorkRoot = [IO.Path]::GetFullPath($workRoot)

if (-not $resolvedWorkRoot.StartsWith($installerPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean an installer work directory outside $installerRoot"
}

if (-not (Test-Path -LiteralPath $pythonExe)) {
    throw "Project Python environment was not found at $pythonExe. Run setup.ps1 first."
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw "Windows C# compiler was not found at $compiler."
}

if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $payloadRoot,$distRoot -Force | Out-Null

& $pythonExe (Join-Path $projectRoot 'scripts\build_store_extension.py')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $storeBuild)) {
    throw 'The public extension build failed.'
}

$rootFiles = @(
    'karaoke_core.py',
    'media_commands.py',
    'media_library.py',
    'native_host.py',
    'playback_server.py',
    'wakeword_service.py',
    'requirements.txt',
    'run_host.bat',
    'setup.ps1',
    'README.md',
    'Notes.md',
    'LICENSE'
)
foreach ($name in $rootFiles) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $payloadRoot $name) -Force
}

Copy-Item -LiteralPath $storeBuild -Destination (Join-Path $payloadRoot 'extension') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets') -Destination (Join-Path $payloadRoot 'assets') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'models') -Destination (Join-Path $payloadRoot 'models') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'native_host_launcher') -Destination (Join-Path $payloadRoot 'native_host_launcher') -Recurse -Force

Compress-Archive -Path (Join-Path $payloadRoot '*') -DestinationPath $payloadZip -CompressionLevel Optimal -Force

Add-Type -AssemblyName System.Drawing
$sourceImage = [System.Drawing.Image]::FromFile($iconSource)
try {
    $bitmap = [System.Drawing.Bitmap]::new($sourceImage, 128, 128)
    try {
        $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
        $stream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create)
        try {
            $icon.Save($stream)
        }
        finally {
            $stream.Dispose()
            $icon.Dispose()
        }
    }
    finally {
        $bitmap.Dispose()
    }
}
finally {
    $sourceImage.Dispose()
}

$compilerArgs = @(
    '/nologo',
    '/target:winexe',
    '/platform:anycpu',
    '/optimize+',
    "/out:$outputExe",
    "/win32icon:$iconPath",
    "/resource:$payloadZip,MediaDeck.Payload.zip",
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    $source
)
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputExe)) {
    throw 'Media Deck installer compilation failed.'
}

$hash = Get-FileHash -LiteralPath $outputExe -Algorithm SHA256
$hashLine = "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($outputExe))"
Set-Content -LiteralPath "$outputExe.sha256" -Value $hashLine -Encoding ASCII

Write-Host "Media Deck installer: $outputExe" -ForegroundColor Green
Write-Host "SHA-256: $($hash.Hash)" -ForegroundColor Cyan
