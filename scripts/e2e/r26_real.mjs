// ◆◆◆ 测试方法修正：inline 必须用 {content:...}（或走真实 API）。
// 用真实合同 docx + 正确 inline 的小文档，重新验证死区存在性。
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
// A) 修正 inline 格式的小文档
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
const small = await p.evaluate(() => ({
  tdTexts: [...document.querySelectorAll('.ProseMirror td')].map(t => t.textContent),
}))
console.log('小文档 cell 内容:', JSON.stringify(small.tdTexts))
const clickTd = async (i) => {
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', e => window.__evT = e.target.tagName, { capture: true, passive: true }) })
  const box = await p.evaluate((idx) => { const tds = [...document.querySelectorAll('.ProseMirror td')]; const r = tds[idx].getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } }, i)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(280)
  const ev = await p.evaluate(() => window.__ev)
  const sel = await p.evaluate(() => { const v = window.__pmView; return v ? v.state.selection.from : -1 })
  return { alive: ev > 0, target: await p.evaluate(() => window.__evT), selFrom: sel }
}
const r1 = await clickTd(0)
console.log('小文档 td[0] 点击:', JSON.stringify(r1))
await p.keyboard.type('Q', { delay: 40 })
await p.waitForTimeout(300)
console.log('打字后 td[0]:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.ProseMirror td')][0]?.textContent)))
// B) 真实合同文档
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const rr = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await rr.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1200)
const r2 = await clickTd(2)
console.log('真实文档 td[2] 点击:', JSON.stringify(r2))
await p.keyboard.type('Z9', { delay: 50 })
await p.waitForTimeout(350)
console.log('打字后 td[2]:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.ProseMirror td')][2]?.textContent)))
await b.close()
