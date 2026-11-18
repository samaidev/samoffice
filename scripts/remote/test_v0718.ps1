[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== download v0.7.18 zip and test-run it standalone ==="
$tmp = "$env:TEMP\sam18"
New-Item -ItemType Directory -Force $tmp | Out-Null
if (-not (Test-Path "$tmp\sam18.exe")) {
  Invoke-WebRequest 'https://github.com/samaidev/samoffice/releases/download/v0.7.18/SamOffice-desktop-windows-x64-0.7.18.zip' -OutFile "$tmp\sam18.zip" -UseBasicParsing
  Expand-Archive "$tmp\sam18.zip" -DestinationPath $tmp -Force
  Get-ChildItem $tmp -Recurse -Filter *.exe | Select-Object FullName, Length | Out-String
}
$exe18 = Get-ChildItem $tmp -Recurse -Filter samoffice.exe | Select-Object -First 1 -ExpandProperty FullName
"v0.7.18 exe: $exe18"
"--- boot.log before:"
Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 1
$p = Start-Process $exe18 -PassThru
"launched pid=$($p.Id), wait 35s"
Start-Sleep -Seconds 35
$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) {
  "V0.7.18 ALIVE — regression confirmed between 18→19"
  $alive | Select-Object Id, MainWindowHandle | Format-List | Out-String
  Stop-Process -Id $p.Id -Force
} else { "v0.7.18 also dies here" }
"--- boot.log after:"
Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 1
