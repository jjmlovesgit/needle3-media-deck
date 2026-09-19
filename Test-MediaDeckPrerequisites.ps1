[CmdletBinding()]
param(
    [int]$MinimumChromeMajor = 141,
    [Version]$MinimumPythonVersion = '3.11',
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$results = [Collections.Generic.List[object]]::new()

function Add-CheckResult {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][bool]$Passed,
        [string]$Version = '',
        [string]$Path = '',
        [string]$Details = ''
    )

    $results.Add([pscustomobject]@{
        Name = $Name
        Passed = $Passed
        Status = if ($Passed) { 'PASS' } else { 'FAIL' }
        Version = $Version
        Path = $Path
        Details = $Details
    })
}

function Invoke-ExternalCheck {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    try {
        $output = & $Path @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        return [pscustomobject]@{
            Succeeded = ($exitCode -eq 0)
            ExitCode = $exitCode
            Output = (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
        }
    }
    catch {
        return [pscustomobject]@{
            Succeeded = $false
            ExitCode = -1
            Output = $_.Exception.Message
        }
    }
}

function Find-Chrome {
    $registryPaths = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
    )
    foreach ($registryPath in $registryPaths) {
        try {
            $value = (Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop).'(default)'
            if ($value -and (Test-Path -LiteralPath $value -PathType Leaf)) {
                return [IO.Path]::GetFullPath($value)
            }
        }
        catch {
        }
    }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return [IO.Path]::GetFullPath($candidate)
        }
    }

    return $null
}

function Find-CommandPath {
    param([Parameter(Mandatory = $true)][string]$Name)

    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($command) {
        return $command.Source
    }
    return $null
}

# Google Chrome
$chromePath = Find-Chrome
if (-not $chromePath) {
    Add-CheckResult -Name 'Chrome' -Passed $false -Details 'Google Chrome is not installed. Download it from https://www.google.com/chrome/.'
}
else {
    try {
        $chromeInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($chromePath)
        $chromeVersion = [Version]$chromeInfo.FileVersion
        $chromePassed = $chromeVersion.Major -ge $MinimumChromeMajor
        $chromeDetails = if ($chromePassed) {
            "Chrome meets the required major version $MinimumChromeMajor or newer."
        }
        else {
            "Update Chrome to major version $MinimumChromeMajor or newer."
        }
        Add-CheckResult -Name 'Chrome' -Passed $chromePassed -Version $chromeVersion.ToString() -Path $chromePath -Details $chromeDetails
    }
    catch {
        Add-CheckResult -Name 'Chrome' -Passed $false -Path $chromePath -Details "Chrome was found, but its version could not be read: $($_.Exception.Message)"
    }
}

# Python and venv
$pythonPath = Find-CommandPath -Name 'python.exe'
if (-not $pythonPath) {
    Add-CheckResult -Name 'Python' -Passed $false -Details "Python $MinimumPythonVersion or newer is required and must be available as the python command."
}
else {
    $pythonVersionCheck = Invoke-ExternalCheck -Path $pythonPath -Arguments @(
        '-c',
        "import sys; print('.'.join(map(str, sys.version_info[:3])))"
    )
    $venvCheck = Invoke-ExternalCheck -Path $pythonPath -Arguments @('-c', 'import venv')
    try {
        $pythonVersion = [Version]($pythonVersionCheck.Output -split "\r?\n" | Select-Object -Last 1)
        $pythonPassed = $pythonVersionCheck.Succeeded -and
            $pythonVersion -ge $MinimumPythonVersion -and
            $venvCheck.Succeeded
        $pythonDetails = if (-not $venvCheck.Succeeded) {
            'Python was found, but its standard venv module is unavailable.'
        }
        elseif ($pythonVersion -lt $MinimumPythonVersion) {
            "Python $MinimumPythonVersion or newer is required."
        }
        else {
            'Python and the venv module are ready.'
        }
        Add-CheckResult -Name 'Python' -Passed $pythonPassed -Version $pythonVersion.ToString() -Path $pythonPath -Details $pythonDetails
    }
    catch {
        Add-CheckResult -Name 'Python' -Passed $false -Path $pythonPath -Details "The python command did not return a usable version: $($pythonVersionCheck.Output)"
    }
}

# Node.js
$nodePath = Find-CommandPath -Name 'node.exe'
if (-not $nodePath) {
    Add-CheckResult -Name 'Node.js' -Passed $false -Details 'Node.js is required for current yt-dlp YouTube JavaScript challenges. Download the LTS release from https://nodejs.org/.'
}
else {
    $nodeCheck = Invoke-ExternalCheck -Path $nodePath -Arguments @('--version')
    $nodeVersion = ($nodeCheck.Output -split "\r?\n" | Select-Object -First 1).Trim().TrimStart('v')
    Add-CheckResult -Name 'Node.js' -Passed $nodeCheck.Succeeded -Version $nodeVersion -Path $nodePath -Details $(if ($nodeCheck.Succeeded) { 'Node.js is ready.' } else { $nodeCheck.Output })
}

# FFmpeg and subtitle rendering support
$ffmpegPath = Find-CommandPath -Name 'ffmpeg.exe'
if (-not $ffmpegPath) {
    Add-CheckResult -Name 'FFmpeg' -Passed $false -Details 'FFmpeg is required and must be available on PATH. Download a Windows build from https://ffmpeg.org/download.html.'
}
else {
    $ffmpegVersionCheck = Invoke-ExternalCheck -Path $ffmpegPath -Arguments @('-version')
    $ffmpegFiltersCheck = Invoke-ExternalCheck -Path $ffmpegPath -Arguments @('-hide_banner', '-filters')
    $ffmpegFirstLine = ($ffmpegVersionCheck.Output -split "\r?\n" | Select-Object -First 1)
    $ffmpegVersion = if ($ffmpegFirstLine -match '^ffmpeg version\s+([^\s]+)') { $Matches[1] } else { $ffmpegFirstLine }
    $hasSubtitleFilter = $ffmpegFiltersCheck.Succeeded -and $ffmpegFiltersCheck.Output -match '(?m)^\s*[TSC\.]{3}\s+subtitles\s'
    $ffmpegPassed = $ffmpegVersionCheck.Succeeded -and $hasSubtitleFilter
    $ffmpegDetails = if (-not $ffmpegVersionCheck.Succeeded) {
        $ffmpegVersionCheck.Output
    }
    elseif (-not $hasSubtitleFilter) {
        'FFmpeg runs, but its subtitles/libass filter is missing. Install a full FFmpeg build.'
    }
    else {
        'FFmpeg and the subtitles/libass filter are ready.'
    }
    Add-CheckResult -Name 'FFmpeg' -Passed $ffmpegPassed -Version $ffmpegVersion -Path $ffmpegPath -Details $ffmpegDetails
}

# FFprobe
$ffprobePath = Find-CommandPath -Name 'ffprobe.exe'
if (-not $ffprobePath) {
    Add-CheckResult -Name 'FFprobe' -Passed $false -Details 'FFprobe is required and normally ships in the same bin directory as FFmpeg.'
}
else {
    $ffprobeCheck = Invoke-ExternalCheck -Path $ffprobePath -Arguments @('-version')
    $ffprobeFirstLine = ($ffprobeCheck.Output -split "\r?\n" | Select-Object -First 1)
    $ffprobeVersion = if ($ffprobeFirstLine -match '^ffprobe version\s+([^\s]+)') { $Matches[1] } else { $ffprobeFirstLine }
    Add-CheckResult -Name 'FFprobe' -Passed $ffprobeCheck.Succeeded -Version $ffprobeVersion -Path $ffprobePath -Details $(if ($ffprobeCheck.Succeeded) { 'FFprobe is ready.' } else { $ffprobeCheck.Output })
}

$allPassed = ($results | Where-Object { -not $_.Passed }).Count -eq 0

if ($Json) {
    [pscustomobject]@{
        Ready = $allPassed
        MinimumChromeMajor = $MinimumChromeMajor
        MinimumPythonVersion = $MinimumPythonVersion.ToString()
        Checks = $results
    } | ConvertTo-Json -Depth 4
}
else {
    Write-Host ''
    Write-Host 'MEDIA DECK PREREQUISITE CHECK' -ForegroundColor Cyan
    Write-Host '=============================' -ForegroundColor DarkCyan
    foreach ($result in $results) {
        $color = if ($result.Passed) { 'Green' } else { 'Red' }
        Write-Host ("[{0}] {1} {2}" -f $result.Status, $result.Name, $result.Version).TrimEnd() -ForegroundColor $color
        if ($result.Path) {
            Write-Host ("       Path: {0}" -f $result.Path) -ForegroundColor DarkGray
        }
        if ($result.Details) {
            Write-Host ("       {0}" -f $result.Details) -ForegroundColor Gray
        }
    }

    Write-Host ''
    if ($allPassed) {
        Write-Host 'READY: This PC meets the Media Deck installation prerequisites.' -ForegroundColor Green
    }
    else {
        Write-Host 'NOT READY: Install or update the failed items, open a new PowerShell window, and run this check again.' -ForegroundColor Red
    }
}

if ($allPassed) {
    exit 0
}
exit 1
