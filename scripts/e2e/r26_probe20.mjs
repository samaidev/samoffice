// 重大结论：wrapper（fixed 定位、同样坐标）放进 mx-auto(pageRef, chain[5]) 可点，
// 放在 ProseMirror 内部（原位）不可点。表格在 ProseMirror 内部 vs 外部，
// 唯一系统差异 = **ProseMirror 编辑器 dom**。
// PM 的 dom 是 contenteditable=true。Chromium 对 contenteditable 里的
// <table> 有原生「表格选择/拖选」行为 —— 但不至于吞事件。
// 试最后一步：PM dom 上是否挂了巨大的 ::selection/Selection？
// 直接实验：把 PM dom 的 contenteditable 临时关掉再点
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
await p.waitForTimeout(1200)
// A: contenteditable=false
await p.evaluate(() => { window.__pmView.dom.setAttribute('contenteditable', 'false') })
await p.waitForTimeout(300)
await p.evaluate(() => { window.__evA = []; window.addEventListener('pointerdown', e => window.__evA.push(e.target.tagName), true) })
let box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
console.log('contenteditable=false →', JSON.stringify(await p.evaluate(() => window.__evA)))
await p.evaluate(() => { window.__pmView.dom.setAttribute('contenteditable', 'true') })
// B: user-select:none
await p.evaluate(() => { window.__pmView.dom.style.userSelect = 'none' })
await p.waitForTimeout(300)
await p.evaluate(() => { window.__evB = []; window.addEventListener('pointerdown', e => window.__evB.push(e.target.tagName), true) })
box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
console.log('user-select=none →', JSON.stringify(await p.evaluate(() => window.__evB)))
await p.evaluate(() => { window.__pmView.dom.style.userSelect = '' })
// C: 检查 PM dom 内 table 的 ::selection —— 或者 has(TableSelection)？
// D: 对照 —— 段落在 PM 内可点（早已证明）→ 唯一剩余差异：表格的 NodeView！
// DocTableView 的 this.dom 是 wrapper。检查 wrapper 是否 PM 的 NodeView dom
// 与 PM 更新机制有关：试着 view.updateState(view.state) 强制重渲染后再点
await p.evaluate(() => { window.__pmView.updateState(window.__pmView.state) })
await p.waitForTimeout(500)
await p.evaluate(() => { window.__evD = []; window.addEventListener('pointerdown', e => window.__evD.push(e.target.tagName), true) })
box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
console.log('after updateState →', JSON.stringify(await p.evaluate(() => window.__evD)))
await b.close()
