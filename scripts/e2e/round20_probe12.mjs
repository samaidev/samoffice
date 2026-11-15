// 无 fixed 层。但死区从 y≈550 开始 —— 大概是视口下半。
// 检查点 (700, 700) 的 elementsFromPoint 完整堆栈 + z-index：
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
const stack = await p.evaluate(() => {
  const els = document.elementsFromPoint(700, 700)
  return els.slice(0, 8).map(e => {
    const s = getComputedStyle(e)
    return `${e.tagName}.${(e.className?.toString().slice(0, 30) || '')} pe=${s.pointerEvents} z=${s.zIndex} pos=${s.position}`
  })
})
console.log('(700,700) 堆栈:')
stack.forEach(s => console.log(' ', s))
await b.close()
