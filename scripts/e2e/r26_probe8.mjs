// 嫌疑层定位到 d9（DocumentEditor 根 div flex flex-col h-full, position:relative）的
// 第 3 个子 DIV（空 DIV —— 就是 line 3033 附近的「编辑器主区」）。
// 但真正诡异的是 reparent 到 d8 的事件正常、到 d9 无。差异：
// d8 是 flex column 容器（无 relative），d9 有 position:relative。
// reparent 到 d9 时表格 append 到 d9 末尾（越过 ribbon 区）—— 等等！
// 之前 "out of view, skip" 太多。真正的线索在 [7]/[8] 有、[9] 无。
// 新思路：不 reparent 了。直接检查 reparent 实验里 [9] 的点击是不是落在了
// 「Ribbon 面板」上（append 到 d9 末尾 = 页面底部？不，flex column 会排在最后）。
// 换个更直接的实验：临时隐藏 d9 的其它子元素（ribbon 等），只留编辑区，点击原表格
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
// 隐藏 ribbon 两栏
await p.evaluate(() => {
  const root = document.querySelector('.flex.flex-col.h-full')
  window.__hidden = []
  for (const c of [...root.children]) {
    if (!c.contains(window.__pmView.dom)) { c.style.display = 'none'; window.__hidden.push(c) }
  }
})
await p.waitForTimeout(500)
await p.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(500)
await p.evaluate(() => { window.__t = []; window.addEventListener('pointerdown', e => window.__t.push(e.target.tagName), true) })
const box = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
console.log('ribbon hidden → events:', JSON.stringify(await p.evaluate(() => window.__t)))
// 恢复
await p.evaluate(() => { for (const c of (window.__hidden || [])) c.style.display = '' })
await b.close()
