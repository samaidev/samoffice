"""验证 ribbon 字间距（charSpacing）支持输入数字并作用于选区（与字号一致）。"""
import json, os, sys, base64, time, threading, http.server, socketserver

ROOT = r"c:\Users\Administrator\samoffice-1"
DIST = os.path.join(ROOT, "frontend", "dist")
PORT = 8139

def start_http():
    os.chdir(DIST)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def main():
    from playwright.sync_api import sync_playwright
    httpd = start_http()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.add_init_script("""
          window.go = { main: { App: {
            GetStartupArgs: async () => ['C:/test/sample.docx'],
            OpenFile: async (path) => ({ document: { meta:{}, blocks:[{ inline:[{content:'Hello SamOffice spacing test'}] }] }, warnings: [], path: path, rawContent: '' }),
            ReadFile: async (path) => '',
            LogError: async () => {}, Log: async () => {},
          }}};
          window.runtime = { Events: { Emit: ()=>{}, On: ()=>{} }, Log: ()=>{} };
        """)
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("CONSOLE:" + m.text) if m.type == "error" else None)
        # 等待文档编辑器渲染
        page.wait_for_selector(".ProseMirror", timeout=8000)
        time.sleep(0.5)
        # 聚焦编辑器并用 Ctrl+A 全选（真实 ProseMirror 选区）
        page.click(".ProseMirror")
        page.keyboard.press("Control+a")
        time.sleep(0.3)
        # 通过输入数字路径设置字间距（用户真实操作）：聚焦输入框并键入 "2"
        wrap = page.query_selector('div[data-testid="charSpacing"]')
        ok = {"found": bool(wrap)}
        if wrap:
            inp = wrap.query_selector("input")
            inp.click()
            page.keyboard.press("Control+a")
            page.keyboard.type("2")
            page.keyboard.press("Enter")  # 触发 blur（Dropdown 在 Enter 时 blur）
            time.sleep(0.3)
        time.sleep(0.5)
        # 断言：选区文本外层应有 letter-spacing 的 span
        spaced = page.evaluate("""() => {
          const ps = Array.from(document.querySelectorAll('.ProseMirror p, .ProseMirror'));
          for (const p of ps) {
            const spans = Array.from(p.querySelectorAll('span'));
            for (const s of spans) {
              const ls = s.style.letterSpacing;
              if (ls && (ls.includes('2px') || ls.includes('px'))) return ls;
            }
          }
          return 'NONE';
        }""")
        print("input found:", ok.get("found"), "val:", ok.get("val"))
        print("letter-spacing applied:", spaced)
        # 调试：选区是否为空、是否存在任何 letter-spacing
        dbg = page.evaluate("""() => {
          const ed = document.querySelector('.ProseMirror');
          const selInfo = window.getSelection ? window.getSelection().toString().length : -1;
          let anyLS = 'NONE';
          document.querySelectorAll('.ProseMirror span').forEach(s => { if (s.style.letterSpacing) anyLS = s.style.letterSpacing; });
          return { selLen: selInfo, anyLS };
        }""")
        print("dbg:", dbg)
        print("ERRORS:", errs[:5])
        passed = bool(ok.get("found")) and spaced not in ('NONE', None) and '2px' in spaced
        print("PASSED" if passed else "FAILED")
        browser.close()
        with open(os.path.join(ROOT, "scripts", "e2e", "test_char_spacing_result.json"), "w", encoding="utf-8") as f:
            json.dump({"charSpacing": passed, "found": ok.get("found"), "val": ok.get("val"), "applied": spaced, "dbg": dbg, "errors": errs[:5]}, f, ensure_ascii=False, indent=2)
        return passed

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
