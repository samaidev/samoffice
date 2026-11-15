#!/usr/bin/env python3
"""round24 部署：下载 v0.7.7 安装包到 shan，静默安装，启动验证。
用法: python3 scripts/e2e/round24_deploy.py
"""
import sys
sys.path.insert(0, 'scripts/e2e')
from round23_remote import remote  # noqa: E402  复用 SSH 通道执行器（返回 (rc, out, err)）

DOWNLOAD_PS = r"""
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dst = 'C:\Users\Administrator\Downloads\SamOffice-setup-0.7.7.exe'
$urls = @(
  'https://ghfast.top/https://github.com/samaidev/samoffice/releases/download/v0.7.7/SamOffice-setup-0.7.7.exe',
  'https://github.com/samaidev/samoffice/releases/download/v0.7.7/SamOffice-setup-0.7.7.exe'
)
foreach ($u in $urls) {
  try { Invoke-WebRequest -Uri $u -OutFile $dst -UseBasicParsing -TimeoutSec 240; break } catch { Write-Output ("retry: " + $u) }
}
Write-Output ("size=" + (Get-Item $dst).Length)
"""

INSTALL_PS = r"""
$ErrorActionPreference = 'Continue'
Stop-Process -Name samoffice -Force -ErrorAction SilentlyContinue
Start-Sleep 2
$p = Start-Process 'C:\Users\Administrator\Downloads\SamOffice-setup-0.7.7.exe' -ArgumentList '/VERYSILENT','/NORESTART' -PassThru -Wait
Write-Output ("install-rc=" + $p.ExitCode)
$exe = Get-Item 'C:\Program Files\SamOffice\samoffice.exe' -ErrorAction SilentlyContinue
Write-Output ("exe=" + $exe.Length + " mtime=" + $exe.LastWriteTime.ToString('MM-dd HH:mm'))
Start-Process 'C:\Program Files\SamOffice\samoffice.exe'
Start-Sleep 15
$proc = Get-Process samoffice -ErrorAction SilentlyContinue
if ($proc) { Write-Output ("proc=" + $proc.Id + " mem=" + [math]::Round($proc.WorkingSet64/1MB) + "MB") } else { Write-Output "proc=NONE" }
$wv = (Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -match 'samoffice' }).Count
Write-Output ("webview2=" + $wv)
Remove-Item 'C:\Users\Administrator\Downloads\SamOffice-setup-0.7.7.exe' -Force -ErrorAction SilentlyContinue
"""

if __name__ == '__main__':
    print('== download ==')
    rc, out, err = remote(DOWNLOAD_PS, 320)
    txt = out + err
    print(txt[-400:])
    if 'size=' not in txt:
        print('DOWNLOAD FAILED'); sys.exit(1)
    print('== install + launch ==')
    rc, out, err = remote(INSTALL_PS, 320)
    txt = out + err
    print(txt[-600:])
    seg = txt.split('proc=')[1][:20] if 'proc=' in txt else 'NONE'
    ok = ('install-rc=0' in txt and 'proc=' in txt and 'NONE' not in seg and 'webview2=' in txt and not txt.split('webview2=')[1].startswith('0'))
    print('DEPLOY-' + ('OK' if ok else 'CHECK-OUTPUT'))
