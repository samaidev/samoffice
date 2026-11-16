// 验证修复：zoom=100 时无 transform → 表格可点击、可编辑
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
await p.waitForTimeout(1200)
// 确认 scaler 无 transform
const scaler = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const s = pm.parentElement.parentElement.parentElement
  return { style: (s.getAttribute('style') || '').slice(0, 90), csTransform: getComputedStyle(s).transform }
})
console.log('scaler:', JSON.stringify(scaler))
// 点击表格格
const box = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(350)
const st = await p.evaluate(() => {
  const v = window.__pmView
  const s = v.state.selection
  return { sel: s.type?.name, from: s.from, focus: v.hasFocus() }
})
console.log('after click:', JSON.stringify(st))
// 打字验证
await p.keyboard.type('Z9', { delay: 60 })
await p.waitForTimeout(400)
const txt = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror td')][2]?.textContent)
console.log('cell after typing Z9:', JSON.stringify(txt))
// 点击另一个格子再打字
const box2 = await p.evaluate(() => { const r = [...document.querySelectorAll('.ProseMirror td')][4].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box2.x, box2.y)
await p.waitForTimeout(300)
await p.keyboard.type('Y8', { delay: 60 })
await p.waitForTimeout(300)
const txt2 = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror td')][4]?.textContent)
console.log('cell4 after typing Y8:', JSON.stringify(txt2))
await b.close()
