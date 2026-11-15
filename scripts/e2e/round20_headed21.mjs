// 仅表格也 MISS！最小结构 = 单表格文档。再与最小复现页对比差异：
// 1) 我们的表格有 colgroup/table-layout:fixed
// 2) pm-table NodeView 包裹
// 3) 表格 align 属性 → margin-left:auto
// 4) td 内 span 格式
// 二分表格行：只有表头 1 行 vs 全部行；还有去掉 colgroup：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'

async function testDoc(p, doc, tweak) {
  await p.evaluate(d => window.__setDocForTest(d), doc)
  await p.waitForTimeout(2000)
  const has = await p.evaluate(() => !!document.querySelector('.ProseMirror table td'))
  if (!has) return 'NO-TABLE'
  const res = await p.evaluate((tw) => {
    if (tw === 'no-colgroup') document.querySelectorAll('.ProseMirror table colgroup').forEach(c => c.remove())
    if (tw === 'no-fixed') document.querySelectorAll('.ProseMirror table').forEach(t => t.style.tableLayout = 'auto')
    if (tw === 'no-margin') document.querySelectorAll('.ProseMirror table').forEach(t => t.style.margin = '')
    const sc = document.querySelector('.flex-1.overflow-auto')
    const td = document.querySelector('.ProseMirror table td')
    const scRect = sc.getBoundingClientRect()
    const tdTop = td.getBoundingClientRect().top
    sc.scrollTop += tdTop - scRect.top - 300
    window.__hit = -1
    if (!window.__mdHooked) { window.__mdHooked = true; window.addEventListener('mousedown', () => { window.__hit = 1 }, true) }
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, tweak)
  await p.waitForTimeout(1000)
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const hit = await p.evaluate(() => window.__hit)
  return hit >= 0 ? 'HIT' : 'MISS'
}

const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
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
const onlyTable = { ...j.document, blocks: [blocks[tableIdx]] }
console.log('仅表格 原样:', await testDoc(p, onlyTable, 'none'))
console.log('仅表格 去colgroup:', await testDoc(p, onlyTable, 'no-colgroup'))
console.log('仅表格 去fixed:', await testDoc(p, onlyTable, 'no-fixed'))
// 只留 1 行
const oneRow = { ...j.document, blocks: [{ ...blocks[tableIdx], rows: [blocks[tableIdx].rows[0]] }] }
console.log('仅表头1行:', await testDoc(p, oneRow, 'none'))
await b.close()
