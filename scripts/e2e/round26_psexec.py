#!/usr/bin/env python3
"""round26：远程执行复杂 PowerShell（base64 编码传输，避免多层引号转义）。
用法: python3 round26_psexec.py <脚本文件.ps1>
"""
import sys, base64
sys.path.insert(0, '.')
from round23_remote import remote

if __name__ == '__main__':
    with open(sys.argv[1], encoding='utf-8-sig') as f:
        script = f.read()
    b64 = base64.b64encode(script.encode('utf-16-le')).decode()
    # powershell -EncodedCommand 接收 UTF-16LE base64
    rc, out, err = remote(f'powershell -NoProfile -EncodedCommand {b64}', 240)
    print(out)
    if err.strip():
        print('STDERR:', err[-500:])
