"""验证 Markdown 编辑器两处修复：
1) 公式渲染：预览区应出现 .katex 元素（KaTeX auto-render 已调用）。
2) 目录导航同步代码：点击 TOC 后编辑器 textarea 应滚动到对应行（scrollTop 变化且光标定位）。

通过远程模式页面 + 桩 window.go 驱动真实生产代码（tryOpenStartupFile -> openResult -> MarkdownHtmlEditor）。
"""
import json, os, sys, subprocess, time, base64, threading, http.server, socketserver

ROOT = r"c:\Users\Administrator\samoffice-1"
DIST = os.path.join(ROOT, "frontend", "dist")
PORT = 8137

# 测试 md：含公式与多级标题
TEST_MD = """# 一级标题

这是正文，下面有一个行内公式 $E = mc^2$ 和一个块级公式：

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## 二级标题A

段落 A 的内容，用于定位滚动。

## 二级标题B

段落 B 的内容，后面再写一些占位文字以保证页面可滚动：
Lorem ipsum dolor sit amet, consectetur adipiscing elit. 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 占位 填空 占位 占位 占位
"""

def start_http():
    os.chdir(DIST)
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd

def main():
    from playwright.sync_api import sync_playwright
    httpd = start_http()
    b64 = base64.b64encode(TEST_MD.encode("utf-8")).decode("ascii")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            # 桩 window.go（Wails 后端），驱动真实 openResult 流程
            page.add_init_script("""
              window.go = { main: { App: {
                GetStartupArgs: async () => ['C:/test/sample.md'],
                OpenFile: async (path) => ({ document: {}, warnings: [], path: path, rawContent: '%s' }),
                ReadFile: async (path) => '%s',
                LogError: async (m) => {}, Log: async (m) => {},
              }}};
              window.runtime = { Events: { Emit: ()=>{}, On: ()=>{} }, Log: ()=>{} };
            """ % (b64, b64))
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
            # 等待 MD 预览渲染完成
            page.wait_for_selector(".markdown-preview .katex", timeout=8000)
            katex_count = page.eval_on_selector_all(".markdown-preview .katex", "els => els.length")
            katex_display = page.eval_on_selector_all(".markdown-preview .katex-display", "els => els.length")
            inline_raw = page.eval_on_selector_all(".markdown-preview", "els => els[0].innerText.slice(0, 400)")
            print("katex elements:", katex_count, "display:", katex_display)
            dbg = {"katex": katex_count, "display": katex_display}
            block_html = page.evaluate("""() => {
              const ps = Array.from(document.querySelectorAll('.markdown-preview p'));
              const hit = ps.find(p => p.textContent.includes('int'));
              return hit ? hit.outerHTML : 'NOTFOUND';
            }""")
            if block_html and block_html != 'NOTFOUND':
                block_html = ''.join(ch if ord(ch) < 128 else '?' for ch in block_html)
            dbg["block_html"] = block_html[:600] if block_html else block_html
            with open(os.path.join(ROOT, "scripts", "e2e", "md_dbg.json"), "w", encoding="utf-8") as f:
                json.dump(dbg, f, ensure_ascii=False, indent=2)

            # 等待 TOC 出现
            page.wait_for_selector("aside button", timeout=8000)
            # 找到“二级标题B”对应的 TOC 按钮并点击
            toc_clicked = page.evaluate("""() => {
              const btns = Array.from(document.querySelectorAll('aside button'));
              const target = btns.find(b => b.title && b.title.includes('二级标题B'));
              if (!target) return false;
              target.click();
              return true;
            }""")
            time.sleep(1.0)
            # 编辑器 textarea 应滚动到对应行
            editor = page.query_selector("textarea")
            scroll_top = page.eval_on_selector("textarea", "el => el.scrollTop") if editor else 0
            sel_start = page.eval_on_selector("textarea", "el => el.selectionStart") if editor else 0
            print("toc clicked:", toc_clicked, "editor scrollTop:", scroll_top, "selectionStart:", sel_start)

            katex_ok = katex_count >= 2  # 至少一个行内 + 一个块级
            nav_ok = bool(toc_clicked) and (scroll_top > 20 or sel_start > 0)
            print("katex_ok:", katex_ok, "nav_ok:", nav_ok)
            print("PAGEERRORS:", errors[:3])
            passed = katex_ok and nav_ok
            print("PASSED" if passed else "FAILED")
            browser.close()
            return passed
    finally:
        httpd.shutdown()

if __name__ == "__main__":
    passed = main()
    out = os.path.join(ROOT, "scripts", "e2e", "test_md_features_result.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"formulaRender": passed, "tocSyncEditor": passed}, f, ensure_ascii=False, indent=2)
    sys.exit(0 if passed else 1)
