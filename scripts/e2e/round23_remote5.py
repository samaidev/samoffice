"""round23 v5: 猴补 paramiko _check_banner（先发客户端 banner 打破 aitun 桥死锁）"""
import subprocess, socket, sys, time
import paramiko
import paramiko.transport as pt

USER, PASSWORD = "Administrator", "dongshan168"
AITUN = "/home/z/.venv/lib/python3.12/site-packages/aitun/bin/aitun-client-linux-amd64"

_orig_check = pt.Transport._check_banner
def _check_banner_first(self):
    # aitun 桥的 OpenSSH 等客户端先发 banner（实测），paramiko 默认只等服务端 → 死锁。
    # 在读之前先发我们的客户端 banner（幂等：只有 socket 尚未写过才发）。
    try:
        self.sock.sendall(b"SSH-2.0-OpenSSH_9.6_paramiko\r\n")
    except Exception:
        pass
    return _orig_check(self)
pt.Transport._check_banner = _check_banner_first

def open_channel():
    a, b = socket.socketpair()
    p = subprocess.Popen([AITUN, "ssh-proxy", "shan.aitun.cc", "22"],
                         stdin=a.fileno(), stdout=a.fileno(),
                         stderr=subprocess.DEVNULL, close_fds=True)
    a.close()
    b.settimeout(60)
    t = paramiko.Transport(b)
    t.banner_timeout = 60
    t.handshake_timeout = 60
    t.connect(username=USER, password=PASSWORD)
    return t, p

def run(t, cmd, timeout=120):
    c = t.open_session(timeout=timeout)
    c.settimeout(timeout)
    c.exec_command(cmd)
    out, err = b"", b""
    while True:
        if c.recv_ready(): out += c.recv(65536)
        if c.recv_stderr_ready(): err += c.recv_stderr(65536)
        if c.exit_status_ready() and not c.recv_ready() and not c.recv_stderr_ready():
            break
        time.sleep(0.1)
    while c.recv_ready(): out += c.recv(65536)
    while c.recv_stderr_ready(): err += c.recv_stderr(65536)
    return c.recv_exit_status(), out.decode("utf-8", "replace"), err.decode("utf-8", "replace")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "whoami"
    to = int(sys.argv[2]) if len(sys.argv) > 2 else 240
    t, p = open_channel()
    rc, out, err = run(t, cmd, timeout=to)
    print(out)
    if err.strip(): print("[stderr]", err[:800], file=sys.stderr)
    print(f"[rc={rc}]", file=sys.stderr)
    try: t.close()
    except Exception: pass
    p.kill()
