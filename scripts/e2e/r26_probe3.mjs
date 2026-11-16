// 合成事件 PM 也不响应（from=1）——连 PM 的 handleDOMEvents/mousedown 都没跑？
// PM 对合成 mousedown 会走 posFromCoords。试 view.posAtCoords。
// 同时排查「表格是否在 .pg-paper 白纸外」：纸外区域（gap 区）会不会有一个
// 透明覆盖层（.pageOverlay / 背景层）在纸页层容器上铺满且 pointerEvents:auto？
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(3500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)
const q = await p.evaluate(() => {
  const v = window.__pmView
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const r = td.getBoundingClientRect()
  const pos = v.posAtCoords({ left: r.x + r.width / 2, top: r.y + r.height / 2 })
  return { pos, inside: pos?.inside, posPos: pos?.pos }
})
console.log('posAtCoords(center):', JSON.stringify(q))
// 对比段落
const q2 = await p.evaluate(() => {
  const v = window.__pmView
  const ps = [...document.querySelectorAll('.ProseMirror p')].filter(pp => { const rr = pp.getBoundingClientRect(); return rr.y > 80 && rr.y < innerHeight - 80 && rr.height > 8 })
  const rr = ps[0].getBoundingClientRect()
  return v.posAtCoords({ left: rr.x + 30, top: rr.y + rr.height / 2 })
})
console.log('posAtCoords(para):', JSON.stringify(q2))
await b.close()
