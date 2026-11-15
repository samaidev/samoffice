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
  // 找表格区上方段落
  let target = null
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (r.y > 100 && r.y < 400 && el.textContent.trim().length > 5) { target = { x: r.x + 80, y: r.y + r.height / 2, text: el.textContent.slice(0, 10), rect: { y: Math.round(r.y), h: Math.round(r.height) } }; break }
  }
  const hit = document.elementFromPoint(target.x, target.y)
  const chain = []
  let n = hit
  for (let i = 0; i < 8 && n; i++) {
    const r = n.getBoundingClientRect?.()
    chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 40), rect: r ? { y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width) } : null, pos: getComputedStyle(n).position, pe: getComputedStyle(n).pointerEvents })
    n = n.parentElement
  }
  return { target, chain }
})
console.log('目标段落:', JSON.stringify(info.target))
console.log('命中链:')
info.chain.forEach((c, i) => console.log(`  ${i}. ${c.tag}.${c.cls} rect=${JSON.stringify(c.rect)} pos=${c.pos} pe=${c.pe}`))
await b.close()
