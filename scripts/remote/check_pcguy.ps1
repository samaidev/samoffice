[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== PC Guy install contents ==="
$pgDirs = @("$env:APPDATA\PCGuy", "$env:LOCALAPPDATA\PCGuy", 'C:\Program Files\PC Guy', 'C:\Program Files\PCGuy', "${env:ProgramFiles(x86)}\PC Guy")
foreach ($d in $pgDirs) { if (Test-Path $d) { "DIR: $d"; Get-ChildItem $d -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 25 FullName | Out-String } }
"=== PC Guy autostart/services ==="
Get-Service | Where-Object { $_.Name -like '*PCGuy*' -or $_.DisplayName -like '*PC Guy*' } | Select-Object Name, Status, StartType, BinaryPathName 2>$null | Format-List | Out-String
Get-CimInstance Win32_Service -Filter "Name LIKE '%PCGuy%' OR DisplayName LIKE '%PC%Guy%'" | Select-Object Name, State, PathName | Format-List | Out-String
"=== global hooks / injected DLLs: appinit ==="
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows' | Select-Object AppInit_DLLs, LoadAppInit_DLLs | Format-List | Out-String
"=== installed drivers (non-Microsoft, recent) ==="
driverquery /v /fo csv 2>$null | ConvertFrom-Csv | Where-Object { $_.'Module Name' -notmatch '^(microsoft|windows)' } | Select-Object -First 10 'Module Name', State, 'Display Name' | Out-String
"=== PC Guy processes running ==="
Get-Process | Where-Object { $_.Path -like '*PCGuy*' } | Select-Object Id, Name, Path | Format-List | Out-String
