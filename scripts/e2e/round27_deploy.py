"""round27: 部署 v0.7.10 到 shan + 远程验证四项修复 + 看门狗"""
import sys, time, subprocess, socket
sys.path.insert(0, 'scripts/e2e')
from round23_remote import open_channel_retry, run

def download_artifact_and_deploy():
    # 1) 从 GitHub Release 下载（shan 直接下）
    t, p = open_channel_retry()
    try:
        rc, out, err = run(t, r'powershell -Command "Get-Process samoffice -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 1; echo killed"', 60)
        print('stop old:', out.strip())
        rc, out, err = run(t, r'powershell -Command "Invoke-WebRequest -Uri \'https://github.com/samaidev/samoffice/releases/download/v0.7.10/SamOffice-setup-0.7.9.exe\' -OutFile C:\samsetup710.exe -UseBasicParsing"', 300)
        print('download:', rc, (out + err).strip()[:150])
        rc, out, err = run(t, r'C:\samsetup710.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART', 300)
        print('install:', rc, out.strip()[:100])
        time.sleep(3)
        # 2) 启动 + 看门狗验证（boot.log）
        rc, out, err = run(t, r'powershell -Command "Start-Process \'C:\Program Files\SamOffice\samoffice.exe\' -PassThru | Select-Object Id"', 60)
        print('start:', out.strip()[:80])
        print('等待窗口 + boot.log...')
        time.sleep(35)
        rc, out, err = run(t, r'powershell -Command "Get-Content $env:LOCALAPPDATA\samoffice\boot.log -ErrorAction SilentlyContinue; Test-Path $env:LOCALAPPDATA\samoffice\boot_ok.txt"', 60)
        print('boot 状态:', out.strip()[:200])
        # 3) 进程与窗口
        rc, out, err = run(t, r'powershell -Command "Get-Process samoffice -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-List"', 60)
        print('进程:', out.strip()[:200])
        return out
    finally:
        try: t.close()
        except: pass
        try: p.terminate()
        except: pass

if __name__ == '__main__':
    download_artifact_and_deploy()
