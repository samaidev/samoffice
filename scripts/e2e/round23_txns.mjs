import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(25000)
await p.goto('http://localhost:18400', { waitUntil: 'networkidle' })
await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1000)
const buf = fs.readFileSync(DOC)
const form = new FormData()
form.append('file', new Blob([buf]), 'contract.docx')
const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form })
const j = await r.json()
await p.evaluate(d => window.__setDocForTest(d), j.document)
await p.waitForTimeout(6000)
await p.evaluate(() => {
  window.__txnLog = []
  const pm = window.__pmView
  const orig = pm.dispatch.bind(pm)
  pm.dispatch = (tr) => {
    window.__txnLog.push(Object.keys(tr.meta).join(',') || '(no-meta)')
    return orig(tr)
  }
})
const pt = await p.evaluate(() => {
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 300 && r.y < 600 && el.textContent.trim().length > 5) return { x: r.x + 40, y: r.y + r.height / 2 }
  }
})
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(400)
await p.evaluate(() => { window.__txnLog = [] })
await p.keyboard.type('ab', { delay: 200 })
await p.waitForTimeout(2000)
const log = await p.evaluate(() => window.__txnLog.slice())
const counts = {}
log.forEach(m => { counts[m] = (counts[m] || 0) + 1 })
console.log('2 键事务序列（分组计数）:')
Object.entries(counts).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log(`  ${v}x ${k}`))
console.log('总事务:', log.length)
await b.close()
