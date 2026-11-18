$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== sam processes ==="
Get-Process | Where-Object { $_.Path -like '*sam*' } | Select-Object Name, Id, Path | Format-List | Out-String
"=== installed apps (Sam) ==="
Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*, HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like '*Sam*' } |
  Select-Object DisplayName, DisplayVersion, InstallLocation | Format-List | Out-String
"=== likely dirs ==="
foreach ($p in @("$env:LOCALAPPDATA\SamOffice", "$env:ProgramFiles\SamOffice", "${env:ProgramFiles(x86)}\SamOffice", "$env:APPDATA\SamOffice")) {
  if (Test-Path $p) { "EXISTS: $p"; Get-ChildItem $p -ErrorAction SilentlyContinue | Select-Object -First 12 Name, LastWriteTime | Out-String }
}
