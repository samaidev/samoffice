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
  // 所有可见'表1'段落（可能有重名）
  const found = []
  for (const el of document.querySelectorAll('.ProseMirror p')) {
    const r = el.getBoundingClientRect()
    if (el.textContent.includes('参数模拟') && r.y > -100 && r.y < 900) {
      // 是否在滚动容器内
      const sc = document.querySelector('.flex-1.overflow-auto')
      const inScroll = sc.contains(el)
      // offsetParent 链
      const chain = []
      let n = el.parentElement
      for (let i = 0; i < 4 && n; i++) { chain.push(n.tagName + '.' + String(n.className).slice(0, 25)); n = n.parentElement }
      found.push({ y: Math.round(r.y), x: Math.round(r.x), text: el.textContent.slice(0, 10), inScroll, chain })
    }
  }
  return found
})
console.log('可见的表1段落:', JSON.stringify(info, null, 1))
await b.close()
