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
  let pEl = null
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (el.textContent.includes('参数模拟') && r.y > 100 && r.y < 400) { pEl = el; break }
  }
  const chain = []
  let n = pEl
  for (let i = 0; i < 7 && n; i++) {
    const s = getComputedStyle(n)
    const r = n.getBoundingClientRect()
    chain.push({
      tag: n.tagName, cls: String(n.className).slice(0, 22),
      rectY: Math.round(r.y), offTop: n.offsetTop,
      mt: s.marginTop, tf: s.transform !== 'none' ? s.transform.slice(0, 24) : '-', contain: s.contain, z: s.zIndex,
    })
    n = n.parentElement
  }
  return chain
})
console.log('位移源分析:')
info.forEach((c, i) => console.log(' ', JSON.stringify(c)))
await b.close()
