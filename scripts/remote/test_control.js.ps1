[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== control: launch the 11/15 older build ==="
$old = "$env:LOCALAPPDATA\Programs\SamOffice\samoffice.exe"
if (Test-Path $old) {
  $p = Start-Process $old -PassThru
  "old exe launched pid=$($p.Id), wait 35s"
  Start-Sleep -Seconds 35
  $alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
  if ($alive) {
    "OLD BUILD ALIVE - regression in new build"
    $alive | Select-Object Id, MainWindowHandle, MainWindowTitle | Format-List | Out-String
    Stop-Process -Id $p.Id -Force
  } else { "old build also dies - environment issue" ; Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 1 }
} else { "old exe not found" }

"=== fetch new build's embedded frontend while it runs (start, poll port, curl) ==="
$p2 = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru
"new exe pid=$($p2.Id)"
$html = $null
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Milliseconds 800
  try {
    $html = Invoke-WebRequest 'http://127.0.0.1:62392/' -UseBasicParsing -TimeoutSec 2
    break
  } catch {}
}
if ($html) {
  "HTTP 200 fetched, length=$($html.Content.Length)"
  "title: " + ([regex]::Match($html.Content, '<title>[^<]*</title>').Value)
  "script tags: " + ([regex]::Matches($html.Content, '<script[^>]*src="[^"]*"').Count)
  [regex]::Matches($html.Content, 'src="([^"]*)"') | ForEach-Object { "  src: $($_.Groups[1].Value)" }
  "=== fetch first script ==="
  $src = [regex]::Match($html.Content, 'src="([^"]*\.js[^"]*)"').Groups[1].Value
  if ($src) {
    if ($src.StartsWith('/')) { $u = 'http://127.0.0.1:62392' + $src } else { $u = 'http://127.0.0.1:62392/' + $src }
    try { $js = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 5; "JS fetched OK: $u length=$($js.Content.Length)" }
    catch { "JS FETCH FAILED: $u -> $($_.Exception.Message)" }
  }
} else { "index.html never became fetchable in 20s" }
Stop-Process -Id $p2.Id -Force -ErrorAction SilentlyContinue
