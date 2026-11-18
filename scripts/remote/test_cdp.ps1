[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== launch with remote debugging port ==="
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
$p = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru
"pid=$($p.Id)"
Start-Sleep -Seconds 10
"--- try CDP /json list:"
try {
  $tabs = Invoke-RestMethod 'http://127.0.0.1:9222/json' -TimeoutSec 5
  $tabs | ForEach-Object { "TAB: $($_.title) | $($_.url) | $($_.type)" }
  $page = $tabs | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
  if ($page) {
    "--- page ws: $($page.webSocketDebuggerUrl)"
    "--- try evaluate via CDP http endpoint ( PUT /json/new not needed; use ws in later step )"
  }
} catch { "CDP unavailable: $($_.Exception.Message)" }
Start-Sleep -Seconds 25
$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) { "ALIVE past watchdog"; Stop-Process -Id $p.Id -Force } else { "died" }
Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 1
