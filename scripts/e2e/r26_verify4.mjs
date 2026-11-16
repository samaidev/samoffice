// ★★★ 层阶梯全 ALIVE（transform 移除后）！外来表在每个层都活了。
// 但 PM 自己的表格仍点不到（verify2）。区别：PM 的表在 L0 内的
// .ProseMirror 里 —— probe42 之前只测到 L0 位置的外来表，没测 PM 内。
// 现在测：外来 fixed 表挂【.ProseMirror dom 内】—— 但 PM DOMObserver 会删。
// 换法：直接点 PM 表格 —— verify2 失败…… 
// 等等！verify2 里 scaler=[] —— transform 全无，但点击还是 from=1。
// 差异：verify2 的点击点 y 是 TD 中心。而外来表 z=2^31 盖在上面 → 
// verify3 L0-L4 ALIVE 的点击其实命中的是【外来表】不是 PM 表！
// 真正的 PM 表格可能仍死。决定性测试：移除外来表后再点 PM 表。
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(4000)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1500)
// 清除探针 + 直接点 PM 表格
await p.evaluate(() => { document.querySelectorAll('[data-tprobe]').forEach(e => e.remove()); window.__e = []; window.addEventListener('pointerdown', e => window.__e.push(e.target.tagName), { capture: true, passive: true }) })
const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
const ev = await p.evaluate(() => window.__e)
console.log('PM table click events:', JSON.stringify(ev))
const st = await p.evaluate(() => { const v = window.__pmView; return { sel: v.state.selection.type?.name, from: v.state.selection.from, focus: v.hasFocus() } })
console.log('selection:', JSON.stringify(st))
await p.keyboard.type('Z9', { delay: 50 })
await p.waitForTimeout(350)
console.log('cell text:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.ProseMirror td')][2]?.textContent)))
await b.close()
