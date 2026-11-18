[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== Wails default WebView2 user data dirs (find all EBWebView / SamOffice wails dirs) ==="
foreach ($root in @($env:LOCALAPPDATA, $env:APPDATA, "$env:LOCALAPPDATA\Programs")) {
  Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*SamOffice*' -or $_.Name -like '*samoffice*' } | ForEach-Object {
    "DIR: $($_.FullName)"
    Get-ChildItem $_.FullName -ErrorAction SilentlyContinue | Select-Object -First 15 Name, LastWriteTime | Out-String
  }
}
"=== WebView2 for this exe: where? check %TEMP% wails dirs and ProgramData ==="
foreach ($p in @("$env:TEMP", "$env:ProgramData")) {
  Get-ChildItem $p -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*ebwebview*' -or $_.Name -like '*wails*' -or $_.Name -like '*samoffice*' } | Select-Object FullName, LastWriteTime | Out-String
}
"=== disk space ==="
Get-PSDrive C | Select-Object Used, Free | Out-String
"=== check installed exe version from binary ==="
(Get-Item 'C:\Program Files\SamOffice\samoffice.exe').VersionInfo.FileVersion
"=== try launch with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS disabled-GPU ==="
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--disable-gpu'
$p = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru
"launched pid=$($p.Id) with --disable-gpu, wait 35s"
Start-Sleep -Seconds 35
$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) {
  "STILL ALIVE - GPU was the problem!"
  $alive | Select-Object Id, MainWindowHandle, MainWindowTitle | Format-List | Out-String
  Stop-Process -Id $p.Id -Force
} else { "died again (not GPU)" }
Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 2
