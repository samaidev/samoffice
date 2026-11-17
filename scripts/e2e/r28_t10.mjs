// 点击后 100ms：anchor 在视口内、scroll 9658 没动 —— 跳动发生在
// 【更晚】（我们的 t7 里等 700ms 后才看到 16142）。采样时间线：
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
// 滚动时间线采样（100ms 间隔，覆盖点击后 2s）
await p.evaluate(() => {
  window.__tl = []
  const iv = setInterval(() => window.__tl.push(Math.round(performance.now()) + ':' + document.querySelector('.overflow-auto').scrollTop), 100)
  setTimeout(() => clearInterval(iv), 2600)
})
const box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const td = tds[8]; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(2500)
const tl = await p.evaluate(() => [...window.__tl])
// 只显示变化的点
const chg = tl.filter((s, i, a) => i === 0 || s.split(':')[1] !== a[i-1].split(':')[1])
console.log('滚动时间线（变化点）:', JSON.stringify(chg.slice(0, 12)))
await b.close()
