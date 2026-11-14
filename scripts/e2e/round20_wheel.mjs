import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
const errs = []
p.on('pageerror', e => errs.push(e.message.slice(0, 100)))
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
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
})
// 真实滚轮滚动（CDP wheel 事件走 compositor 管线）
const cdp = await p.context().newCDPSession(p)
for (let i = 0; i < 12; i++) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 680, y: 500, deltaX: 0, deltaY: 1200 })
  await p.waitForTimeout(180)
}
await p.waitForTimeout(1000)
const pos = await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { scrollTop: Math.round(sc.scrollTop), tdTop: Math.round(r.top), inView: r.top > 200 && r.bottom < 880 }
})
console.log('滚轮12次后:', JSON.stringify(pos))
// 若表格不在视口，继续滚轮
// 精细回滚（负 deltaY）到表格进入视口中上部
let guard = 0
while (guard++ < 40) {
  const tdTop2 = await p.evaluate(() => Math.round(document.querySelector('.ProseMirror table td').getBoundingClientRect().top))
  if (tdTop2 > 280 && tdTop2 < 520) break
  // 表格在上方 → 回滚；在下方 → 继续下滚
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 680, y: 500, deltaX: 0, deltaY: tdTop2 < 280 ? -400 : 400 })
  await p.waitForTimeout(200)
}
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.top) }
})
console.log('表格位置:', JSON.stringify(box))
await p.evaluate(() => { window.__hit = -1 })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
const hit = await p.evaluate(() => window.__hit)
const focused = await p.evaluate(() => window.__pmView?.hasFocus?.())
console.log('滚轮路径点击:', hit >= 0 ? '✓ HIT' : '✗ MISS', '| PM focus:', focused)
if (hit >= 0 && focused) {
  await p.keyboard.type('OK', { delay: 40 })
  await p.waitForTimeout(300)
  const txt = await p.evaluate(() => {
    let t = ''
    window.__pmView.state.doc.descendants(n => { if (!t && n.type.name === 'table_cell') t = n.textContent.slice(0, 10); return !t })
    return t
  })
  console.log('键入OK:', JSON.stringify(txt), txt.includes('OK') ? '表格可编辑 ✓✓✓' : 'fail')
  await p.keyboard.press('Control+z')
}
console.log('errors:', errs.slice(0, 2))
await b.close()
