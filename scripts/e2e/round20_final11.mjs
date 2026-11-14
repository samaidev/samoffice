// 临界在 3✓/5✗ 之间（4 未测）。+N 段 = 表格上方内容高度 N*段高。
// 3段≈800px? 5段≈1300px? —— 临界内容高度 ~1000-1300px。
// ★ 洞察：3 段时表格+内容 = 大约 1 页内；5 段后表格被推到【第 2 页】
// —— 分页引擎给表格挂 pg-brk-table / 或给上方段落挂 pg-brk →
// 行位移(position:relative top) 出现 → hit-test 失效！
// 验证 3/5 段时分页状态：
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
const blocks = j.document.blocks
const tableIdx = blocks.findIndex(bl => bl.rows)
const tbl = blocks[tableIdx]

for (const n of [3, 5]) {
  await p.evaluate(d => window.__setDocForTest(d), { ...j.document, blocks: [...blocks.slice(0, n), tbl] })
  await p.waitForTimeout(2200)
  await p.evaluate(() => { document.querySelector('.flex-1.overflow-auto').scrollTop = 300 })
  await p.waitForTimeout(800)
  const info = await p.evaluate(() => {
    const t = document.querySelector('.ProseMirror table')
    const wrap = t.closest('.tableWrapper')
    const rows = Array.from(t.rows)
    const displaced = rows.filter(rw => getComputedStyle(rw).top !== 'auto')
    // 上方段落有没有断页装饰
    const brks = document.querySelectorAll('.pg-brk').length
    const linebrks = document.querySelectorAll('.pg-linebreak').length
    const papers = document.querySelectorAll('.pg-paper').length
    return {
      brk: wrap?.classList.contains('pg-brk-table'),
      displaced: displaced.length,
      displacedTops: displaced.map(rw => getComputedStyle(rw).top).slice(0, 2),
      brks, linebrks, papers,
    }
  })
  console.log(`+${n}段:`, JSON.stringify(info))
}
await b.close()
