// 这次点击后【完全没有跳动】（9658 全程稳定）！t7 的 6484 跳变不可复现？
// 差异：t7 是【连续点击 td[6] → td[8]】，这次只点 td[8]。
// ★★★ 复测连续点击场景（两次点击间隔 700ms）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(5000)
await p.evaluate(() => { document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)
const click = async (idx) => {
  const box = await p.evaluate((i) => { const tds = [...document.querySelectorAll('td')]; const td = tds[i]; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5, vis: r.y > 40 && r.y < 870 } }, idx)
  if (!box?.vis) return { skip: true }
  const before = await p.evaluate(() => document.querySelector('.overflow-auto').scrollTop)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(700)
  return await p.evaluate((bt) => ({ after: document.querySelector('.overflow-auto').scrollTop, delta: document.querySelector('.overflow-auto').scrollTop - bt, sel: window.__pmView.state.selection.from }), before)
}
console.log('td[6]:', JSON.stringify(await click(6)))
console.log('td[8]:', JSON.stringify(await click(8)))
console.log('td[6]再:', JSON.stringify(await click(6)))
console.log('td[7]:', JSON.stringify(await click(7)))
await b.close()
