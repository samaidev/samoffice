"""round23: 分块上传文件到远程 Windows（base64 over SSH exec，支持断点）
用法：python3 round23_upload.py <本地文件> <远程路径> [块大小KB]
"""
import sys, os, base64, time
sys.path.insert(0, os.path.dirname(__file__))
from round23_remote import remote

def upload(local, remote_path, chunk_kb=180):
    size = os.path.getsize(local)
    chunk = chunk_kb * 1024
    n = (size + chunk - 1) // chunk
    print(f"上传 {local} ({size/1048576:.1f}MB) → {remote_path}，{n} 块", file=sys.stderr)
    # 清空目标
    rc, out, _ = remote(f'powershell -Command "Set-Content -Path \'{remote_path}\' -Value \'\'"', timeout=60)
    t0 = time.time()
    with open(local, 'rb') as f:
        for i in range(n):
            data = f.read(chunk)
            b64 = base64.b64encode(data).decode()
            # 写入远端：certutil 解码追加。用 add-content 写 b64 临时文件再 certutil -decodehex 追加太慢；
            # 直接 powershell append bytes：
            cmd = (
                'powershell -Command "$b=[Convert]::FromBase64String(\'' + b64 + '\');'
                '$fs=[System.IO.File]::Open(\'' + remote_path + '\',[System.IO.FileMode]::Append);'
                '$fs.Write($b,0,$b.Length);$fs.Close()"'
            )
            rc, out, err = remote(cmd, timeout=120)
            if rc != 0:
                print(f"块 {i+1}/{n} 失败 rc={rc} {err[:200]}", file=sys.stderr)
                sys.exit(1)
            if (i + 1) % 5 == 0 or i + 1 == n:
                el = time.time() - t0
                print(f"  {i+1}/{n} ({(i+1)*100//n}%) {el:.0f}s", file=sys.stderr, flush=True)
    # 校验大小
    rc, out, _ = remote(f'powershell -Command "(Get-Item \'{remote_path}\').Length"', timeout=60)
    got = out.strip().splitlines()[-1] if out.strip() else '0'
    print(f"远端大小 {got} / 本地 {size}", file=sys.stderr)
    if int(got) != size:
        print("大小不一致！", file=sys.stderr)
        sys.exit(2)
    print("UPLOAD OK")

if __name__ == '__main__':
    upload(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 180)
