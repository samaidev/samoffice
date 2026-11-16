$ErrorActionPreference = 'Continue'
# 计划任务里嵌套引号太麻烦：把启动器写成 bat，任务只跑 bat
$bat = 'C:\samdumps\launch_sam.bat'
Set-Content -Path $bat -Value '@echo off
start "" "C:\Program Files\SamOffice\samoffice.exe"
' -Encoding ASCII
Write-Output "bat written"
schtasks /Delete /TN SamBat /F 2>$null | Out-Null
schtasks /Create /TN SamBat /TR "C:\samdumps\launch_sam.bat" /SC ONCE /ST 23:59 /RU administrator /IT /F | Out-Null
$r = schtasks /Run /TN SamBat 2>&1 | Out-String
Write-Output ("run: " + $r.Trim())
Start-Sleep 16
$p = Get-Process samoffice -ErrorAction SilentlyContinue
if ($p) {
  $p | ForEach-Object {
    Write-Output ("pid=" + $_.Id + " session=" + $_.SessionId + " hwnd=" + $_.MainWindowHandle + " title=[" + $_.MainWindowTitle + "] responding=" + $_.Responding)
  }
} else {
  Write-Output 'NONE'
  $q = schtasks /Query /TN SamBat /V /FO LIST | Out-String
  Write-Output $q.Substring(0, [Math]::Min(700, $q.Length))
}
