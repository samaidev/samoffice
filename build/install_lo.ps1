# 在 PowerShell 后台 Job 内运行 winget 安装，主进程持续心跳输出，
# 避免被 IDE 的空闲超时中断；安装完成（或超时）后校验 soffice.exe。
$job = Start-Job {
    winget install --id TheDocumentFoundation.LibreOffice --silent --accept-package-agreements --accept-source-agreements --disable-interactivity *>$null
}
$t = 0
while ($job.State -eq 'Running' -and $t -lt 1200) {
    Start-Sleep -Seconds 5
    $t += 5
    Write-Host "WAITING $t"
}
Write-Host ("STATE " + $job.State)
if ($job.State -ne 'Running') {
    Receive-Job $job 2>$null
}
if (Test-Path "C:\Program Files\LibreOffice\program\soffice.exe") {
    Write-Host "SOFFICE_READY"
} else {
    Write-Host "SOFFICE_MISSING"
}
