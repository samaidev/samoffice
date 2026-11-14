// katex.min.css 无 pointer-events 规则 —— 但组合才触发。
// 深入：katex css 让【什么元素】出现/变大导致遮挡？katex 渲染在文档里，
// 但死区在表格 —— 表格区域与公式无关……
// 真正机制猜想：katex css 含 .katex-display{margin} 等 —— 改变文档流高度，
// 让分页引擎把表格【跨页断行】（pg-brk-table）→ 断行表格的 separate 边框模型
// + 行位移（relative top）→ compositor hit-test 失效！
// 验证：主+katex 下表格是否 pg-brk-table（主表单独时不是）：
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
await p.waitForTimeout(3000)
const info = await p.evaluate(() => {
  const t = document.querySelector('.ProseMirror table')
  const rows = Array.from(t.rows)
  const displaced = rows.filter(rw => getComputedStyle(rw).top !== 'auto')
  const wrap = t.closest('.tableWrapper')
  return {
    brk: wrap?.classList.contains('pg-brk-table'),
    rowCount: rows.length,
    displacedCount: displaced.length,
    displacedTops: displaced.map(rw => getComputedStyle(rw).top).slice(0, 3),
    tableStyle: t.getAttribute('style'),
  }
})
console.log('全 CSS 下表格状态:', JSON.stringify(info, null, 1))
await b.close()
