import { chromium } from 'playwright'
import fs from 'fs'
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: false })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(20000)
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
await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const td = document.querySelector('.ProseMirror table td')
  const scRect = sc.getBoundingClientRect()
  const tdTop = td.getBoundingClientRect().top
  sc.scrollTop += tdTop - scRect.top - 300
})
await p.waitForTimeout(1500)
const info = await p.evaluate(() => {
  // 谁在用 drop-shadow 类？
  const els = document.querySelectorAll('.drop-shadow')
  const list = Array.from(els).slice(0, 5).map(e => {
    const r = e.getBoundingClientRect()
    const s = getComputedStyle(e)
    return `${e.tagName}.${(e.className?.toString().slice(0, 30) || '')} filter=${s.filter.slice(0, 40)} y=${Math.round(r.y)} h=${Math.round(r.height)}`
  })
  // 表格祖先有 filter 吗
  const td = document.querySelector('.ProseMirror table td')
  const filters = []
  let n = td
  while (n && n !== document.body) {
    const f = getComputedStyle(n).filter
    if (f !== 'none') filters.push(`${n.tagName}.${(n.className?.toString().slice(0, 25) || '')}:${f.slice(0, 50)}`)
    n = n.parentElement
  }
  return { dropShadowCount: els.length, list, tableFilterAncestors: filters }
})
console.log(JSON.stringify(info, null, 1).slice(0, 900))
await b.close()
