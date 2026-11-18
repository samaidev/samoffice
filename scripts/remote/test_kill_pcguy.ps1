[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== kill PC Guy processes, then launch SamOffice ==="
Stop-Process -Name pcguy -Force -ErrorAction SilentlyContinue
Stop-Process -Name aitun-client -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
"remaining PC Guy procs: $((Get-Process | Where-Object { $_.Path -like '*PCGuy*' } | Measure-Object).Count)"
$p = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru
"launched pid=$($p.Id), wait 35s"
Start-Sleep -Seconds 35
$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) {
  $alive.Refresh()
  "ALIVE. MainWindowHandle = $($alive.MainWindowHandle)"
  if ($alive.MainWindowHandle -ne 0) { "*** WINDOW UP — PC GUY WAS THE CAUSE ***" }
  else { "alive but no window (still broken)" }
  Stop-Process -Id $p.Id -Force
} else { "died — PC Guy not the cause" }
Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 1
