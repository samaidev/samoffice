"""验证打开 .md 文件时加载的是文件真实内容（而非模板）。

修复点：OpenFile/HTTP /api/doc/local 现在对 md/html 一并返回 rawContent(base64)，
前端 openResult 优先用 rawContent 加载原文，远程(网页)模式下不再因 readFile 不可用而回退到模板。

本测试：启动本地服务器(远程模式，readFile 不可用)，打开真实 md 文件，
断言 API 返回 rawContent 且解码后等于文件原文（这正是前端 MD 编辑器将展示的内容）。
"""
import json, os, sys, subprocess, time, urllib.request, urllib.parse, base64

ROOT = r"c:\Users\Administrator\samoffice-1"
PORT = 8080

MD_CONTENT = "# 真实标题\n\n这是 SamOffice 打开 md 的真实内容，特征串：SAMOFFICE_REAL_MD_42。\n\n- 列表项一\n- 列表项二\n"
MD_PATH = os.path.join(ROOT, "scripts", "e2e", "sample_real.md")
with open(MD_PATH, "w", encoding="utf-8") as f:
    f.write(MD_CONTENT)

def find_server_exe():
    for p in [os.path.join(ROOT, "bin", "samoffice-server.exe"),
              os.path.join(ROOT, "build", "bin", "samoffice-server.exe"),
              os.path.join(ROOT, "samoffice-server.exe")]:
        if os.path.exists(p):
            return p
    return None

def start_server():
    # 若已有服务器在运行则直接复用
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=1)
        return None
    except Exception:
        pass
    exe = find_server_exe()
    if not exe:
        raise SystemExit("未找到 samoffice-server.exe")
    proc = subprocess.Popen([exe, "--addr", f"127.0.0.1:{PORT}"],
                            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=1)
            return proc
        except Exception:
            time.sleep(0.5)
    raise SystemExit("服务器启动超时")

def main():
    proc = start_server()
    try:
        url = f"http://127.0.0.1:{PORT}/api/doc/local?path=" + urllib.parse.quote(MD_PATH)
        with urllib.request.urlopen(url, timeout=10) as r:
            body = json.loads(r.read().decode("utf-8"))
        has_raw = bool(body.get("rawContent"))
        decoded = base64.b64decode(body["rawContent"]).decode("utf-8") if has_raw else ""
        print("has rawContent:", has_raw)
        print("decoded head:", decoded[:60].replace("\n", "\\n"))
        passed = has_raw and ("SAMOFFICE_REAL_MD_42" in decoded) and ("真实标题" in decoded)
        print("PASSED" if passed else "FAILED")
        return passed
    finally:
        if proc is not None:
            proc.terminate()

if __name__ == "__main__":
    passed = main()
    out = os.path.join(ROOT, "scripts", "e2e", "test_open_md_result.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"openMdContent": passed}, f, ensure_ascii=False, indent=2)
    sys.exit(0 if passed else 1)
