[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== mutex held? ==="
$held = & handle.exe -a "SamOffice-SingleInstance" 2>$null
if (-not $held) {
  # 无 sysinternals：用 PowerShell 尝试 WaitHandle 方式探测 —— .NET 不能直接开全局互斥体检测，
  # 改用：创建同名 mutex 看是否 AlreadyExists
  $m = [System.Threading.Mutex]::new($false, 'Global\SamOffice-SingleInstance')
  try { $created = $false; $m.WaitOne(0) | Out-Null; $created = $true; "MUTEX NOT HELD (we acquired it - no instance running)" }
  catch [System.Threading.AbandonedMutexException] { "MUTEX abandoned" }
  catch { "MUTEX HELD by another process: $($_.Exception.GetType().Name)" }
  finally { if ($created) { $m.ReleaseMutex() }; $m.Dispose() }
}
"=== any samoffice.exe anywhere now ==="
Get-Process samoffice -ErrorAction SilentlyContinue | Select-Object Id, Path, StartTime | Format-List | Out-String
"=== last direct launch test with output capture ==="
$log = "$env:TEMP\sam_boot_test.log"
Remove-Item $log -ErrorAction SilentlyContinue
$p = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru -RedirectStandardError "$env:TEMP\sam_stderr.log"
"launched pid=$($p.Id), waiting 35s for watchdog window..."
Start-Sleep -Seconds 35
$alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
if ($alive) { "STILL ALIVE after 35s (watchdog passed? window up?)"; $alive | Select-Object Id, MainWindowTitle, MainWindowHandle | Format-List | Out-String }
else { "DIED within 35s (watchdog kill)" }
"=== boot.log tail ==="
Get-Content "$env:LOCALAPPDATA\SamOffice\boot.log" -Tail 4
"=== stderr capture ==="
Get-Content "$env:TEMP\sam_stderr.log" -ErrorAction SilentlyContinue | Select-Object -First 30
