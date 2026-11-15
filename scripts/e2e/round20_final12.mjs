// 分页无差异（都 1 页无断行）。3✓/5✗ 的本质 = 表格上方内容高度
// 3段≈??px vs 5段≈??px。测量精确高度 + 扫高度阈值：
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

async function testDoc(docBlocks) {
  await p.evaluate(d => window.__setDocForTest(d), { ...j.document, blocks: docBlocks })
  await p.waitForTimeout(2200)
  await p.evaluate(() => {
    window.__hit = -1
    if (!window.__mdHooked) { window.__mdHooked = true; window.addEventListener('mousedown', () => { window.__hit = 1 }, true) }
  })
  await p.evaluate(() => { document.querySelector('.flex-1.overflow-auto').scrollTop = 300 })
  await p.waitForTimeout(800)
  const geo = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const sc = document.querySelector('.flex-1.overflow-auto')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), pmH: Math.round(document.querySelector('.ProseMirror').getBoundingClientRect().height), scSH: sc.scrollHeight }
  })
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(geo.x, geo.y)
  await p.waitForTimeout(180)
  const hit = await p.evaluate(() => window.__hit) >= 0
  return { hit, tdY: geo.y, pmH: geo.pmH, scSH: geo.scSH }
}

for (const n of [3, 4, 5]) {
  const { hit, tdY, pmH, scSH } = await testDoc([...blocks.slice(0, n), tbl])
  console.log(`+${n}段: ${hit ? '✓' : '✗死区'} tdY=${tdY} PM高=${pmH} scrollH=${scSH}`)
}
await b.close()
