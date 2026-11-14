// 点击 (315, 325) 仍无事件 —— 再测 pointerdown 是否到达。如果连 pointerdown 都没有，
// 那位置上有东西在合成层截获。这次在【点击的同一时刻】同步检查 elementsFromPoint
// 和 pointer-events 计算值（不再提前打点）。
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

// 注册最全事件探针（window + document, capture + bubble, pointerdown/mousedown）
await p.evaluate(() => {
  for (const t of ['pointerdown', 'mousedown']) {
    window.addEventListener(t, e => console.log(`EV:${t}@${Math.round(e.clientX)},${Math.round(e.clientY)} tgt=${e.target.tagName}`), true)
  }
})

const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r2 = td.getBoundingClientRect()
  return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2, top: Math.round(r2.top), bottom: Math.round(r2.bottom), vh: window.innerHeight }
})
console.log('目标:', JSON.stringify(box))
await p.mouse.move(box.x, box.y)
await p.waitForTimeout(800)
const hit = await p.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y)
  return el ? el.tagName + '.' + (el.className?.toString().slice(0, 25) || '') : 'null'
}, box)
console.log('move后823ms 命中:', hit, '| 视口高:', box.vh)
await p.mouse.down()
await p.waitForTimeout(100)
await p.mouse.up()
await p.waitForTimeout(300)
console.log('事件:', consoleMsgs.filter(m => m.startsWith('EV:')).slice(0, 4).join(' ; ') || '(无)')
await b.close()
