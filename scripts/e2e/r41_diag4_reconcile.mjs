// r41 终版对账：同一时刻取 __pg 模型数据 + DOM 实测，统一坐标系逐块判定"越界"
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
await p.goto('http://localhost:18400/?r41final=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(5000)

const out = await p.evaluate(() => {
  const pg = (window).__pg
  const pm = document.querySelector('.ProseMirror')
  const papers = [...document.querySelectorAll('.pg-paper')]
  // 视觉偏移：纸页0视觉top - 0（布局顶）
  const v0 = papers[0].getBoundingClientRect().top
  // docMargins（React 层用的真实值——从 DocumentEditor 无法直接拿，从角标 DOM 读）
  const corner = papers[0].querySelector('span[style*="border-top"]')
  const mt = corner ? parseFloat(corner.style.top) : NaN   // px
  const ml = corner ? parseFloat(corner.style.left) : NaN
  // 底部角标：bottom 值
  const cornerB = papers[0].querySelector('span[style*="border-bottom"]')
  const mb = cornerB ? parseFloat(cornerB.style.bottom) : NaN // px
  // 逐块实测（视觉坐标 → 布局坐标：y - v0）
  const rows = []
  const kids = [...pm.children]
  pg.blocks.forEach((blk, k) => {
    const el = kids[k]
    if (!el) return
    const r = el.getBoundingClientRect()
    const layoutTop = r.top - v0
    const layoutBottom = r.bottom - v0
    // 该块声称所在页
    const page = blk.page
    const cb = page * pg.pageStep + pg.per  // 该页 contentBottom（布局）
    const overflow = Math.round(layoutBottom - cb)
    rows.push({ k, type: blk.type, page, h: Math.round(r.height), lo: overflow, pv: (blk.pv || '').slice(0, 10) })
  })
  const bad = rows.filter(r => r.lo > 4)
  return { mt, ml, mb, pageStep: pg.pageStep, per: pg.per, papers: papers.length, v0: Math.round(v0), bad, total: rows.length }
})
console.log('docMargins(px): top', out.mt, 'left', out.ml, 'bottom', out.mb, '| pageStep', out.pageStep, 'per', out.per, '| 纸页', out.papers)
console.log(`真实越界块（DOM 底 > 所在页 contentBottom+4px）: ${out.bad.length}/${out.total}`)
for (const r of out.bad) console.log(' ', JSON.stringify(r))
console.log('pageerror:', errs.length)
await b.close()
