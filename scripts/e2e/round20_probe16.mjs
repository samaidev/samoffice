// 精确死区边界测定：从表格上方到下方逐 40px 扫描，找到事件到达/丢失的确切 y
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
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
const base = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  return { tdTop: Math.round(td.getBoundingClientRect().top), tdH: Math.round(td.getBoundingClientRect().height) }
})
console.log('表格顶 y=' + base.tdTop + ' 高=' + base.tdH)
await p.evaluate(() => {
  window.__hit = -1
  window.addEventListener('mousedown', e => { window.__hit = Math.round(e.clientY) }, true)
})
const rows = []
for (let y = base.tdTop - 80; y <= base.tdTop + base.tdH + 80; y += 30) {
  if (y < 5 || y > 890) continue
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(700, y)
  await p.waitForTimeout(100)
  const hit = await p.evaluate(() => window.__hit)
  rows.push(`${y}:${hit >= 0 ? '✓' : '✗'}`)
}
console.log(rows.join(' '))
await b.close()
