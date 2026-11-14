// elementFromPoint=SPAN（命中正常），但 Playwright 的 down() 无事件。
// 注意：probe5 里 mouse.move 到 (315, 325) 后 823ms 命中还是 SPAN —— 说明元素没动。
// 那为什么 down() 没事件？！唯一没试过的：mouse.move 后【页面把鼠标指针捕获】
// （setPointerCapture）或者该处有 drag 处理拦截。还有一种简单可能：
// scrollIntoView 让【内层滚动容器】滚动，但 Playwright mouse 事件是基于视口的 ——
// 坐标 (315,325) 在视口内且命中 SPAN —— 一切正常却无事件 = 事件被【Chrome 合成层】
// 吞掉 —— 该元素在 transform/zoom 容器里，Playwright 的输入派发目标计算错误？
// 试试 CDP Input.dispatchMouseEvent（绕过 Playwright 输入管线）：
import { chromium } from 'playwright'
import fs from 'fs'

const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
const consoleMsgs = []
p.on('console', m => consoleMsgs.push(m.text()))
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(2500)
await p.evaluate(() => document.querySelector('.ProseMirror table').scrollIntoView({ block: 'center' }))
await p.waitForTimeout(3000)
await p.evaluate(() => {
  for (const t of ['pointerdown', 'mousedown', 'click']) {
    window.addEventListener(t, e => console.log(`EV:${t}@${Math.round(e.clientX)},${Math.round(e.clientY)} tgt=${e.target.tagName}`), true)
  }
})
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r2 = td.getBoundingClientRect()
  return { x: Math.round(r2.x + r2.width / 2), y: Math.round(r2.y + r2.height / 2) }
})
console.log('目标:', JSON.stringify(box))
// CDP 直接派发
const cdp = await p.context().newCDPSession(p)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
await p.waitForTimeout(200)
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
await p.waitForTimeout(100)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
await p.waitForTimeout(400)
console.log('CDP事件:', consoleMsgs.filter(m => m.startsWith('EV:')).slice(0, 5).join(' ; ') || '(无)')
const st = await p.evaluate(() => {
  const pm = window.__pmView
  return { focused: pm.hasFocus(), from: pm.state.selection.from }
})
console.log('CDP点击后:', JSON.stringify(st))
await b.close()
