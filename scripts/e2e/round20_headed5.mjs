// move 后命中 SPAN（inTD=true）但 down/up 无事件 —— headed2 的成功其实是
// 【第三次连续点击】才成功。热身效应？做 A/B：同一位置连续点 5 次，每次记录
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
await p.waitForTimeout(2500)
await p.evaluate(() => {
  window.__n = 0
  window.addEventListener('mousedown', () => { window.__n++ }, true)
})
const box = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
const out = []
for (let i = 1; i <= 5; i++) {
  await p.evaluate(() => { window.__n = 0 })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const n = await p.evaluate(() => window.__n)
  out.push(`#${i}:${n > 0 ? '✓' : '✗'}`)
}
console.log('连续点击同一点:', out.join(' '))
await b.close()
