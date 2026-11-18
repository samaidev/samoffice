[Console]::OutputEncoding = [Text.Encoding]::UTF8
$exe5 = "$env:LOCALAPPDATA\Programs\SamOffice\samoffice.exe"
$p = Start-Process $exe5 -PassThru
"v0.7.5 pid=$($p.Id), wait 35s"
Start-Sleep -Seconds 35
$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) {
  "alive. MainWindowHandle = $($alive.MainWindowHandle)"
  if ($alive.MainWindowHandle -ne 0) { "WINDOW EXISTS — truly working" }
  else { "NO WINDOW — v0.7.5 is ALSO broken, just no watchdog to kill it" }
  Stop-Process -Id $p.Id -Force
} else { "died" }
