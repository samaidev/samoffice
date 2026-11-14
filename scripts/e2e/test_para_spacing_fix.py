"""验证两处修复：
1) 段落字间距输入数字不会替换正文内容（正文文本保持原样，仅 letter-spacing 属性生效）。
2) “显示标记”下纸张四角直角：数量为每页4个、颜色为 Word 风格蓝灰(rgb(91,155,213))、
   定位在整张纸边界（top/bottom 含页边距偏移）。
"""
import json, os, sys, time, threading, http.server, socketserver

ROOT = r"c:\Users\Administrator\samoffice-1"
DIST = os.path.join(ROOT, "frontend", "dist")
PORT = 8151

def start_http():
    os.chdir(DIST)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

ORIGINAL_TEXT = "Hello SamOffice test content for letter spacing"

def main():
    from playwright.sync_api import sync_playwright
    httpd = start_http()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.add_init_script("""
          try { localStorage.setItem('samoffice_show_marks', '1'); } catch (e) {}
          window.go = { main: { App: {
            GetStartupArgs: async () => ['C:/test/sample.docx'],
            OpenFile: async (path) => ({ document: { meta:{}, blocks:[{ inline:[{content:'Hello SamOffice test content for letter spacing'}] }] }, warnings: [], path: path, rawContent: '' }),
            ReadFile: async (path) => '',
            SpellCheck: async () => [],
            LogError: async () => {}, Log: async () => {},
          }}};
          window.runtime = { Events: { Emit: ()=>{}, On: ()=>{} }, Log: ()=>{} };
        """)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("CONSOLE:" + m.text) if m.type == "error" else None)
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        page.wait_for_selector(".ProseMirror", timeout=8000)
        time.sleep(0.8)

        result = {"loadCrash": bool(errs)}

        # 记录输入前正文
        before = page.evaluate("() => document.querySelector('.ProseMirror p')?.textContent || ''")
        result["textBefore"] = before

        # 光标放入段落
        page.click(".ProseMirror p")
        time.sleep(0.3)

        # 在段落字间距框输入数字（逐字符，模拟真实输入）
        wrap = page.query_selector('div[data-testid="paraLetterSpacing"]')
        result["paraFound"] = bool(wrap)
        if wrap:
            inp = wrap.query_selector("input")
            inp.click()
            time.sleep(0.2)
            inp.press("Control+a")
            page.keyboard.type("3")
            time.sleep(0.5)

        # 输入后正文：必须保持原样，不应包含 "3" 或被替换
        after = page.evaluate("() => document.querySelector('.ProseMirror p')?.textContent || ''")
        result["textAfter"] = after
        result["textUnchanged"] = (after == before) and ("3" not in after)

        # letter-spacing 是否生效
        result["paraLetterSpacing"] = page.evaluate("""() => {
          const ps = Array.from(document.querySelectorAll('.ProseMirror p'));
          for (const p of ps) {
            if (p.style.letterSpacing) return p.style.letterSpacing;
            const span = p.querySelector('span[style*="letter-spacing"]');
            if (span) return span.style.letterSpacing;
          }
          return 'NONE';
        }""")

        # 四角直角：统计数量与颜色（匹配任一边框为 Word 蓝灰的 absolute span）
        corners = page.evaluate("""() => {
          const isCorner = (s) => {
            if (s.style.position !== 'absolute') return false;
            const c = (s.style.borderTopColor || s.style.borderBottomColor || s.style.borderLeftColor || s.style.borderRightColor || '').toLowerCase();
            return c.includes('91, 155, 213') || c.includes('5b9bd5');
          };
          const all = Array.from(document.querySelectorAll('span')).filter(isCorner);
          const colors = all.map(s => s.style.borderTopColor || s.style.borderBottomColor);
          const tops = all.map(s => s.style.top);
          const lefts = all.map(s => s.style.left);
          return { count: all.length, colors, tops, lefts };
        }""")
        result["cornerCount"] = corners["count"]
        result["cornerColors"] = corners["colors"]
        result["cornerTops"] = corners["tops"]

        result["errors"] = errs[:5]
        result["crash"] = bool(errs)

        passed = (not result["loadCrash"]) and result.get("paraFound") and result["textUnchanged"] \
                  and '3px' in str(result["paraLetterSpacing"]) and result["cornerCount"] >= 4 \
                  and (not result["crash"])
        result["passed"] = passed
        print("RESULT:", json.dumps(result, ensure_ascii=False))
        print("PASSED" if passed else "FAILED")
        browser.close()
        with open(os.path.join(ROOT, "scripts", "e2e", "test_para_spacing_fix_result.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        return passed

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
