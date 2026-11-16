// 边界精确：y≤516 有事件，y=524 起全死。516 = 表格第一行顶部！
// 表格顶=516。所以「表格 wrapper 的整个渲染区域」鼠标事件全灭。
// 且克隆 fixed 覆盖也不行（在 PM 内）→ 与位置无关、与「表格类型的层」有关。
// ★ 触摸活、鼠标死 —— Chromium 合成器对 contenteditable 中的 <table> 有
// "mouse event interception"（表格单元格选择特性）？查 CSS：index.css 
// .ProseMirror table 的规则里有没有 user-select/-webkit-user-select!
// table { user-select: element } 之类的 webkit 私有值会启用 Chromium 的
// 原生表格选择模式 → mousedown 被浏览器"吃掉"做拖选！
// 若 mousedown 被原生表格选择吞掉 → 不会有 DOM 事件（一致！）
// 查所有 table 相关的 user-select 声明
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
const css = await p.evaluate(() => {
  const out = []
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const chain = [td, td.closest('table'), td.closest('.tableWrapper'), window.__pmView.dom]
  for (const el of chain) {
    const s = getComputedStyle(el)
    out.push({
      el: el.tagName + '.' + (el.className || '').toString().slice(0, 18),
      userSelect: s.userSelect,
      webkitUserSelect: s.webkitUserSelect,
      webkitUserModify: s.webkitUserModify,
      touchCallout: s.webkitTouchCallout,
    })
  }
  return out
})
console.log(JSON.stringify(css, null, 1))
// 再看选区拖动是否原生生效：mousedown 在 TD 上拖动后 selection 是什么样
const box = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.move(box.x, box.y)
await p.mouse.down()
await p.mouse.move(box.x + 60, box.y + 30, { steps: 5 })
await p.mouse.up()
await p.waitForTimeout(300)
const sel = await p.evaluate(() => {
  const s = window.getSelection()
  return { anchor: s?.anchorNode?.nodeName, rangeCount: s?.rangeCount, text: s?.toString?.().slice(0, 20) }
})
console.log('selection after drag:', JSON.stringify(sel))
await b.close()
