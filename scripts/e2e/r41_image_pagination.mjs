// r41 验证：EMC 合同文档所有块落在页内容区内（pm 顶坐标系，修正审计坐标 bug）
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/emc_contract.udm.json'), 'utf-8'))

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
await p.goto('http://localhost:18400/?r41verify=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(5000)

// ① 模型自洽验证：__pg.blocks 每块 actualBottom ≤ 所在页 contentBottom + 容差
const out = await p.evaluate(() => {
  const pg = (window).__pg
  if (!pg) return { error: 'no __pg' }
  const per = pg.per, step = pg.pageStep
  const bad = []
  pg.blocks.forEach((blk, k) => {
    const cb = blk.page * step + per
    if (blk.actualBottom > cb + 6) bad.push({ k, type: blk.type, page: blk.page, aBot: blk.actualBottom, cb, over: Math.round(blk.actualBottom - cb), pv: (blk.pv || '').slice(0, 10) })
  })
  return { total: pg.blocks.length, pages: pg.pageCount, bad }
})
if (out.error) { console.log('FAIL:', out.error); process.exit(1) }
console.log(`① 模型层：${out.total} 块 / ${out.pages} 页，越界 ${out.bad.length} 个（容差 6px）`)
for (const r of out.bad.slice(0, 10)) console.log('  ', JSON.stringify(r))

// ② DOM 实测（pm 顶原点）：每块 rect 底 ≤ 所在页 contentBottom + 容差
const out2 = await p.evaluate(() => {
  const pg = (window).__pg
  const pm = document.querySelector('.ProseMirror')
  const pmTop = pm.getBoundingClientRect().top
  const kids = [...pm.children]
  const per = pg.per, step = pg.pageStep
  const bad = []
  pg.blocks.forEach((blk, k) => {
    const el = kids[k]
    if (!el) return
    const r = el.getBoundingClientRect()
    const layoutBottom = r.bottom - pmTop // pm 顶原点（内容盒坐标系）
    const cb = blk.page * step + per
    if (layoutBottom > cb + 6) bad.push({ k, type: blk.type, page: blk.page, domBottom: Math.round(layoutBottom), cb, over: Math.round(layoutBottom - cb), pv: (blk.pv || '').slice(0, 10) })
  })
  return { bad }
})
console.log(`② DOM 实测：越界 ${out2.bad.length} 个（容差 6px）`)
for (const r of out2.bad.slice(0, 10)) console.log('  ', JSON.stringify(r))

// ③ 图片段专项：3 张图片所在段的页内位置
const out3 = await p.evaluate(() => {
  const pg = (window).__pg
  const pm = document.querySelector('.ProseMirror')
  const pmTop = pm.getBoundingClientRect().top
  const kids = [...pm.children]
  const res = []
  kids.forEach((el, k) => {
    const img = el.querySelector && el.querySelector('img')
    if (!img) return
    const r = el.getBoundingClientRect()
    const blk = pg.blocks[k]
    const cb = blk.page * pg.pageStep + pg.per
    res.push({ k, page: blk.page, h: Math.round(r.height), domBottom: Math.round(r.bottom - pmTop), cb, ok: (r.bottom - pmTop) <= cb + 6 })
  })
  return res
})
console.log('③ 图片段：', JSON.stringify(out3))

const pass = out.bad.length === 0 && out2.bad.length === 0 && out3.every(r => r.ok)
console.log(`pageerror: ${errs.length}`)
console.log(`=== r41 结果: ${pass ? 'ALL PASS ✓' : 'FAIL ✗'} ===`)
await b.close()
process.exit(pass ? 0 : 1)
