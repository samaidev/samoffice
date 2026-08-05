"""复现：点击目录导航后，顶部菜单栏(header)是否消失。
测量 header 与编辑器工具栏在点击前后的 getBoundingClientRect。"""
import json, os, sys, base64, time, threading, http.server, socketserver

ROOT = r"c:\Users\Administrator\samoffice-1"
DIST = os.path.join(ROOT, "frontend", "dist")
PORT = 8138

TEST_MD = "# A\n\n正文占位段落用于滚动。\n\n## B1\n\n" + ("占位文字一行。\n" * 30) + "\n## B2\n\n" + ("占位文字二行。\n" * 30) + "\n"

def start_http():
    os.chdir(DIST)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def main():
    from playwright.sync_api import sync_playwright
    httpd = start_http()
    b64 = base64.b64encode(TEST_MD.encode("utf-8")).decode("ascii")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.add_init_script("""
          window.go = { main: { App: {
            GetStartupArgs: async () => ['C:/test/sample.md'],
            OpenFile: async (path) => ({ document: {}, warnings: [], path: path, rawContent: '%s' }),
            ReadFile: async (path) => '%s',
            LogError: async () => {}, Log: async () => {},
          }}};
          window.runtime = { Events: { Emit: ()=>{}, On: ()=>{} }, Log: ()=>{} };
        """ % (b64, b64))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        page.wait_for_selector("aside button", timeout=8000)
        # 切到 split 视图以便同时看到预览与编辑器
        page.evaluate("""() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const sp = btns.find(b => b.textContent && b.textContent.includes('split') || b.textContent.includes('Split'));
          if (sp) sp.click();
        }""")
        time.sleep(0.5)
        def rect(sel):
            return page.evaluate("""(s) => {
              const el = document.querySelector(s);
              if (!el) return 'NO_EL';
              const r = el.getBoundingClientRect();
              return { top: Math.round(r.top), bottom: Math.round(r.bottom), display: getComputedStyle(el).display, vis: getComputedStyle(el).visibility };
            }""", sel)
        before_header = rect("header")
        before_toolbar = rect("div.flex.h-full > div")
        # 点击 B2 目录
        clicked = page.evaluate("""() => {
          const b = Array.from(document.querySelectorAll('aside button')).find(x => x.title && x.title.includes('B2'));
          if (!b) return false; b.click(); return true;
        }""")
        time.sleep(1.2)
        after_header = rect("header")
        after_toolbar = rect("div.flex.h-full > div")
        print("clicked:", clicked)
        print("HEADER before:", before_header, "after:", after_header)
        print("TOOLBAR before:", before_toolbar, "after:", after_toolbar)
        # 判定 header 是否消失/移出视口顶部
        header_gone = (after_header == 'NO_EL') or (after_header.get('top', 0) < -5) or (after_header.get('display') == 'none')
        out = {"clicked": clicked, "header_before": before_header, "header_after": after_header,
               "toolbar_before": before_toolbar, "toolbar_after": after_toolbar, "header_gone": header_gone}
        with open(os.path.join(ROOT, "scripts", "e2e", "toc_header_dbg.json"), "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        browser.close()
        return not header_gone

if __name__ == "__main__":
    ok = main()
    print("HEADER_OK" if ok else "HEADER_GONE")
    sys.exit(0 if ok else 1)
