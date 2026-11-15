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
await p.evaluate(() => { const sc = document.querySelector('.flex-1.overflow-auto'); sc.scrollTo({ top: 10230 }) })
await p.waitForTimeout(2000)
const info = await p.evaluate(() => {
  const out = []
  // 滚动容器可视区上下 100px 内的所有 PM 块级子元素 + 装饰信息
  const pm = window.__pmView.dom
  for (const el of pm.children) {
    const r = el.getBoundingClientRect()
    if (r.y > 100 && r.y < 500) {
      const s = getComputedStyle(el)
      out.push({
        tag: el.tagName, cls: String(el.className).slice(0, 30), text: (el.textContent || '').slice(0, 8),
        y: Math.round(r.y), h: Math.round(r.height),
        marginTop: s.marginTop, marginBottom: s.marginBottom,
        pos: s.position, top: s.top,
      })
    }
  }
  return out
})
console.log('视口上沿的块（y 100-500）:')
info.forEach(o => console.log(' ', JSON.stringify(o)))
await b.close()
