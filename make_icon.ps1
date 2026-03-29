Add-Type -AssemblyName System.Drawing

[int]$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAlias'

$g.Clear([System.Drawing.Color]::FromArgb(8,8,8))

$fontName = 'Arial'
foreach ($f in @('Barlow Condensed','Arial Narrow','Trebuchet MS','Impact','Arial')) {
  $test = New-Object System.Drawing.Font($f, 12, [System.Drawing.FontStyle]::Bold)
  if ($test.Name -eq $f) { $fontName = $f; $test.Dispose(); break }
  $test.Dispose()
}
Write-Host "Using font: $fontName"

$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = 'Center'
$sf.LineAlignment = 'Near'

$maxW = 460
$fontSize = 140

while ($fontSize -gt 20) {
  $font = New-Object System.Drawing.Font($fontName, $fontSize, [System.Drawing.FontStyle]::Bold)
  $sz = $g.MeasureString('FACTORY', $font)
  if ($sz.Width -le $maxW) { break }
  $font.Dispose()
  $fontSize -= 2
}

Write-Host "Font size: $fontSize"
$szCar  = $g.MeasureString('CAR', $font)
$szFact = $g.MeasureString('FACTORY', $font)
Write-Host "CAR w=$($szCar.Width) h=$($szCar.Height)  FACTORY w=$($szFact.Width)"

$letterH = $szCar.Height
$gap     = [int]($letterH * 0.2)
$totalH  = [int]($letterH * 2 + $gap)
$startY  = [int](($size - $totalH) / 2)
$cx      = [int]($size / 2)

$g.DrawString('CAR',     $font, $brush, $cx, $startY,               $sf)
$g.DrawString('FACTORY', $font, $brush, $cx, $startY + $letterH + $gap, $sf)

$g.Dispose()

$path = 'C:\Users\Vlad\Desktop\carfactory\icon.png'
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$font.Dispose()
Write-Host "Saved to $path"
