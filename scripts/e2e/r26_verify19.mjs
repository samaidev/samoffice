// 修 verify18：UDM table 结构可能是 {type:'table', rows:[{cells:[...]}]}，看 convert.ts
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
// 用真实打开的文档的 UDM 里抠一个 table block 作为模板
const template = await p.evaluate(() => {
  return { note: 'check convert' }
})
// 查 convert.ts 的 UDM 表格结构（从页面源读不了，直接从磁盘读）
await b.close()
