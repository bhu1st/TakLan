# PowerShell Release Build Script for LAN Msngr
# Dynamically reads version from wails.json and packages release build folder & zip archive.

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Get-Location }

# Determine Repo Root & Desktop Directory paths dynamically
if (Test-Path (Join-Path $ScriptDir "wails.json")) {
    $DesktopDir = $ScriptDir
    $RepoRootDir = (Get-Item $DesktopDir).Parent.FullName
    if (-not $RepoRootDir) { $RepoRootDir = $DesktopDir }
} elseif (Test-Path (Join-Path $ScriptDir "desktop\wails.json")) {
    $RepoRootDir = $ScriptDir
    $DesktopDir = Join-Path $RepoRootDir "desktop"
} else {
    Write-Error "Could not find desktop/wails.json in $ScriptDir"
    exit 1
}

# 1. Dynamically read version & application name from wails.json
$WailsJsonPath = Join-Path $DesktopDir "wails.json"
if (-not (Test-Path $WailsJsonPath)) {
    Write-Error "wails.json not found at $WailsJsonPath"
    exit 1
}

$wailsConfig = Get-Content -Raw -Path $WailsJsonPath | ConvertFrom-Json
$version = $wailsConfig.version
$outputFilename = $wailsConfig.outputfilename
if (-not $outputFilename) { $outputFilename = "lanmsngr" }

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Building LAN Msngr Release v$version " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan

# 2. Run Wails Production Build inside desktop directory
Write-Host "`n[1/4] Running Wails production build..." -ForegroundColor Yellow
Push-Location $DesktopDir
try {
    wails build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Wails build failed with exit code $LASTEXITCODE"
        Pop-Location
        exit $LASTEXITCODE
    }
} catch {
    Pop-Location
    Write-Error "Failed to execute 'wails build'. Ensure Wails CLI is installed and available in PATH."
    exit 1
}
Pop-Location

# 3. Setup Target Release Directory Structure at Repo Root
$ReleaseBaseDir = Join-Path $RepoRootDir "release"
$FolderVersionName = "LanMsngr-win-v$version"
$TargetReleaseDir = Join-Path $ReleaseBaseDir $FolderVersionName
$ZipArchivePath = Join-Path $ReleaseBaseDir "$FolderVersionName.zip"

Write-Host "`n[2/4] Preparing Release Directory: $TargetReleaseDir" -ForegroundColor Yellow

if (Test-Path $TargetReleaseDir) {
    Remove-Item -Path $TargetReleaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $TargetReleaseDir -Force | Out-Null

# 4. Copy Release Artifacts (Executable, LICENSE, README, Banner)
Write-Host "`n[3/4] Copying build artifacts into release folder..." -ForegroundColor Yellow

# Executable from desktop/build/bin/
$ExeSource = Join-Path $DesktopDir "build\bin\$outputFilename.exe"
if (-not (Test-Path $ExeSource)) {
    $ExeSource = Join-Path $DesktopDir "$outputFilename.exe"
}

if (Test-Path $ExeSource) {
    Copy-Item -Path $ExeSource -Destination (Join-Path $TargetReleaseDir "$outputFilename.exe") -Force
    Write-Host "  [+] Executable: $outputFilename.exe" -ForegroundColor Green
} else {
    Write-Error "Could not find built executable at $ExeSource"
    exit 1
}

# LICENSE
$LicenseSource = Join-Path $DesktopDir "LICENSE"
if (-not (Test-Path $LicenseSource)) {
    $LicenseSource = Join-Path $RepoRootDir "LICENSE"
}

if (Test-Path $LicenseSource) {
    Copy-Item -Path $LicenseSource -Destination (Join-Path $TargetReleaseDir "LICENSE") -Force
    Write-Host "  [+] LICENSE" -ForegroundColor Green
} else {
    Write-Warning "LICENSE file not found"
}

# README.md
$ReadmeSource = Join-Path $DesktopDir "README.md"
if (-not (Test-Path $ReadmeSource)) {
    $ReadmeSource = Join-Path $RepoRootDir "README.md"
}

if (Test-Path $ReadmeSource) {
    Copy-Item -Path $ReadmeSource -Destination (Join-Path $TargetReleaseDir "README.md") -Force
    Write-Host "  [+] README.md" -ForegroundColor Green
} else {
    Write-Warning "README.md not found"
}

# lanmsngr.png banner image
$BannerSource = Join-Path $DesktopDir "lanmsngr.png"
if (-not (Test-Path $BannerSource)) {
    $BannerSource = Join-Path $RepoRootDir "lanmsngr.png"
}

if (Test-Path $BannerSource) {
    Copy-Item -Path $BannerSource -Destination (Join-Path $TargetReleaseDir "lanmsngr.png") -Force
    Write-Host "  [+] lanmsngr.png (Banner)" -ForegroundColor Green
}

# 5. Create ZIP Archive for distribution
Write-Host "`n[4/4] Creating ZIP Archive: $ZipArchivePath" -ForegroundColor Yellow
if (Test-Path $ZipArchivePath) {
    Remove-Item -Path $ZipArchivePath -Force
}
Compress-Archive -Path "$TargetReleaseDir\*" -DestinationPath $ZipArchivePath -Force
Write-Host "  [+] ZIP Archive created successfully!" -ForegroundColor Green

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host " Build & Release Packaging Successful! " -ForegroundColor Green
Write-Host " Release Folder:  $TargetReleaseDir" -ForegroundColor White
Write-Host " Release Archive: $ZipArchivePath" -ForegroundColor White
Write-Host "==========================================" -ForegroundColor Cyan
