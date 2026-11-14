// CSS 是罪魁！717 条主样式表 —— 二分禁用（先试 katex 249 条，再主表二分）：
import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
const tryClick = async (label) => {
  await p.evaluate(() => { window.__hit = -1 })
  const box = await p.evaluate(() => {
    const td = document.querySelector('.ProseMirror table td')
    const r = td.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(180)
  const hit = await p.evaluate(() => window.__hit)
  console.log(`${label}: ${hit >= 0 ? '✓' : '✗'}`)
  return hit >= 0
}
// 只开主表（禁 github+katex）
await p.evaluate(() => {
  const sheets = Array.from(document.querySelectorAll('link[rel=stylesheet], style'))
  sheets.forEach(n => n.disabled = true)
  sheets[2].disabled = false  // 主表
})
await p.waitForTimeout(300)
if (await tryClick('只开主表')) console.log('>>> 主表内规则（717条）二分')
else {
  // 主表禁用后可点 → 试只开 katex
  await p.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll('link[rel=stylesheet], style'))
    sheets.forEach(n => n.disabled = true)
    sheets[1].disabled = false
  })
  if (await tryClick('只开 katex')) console.log('>>> katex 是罪魁')
}
await b.close()
