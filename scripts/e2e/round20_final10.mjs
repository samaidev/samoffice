// ★ 关键数据：
//   仅表格 不滚 ✗ / 滚300 ✓
//   表格+1段 不滚 ✓ 滚300 ✓
//   表格+10段 滚300 ✗
// +1段 全 ✓；+10段 ✗。二分 2..10 段找临界 —— 这才是可操作的规律！
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

async function testDoc(docBlocks, scroll) {
  await p.evaluate(d => window.__setDocForTest(d), { ...j.document, blocks: docBlocks })
  await p.waitForTimeout(2200)
  await p.evaluate(() => {
    window.__hit = -1
    if (!window.__mdHooked) { window.__mdHooked = true; window.addEventListener('mousedown', () => { window.__hit = 1 }, true) }
  })
  if (scroll > 0) await p.evaluate(v => { document.querySelector('.flex-1.overflow-auto').scrollTop = v }, scroll)
  await p.waitForTimeout(800)
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (box.y < 0 || box.y > 880) return '跳过(y=' + box.y + ')'
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(180)
  return (await p.evaluate(() => window.__hit)) >= 0 ? '✓' : '✗'
}

for (const n of [2, 3, 5, 7, 10]) {
  const res = await testDoc([...blocks.slice(0, n), tbl], 300)
  console.log(`+${n}段 滚300: ${res}`)
}
await b.close()
