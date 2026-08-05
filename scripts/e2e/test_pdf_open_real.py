"""真实验证：用桌面 PDF 测试前端打开 PDF 是否真正渲染内容（而不只是切 tab）。
- 桩 window.go：OpenFile 对 pdf 返回 {document:null, path}；ReadFile 返回桌面 PDF 的真实 base64。
- 触发 second-instance-open(['桌面PDF']) -> openViaApp -> openResult(pdf) -> setTab('pdf') -> dispatch 'pdf-open' -> PdfViewer.loadPdf。
- 等待 pdf.js 渲染，检查 PdfViewer 是否显示页数(numPages>0) 或 error 文本。
"""
import json, os, sys, time, threading, http.server, socketserver, base64

ROOT = r"c:\Users\Administrator\samoffice-1"
DIST = os.path.join(ROOT, "frontend", "dist")
PORT = 8151

PDF_PATH = r"C:\Users\Administrator\Desktop\Untitled.pdf"

def start_http():
    os.chdir(DIST)
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def main():
    from playwright.sync_api import sync_playwright
    # 真实读取桌面 PDF -> base64
    try:
        with open(PDF_PATH, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        pdf_ok = True
    except Exception as e:
        b64 = ""
        pdf_ok = False
        print("READ PDF FAILED:", e)

    # 把 base64 注入到 ReadFile 桩里
    INIT = (
        "window.go = { main: { App: {\n"
        "  GetStartupArgs: async () => [],\n"
        "  OpenFile: async (path) => {\n"
        "    if (path.toLowerCase().indexOf('.pdf') >= 0) { return { document: null, warnings: [], path: path }; }\n"
        "    return { document: { meta:{}, blocks:[] }, warnings: [], path: path, rawContent: '' };\n"
        "  },\n"
        "  ReadFile: async (path) => { return window.__PDF_B64__ || ''; },\n"
        "  SpellCheck: async () => [],\n"
        "  LogError: async () => {}, Log: async () => {},\n"
        "}}};\n"
        "window.__PDF_B64__ = " + json.dumps(b64) + ";\n"
        "window.__handlers = {};\n"
        "window.runtime = {\n"
        "  EventsOn: (name, cb) => { window.__handlers[name] = cb; },\n"
        "  EventsOff: (name) => { delete window.__handlers[name]; },\n"
        "  EventsEmit: () => {},\n"
        "  Log: () => {},\n"
        "  WindowShow: () => {}, WindowUnminimise: () => {}, WindowMaximise: () => {}, WindowIsMaximised: () => false,\n"
        "};\n"
    )

    httpd = start_http()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.add_init_script(INIT)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.type + ":" + m.text) if m.type == "error" else None)
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        page.wait_for_selector(".ProseMirror", timeout=8000)
        time.sleep(0.6)

        result = {"pdfFileRead": pdf_ok, "loadCrash": bool(errs)}

        # 触发 second-instance-open pdf 事件
        fired = page.evaluate("""() => {
          const h = window.__handlers['second-instance-open'];
          if (!h) return 'NO_HANDLER';
          h(['C:\\\\Users\\\\Administrator\\\\Desktop\\\\Untitled.pdf']);
          return 'FIRED';
        }""")
        result["firePdf"] = fired

        # 等待 pdf.js 加载 + 渲染（给足时间）
        time.sleep(5.0)

        # 检查 PdfViewer 状态：页数 / error / 是否有 canvas 画出内容
        pdf_state = page.evaluate("""() => {
          const toolbar = document.querySelector('[data-testid=\"pdf-toolbar\"]');
          const container = toolbar?.parentElement;
          const canvas = container?.querySelector('canvas');
          // 完整提取 PdfViewer 容器内文本，便于排查加载/错误状态
          const fullText = (container?.innerText || '').slice(0, 500);
          let canvasInfo = 'NO_CANVAS';
          if (canvas) canvasInfo = (canvas.width + 'x' + canvas.height);
          const hasToolbar = !!toolbar;
          const hasPageInput = !!document.querySelector('[data-testid=\"pdf-page-input\"]');
          return { canvasInfo, hasToolbar, hasPageInput, fullText };
        }""")
        result["pdfState"] = pdf_state

        result["errors"] = errs[:8]
        result["crash"] = bool(errs)

        # 判定：出现页码输入框（pdfDoc 加载成功）或 canvas 有实际像素尺寸说明真正渲染了 PDF
        try:
            w, h = pdf_state["canvasInfo"].split("x")
            canvasRendered = int(w) > 0 and int(h) > 0
        except:
            canvasRendered = False
        rendered = bool(pdf_state.get("hasPageInput")) or canvasRendered
        result["rendered"] = rendered

        passed = pdf_ok and (fired == 'FIRED') and (not result["loadCrash"]) and rendered and (not result["crash"])
        result["passed"] = passed
        print("RESULT:", json.dumps(result, ensure_ascii=True))
        print("PASSED" if passed else "FAILED")
        browser.close()
        with open(os.path.join(ROOT, "scripts", "e2e", "test_pdf_open_real_result.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        return passed

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
