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
await p.waitForTimeout(2500)
const info = await p.evaluate(() => {
  // y=110-180 的元素是什么
  const hits = []
  for (const y of [115, 140, 165, 180, 210, 250]) {
    const el = document.elementFromPoint(500, y)
    if (el) {
      // 找它的 ProseMirror 根与 refScope
      const scope = el.closest('[ref-scope]')
      const pmRoot = el.closest('.ProseMirror')
      const editable = el.isContentEditable
      hits.push({ y, tag: el.tagName, cls: String(el.className).slice(0, 25), ce: editable, scope: scope?.getAttribute('ref-scope') || '-', inPM: !!pmRoot, pmIsMain: pmRoot === window.__pmView.dom })
    }
  }
  // 有几个 .ProseMirror 实例
  const pmCount = document.querySelectorAll('.ProseMirror').length
  return { hits, pmCount }
})
console.log('PM 实例数:', info.pmCount)
console.log('y 采样命中:')
info.hits.forEach(h2 => console.log(' ', JSON.stringify(h2)))
await b.close()
