// 用户真实流程验证：打开文档 → 先点一下正文（激活 proxy 创建）→ 
// 再点表格格 → 打字。这是用户实际会做的操作序列。
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
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
// ① 用户先点正文（首次交互 → 建 proxy）
const paraBox = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(paraBox.x, paraBox.y)
await p.waitForTimeout(800) // 60ms 后建 + 稳定
// ② 点表格格
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(500)
console.log('② 点击表格:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('③ td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
// ④ 第二格
const box2 = await p.evaluate(() => { const r = [...document.querySelectorAll('td')][1].getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box2.x, box2.y)
await p.waitForTimeout(500)
await p.keyboard.type('W7', { delay: 60 })
await p.waitForTimeout(400)
console.log('④ td[1]:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('td')][1]?.textContent)))
console.log('⑤ doc:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })))
// ⑥ 真实文档
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
await p.evaluate(() => { [...document.querySelectorAll('td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)
// 用户再点一下正文
const pb2 = await p.evaluate(() => { const ps = [...document.querySelectorAll('.ProseMirror p')].filter(pp => { const rr = pp.getBoundingClientRect(); return rr.y > 100 && rr.y < 800 && rr.height > 8 }); const r = ps[0].getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 } })
await p.mouse.click(pb2.x, pb2.y)
await p.waitForTimeout(800)
const box3 = await p.evaluate(() => { const r = [...document.querySelectorAll('td')][2].getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box3.x, box3.y)
await p.waitForTimeout(500)
await p.keyboard.type('Z9', { delay: 60 })
await p.waitForTimeout(400)
console.log('⑥ 真实文档 td[2]:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('td')][2]?.textContent)))
// ⑦ 滚动后
await p.evaluate(() => { document.querySelector('.overflow-auto').scrollTop += 600 })
await p.waitForTimeout(1000)
const box4 = await p.evaluate(() => { const r = [...document.querySelectorAll('td')][2].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5, vis: r.y > 0 && r.y < 880 } })
if (box4.vis) {
  await p.mouse.click(box4.x, box4.y)
  await p.waitForTimeout(500)
  await p.keyboard.type('Y8', { delay: 60 })
  await p.waitForTimeout(400)
  console.log('⑦ 滚动后 td[2]:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('td')][2]?.textContent)))
} else console.log('⑦ 滚动后不可见，跳过')
await b.close()
