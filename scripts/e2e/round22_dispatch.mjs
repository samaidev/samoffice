// 原生 vs 合成事件对照 + 不同滚动位置的死区边界扫描
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
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
await p.waitForTimeout(3500)
// 滚动到表格区（top≈10427-200）
await p.evaluate(() => { const sc = document.querySelector('.flex-1.overflow-auto'); if (sc) sc.scrollTo({ top: 10230 }) })
await p.waitForTimeout(1000)
// 1) 原生点击同一行三次（看是否偶发）
let natOK = 0
for (let i = 0; i < 3; i++) {
  const pt = await p.evaluate(() => {
    const els = document.querySelectorAll('.ProseMirror p')
    let first = null
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (!first && r.y > 120 && r.y < 800 && el.textContent.trim().length > 5) first = { x: r.x + 80, y: r.y + r.height / 2 }
    }
    return first
  })
  if (!pt) break
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(300)
  const f = await p.evaluate(() => window.__pmView.hasFocus())
  if (f) natOK++
  await p.evaluate(() => window.__pmView.dom.blur())
  await p.waitForTimeout(150)
}
console.log('原生点击 3 次:', natOK + ' 成功')
// 2) 合成事件（dispatchEvent mousedown）应 100% 触发 PM selection
const syn = await p.evaluate(() => {
  const els = document.querySelectorAll('.ProseMirror p')
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.y > 120 && r.y < 800 && el.textContent.trim().length > 5) {
      const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.x + 80, clientY: r.y + r.height / 2 })
      el.dispatchEvent(ev)
      return { dispatched: true }
    }
  }
  return { dispatched: false }
})
await p.waitForTimeout(300)
const synFocus = await p.evaluate(() => window.__pmView.hasFocus())
console.log('合成 mousedown: focus=' + synFocus, synFocus ? 'OK（JS 层正常 → 纯原生派发问题）' : 'FAIL（JS 层也坏）')
// 3) CDP 点击对照（Input.dispatchMouseEvent 绕过 Playwright 事件层）
await p.evaluate(() => window.__pmView.dom.blur())
await p.waitForTimeout(200)
const cdp = await p.context().newCDPSession(p)
const pt2 = await p.evaluate(() => {
  const els = document.querySelectorAll('.ProseMirror p')
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (r.y > 120 && r.y < 800 && el.textContent.trim().length > 5) return { x: r.x + 80, y: r.y + r.height / 2 }
  }
  return null
})
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt2.x, y: pt2.y, button: 'left', clickCount: 1 })
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt2.x, y: pt2.y, button: 'left', clickCount: 1 })
await p.waitForTimeout(400)
const cdpFocus = await p.evaluate(() => window.__pmView.hasFocus())
console.log('CDP 原生输入: focus=' + cdpFocus, cdpFocus ? 'OK' : 'FAIL')
await b.close()
