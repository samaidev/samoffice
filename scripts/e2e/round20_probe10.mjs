// tdTop=515、hitInTd=true、window 无滚动 —— 一切几何正常，点击 (315, 528) 无 focus。
// 但 probe8 里点击 y=9983（视口外）事件正常到达！区别：视口外点击 Playwright 自动滚。
// 大胆新假设：视口内某矩形区域的输入被 Chromium 层面吞掉（如 DevTools overlay、
// 或 CDP Domain esp. Inspector?）。无头浏览器 headless 模式下不该有。
// 最后一招二分法：从视口顶到底，每 50px 点一下，找出事件能到达的区域边界：
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
await p.evaluate(() => {
  window.__hits = []
  window.addEventListener('mousedown', e => {
    window.__hits.push(Math.round(e.clientX) + ',' + Math.round(e.clientY))
  }, true)
})
const rows = []
for (let y = 100; y <= 850; y += 75) {
  await p.evaluate(() => { window.__hits = [] })
  await p.mouse.click(700, y)
  await p.waitForTimeout(120)
  const got = await p.evaluate(() => window.__hits.length)
  rows.push(`y=${y}:${got ? '✓' : '✗'}`)
}
console.log(rows.join(' '))
await b.close()
