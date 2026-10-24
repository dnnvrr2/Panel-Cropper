$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourceDir = 'C:\Users\Admin\Desktop\CBZ\images\SSS-Class Revival Hunter\SSS-Class Revival Hunter\crops'
$outputDir = Join-Path $PSScriptRoot 'blurred-crops'
$backupDir = Join-Path $PSScriptRoot 'knife-blur-backup'
New-Item -ItemType Directory -Force -Path $outputDir, $backupDir | Out-Null

function New-Point([int]$x, [int]$y) {
    return [System.Drawing.Point]::new($x, $y)
}

$areas = @{
    '001.png' = @(
        @( (New-Point 360 402), (New-Point 368 402), (New-Point 389 545), (New-Point 342 545) ),
        @( (New-Point 342 651), (New-Point 401 651), (New-Point 426 694), (New-Point 427 833),
           (New-Point 409 857), (New-Point 344 857), (New-Point 331 831), (New-Point 333 691) )
    )
    '002.png' = @(
        ,@( (New-Point 0 622), (New-Point 37 633), (New-Point 151 922), (New-Point 75 922),
           (New-Point 0 710) )
    )
    '014.png' = @(
        ,@( (New-Point 0 260), (New-Point 20 301), (New-Point 92 490), (New-Point 223 813),
           (New-Point 143 813), (New-Point 12 520), (New-Point 0 518) )
    )
    '015.png' = @(
        ,@( (New-Point 341 827), (New-Point 406 827), (New-Point 425 910), (New-Point 426 1043),
           (New-Point 403 1144), (New-Point 338 1144), (New-Point 317 1043), (New-Point 322 910) )
    )
}

foreach ($name in @('001.png', '002.png', '014.png', '015.png')) {
    $source = Join-Path $sourceDir $name
    $maskPath = Join-Path $outputDir ($name.Replace('.png', '-mask.png'))
    $output = Join-Path $outputDir $name
    Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir $name) -Force
    $sourceBitmap = [System.Drawing.Bitmap]::new($source)
    try {
        $mask = [System.Drawing.Bitmap]::new($sourceBitmap.Width, $sourceBitmap.Height,
            [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($mask)
            try {
                $graphics.Clear([System.Drawing.Color]::Black)
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
                foreach ($polygon in $areas[$name]) {
                    $graphics.FillPolygon([System.Drawing.Brushes]::White, [System.Drawing.Point[]]$polygon)
                }
            } finally { $graphics.Dispose() }
            $mask.Save($maskPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $mask.Dispose() }
    } finally { $sourceBitmap.Dispose() }

    & ffmpeg -hide_banner -loglevel error -y -i $source -i $maskPath `
        -filter_complex '[0:v]gblur=sigma=24[blur];[1:v]gblur=sigma=3[softmask];[0:v][blur][softmask]maskedmerge[out]' `
        -map '[out]' -frames:v 1 $output
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for $name" }
    Write-Output $output
}
