[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== exe file dates/sizes ==="
Get-ChildItem 'C:\Program Files\SamOffice\*.exe*' | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String
"=== exe hash (current vs baks) ==="
Get-FileHash 'C:\Program Files\SamOffice\samoffice.exe' -Algorithm SHA256 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Hash
(Get-Item 'C:\Program Files\SamOffice\samoffice.exe').Length
"=== frontend assets present? ==="
$exe = 'C:\Program Files\SamOffice\samoffice.exe'
"frontend/ embedded in Wails binary; check symbol:"
$bytes = [IO.File]::ReadAllBytes($exe)
"size: $($bytes.Length)"
"=== try strings: wails asset markers ==="
$text = [Text.Encoding]::ASCII.GetString($bytes[($bytes.Length-4MB)..($bytes.Length-1)])
"has wailsjs: " + $text.Contains('wailsjs')
"=== GPU/driver info ==="
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, Status | Format-List | Out-String
"=== RDP session? ==="
query session 2>&1 | Out-String
