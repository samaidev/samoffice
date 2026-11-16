#!/usr/bin/env python3
"""round26：通过 SSH 通道把 shan 上的文件拉回本地。
用法: python3 round26_fetch.py <远程路径> <本地路径>
"""
import sys
sys.path.insert(0, '.')
from round23_remote import open_channel_retry, run

if __name__ == '__main__':
    remote_path, local_path = sys.argv[1], sys.argv[2]
    t, p = open_channel_retry()
    try:
        # 用 PowerShell 读 base64 分块传输（无 sftp 依赖）
        rc, out, err = run(t, f'powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes(\'{remote_path}\')).Length"', 120)
        total = int(out.strip())
        print(f'b64len={total}')
        chunk = 3_000_000  # ~2.2MB binary per chunk
        with open(local_path, 'wb') as f:
            pos = 0
            i = 0
            while pos < total:
                rc, out, err = run(t, f'powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes(\'{remote_path}\'))[{pos}..{min(pos+chunk-1, total-1)}] -join \'\'"', 180)
                data = out.strip()
                if not data:
                    print(f'chunk {i} empty! err={err[:200]}'); sys.exit(1)
                import base64
                f.write(base64.b64decode(data))
                pos += chunk
                i += 1
                if i % 5 == 0: print(f'  {pos}/{total} b64 ({pos*100//total}%)')
        print('done', local_path)
    finally:
        try: t.close()
        except Exception: pass
        p.kill()
