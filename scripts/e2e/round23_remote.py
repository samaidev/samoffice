"""round23 final: 远程 Windows SSH 控制（aitun ProxyCommand + paramiko 被动 banner）"""
import subprocess, socket, sys, time
import paramiko

USER, PASSWORD = "Administrator", "dongshan168"
AITUN = "/home/z/.venv/lib/python3.12/site-packages/aitun/bin/aitun-client-linux-amd64"

def open_channel():
    a, b = socket.socketpair()
    p = subprocess.Popen([AITUN, "ssh-proxy", "shan.aitun.cc", "22"],
                         stdin=a.fileno(), stdout=a.fileno(),
                         stderr=subprocess.DEVNULL, close_fds=True)
    a.close()
    b.settimeout(90)
    t = paramiko.Transport(b)
    t.banner_timeout = 90
    t.handshake_timeout = 90
    t.start_client(timeout=90)
    t.auth_password(USER, PASSWORD)
    if not t.is_authenticated():
        raise RuntimeError("auth failed")
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

def open_channel_retry(tries=4):
    last = None
    for i in range(tries):
        try:
            return open_channel()
        except Exception as e:
            last = e
            import time as _t
            _t.sleep(3)
    raise last

def remote(cmd, timeout=240):
    t, p = open_channel_retry()
    try:
        return run(t, cmd, timeout=timeout)
    finally:
        try: t.close()
        except Exception: pass
        p.kill()

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "whoami"
    to = int(sys.argv[2]) if len(sys.argv) > 2 else 240
    rc, out, err = remote(cmd, timeout=to)
    print(out)
    if err.strip(): print("[stderr]", err[:800], file=sys.stderr)
    print(f"[rc={rc}]", file=sys.stderr)
