$ErrorActionPreference = 'Continue'
Write-Output '--- kill stuck instance ---'
Stop-Process -Name samoffice -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Write-Output '--- fresh launch with file arg (user path reproduction) ---'
$doc = (Get-ChildItem "$env:USERPROFILE\Desktop" -Filter '*.docx' | Select-Object -First 1).FullName
Write-Output ("doc=" + $doc)
$run = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -ArgumentList @($doc) -PassThru
Start-Sleep 18
$alive = Get-Process -Id $run.Id -ErrorAction SilentlyContinue
Write-Output ("alive=" + [bool]$alive + " cpu=" + [math]::Round($run.CPU,1) + "s")
Write-Output ("hwnd=" + $alive.MainWindowHandle + " title=[" + $alive.MainWindowTitle + "] threads=" + $alive.Threads.Count)
Write-Output '--- second check after 20s more ---'
Start-Sleep 20
$alive2 = Get-Process -Id $run.Id -ErrorAction SilentlyContinue
if ($alive2) { Write-Output ("hwnd2=" + $alive2.MainWindowHandle + " title2=[" + $alive2.MainWindowTitle + "] cpu2=" + [math]::Round($alive2.CPU,1) + "s") } else { Write-Output "process-exited" }
Write-Output '--- event log fresh crash ---'
Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddMinutes(-3)} -ErrorAction SilentlyContinue | Where-Object { $_.Message -match 'samoffice' } | Select-Object -First 2 | ForEach-Object { Write-Output ("evt " + $_.TimeCreated.ToString('HH:mm:ss') + " " + $_.ProviderName + " id=" + $_.Id) }
Write-Output '--- stderr redirect attempt ---'
Stop-Process -Name samoffice -Force -ErrorAction SilentlyContinue
Start-Sleep 2
$errf = "$env:TEMP\sam_err.txt"
$run2 = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -ArgumentList @($doc) -PassThru -RedirectStandardError $errf
Start-Sleep 15
$alive3 = Get-Process -Id $run2.Id -ErrorAction SilentlyContinue
Write-Output ("alive3=" + [bool]$alive3 + " hwnd3=" + $alive3.MainWindowHandle)
if (Test-Path $errf) { Write-Output '--- stderr content ---'; Get-Content $errf | Select-Object -First 20 }
Stop-Process -Name samoffice -Force -ErrorAction SilentlyContinue
