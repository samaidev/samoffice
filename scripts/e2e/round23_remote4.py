"""round23 v4: aitun-relay(先发banner) 中继 + paramiko socketpair"""
import subprocess, socket, sys, time, threading
import paramiko

USER, PASSWORD = "Administrator", "dongshan168"
RELAY = "python3 /home/z/my-project/samoffice/scripts/e2e/aitun-relay.py"

def open_channel():
    a, b = socket.socketpair()
    p = subprocess.Popen(["bash", "-c", RELAY],
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
