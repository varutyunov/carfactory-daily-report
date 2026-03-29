Add-Type -AssemblyName System.Drawing

$src = New-Object System.Drawing.Bitmap('C:\Users\Vlad\Desktop\carfactory\icon.png')
$dst = New-Object System.Drawing.Bitmap(180, 180)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.SmoothingMode = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($src, 0, 0, 180, 180)
$g.Dispose()
$dst.Save('C:\Users\Vlad\Desktop\carfactory\apple-touch-icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose()
$src.Dispose()
Write-Host "Done"
