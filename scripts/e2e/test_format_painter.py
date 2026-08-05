import json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8080"

def log(msg):
    with open("c:/Users/Administrator/samoffice-1/scripts/e2e/test_out.log", "a", encoding="utf-8") as f:
        f.write(msg + "\n")
    print(msg)

SEL_HELPER = """
(word) => {
  const pm = document.querySelector('.ProseMirror');
  if (!pm) return false;
  const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const idx = node.nodeValue.indexOf(word);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + word.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      pm.focus();
      document.dispatchEvent(new Event('selectionchange'));
      return true;
    }
  }
  return false;
}
"""

def select_word(page, word):
    return page.evaluate(SEL_HELPER, word)

def strong_count(page):
    return page.evaluate("() => document.querySelectorAll('.ProseMirror strong, .ProseMirror b').length")

def main():
    results = {"formatPainter": None, "clearFormat": None}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("console", lambda m: log(f"[console] {m.text}") if "[FP]" in m.text else None)
        page.goto(URL, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(2000)
        # 确保进入文档编辑器视图（点顶部 Document 标签，若不存在则忽略）
        try:
            doc_tab = page.get_by_text("📄Document", exact=False)
            if doc_tab.count() > 0:
                doc_tab.first.click()
                page.wait_for_timeout(800)
        except Exception as e:
            log(f"[info] 未找到 Document 标签或点击失败: {e}")
        page.wait_for_selector(".ProseMirror", timeout=20000)
        page.wait_for_timeout(1200)

        editor = page.locator(".ProseMirror")
        editor.click()
        page.keyboard.press("Control+A")
        page.keyboard.press("Delete")
        page.keyboard.type("Hello Bold World")
        page.wait_for_timeout(300)

        # 选中 "Bold" 并加粗（作为格式刷源）
        ok = select_word(page, "Bold")
        page.wait_for_timeout(250)
        page.get_by_title("Bold Ctrl+B").click()
        page.wait_for_timeout(350)
        before = strong_count(page)
        log(f"[setup] 加粗 'Bold' 后 strong 数: {before}")
        if before < 1:
            log("[FAIL] 源文本未能加粗，后续测试无意义")
            results["formatPainter"] = False
        else:
            # 格式刷：选中【源】(已加粗的 "Bold") -> 点 Format Painter 获取源格式 -> 选中【目标】"World" 应用
            select_word(page, "Bold")
            page.wait_for_timeout(200)
            page.get_by_title("Format Painter（双击锁定连续刷）").click()
            page.wait_for_timeout(250)
            select_word(page, "World")
            page.wait_for_timeout(450)
            after_paint = strong_count(page)
            log(f"[formatPainter] 把源格式刷到 'World' 后 strong 数: {after_paint}")
            if after_paint >= before + 1:
                results["formatPainter"] = True
                log("[PASS] 格式刷：成功将加粗格式复制到目标文本")
            else:
                results["formatPainter"] = False
                log(f"[FAIL] 格式刷：strong 期望 >= {before+1}，实际 {after_paint}")

            # 清除格式：选中刚被加粗的 "World" -> 点 Clear Formatting
            select_word(page, "World")
            page.wait_for_timeout(150)
            page.get_by_title("Clear Formatting").click()
            page.wait_for_timeout(400)
            after_clear = strong_count(page)
            log(f"[clearFormat] 清除 'World' 格式后 strong 数: {after_clear}")
            if after_clear == before:
                results["clearFormat"] = True
                log("[PASS] 清除格式：目标字符格式被移除，段落结构保留")
            else:
                results["clearFormat"] = False
                log(f"[FAIL] 清除格式：期望 strong={before}，实际 {after_clear}")

        page.screenshot(path="c:/Users/Administrator/samoffice-1/scripts/e2e/test_result.png")
        browser.close()

    with open("c:/Users/Administrator/samoffice-1/scripts/e2e/test_result.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    log("RESULTS: " + json.dumps(results, ensure_ascii=False))

if __name__ == "__main__":
    main()
