// 只看到了 clip 链尾部 —— 需要完整输出。重跑并打印全部：
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
const geo = await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const r = sc.getBoundingClientRect()
  const pm = document.querySelector('.ProseMirror')
  const pr = pm.getBoundingClientRect()
  return { scroller: { y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom), ch: sc.clientHeight }, pmRect: { y: Math.round(pr.y), h: Math.round(pr.height) } }
})
console.log('scroller:', JSON.stringify(geo.scroller), 'pm:', JSON.stringify(geo.pmRect))
await b.close()
