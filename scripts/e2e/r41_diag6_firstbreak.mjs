// r41 诊断6：k=24 附近（第一个越界点）的断页内部状态
import { chromium } from 'playwright'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/emc_contract.udm.json'), 'utf-8'))

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto('http://localhost:18400/?r41d6=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(d => window.__setDocForTest(d), DOC)
await p.waitForTimeout(5000)

const out = await p.evaluate(() => {
  const pg = (window).__pg
  const rows = []
  for (const k of [22, 23, 24, 25, 26, 27, 28, 36, 37, 38, 39, 55, 56, 57]) {
    const blk = pg.blocks[k]
    if (!blk) continue
    rows.push({ k, ...blk })
  }
  return { rows, breaks: pg.breakDetails, pageStep: pg.pageStep, per: pg.per }
})
console.log('pageStep', out.pageStep, 'per', out.per)
console.log('块详情:')
for (const r of out.rows) console.log(' ', JSON.stringify({ k: r.k, type: r.type, top: r.top, h: r.h, page: r.page, aTop: r.actualTop, aBot: r.actualBottom, pv: (r.pv || '').slice(0, 12) }))
console.log('断点详情:')
const bds = [...out.breaks.entries()].map(([pos, d]) => ({ pos, ...d }))
for (const d of bds.slice(0, 14)) console.log(' ', JSON.stringify(d))
await b.close()
