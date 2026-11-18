[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== boot.log (tail 60) ==="
Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 60 -ErrorAction SilentlyContinue
"=== pending_open.txt ==="
Get-Content "$env:LOCALAPPDATA\SamOffice\pending_open.txt" -ErrorAction SilentlyContinue
"=== exe version ==="
(Get-Item 'C:\Program Files\SamOffice\samoffice.exe').VersionInfo | Select-Object FileVersion, ProductVersion, ProductName | Format-List | Out-String
"=== Windows Application log: samoffice errors (last 5) ==="
Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'} -MaxEvents 200 -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -like '*samoffice*' } | Select-Object -First 5 TimeCreated, @{n='Msg';e={$_.Message.Substring(0, [Math]::Min(700, $_.Message.Length))}} | Format-List | Out-String
