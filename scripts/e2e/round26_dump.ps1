$ErrorActionPreference = 'Continue'
# 1. 开启 WER 本地转储（Full dump）
New-Item -Path 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\samoffice.exe' -Force | Out-Null
Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\samoffice.exe' -Name DumpFolder -Value 'C:\samdumps' -Type ExpandString
Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\samoffice.exe' -Name DumpType -Value 2 -Type DWord
Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\samoffice.exe' -Name DumpCount -Value 3 -Type DWord
New-Item -Path 'C:\samdumps' -ItemType Directory -Force | Out-Null
Write-Output 'wer-localdump-enabled'

# 2. 卡死不是崩溃，WER 不会自动触发 —— 用 rundll32 comsvcs MiniDump 主动抓 hung 进程
Stop-Process -Name samoffice -Force -ErrorAction SilentlyContinue
Start-Sleep 2
$run = Start-Process 'C:\Program Files\SamOffice\samoffice.exe' -PassThru
Start-Sleep 16
$p = Get-Process -Id $run.Id -ErrorAction SilentlyContinue
if ($p -and $p.MainWindowHandle -eq 0) {
  Write-Output ("stuck confirmed pid=" + $p.Id + " - capturing minidump")
  $dump = "C:\samdumps\sam_hung.dmp"
  # comsvcs.dll MiniDump 需要在目标进程会话外调用；用 rundll32
  $r = rundll32.exe comsvcs.dll,MiniDump ($p.Id) $dump full
  Start-Sleep 8
  if (Test-Path $dump) { Write-Output ("dump-size=" + [math]::Round((Get-Item $dump).Length/1MB,1) + "MB") } else { Write-Output 'dump-failed-trying-taskkill-wer' ; Stop-Process -Id $p.Id -Force }
} elseif ($p) {
  Write-Output ("window appeared! hwnd=" + $p.MainWindowHandle)
  Stop-Process -Name samoffice -Force -ErrorAction SilentlyContinue
} else { Write-Output 'exited' }

# 3. 列出 samdumps
Get-ChildItem C:\samdumps -ErrorAction SilentlyContinue | ForEach-Object { Write-Output ($_.Name + " " + [math]::Round($_.Length/1MB,1) + "MB " + $_.LastWriteTime.ToString('HH:mm:ss')) }
