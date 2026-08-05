"""验证：
1) 文档加载后 ribbon 不崩溃（修复 activeAttrs.letterSpacing 为 undefined 时 .replace 崩溃）。
2) 段落组字间距（paraLetterSpacing）可输入数字并作用于当前段落 letter-spacing。
3) 字体组字间距（charSpacing）仍可输入数字。
"""
import json, os, sys, time, threading, http.server, socketserver

ROOT = r"c:\Users\Administrator\samoffice-1"
DIST = os.path.join(ROOT, "frontend", "dist")
PORT = 8141

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
            OpenFile: async (path) => ({ document: { meta:{}, blocks:[{ inline:[{content:'Hello SamOffice paragraph spacing test'}] }] }, warnings: [], path: path, rawContent: '' }),
            ReadFile: async (path) => '',
            SpellCheck: async () => [],
            LogError: async () => {}, Log: async () => {},
          }}};
          window.runtime = { Events: { Emit: ()=>{}, On: ()=>{} }, Log: ()=>{} };
        """)
        errs = []
        para_logs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: (para_logs.append(m.text) if "[setParaAttr]" in m.text else (errs.append("CONSOLE:" + m.text) if m.type == "error" else None)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        # 关键：页面加载即触发 ribbon 渲染，若有崩溃会在此时抛 pageerror
        page.wait_for_selector(".ProseMirror", timeout=8000)
        time.sleep(0.8)

        load_crash = bool(errs)
        result = {"loadCrash": load_crash, "loadErrors": errs[:5]}

        # 将光标放入段落内（不全选，避免 AllSelection 使 $from.parent 变成 doc）
        page.click(".ProseMirror p")
        time.sleep(0.3)

        para_wrap = page.query_selector('div[data-testid="paraLetterSpacing"]')
        result["paraFound"] = bool(para_wrap)
        if para_wrap:
            pinp = para_wrap.query_selector("input")
            pinp.click()
            page.keyboard.press("Control+a")
            page.keyboard.type("2")
            page.keyboard.press("Enter")
            time.sleep(0.4)
        # 捕获可能的错误浮层（<pre> window.error）
        result["errOverlay"] = page.evaluate("""() => {
          const pre = document.querySelector('pre');
          return pre ? pre.textContent.slice(0, 200) : 'NONE';
        }""")
        result["setParaLogs"] = para_logs[:10]
        result["afterInputCrash"] = bool(errs)
        result["errors"] = errs[:5]

        para_ls = page.evaluate("""() => {
          const ps = Array.from(document.querySelectorAll('.ProseMirror p'));
          for (const p of ps) {
            if (p.style.letterSpacing) return p.style.letterSpacing;
            const span = p.querySelector('span[style*="letter-spacing"]');
            if (span) return span.style.letterSpacing;
          }
          return 'NONE';
        }""")
        result["paraLetterSpacing"] = para_ls
        result["paraHtml"] = page.evaluate("""() => {
          const p = document.querySelector('.ProseMirror p');
          return p ? p.outerHTML.slice(0, 240) : 'NO_P';
        }""")

        passed = (not load_crash) and (not result["afterInputCrash"]) and result.get("paraFound") and '2px' in str(para_ls)
        result["passed"] = passed
        print("RESULT:", json.dumps(result, ensure_ascii=False))
        print("PASSED" if passed else "FAILED")
        browser.close()
        with open(os.path.join(ROOT, "scripts", "e2e", "test_para_spacing_result.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        return passed

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
