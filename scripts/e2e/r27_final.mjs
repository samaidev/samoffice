// z=7 后 from=20（正文）—— ui_verify 的点击点=td*0.6 在 z7 层上应命中。
// t27 已验证 z7+td中心=HIT。ui_verify 等待 500ms 可能不够（2s channel
// 延迟建层 —— ui_verify 点正文后只等 800ms 就点表格 → 层还没建！）
// ui_verify 需要等 2s+。用正确时序跑最终验证：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const clickAndType = async (i, ch) => {
  const box = await p.evaluate((idx) => { const tds = [...document.querySelectorAll('td')]; const td = tds[idx]; if (!td) return null; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5, vis: r.y > 0 && r.y < 880 } }, i)
  if (!box || !box.vis) return { skip: true }
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(600)
  const sel = await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))
  await p.keyboard.type(ch, { delay: 70 })
  await p.waitForTimeout(400)
  const txt = await p.evaluate((idx) => [...document.querySelectorAll('td')][idx]?.textContent, i)
  return { sel, txt }
}
// A) 小文档
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
// 首次交互（用户点正文）→ 等 2.5s（channel 2s 建层）
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2600)
console.log('A td[0]:', JSON.stringify(await clickAndType(0, 'Q5')))
console.log('A td[1]:', JSON.stringify(await clickAndType(1, 'W7')))
console.log('A doc:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })))
// B) 真实文档
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
await p.evaluate(() => { [...document.querySelectorAll('td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1800)
console.log('B td[2]:', JSON.stringify(await clickAndType(2, 'Z9')))
await p.evaluate(() => { document.querySelector('.overflow-auto').scrollTop += 500 })
await p.waitForTimeout(1200)
console.log('B 滚动后 td[2]:', JSON.stringify(await clickAndType(2, 'Y8')))
await b.close()
