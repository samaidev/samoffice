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
const layout = await p.evaluate(() => {
  const sc = document.querySelector('.flex-1.overflow-auto')
  const pm = window.__pmView
  const pmR = pm.dom.getBoundingClientRect()
  const scR = sc.getBoundingClientRect()
  const firstP = document.querySelector('.ProseMirror p')
  return {
    scrollContainer: { top: Math.round(scR.top), h: Math.round(scR.height), scrollTop: sc.scrollTop, scrollH: sc.scrollHeight },
    pmRoot: { top: Math.round(pmR.top), y: Math.round(pmR.y) },
    firstVisibleP: (() => {
      for (const el of document.querySelectorAll('.ProseMirror p')) {
        const r = el.getBoundingClientRect()
        if (r.y > 100 && r.y < 400 && el.textContent.trim().length > 5) return { y: Math.round(r.y), text: el.textContent.slice(0, 8) }
      }
      return null
    })(),
    // 滚动容器上方还有哪些元素
    overlays: (() => {
      const out = []
      for (const el of document.querySelectorAll('div, header, main')) {
        const s = getComputedStyle(el)
        if ((s.position === 'fixed' || s.position === 'sticky') && el.getBoundingClientRect().height > 20) {
          out.push({ tag: el.tagName, cls: String(el.className).slice(0, 30), pos: s.position, y: Math.round(el.getBoundingClientRect().y), h: Math.round(el.getBoundingClientRect().height) })
        }
      }
      return out.slice(0, 6)
    })(),
  }
})
console.log(JSON.stringify(layout, null, 1))
await b.close()
