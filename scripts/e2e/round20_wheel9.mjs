// 上移也不行。回到 wheel5 数据再读一遍：
//   x=100✓ 200✓ [300-800 表格内全✗] 900✓ 1000✓ ...
// 表格 y=515 高 487（到 1002 —— 但视口 900！表格被 scroller 裁剪在 870）。
// 点击 y=541 在表格第一行 —— x=300..800 死。
// 而最小复现页（简单 table）OK。差异只剩：我们的表格有 9 行 4 列 + 内容格式 +
// colgroup + NodeView + 装饰（pg-linebreak 等）。
// 最强隔离：把【真实表格的 outerHTML】注入到最小复现页（无 PM/无我们的 CSS）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
// 拿表格 HTML
const tableHTML = await p.evaluate(() => document.querySelector('.ProseMirror table').outerHTML)
await b.close()

// 注入到空白页
const b2 = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p2 = await (await b2.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p2.setContent(`<!DOCTYPE html><html><body style="margin:0">
<div id="sc" style="position:absolute;top:215px;height:655px;overflow:auto;width:100%">
<div style="height:9957px"></div>
${tableHTML}
</div>
<script>
  window.__hit = -1
  window.addEventListener('mousedown', function(){ window.__hit = 1 }, true)
</script>
</body></html>`)
// 滚到表格
await p2.evaluate(() => {
  const sc = document.getElementById('sc')
  const td = document.querySelector('td')
  sc.scrollTop = 9957 - 300
})
await p2.waitForTimeout(600)
const box = await p2.evaluate(() => {
  const td = document.querySelector('td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.top) }
})
console.log('注入页表格位置:', JSON.stringify(box))
await p2.mouse.click(box.x, box.y)
await p2.waitForTimeout(300)
const hit = await p2.evaluate(() => window.__hit)
console.log('注入表格点击:', hit >= 0 ? '✓ HIT（CSS/结构无问题 → 应用层 CSS 是罪魁）' : '✗ MISS（表格 HTML 本身触发 Chromium bug）')
await b2.close()
