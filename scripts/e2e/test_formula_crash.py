"""复现插入公式崩溃，捕获真实 pageerror stack。"""
import json, os, sys, time, threading, http.server, socketserver

ROOT = r"c:\Users\Administrator\samoffice-1"
DIST = os.path.join(ROOT, "frontend", "dist")
PORT = 8142
DEV_URL = "http://127.0.0.1:8142/"

def start_http():
    os.chdir(DIST)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def main():
    from playwright.sync_api import sync_playwright
    start_http()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.add_init_script("""
          window.go = { main: { App: {
            GetStartupArgs: async () => ['C:/test/sample.docx'],
            OpenFile: async (path) => ({ document: { meta:{}, blocks:[{ inline:[{content:'Hello SamOffice formula test'}] }] }, warnings: [], path: path, rawContent: '' }),
            ReadFile: async (path) => '',
            SpellCheck: async () => [],
            LogError: async () => {}, Log: async () => {},
          }}};
          window.runtime = { Events: { Emit: ()=>{}, On: ()=>{} }, Log: ()=>{} };
        """)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e) + "\nSTACK:\n" + (e.stack or "")))
        page.goto(DEV_URL, wait_until="networkidle")
        page.wait_for_selector(".ProseMirror", timeout=8000)
        time.sleep(0.6)

        # 调试：dump 含 formula 的按钮
        dumps = page.evaluate("""() => {
          const btns = Array.from(document.querySelectorAll('button'));
          return btns.filter(b => (b.getAttribute('data-testid')||'').includes('formula') || (b.textContent||'').includes('公式') || (b.textContent||'').includes('Σ'))
                    .map(b => ({ testid: b.getAttribute('data-testid'), text: (b.textContent||'').slice(0,20), vis: b.offsetParent !== null }));
        }""")
        result_dbg = {"formulaBtnsHome": dumps}
        # 先切到“插入”标签页（公式按钮在 insert tab）
        trace = {}
        try:
            page.click('button[data-testid="ribbon-tab-insert"]', timeout=4000)
            time.sleep(0.4)
            trace["insertTab"] = "ok"
        except Exception as e:
            errs.append("CLICK_INSERT_TAB:" + str(e)[:150])
        # 切到 insert 后 dump 公式相关按钮
        dumps2 = page.evaluate("""() => {
          const btns = Array.from(document.querySelectorAll('button'));
          return btns.filter(b => (b.getAttribute('data-testid')||'').includes('formula'))
                    .map(b => ({ testid: b.getAttribute('data-testid'), text: (b.textContent||'').slice(0,20) }));
        }""")
        trace["formulaBtnsInsert"] = dumps2
        # 点击公式按钮（insert 标签页）
        try:
            page.click('button[data-testid="insert-formula"]', timeout=4000)
            time.sleep(0.4)
            trace["formulaBtn"] = "ok"
        except Exception as e:
            errs.append("CLICK_FORMULA_BTN:" + str(e)[:150])
        # 面板打开后 dump
        dumps3 = page.evaluate("""() => {
          const btns = Array.from(document.querySelectorAll('button'));
          return btns.filter(b => (b.getAttribute('data-testid')||'').includes('formula'))
                    .map(b => ({ testid: b.getAttribute('data-testid'), text: (b.textContent||'').slice(0,20) }));
        }""")
        trace["formulaBtnsPanel"] = dumps3
        # 点击第一个常用公式（a²+b²=c²）
        step = {}
        try:
            page.click('button[data-testid="formula-quick"]', timeout=4000)
            step["formulaQuick"] = "clicked"
            time.sleep(0.8)
        except Exception as e:
            step["formulaQuick"] = "ERR:" + str(e)[:120]

        # 诊断：面板内按钮、math 节点
        diag = page.evaluate("""() => {
          const q = document.querySelector('button[data-testid="formula-quick"]');
          const el = document.querySelector('.sam-math, .sam-math-error');
          // 文档里是否有 math 节点（ProseMirror）
          const pmMath = document.querySelector('.ProseMirror [data-latex]');
          return {
            quickExists: !!q,
            mathClass: el ? (el.className + '|' + (el.getAttribute('data-latex')||'')) : 'NONE',
            pmMath: pmMath ? (pmMath.getAttribute('data-latex')||'EMPTY') : 'NONE'
          };
        }""")
        # 检查文档是否仍正常（math 节点是否存在）
        hasMath = page.evaluate("""() => {
          const el = document.querySelector('.sam-math, .sam-math-error, .ProseMirror [data-latex]');
          return el ? (el.getAttribute('data-latex') || 'EMPTY') : 'NONE';
        }""")
        result = {"errors": errs[:5], "hasMath": hasMath, "crashed": bool(errs), "trace": trace, "step": step, "diag": diag}
        sys.stdout.reconfigure(encoding="utf-8")
        browser.close()
        with open(os.path.join(ROOT, "scripts", "e2e", "test_formula_crash_result.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print("RESULT:", json.dumps(result, ensure_ascii=True))
        return not errs

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
