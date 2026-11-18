[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== PC Guy services ==="
Get-CimInstance Win32_Service | Where-Object { $_.PathName -like '*PCGuy*' } | Select-Object Name, State, StartMode, PathName | Format-List | Out-String
"=== AppInit hooks ==="
(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows').AppInit_DLLs
(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows').LoadAppInit_DLLs
"=== PC Guy processes now ==="
Get-Process | Where-Object { $_.Path -like '*PCGuy*' } | Select-Object Id, Name | Format-Table | Out-String
"=== takeover.json (what does it hook?) ==="
Get-Content "$env:APPDATA\PCGuy\takeover.json" -ErrorAction SilentlyContinue
"=== edge-pow / chrome-pow: WebView2 POOL profiles! They run own Edge ==="
Get-Process msedge -ErrorAction SilentlyContinue | Select-Object -First 3 Id, Path | Format-List | Out-String
"=== winlogon shell / notify ==="
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' | Select-Object Shell, Userinit | Format-List | Out-String
"=== IFEO hijacks (common injection point) ==="
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options' -ErrorAction SilentlyContinue | ForEach-Object {
  $deb = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
  if ($deb.Debugger) { "IFEO: $($_.PSChildName) -> $($deb.Debugger)" }
}
