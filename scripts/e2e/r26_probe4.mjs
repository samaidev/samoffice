// posAtCoords 完全正常（pos 5110 落在 cell 里）—— 主线程 hit-test 没问题，
// PM 也能定位。问题精确定位为：**合成器 hit-test 与主线程不一致**。
// 这是 Chromium 对 `transform: scale()` 的已知行为吗？—— zoom=100 时 scale(1)
// 仍是 transform！transform 会创建合成层。普通段落也在同一层里却正常……
// 区别：表格有 DocTableView NodeView + position:relative 的 tableWrapper + colgroup。
// 试着把 zoom 容器的 transform 临时去掉再点！
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
await p.waitForTimeout(1500)

// 实验1：移除 zoom 包裹层的 transform
await p.evaluate(() => {
  const host = window.__pmView.dom.parentElement // pm-host
  const scaler = host.parentElement               // scale 包裹层
  window.__savedTransform = scaler.style.transform
  scaler.style.transform = 'none'
  window.__scaler = scaler
})
await p.waitForTimeout(600)
await p.evaluate(() => { window.__t1 = []; window.addEventListener('pointerdown', e => window.__t1.push(e.target.tagName), true) })
let box = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
console.log('transform=none → events:', JSON.stringify(await p.evaluate(() => window.__t1)))
// 恢复
await p.evaluate(() => { window.__scaler.style.transform = window.__savedTransform })
await p.waitForTimeout(600)

// 实验2：临时把 tableWrapper 的 position:relative 去掉
await p.evaluate(() => {
  const td = [...document.querySelectorAll('.ProseMirror td')][2]
  const w = td.closest('.tableWrapper')
  window.__savedPos = w.style.position
  w.style.position = 'static'
})
await p.waitForTimeout(400)
await p.evaluate(() => { window.__t2 = []; window.addEventListener('pointerdown', e => window.__t2.push(e.target.tagName), true) })
box = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
console.log('tableWrapper position=static → events:', JSON.stringify(await p.evaluate(() => window.__t2)))
await b.close()
