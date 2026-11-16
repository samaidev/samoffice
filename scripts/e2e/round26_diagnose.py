#!/usr/bin/env python3
"""round26 诊断：shan 双击打不开 samoffice。
拉取：进程/互斥体、Application 崩溃事件、boot.log、pending_open.txt、快捷方式目标、直接启动实测。
用法: python3 scripts/e2e/round26_diagnose.py
"""
import sys
sys.path.insert(0, 'scripts/e2e')
from round23_remote import remote

DIAG_PS = r'''
$ErrorActionPreference = 'Continue'
Write-Output '=== 1. process/mutex ==='
$proc = Get-Process samoffice -ErrorAction SilentlyContinue
if ($proc) { $proc | ForEach-Object { Write-Output ("pid=" + $_.Id + " start=" + $_.StartTime.ToString('MM-dd HH:mm:ss') + " mem=" + [math]::Round($_.WorkingSet64/1MB) + "MB title=[" + $_.MainWindowTitle + "]") } } else { Write-Output 'proc=NONE' }
$mx = & tasklist /M 2>$null | Select-String -Pattern 'SamOffice' | Select-Object -First 2
Write-Output ("mutex-hint: " + (($mx | ForEach-Object { $_.Line }) -join ' | '))
Write-Output '=== 2. crash events (48h) ==='
Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=(Get-Date).AddHours(-48)} -ErrorAction SilentlyContinue |
  Where-Object { $_.ProviderName -in @('Application Error','Windows Error Reporting','.NET Runtime') -and $_.Message -match 'samoffice' } |
  Select-Object -First 4 | ForEach-Object {
    Write-Output ("--- " + $_.TimeCreated.ToString('MM-dd HH:mm') + " " + $_.ProviderName + " id=" + $_.Id)
    Write-Output ($_.Message.Substring(0, [Math]::Min(500, $_.Message.Length)))
  }
Write-Output '=== 3. wER report archive ==='
Get-ChildItem "$env:ProgramData\Microsoft\Windows\WER\ReportArchive","$env:ProgramData\Microsoft\Windows\WER\ReportQueue" -Filter '*samoffice*' -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 2 | ForEach-Object { Write-Output ($_.FullName + " " + $_.LastWriteTime.ToString('MM-dd HH:mm')) }
Write-Output '=== 4. boot.log tail ==='
if (Test-Path "$env:USERPROFILE\.samoffice\boot.log") { Get-Content "$env:USERPROFILE\.samoffice\boot.log" -Tail 12 } else { Write-Output 'no boot.log' }
Write-Output '=== 5. pending_open.txt ==='
$po = Join-Path $env:LOCALAPPDATA 'samoffice\pending_open.txt'
if (Test-Path $po) { Write-Output ("size=" + (Get-Item $po).Length + " content=[" + (Get-Content $po -Raw) + "]") } else { Write-Output 'no pending file' }
Write-Output '=== 6. shortcut target ==='
$lnk = Get-ChildItem "$env:USERPROFILE\Desktop","C:\Users\Public\Desktop" -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'SamOffice' }
foreach ($l in $lnk) { $s = (New-Object -ComObject WScript.Shell).CreateShortcut($l.FullName); Write-Output ($l.FullName + " -> " + $s.TargetPath + " args=" + $s.Arguments) }
Write-Output '=== 7. run key / startup ==='
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue | ForEach-Object { if ($_.'SamOffice') { Write-Output ("run: " + $_.'SamOffice') } }
Write-Output '=== 8. direct launch probe ==='
$run = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru
Start-Sleep 14
$alive = Get-Process -Id $run.Id -ErrorAction SilentlyContinue
Write-Output ("boot-alive=" + [bool]$alive + " exit=" + $run.ExitCode)
$all = Get-Process samoffice -ErrorAction SilentlyContinue
$all | ForEach-Object { Write-Output ("now pid=" + $_.Id + " mem=" + [math]::Round($_.WorkingSet64/1MB) + "MB title=[" + $_.MainWindowTitle + "]") }
Write-Output '=== 9. http port check ==='
$hp = Get-Content "$env:USERPROFILE\.samoffice\http_port" -ErrorAction SilentlyContinue
Write-Output ("port-file=" + $hp)
'''

if __name__ == '__main__':
    rc, out, err = remote(DIAG_PS, 200)
    print(out)
    print('STDERR:', err[-300:] if err else '(empty)')
