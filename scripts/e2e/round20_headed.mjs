import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
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
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', e => { window.__hit = Math.round(e.clientY) }, true)
})
// 表格位置
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.top) }
})
console.log('表格位置:', JSON.stringify(box))
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
const hit = await p.evaluate(() => window.__hit)
const focused = await p.evaluate(() => window.__pmView.hasFocus())
console.log('headed 点击单元格:', hit >= 0 ? '✓ 事件到 y=' + hit : '✗ 死区', '| PM focus=' + focused)
if (hit >= 0) {
  await p.keyboard.type('OK', { delay: 40 })
  await p.waitForTimeout(300)
  const txt = await p.evaluate(() => {
    let t = ''
    window.__pmView.state.doc.descendants((n) => { if (!t && n.type.name === 'table_cell') t = n.textContent.slice(0, 10); return !t })
    return t
  })
  console.log('键入OK后:', JSON.stringify(txt), txt.includes('OK') ? 'EDIT-PASS（真实环境表格可编辑）' : 'edit-fail')
}
await b.close()
