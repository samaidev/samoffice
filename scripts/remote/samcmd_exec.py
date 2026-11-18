#!/usr/bin/env python3
"""samcmd 远程执行助手：读 ps1 脚本 → base64 → 发 /exec → 打印结果。
避免命令行里手抄 base64 造成截断。"""
import base64
import json
import sys
import urllib.request

T = "https://samcmd-shan-a030eeffd9.t.aitun.cc"
K = "b3f3358fb9f0962e057340aa7b5163b2"


def run_ps(ps_text: str, timeout: int = 90) -> str:
    b64 = base64.b64encode(ps_text.encode("utf-16le")).decode()
    cmd = f"powershell -NoProfile -EncodedCommand {b64}"
    body = json.dumps({"command": cmd, "timeout": timeout}).encode()
    req = urllib.request.Request(
        T + "/exec", data=body, method="POST",
        headers={"Authorization": "Bearer " + K, "Content-Type": "application/json"},
    )
    d = json.loads(urllib.request.urlopen(req, timeout=timeout + 30).read())
    out = (d.get("stdout") or "") + (("\n[stderr] " + d.get("stderr", "")) if d.get("stderr") else "")
    return f"exit={d.get('exit_code')} {d.get('duration_ms')}ms\n{out}"


if __name__ == "__main__":
    print(run_ps(open(sys.argv[1], encoding="utf-8").read(),
                 int(sys.argv[2]) if len(sys.argv) > 2 else 90))
