"""round23 v3: aitun ssh-proxy 子进程(socketpair) + paramiko —— 标准桥接"""
import subprocess, socket, sys, time, threading
import paramiko

USER, PASSWORD = "Administrator", "dongshan168"
AITUN = "/home/z/.venv/lib/python3.12/site-packages/aitun/bin/aitun-client-linux-amd64"

def open_channel():
    """返回 paramiko Transport —— aitun 子进程作 ProxyCommand"""
    a, b = socket.socketpair()
    p = subprocess.Popen([AITUN, "ssh-proxy", "shan.aitun.cc", "22"],
                         stdin=a.fileno(), stdout=a.fileno(),
                         stderr=subprocess.DEVNULL, close_fds=True)
    a.close()  # 父进程持有 b；子进程持有 a 的副本
    b.settimeout(45)
    # aitun 桥要求客户端先发 banner（实测），paramiko 会先等服务端 ——
    # 用小线程预发：
    threading.Thread(target=lambda: (time.sleep(0.2), b.sendall(b"SSH-2.0-OpenSSH_9.6\r\n")), daemon=True).start()
    t = paramiko.Transport(b)
    t.banner_timeout = 45
    t.handshake_timeout = 45
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
    rc = c.recv_exit_status()
    return rc, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")

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
