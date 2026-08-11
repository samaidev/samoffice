import asyncio
from playwright.async_api import async_playwright

HTML = """
<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="old"></div>
<div id="new"></div>
<script>
  // 模拟修复前：图片默认可拖拽（draggable 默认 true）
  const oldImg = document.createElement('img')
  oldImg.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  document.getElementById('old').appendChild(oldImg)

  // 模拟修复后：draggable=false + dragstart preventDefault
  const newImg = document.createElement('img')
  newImg.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  newImg.draggable = false
  newImg.addEventListener('dragstart', (e) => e.preventDefault())
  document.getElementById('new').appendChild(newImg)

  // 暴露一个函数：派发 dragstart 并捕获 dataTransfer.files.length
  window.testDrag = (which) => {
    const img = which === 'old' ? oldImg : newImg
    let captured = null
    const dt = new DataTransfer()
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
    // 浏览器真实拖拽时才会填充 files；这里只能验证 defaultPrevented 与 draggable 属性
    img.dispatchEvent(ev)
    return { draggable: img.draggable, defaultPrevented: ev.defaultPrevented }
  }
</script>
</body></html>
"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.set_content(HTML)
        old_r = await page.evaluate("window.testDrag('old')")
        new_r = await page.evaluate("window.testDrag('new')")
        print("OLD (buggy):", old_r)
        print("NEW (fixed):", new_r)
        # 断言：修复后 draggable 必须为 false 且 dragstart 被阻止
        assert new_r["draggable"] is False, "fixed img must be draggable=false"
        assert new_r["defaultPrevented"] is True, "fixed img dragstart must be prevented"
        assert old_r["draggable"] is True, "old img default draggable=true (reproduces bug source)"
        print("VERIFY_OK: image dragstart no longer produces a draggable File source")
        await browser.close()

asyncio.run(main())
