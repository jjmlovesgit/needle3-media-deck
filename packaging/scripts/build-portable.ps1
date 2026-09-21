[CmdletBinding()]
param(
  [string]$NodeExe = (Join-Path $env:ProgramFiles 'nodejs\node.exe')
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$packaging = Join-Path $repo 'packaging'
$dist = Join-Path $packaging 'dist'
$portable = Join-Path $dist 'Needle3MediaDeck-portable'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "Node.js was not found at $NodeExe" }
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw "The .NET Framework C# compiler was not found at $compiler" }
$requiredNodeVersion = '22.19.0'
$nodeVersion = (& $NodeExe --version).Trim().TrimStart('v')
if ($nodeVersion -ne $requiredNodeVersion) { throw "This build is pinned to Node.js $requiredNodeVersion; found $nodeVersion" }
if (-not (Test-Path -LiteralPath (Join-Path $repo 'spa\app\vendor\needle3\needle3.cact') -PathType Leaf)) {
  throw 'Needle assets are missing. Run node spa\scripts\acquire-needle.mjs before building.'
}

if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
New-Item -ItemType Directory -Path $portable | Out-Null

$directories = @(
  'spa\app',
  'spa\config',
  'spa\licenses'
)
foreach ($relative in $directories) {
  $source = Join-Path $repo $relative
  $target = Join-Path $portable $relative
  New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

$files = @(
  'spa\scripts\serve.mjs',
  'spa\scripts\media-source.mjs',
  'spa\scripts\verify-needle.mjs',
  'spa\needle-assets.lock.json',
  'utilities\media-catalog\editor-server.mjs',
  'utilities\media-catalog\lib.mjs',
  'LICENSE',
  'README.md',
  'packaging\README.md',
  'packaging\THIRD-PARTY-NOTICES.md',
  'packaging\licenses\node-v22.19.0-LICENSE.txt'
)
foreach ($relative in $files) {
  $source = Join-Path $repo $relative
  $target = Join-Path $portable $relative
  New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

$runtime = Join-Path $portable 'runtime'
New-Item -ItemType Directory -Path $runtime | Out-Null
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $runtime 'node.exe') -Force

$launcher = Join-Path $packaging 'launcher\MediaDeckLauncher.cs'
$exe = Join-Path $portable 'MediaDeck.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /out:$exe $launcher
if ($LASTEXITCODE -ne 0) { throw "Launcher compilation failed with exit code $LASTEXITCODE" }

$hashFile = Join-Path $portable 'SHA256SUMS.txt'
$lines = Get-ChildItem -LiteralPath $portable -Recurse -File |
  Where-Object { $_.FullName -ne $hashFile } |
  Sort-Object FullName |
  ForEach-Object {
    $relative = $_.FullName.Substring($portable.Length + 1).Replace('\', '/')
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
  }
[IO.File]::WriteAllLines($hashFile, $lines, [Text.UTF8Encoding]::new($false))

$archive = Join-Path $dist 'Needle3MediaDeck-portable.zip'
Compress-Archive -Path (Join-Path $portable '*') -DestinationPath $archive -CompressionLevel Optimal

[pscustomobject]@{
  PortableDirectory = $portable
  Archive = $archive
  Files = (Get-ChildItem -LiteralPath $portable -Recurse -File).Count
  Bytes = (Get-ChildItem -LiteralPath $portable -Recurse -File | Measure-Object Length -Sum).Sum
} | ConvertTo-Json
