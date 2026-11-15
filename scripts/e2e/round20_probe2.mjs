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

const st = await p.evaluate(() => {
  const td = document.querySelector('.ProseMirror table td')
  if (!td) return { tdCount: 0 }
  td.setAttribute('data-probe', '1')
  const r2 = td.getBoundingClientRect()
  return { tdCount: document.querySelectorAll('.ProseMirror table td').length, y: Math.round(r2.y) }
})
console.log('探针状态:', JSON.stringify(st))

await p.evaluate(() => {
  const el = document.querySelector('[data-probe]')
  if (el) el.scrollIntoView({ block: 'center' })
})
const out = []
for (let i = 0; i < 5; i++) {
  await p.waitForTimeout(400)
  const c = await p.evaluate(() => {
    const el = document.querySelector('[data-probe]')
    return el ? 'y=' + Math.round(el.getBoundingClientRect().y) : 'GONE'
  })
  out.push(`t${(i + 1) * 0.4}s:${c}`)
}
console.log(out.join(' | '))
await b.close()
