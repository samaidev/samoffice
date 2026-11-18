[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== launch new build, immediately poll its HTTP port for index.html ==="
$p = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru -RedirectStandardError "$env:TEMP\sam_err3.log"
"pid=$($p.Id)"
$port = $null
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Milliseconds 700
  $line = netstat -ano | Select-String "LISTENING\s+$($p.Id)$" | Select-Object -First 1
  if ($line) { $port = ($line -replace '.*127\.0\.0\.1:(\d+).*','$1'); break }
}
"port = $port"
if ($port) {
  foreach ($delay in @(0.5, 2, 5, 10, 15)) {
    Start-Sleep -Seconds $delay
    try {
      $r = Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 3
      "t+${delay}s: HTTP $($r.StatusCode), len=$($r.Content.Length)"
      $r.Content.Substring(0, [Math]::Min(400, $r.Content.Length))
      break
    } catch { "t+${delay}s: no response ($($_.Exception.Message.Split("`n")[0]))" }
  }
}
"=== full stderr ==="
Get-Content "$env:TEMP\sam_err3.log" -ErrorAction SilentlyContinue
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
