// 正式代理层实现验证：小文档 + 真实文档全流程
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const clickAndType = async (i, ch) => {
  const box = await p.evaluate((idx) => { const tds = [...document.querySelectorAll('td')]; const td = tds[idx]; if (!td) return null; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5, vis: r.y > 0 && r.y < 880 } }, i)
  if (!box || !box.vis) return { skip: true }
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(350)
  const sel = await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))
  await p.keyboard.type(ch, { delay: 60 })
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
const proxyState = await p.evaluate(() => {
  const proxys = document.querySelectorAll('.pm-table-clickproxy')
  const w = document.querySelector('.tableWrapper')
  const pr = proxys[0]?.getBoundingClientRect()
  const wr = w?.getBoundingClientRect()
  return { count: proxys.length, covers: pr && wr ? Math.abs(pr.top - wr.top) < 2 && pr.height >= wr.height - 2 : false }
})
console.log('代理层状态:', JSON.stringify(proxyState))
console.log('A1 td[0]:', JSON.stringify(await clickAndType(0, 'Q5')))
console.log('A2 td[3]:', JSON.stringify(await clickAndType(3, 'W7')))
console.log('doc 完整:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })))
// B) 真实文档
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4500)
await p.evaluate(() => { [...document.querySelectorAll('td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)
console.log('B 真实 td[2]:', JSON.stringify(await clickAndType(2, 'Z9')))
// 滚动后（代理跟随验证）
await p.evaluate(() => { document.querySelector('.overflow-auto').scrollTop += 500 })
await p.waitForTimeout(800)
console.log('滚动后 td[2]:', JSON.stringify(await clickAndType(2, 'Y8')))
await b.close()
