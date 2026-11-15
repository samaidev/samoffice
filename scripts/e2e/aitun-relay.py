#!/usr/bin/env python3
# aitun-relay: 先发客户端 SSH banner，之后 stdin/stdout 双向透传到 aitun ssh-proxy
import subprocess, sys, threading, os
AITUN = "/home/z/.venv/lib/python3.12/site-packages/aitun/bin/aitun-client-linux-amd64"
p = subprocess.Popen([AITUN, "ssh-proxy", "shan.aitun.cc", "22"],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL, bufsize=0)
# 先发 banner 打破服务端等待
p.stdin.write(b"SSH-2.0-OpenSSH_9.6\r\n")
p.stdin.flush()
def pump_out():
    while True:
        d = p.stdout.read1(65536)
        if not d: break
        os.write(1, d)
threading.Thread(target=pump_out, daemon=True).start()
while True:
    d = os.read(0, 65536)
    if not d: break
    p.stdin.write(d)
    p.stdin.flush()
