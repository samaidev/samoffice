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
const info = await p.evaluate(() => {
  const pm = window.__pmView.dom
  // PM 的滚动祖先链
  const chain = []
  let n = pm.parentElement
  while (n && n !== document.body) {
    const s = getComputedStyle(n)
    if (s.overflow !== 'visible' || s.position === 'sticky' || s.position === 'fixed') {
      const r = n.getBoundingClientRect()
      chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 35), overflow: s.overflow, pos: s.position, rect: { y: Math.round(r.y), h: Math.round(r.height), x: Math.round(r.x), w: Math.round(r.width) }, st: n.scrollTop })
    }
    n = n.parentElement
  }
  return chain
})
console.log('PM 的滚动祖先链:', JSON.stringify(info, null, 1))
await b.close()
