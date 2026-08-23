# generate_android_icons.ps1
# Generates Android adaptive icon foregrounds and legacy launcher icons with proper safe-zone padding so the icon is never cropped.

Add-Type -AssemblyName System.Drawing

$SourcePath = Resolve-Path (Join-Path $PSScriptRoot "..\assets\images\icon.png")
$ResBase = Resolve-Path (Join-Path $PSScriptRoot "..\android\app\src\main\res")
$AssetsImages = Resolve-Path (Join-Path $PSScriptRoot "..\assets\images")

$BackgroundColor = [System.Drawing.ColorTranslator]::FromHtml("#0F172A")

function GenerateForegroundImage([string]$sourceImgPath, [string]$outPath, [int]$canvasSize, [double]$scaleRatio) {
    $src = [System.Drawing.Bitmap]::FromFile($sourceImgPath)
    $bmp = New-Object System.Drawing.Bitmap($canvasSize, $canvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    
    $drawSize = [int]($canvasSize * $scaleRatio)
    $offset = [int](($canvasSize - $drawSize) / 2)
    
    $rect = New-Object System.Drawing.Rectangle($offset, $offset, $drawSize, $drawSize)
    $g.DrawImage($src, $rect)
    
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $g.Dispose()
    $bmp.Dispose()
    $src.Dispose()
}

function GenerateLegacyIcon([string]$sourceImgPath, [string]$outPath, [int]$canvasSize, [bool]$isRound) {
    $src = [System.Drawing.Bitmap]::FromFile($sourceImgPath)
    $bmp = New-Object System.Drawing.Bitmap($canvasSize, $canvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    
    $bgBrush = New-Object System.Drawing.SolidBrush($BackgroundColor)
    if ($isRound) {
        $g.FillEllipse($bgBrush, 0, 0, $canvasSize, $canvasSize)
    } else {
        # Rounded rectangle for legacy icon
        $radius = [int]($canvasSize * 0.2)
        $rect = New-Object System.Drawing.Rectangle(0, 0, $canvasSize, $canvasSize)
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
        $path.AddArc($canvasSize - $radius * 2, 0, $radius * 2, $radius * 2, 270, 90)
        $path.AddArc($canvasSize - $radius * 2, $canvasSize - $radius * 2, $radius * 2, $radius * 2, 0, 90)
        $path.AddArc(0, $canvasSize - $radius * 2, $radius * 2, $radius * 2, 90, 90)
        $path.CloseFigure()
        $g.FillPath($bgBrush, $path)
        $path.Dispose()
    }
    $bgBrush.Dispose()
    
    $drawSize = [int]($canvasSize * 0.72)
    $offset = [int](($canvasSize - $drawSize) / 2)
    $iconRect = New-Object System.Drawing.Rectangle($offset, $offset, $drawSize, $drawSize)
    $g.DrawImage($src, $iconRect)
    
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $g.Dispose()
    $bmp.Dispose()
    $src.Dispose()
}

Write-Host "Generating android-icon-foreground.png with 65% safe zone..." -ForegroundColor Cyan
$ForegroundAsset = Join-Path $AssetsImages "android-icon-foreground.png"
GenerateForegroundImage $SourcePath $ForegroundAsset 512 0.65

# Density specifications for mipmaps:
$Densities = @(
    @{ Name = "mipmap-mdpi"; ForegroundSize = 108; LegacySize = 48 },
    @{ Name = "mipmap-hdpi"; ForegroundSize = 162; LegacySize = 72 },
    @{ Name = "mipmap-xhdpi"; ForegroundSize = 216; LegacySize = 96 },
    @{ Name = "mipmap-xxhdpi"; ForegroundSize = 324; LegacySize = 144 },
    @{ Name = "mipmap-xxxhdpi"; ForegroundSize = 432; LegacySize = 192 }
)

foreach ($d in $Densities) {
    $dir = Join-Path $ResBase $d.Name
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    
    # Remove any existing .png / .webp conflicts first
    Get-ChildItem -Path $dir -Filter "ic_launcher*" | Remove-Item -Force
    
    Write-Host "Generating icons for $($d.Name)..." -ForegroundColor Yellow
    
    # 1. Adaptive foreground (65% safe zone ratio)
    $fgPath = Join-Path $dir "ic_launcher_foreground.png"
    GenerateForegroundImage $SourcePath $fgPath $d.ForegroundSize 0.65
    
    # 2. Legacy regular icon
    $legacyPath = Join-Path $dir "ic_launcher.png"
    GenerateLegacyIcon $SourcePath $legacyPath $d.LegacySize $false
    
    # 3. Legacy round icon
    $roundPath = Join-Path $dir "ic_launcher_round.png"
    GenerateLegacyIcon $SourcePath $roundPath $d.LegacySize $true
}

Write-Host "All Android icons generated successfully with safe-zone padding!" -ForegroundColor Green
