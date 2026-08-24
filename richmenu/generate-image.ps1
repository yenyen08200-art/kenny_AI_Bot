# Generate the LINE rich menu background image (2500x1686, 3x2 grid).
# Usage: powershell -File richmenu/generate-image.ps1
#
# Labels are built from Unicode code points instead of literal CJK characters,
# and this file is kept pure-ASCII, to avoid any file-encoding misparsing.

function U {
    param([int[]]$Codes)
    -join ($Codes | ForEach-Object { [char]$_ })
}

Add-Type -AssemblyName System.Drawing

$width = 2500
$height = 1686
$cols = 3
$rows = 2
$gutter = 8

$cellW = [math]::Floor(($width - $gutter * ($cols + 1)) / $cols)
$cellH = [math]::Floor(($height - $gutter * ($rows + 1)) / $rows)

$label1 = U 0x4ECA,0x5929,0x72C0,0x6CC1   # today status
$label2 = U 0x9019,0x9031,0x884C,0x7A0B   # this week schedule
$label3 = U 0x9019,0x9031,0x7A7A,0x6A94   # this week free slots
$label4 = U 0x6211,0x7684,0x7B46,0x8A18   # my notes
$label5 = U 0x672C,0x6708,0x652F,0x51FA   # this month expense
$label6 = U 0x6307,0x4EE4                 # commands

$cells = New-Object System.Collections.ArrayList
[void]$cells.Add(@{ Label = $label1; Color = "#4A90D9" })
[void]$cells.Add(@{ Label = $label2; Color = "#50B87C" })
[void]$cells.Add(@{ Label = $label3; Color = "#F2A93B" })
[void]$cells.Add(@{ Label = $label4; Color = "#9B6FD1" })
[void]$cells.Add(@{ Label = $label5; Color = "#E1615B" })
[void]$cells.Add(@{ Label = $label6; Color = "#6B7684" })

$bmp = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#F5F5F5"))
$g.FillRectangle($bgBrush, 0, 0, $width, $height)
$bgBrush.Dispose()

$font = New-Object System.Drawing.Font("Microsoft JhengHei", 90, [System.Drawing.FontStyle]::Bold)
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

for ($i = 0; $i -lt $cells.Count; $i++) {
    $row = [math]::Floor($i / $cols)
    $col = $i % $cols
    $x = $gutter + $col * ($cellW + $gutter)
    $y = $gutter + $row * ($cellH + $gutter)

    $cellBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($cells[$i].Color))
    $g.FillRectangle($cellBrush, $x, $y, $cellW, $cellH)
    $cellBrush.Dispose()

    $rect = New-Object System.Drawing.RectangleF($x, $y, $cellW, $cellH)
    $g.DrawString($cells[$i].Label, $font, $textBrush, $rect, $sf)
}

$font.Dispose()
$textBrush.Dispose()

$outPath = Join-Path $PSScriptRoot "richmenu.png"
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()

Write-Output "Saved: $outPath"
