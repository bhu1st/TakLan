# PowerShell Release Build Script for LAN Msngr
# Dynamically reads version from wails.json and packages release build folder & zip archive.

$ErrorActionPreference = "Stop"

$RootDir = $PSScriptRoot
if (-not $RootDir) { $RootDir = Get-Location }

# 1. Dynamically read version & application name from wails.json
$WailsJsonPath = Join-Path $RootDir "wails.json"
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

# 2. Run Wails Production Build
Write-Host "`n[1/4] Running Wails production build..." -ForegroundColor Yellow
try {
    wails build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Wails build failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
} catch {
    Write-Error "Failed to execute 'wails build'. Ensure Wails CLI is installed and available in PATH."
    exit 1
}

# 3. Setup Target Release Directory Structure
$ReleaseBaseDir = Join-Path $RootDir "release"
$FolderVersionName = "LanMsngr-win-v$version"
$TargetReleaseDir = Join-Path $ReleaseBaseDir $FolderVersionName
$ZipArchivePath = Join-Path $ReleaseBaseDir "$FolderVersionName.zip"

Write-Host "`n[2/4] Preparing Release Directory: $TargetReleaseDir" -ForegroundColor Yellow

if (Test-Path $TargetReleaseDir) {
    Remove-Item -Path $TargetReleaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $TargetReleaseDir -Force | Out-Null

# 4. Copy Release Artifacts (Executable, LICENSE, README)
Write-Host "`n[3/4] Copying build artifacts into release folder..." -ForegroundColor Yellow

# Executable from build/bin/
$ExeSource = Join-Path $RootDir "build\bin\$outputFilename.exe"
if (-not (Test-Path $ExeSource)) {
    $ExeSource = Join-Path $RootDir "$outputFilename.exe"
}

if (Test-Path $ExeSource) {
    Copy-Item -Path $ExeSource -Destination (Join-Path $TargetReleaseDir "$outputFilename.exe") -Force
    Write-Host "  [+] Executable: $outputFilename.exe" -ForegroundColor Green
} else {
    Write-Error "Could not find built executable at $ExeSource"
    exit 1
}

# LICENSE
$LicenseSource = Join-Path $RootDir "LICENSE"
if (Test-Path $LicenseSource) {
    Copy-Item -Path $LicenseSource -Destination (Join-Path $TargetReleaseDir "LICENSE") -Force
    Write-Host "  [+] LICENSE" -ForegroundColor Green
} else {
    Write-Warning "LICENSE file not found at $LicenseSource"
}

# README.md (Prefer release/README.md if present, else root README.md)
$ReleaseReadmeSource = Join-Path $ReleaseBaseDir "README.md"
$RootReadmeSource = Join-Path $RootDir "README.md"

if (Test-Path $ReleaseReadmeSource) {
    Copy-Item -Path $ReleaseReadmeSource -Destination (Join-Path $TargetReleaseDir "README.md") -Force
    Write-Host "  [+] README.md (from release/)" -ForegroundColor Green
} elseif (Test-Path $RootReadmeSource) {
    Copy-Item -Path $RootReadmeSource -Destination (Join-Path $TargetReleaseDir "README.md") -Force
    Write-Host "  [+] README.md (from root)" -ForegroundColor Green
} else {
    Write-Warning "README.md not found"
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
