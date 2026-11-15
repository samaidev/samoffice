"""round23: 远程 Windows 机 SSH 控制 v2
aitun ssh-proxy 是 ProxyCommand（stdin/stdout 管道）。
paramiko 支持 sock= 传入已连接的 socket —— 我们模拟 ProxyCommand 行为：
1. TLS 连 shan.aitun.cc:22
2. 双方 banner 交换（桥接要求客户端先发）
3. 交给 paramiko Transport
"""
import ssl, socket, sys, time
import paramiko

HOST, PORT = "shan.aitun.cc", 22
USER, PASSWORD = "Administrator", "dongshan168"

class TLSAdapter:
    """SSLObject/SSLSocket → paramiko 需要的 socket 接口（banner 双向已处理）"""
    def __init__(self, tls, server_banner):
        self.tls = tls
        self.server_banner = server_banner
        self._pending = server_banner.encode() + b"\r\n"
    def send(self, b): return self.tls.write(b)
    def sendall(self, b): self.tls.sendall(b)
    def recv(self, n):
        if self._pending:
            out, self._pending = self._pending[:n], self._pending[n:]
            return out
        return self.tls.recv(n)
    def settimeout(self, t):
        try: self.tls.settimeout(t)
        except Exception: pass
    def setblocking(self, b):
        try: self.tls.setblocking(b)
        except Exception: pass
    def gettimeout(self): return self.tls.gettimeout()
    def fileno(self):
        try: return self.tls.fileno()
        except Exception: return -1
    def close(self):
        try: self.tls.close()
        except Exception: pass
    def makefile(self, *a, **k):
        class _F:
            def __init__(s2, sock): s2.sock = sock
            def read(s2, n=-1): return s2.sock.recv(n if n > 0 else 65536)
            def readline(s2):
                buf = b""
                while not buf.endswith(b"\n"):
                    d = s2.sock.recv(1)
                    if not d: break
                    buf += d
                return buf
            def write(s2, b): return s2.sock.send(b)
            def flush(s2): pass
            def close(s2): pass
        return _F(self)

def connect():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    raw = socket.create_connection((HOST, PORT), timeout=20)
    tls = ctx.wrap_socket(raw, server_hostname=HOST)
    tls.settimeout(30)
    # 客户端先发 banner（桥接要求）
    tls.sendall(b"SSH-2.0-OpenSSH_9.6\r\n")
    # 读服务端 banner（缓存起来供 paramiko 首次 recv 用）
    banner = b""
    while not banner.endswith(b"\r\n"):
        chunk = tls.recv(64)
        if not chunk: raise RuntimeError("no server banner")
        banner += chunk
    server_banner = banner.decode(errors="replace").strip()
    print(f"[ssh] server: {server_banner}", file=sys.stderr)
    t = paramiko.Transport(TLSAdapter(tls, server_banner))
    t.banner_timeout = 30
    t.handshake_timeout = 30
    t.connect(username=USER, password=PASSWORD)
    return t

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
    t = connect()
    rc, out, err = run(t, cmd, timeout=240)
    print(out)
    if err.strip(): print("[stderr]", err[:800], file=sys.stderr)
    print(f"[rc={rc}]", file=sys.stderr)
    try: t.close()
    except Exception: pass
