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
await p.evaluate(() => { const sc = window.__pmView.dom.closest('[class*="overflow"]'); sc.scrollTo({ top: 10230 }) })
await p.waitForTimeout(2000)
const info = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const sc = pm.closest('[class*="overflow"]')
  const parent = sc.parentElement
  const pr = parent.getBoundingClientRect()
  // sc 的兄弟（可能与 sc 重叠）
  const sibs = []
  for (const sib of parent.children) {
    const r2 = sib.getBoundingClientRect()
    sibs.push({ cls: String(sib.className).slice(0, 30), y: Math.round(r2.y), h: Math.round(r2.height), w: Math.round(r2.width), x: Math.round(r2.x) })
  }
  return {
    parent: { tag: parent.tagName, cls: String(parent.className).slice(0, 40), y: Math.round(pr.y), h: Math.round(pr.height) },
    scRect: { y: Math.round(sc.getBoundingClientRect().y), h: Math.round(sc.getBoundingClientRect().height) },
    sibs,
  }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
