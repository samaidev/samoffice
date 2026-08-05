Add-Type -AssemblyName System.Drawing
$f = 'C:\Users\Administrator\samoffice-1\build\bin\samoffice.exe'
$ico = [System.Drawing.Icon]::ExtractAssociatedIcon($f)
$bmp = $ico.ToBitmap()
$out = 'C:\Users\Administrator\samoffice-1\build\bin\check_icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "saved $($bmp.Width) x $($bmp.Height) -> $out"
