// ★ 滚动来自 prosemirror-view 的 scrollRectIntoView（node_modules 里）
// —— PM 的 scrollIntoView 机制。谁调的？截全栈：
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
await p.evaluate(() => {
  window.__scr = []
  const sc = document.querySelector('.overflow-auto')
  let lastTop = sc.scrollTop
  Object.defineProperty(sc, 'scrollTop', {
    get() { return lastTop },
    set(v) { if (Math.abs(v - lastTop) > 100) window.__scr.push((new Error().stack || '').split('\n').slice(1, 7).map(x => x.trim().slice(0, 90)).join('\n')); lastTop = v },
    configurable: true,
  })
})
let box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[6].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
await p.evaluate(() => { window.__scr = [] })
box = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[8].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
const stacks = await p.evaluate(() => [...window.__scr])
console.log('大滚动调用栈:')
stacks.forEach(s => console.log(s + '\n---'))
await b.close()
