[Console]::OutputEncoding = [Text.Encoding]::UTF8
"=== old exe version ==="
$old = "$env:LOCALAPPDATA\Programs\SamOffice\samoffice.exe"
# Wails embeds frontend; version from Go binary: search for version string
$content = [IO.File]::ReadAllText($old, [Text.Encoding]::ASCII)
$m = [regex]::Matches($content, 'v0\.7\.\d+')
$m | Select-Object -First 5 | ForEach-Object { "version string: $($_.Value)" }
"=== old build still running? kill leftovers ==="
Get-Process samoffice -ErrorAction SilentlyContinue | Select-Object Id, Path | Format-List | Out-String
Get-Process samoffice -ErrorAction SilentlyContinue | Stop-Process -Force
"=== new build: capture stderr fully with a longer wait + fixed port? stderr said 62392, but port is random each run. Use netstat while running ==="
$p = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru -RedirectStandardError "$env:TEMP\sam_err2.log"
Start-Sleep -Seconds 8
"listening ports for pid $($p.Id):"
netstat -ano | Select-String "$($p.Id)" | Select-Object -First 8 | Out-String
$err = Get-Content "$env:TEMP\sam_err2.log" -ErrorAction SilentlyContinue
"stderr:"; $err | Select-Object -First 15
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
