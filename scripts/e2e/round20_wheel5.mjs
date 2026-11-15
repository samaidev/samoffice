// ★★★ 等等！！这次 st=2000/8000 全屏全 HIT！（x=500 打在正文上）
// 之前 st=9957 表格区域 MISS —— 表格在 x=309！
// 规律更新：**x=500（正文区）随便滚都 HIT；x=309（表格列位置）MISS** ——
// 死区是【横向】的？！x<某值 死？表格 x=284-650…… 但 (700,530) 也 MISS 过！
// (700,530) x=700 也死？那是 st=9957 的测试。
// 控制变量：同一滚动位置（表格所在 st），扫描 x：100..1200：
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
// 滚到表格（y≈357）
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(2000)
// 记录表格几何
const geo = await p.evaluate(() => {
  const t = document.querySelector('.ProseMirror table')
  const r = t.getBoundingClientRect()
  return { x: Math.round(r.x), right: Math.round(r.right), y: Math.round(r.y), h: Math.round(r.height) }
})
console.log('表格几何:', JSON.stringify(geo))
// 横向扫描（在表格行内 y = geo.y+20；同高度表格外的 x 也测）
const out = []
const y = geo.y + 26
for (let x = 100; x <= 1300; x += 100) {
  await p.evaluate(() => { window.__hit = -1 })
  await p.mouse.click(x, y)
  await p.waitForTimeout(120)
  const hit = await p.evaluate(() => window.__hit)
  const inTable = x >= geo.x && x <= geo.right
  out.push(`x=${x}${inTable ? 'T' : ' '}:${hit >= 0 ? '✓' : '✗'}`)
}
console.log(out.join(' '))
await b.close()
