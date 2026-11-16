// 隐藏 ribbon 也无效。回到 reparent 结论重审：挂到 d8（编辑区包裹层）有事件，
// 挂到 d9（DocumentEditor 根）无。d8 与 d9 之间隔着的正是 d8 这层加它的兄弟。
// 其实 reparent 到 d8 = append 到 d8（flex column）末尾 = 紧跟在 overflow-auto 后面，
// 位于可视区（d8 高度 655）。挂到 d9 末尾也在可视区……但事件无。
// 也许问题根本不在层叠，而在**横向溢出**：overflow-auto 容器 scrollWidth=1360 ==
// clientWidth，但内容 794px 宽 + margin —— 无横向滚动。
// 再看一个此前忽略的值：editorScroll rect=215~870（高 655），scrollTop=? 
// TD y=516 视口内。paper 层 top=-9202~7640 pe=none z=0 —— 它是「缩放层」div！
// pe=none 的 DIV 高 16842（-9202~7640）覆盖整个滚动内容区。
// 但 pe=none 不该挡事件……除非 Chromium 的 compositor 对 huge layer 有 bug。
// 实验：临时把该 pe=none 层 display:none，点击
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
await p.evaluate(() => {
  // 缩放包裹层（transform:scale 的 div，pe=none 的父）display:none 会连编辑器一起没 —— 不行。
  // 逐层试：pg-paper 层(sheetsLayer)、zoom 缩放层、纸页层容器
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  let el = td.closest('table').parentElement
  const arr = []
  while (el && el !== document.body) { arr.push(el); el = el.parentElement }
  window.__layers = arr.map((e, i) => ({ i, tag: e.tagName, cls: (e.className || '').toString().slice(0, 30) }))
})
console.log(JSON.stringify(await p.evaluate(() => window.__layers)))
// 试验 A：给 editorScroll 容器（overflow-auto）临时加 overflow:visible
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  window.__sc = sc
  window.__savedOv = sc.style.overflow
  sc.style.overflow = 'visible'
})
await p.waitForTimeout(400)
await p.evaluate(() => { window.__tA = []; window.addEventListener('pointerdown', e => window.__tA.push(e.target.tagName), true) })
let box = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(200)
console.log('A overflow=visible →', JSON.stringify(await p.evaluate(() => window.__tA)))
await p.evaluate(() => { window.__sc.style.overflow = window.__savedOv })
// 试验 B：给 overflow-auto 临时去掉 onScroll 委托？React 合成事件在 root。
// 试验 C：检查 editorScroll 的 scrollTop 极大 —— scrollIntoView 之后 scrollTop 多少？
const st = await p.evaluate(() => ({ scrollTop: window.__sc.scrollTop, scrollHeight: window.__sc.scrollHeight, clientHeight: window.__sc.clientHeight, tdY: [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect().y }))
console.log('scroll state:', JSON.stringify(st))
await b.close()
