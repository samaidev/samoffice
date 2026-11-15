// 全页点击矩阵：纸页区每 60px 网格点击，统计 focus 成功率
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
const area = await p.evaluate(() => {
  const pm = window.__pmView
  const r2 = pm.dom.getBoundingClientRect()
  return { x0: r2.x + 20, y0: Math.max(150, r2.y + 100), x1: r2.x + r2.width - 20, y1: 750 }
})
let ok = 0, fail = 0
const fails = []
for (let y = area.y0; y <= area.y1; y += 55) {
  for (let x = area.x0 + 40; x <= area.x1 - 40; x += 120) {
    await p.mouse.click(x, y)
    await p.waitForTimeout(90)
    const focused = await p.evaluate(() => window.__pmView.hasFocus())
    if (focused) ok++
    else { fail++; if (fails.length < 12) fails.push(`(${Math.round(x)},${Math.round(y)})`) }
  }
}
console.log(`点击矩阵: 成功 ${ok} / 失败 ${fail}`)
console.log('失败点位:', fails.join(' '))
await b.close()
