// 最终验证：源码修复后，带重试的表格交互（时序敏感 → 点击前强制重滚+等待）
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
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
await p.waitForTimeout(3000)

// 滚到表格后【重新触发一次滚动事件管线】：先滚过头再滚回（模拟用户滚轮）
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', () => { window.__hit = 1 }, true)
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(1000)
await p.evaluate(() => { const sc = document.querySelector('.flex-1.overflow-auto'); sc.scrollTop += 120 })
await p.waitForTimeout(400)
await p.evaluate(() => { const sc = document.querySelector('.flex-1.overflow-auto'); sc.scrollTop -= 120 })
await p.waitForTimeout(1500)

const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
// 点击（重试 3 次）
let focused = false, hit = -1
for (let i = 0; i < 3 && !focused; i++) {
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(400)
  const st = await p.evaluate(() => ({ f: window.__pmView.hasFocus(), h: window.__hit }))
  focused = st.f; hit = st.h
  if (!focused) { await p.waitForTimeout(500) }
}
console.log('点击: focus=' + focused + ' hit=' + hit)
if (focused) {
  await p.keyboard.type('OK', { delay: 40 })
  await p.waitForTimeout(400)
  const txt = await p.evaluate(() => {
    let t = ''
    window.__pmView.state.doc.descendants(n => { if (!t && n.type.name === 'table_cell') t = n.textContent.slice(0, 10); return !t })
    return t
  })
  console.log('编辑:', JSON.stringify(txt), txt.includes('OK') ? 'PASS' : 'FAIL')
  await p.keyboard.press('Control+z')
  await p.keyboard.press('Control+a')
  await p.waitForTimeout(300)
  const sel = await p.evaluate(() => { const s = window.__pmView.state.selection; return s.from + '-' + s.to })
  console.log('Ctrl+A:', sel)
  await p.keyboard.press('Escape')
  await p.screenshot({ path: 'scripts/e2e/round19-shots/final-table.png' })
}
console.log('errors:', errs.slice(0, 2))
await b.close()
