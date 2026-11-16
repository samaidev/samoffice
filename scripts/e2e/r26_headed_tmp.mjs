import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const BASE = 'http://localhost:18400'
const b2 = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
const p2 = await (await b2.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
await p2.goto(BASE, { waitUntil: 'networkidle' })
await p2.waitForTimeout(800)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch(BASE + '/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p2.evaluate(d => window.__setDocForTest(d), j.document)
await p2.waitForTimeout(3500)
await p2.evaluate(() => { [...document.querySelectorAll('.ProseMirror td')][2].scrollIntoView({ block: 'center' }) })
await p2.waitForTimeout(1500)
await p2.evaluate(() => { window.__h = []; window.addEventListener('pointerdown', e => window.__h.push(e.target.tagName), true) })
const box2 = await p2.evaluate(() => {
  const r = [...document.querySelectorAll('.ProseMirror td')][2].getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p2.mouse.click(box2.x, box2.y)
await p2.waitForTimeout(300)
console.log('HEADED events:', JSON.stringify(await p2.evaluate(() => window.__h)))
const st2 = await p2.evaluate(() => {
  const v = window.__pmView
  return { sel: v.state.selection.type?.name, from: v.state.selection.from, focus: v.hasFocus() }
})
console.log('HEADED after click:', JSON.stringify(st2))
await p2.keyboard.type('Z')
await p2.waitForTimeout(250)
const txt2 = await p2.evaluate(() => [...document.querySelectorAll('.ProseMirror td')][2]?.textContent)
console.log('HEADED cell text:', JSON.stringify(txt2))
await b2.close()
