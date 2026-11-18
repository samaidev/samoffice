[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== dirs/files changed under Program Files since 09:00 today ==="
Get-ChildItem 'C:\Program Files', 'C:\Program Files (x86)' -Directory -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date '2026-11-18 09:00') } | Select-Object FullName, LastWriteTime | Out-String
"=== Windows Update pending/reboot state ==="
$wu = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' -ErrorAction SilentlyContinue
"RebootRequired key exists: $($null -ne $wu)"
$pending = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending' -ErrorAction SilentlyContinue
"CBS RebootPending: $($null -ne $pending)"
"=== uptime ==="
(Get-CimInstance Win32_OperatingSystem).LastBootUpTime
"=== EdgeWebView setup log tail (runtime repair events?) ==="
Get-ChildItem "$env:ProgramFiles (x86)\Microsoft\EdgeWebView\Application\SetupMetrics" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, LastWriteTime | Out-String
"=== MSI/product installs in last 6h from registry ==="
Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*, HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue |
  Where-Object { $_.InstallDate -and $_.InstallDate -match '^202611(18|17)$' } |
  Select-Object DisplayName, InstallDate | Format-Table -AutoSize | Out-String
