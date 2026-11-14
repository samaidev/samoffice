// mousedown 一个都不到 —— 但点正文段落能到（之前的探针证明过）。
// 现在同一个会话里先后点【段落】和【表格】，对比两次的传播：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(15000)
const cmsgs = []
p.on('console', m => cmsgs.push(m.text().slice(0, 110)))
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
  window.addEventListener('mousedown', () => { window.__n++; console.log('GOT-MD@' + window.__n) }, true)
})
// 点段落
const paraPt = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + 30), y: Math.round(r.top - 60) }
})
await p.mouse.click(paraPt.x, paraPt.y)
await p.waitForTimeout(300)
const n1 = await p.evaluate(() => window.__n)
// 点表格中心
const cellPt = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  const r = td.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
await p.mouse.click(cellPt.x, cellPt.y)
await p.waitForTimeout(300)
const n2 = await p.evaluate(() => window.__n)
// 再点段落
await p.mouse.click(paraPt.x, paraPt.y)
await p.waitForTimeout(300)
const n3 = await p.evaluate(() => window.__n)
console.log(`段落:${n1 > 0 ? '✓' : '✗'} 表格:${n2 - n1 > 0 ? '✓' : '✗'} 再点段落:${n3 - n2 > 0 ? '✓' : '✗'}`)
await b.close()
