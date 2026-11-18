import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const headed = process.env.HEADED === '1'
const b = await chromium.launch({ args: ['--no-sandbox'], headless: !headed })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/upload-test.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'upload-test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(9000)
await p.evaluate(() => {
  window.__md = null
  document.addEventListener('mousedown', (e) => { window.__md = 'got@' + e.target.tagName }, true)
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
const box = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[20]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
const r1 = await p.evaluate(() => window.__md || '✗丢失')
// 段落对照
await p.evaluate(() => { window.__md = null })
const para = await p.evaluate(() => {
  const ps = document.querySelectorAll('.ProseMirror p')
  for (const pp of ps) { const r = pp.getBoundingClientRect(); if (r.y > 400 && r.y < 750 && r.height > 5) return { x: r.x + 60, y: r.y + r.height / 2 } }
  return null
})
let r2 = 'no-para'
if (para) {
  await p.mouse.click(para.x, para.y)
  await p.waitForTimeout(300)
  r2 = await p.evaluate(() => window.__md || '✗丢失')
}
console.log((headed ? '[headed]' : '[headless]'), '表格:', r1, '| 段落:', r2)
await b.close()
