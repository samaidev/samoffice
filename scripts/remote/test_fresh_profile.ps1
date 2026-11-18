[Console]::OutputEncoding = [Text.Encoding]::UTF8
$eb = "$env:APPDATA\samoffice.exe\EBWebView"
"=== EBWebView contents ==="
Get-ChildItem $eb -ErrorAction SilentlyContinue | Select-Object Name, LastWriteTime | Out-String
"=== corrupt profile suspects: Preferences / Cookies / lockfile ==="
Get-ChildItem "$eb\Default" -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('Preferences','Cookies','LOCK','Network') } | Select-Object Name, Length, LastWriteTime | Out-String
"=== rename test: move EBWebView aside, relaunch ==="
Move-Item $eb "$eb.bak-$(Get-Date -Format HHmmss)" -Force
"moved"
$p = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru
"launched pid=$($p.Id), wait 35s (fresh profile)"
Start-Sleep -Seconds 35
$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) {
  "STILL ALIVE - CORRUPT EBWebView PROFILE WAS THE ROOT CAUSE"
  $alive | Select-Object Id, MainWindowHandle, MainWindowTitle | Format-List | Out-String
  Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 1
} else {
  "still dies - not profile"
  Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 1
}
