import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
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
  window.__evts = []
  document.addEventListener('mousedown', (e) => window.__evts.push('md@' + e.target.tagName + '.' + (typeof e.target.className === 'string' ? e.target.className.split(' ')[0] : '')), true)
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 1) 点击表格上方的普通段落（同滚动区域）
const para = await p.evaluate(() => {
  const table = document.querySelector('table')
  // 表格前面最近的段落
  let el = table.closest('.ProseMirror')
  const ps = el.querySelectorAll('p')
  let target = null
  for (const pp of ps) { const r = pp.getBoundingClientRect(); if (r.y > 100 && r.y < 700 && r.height > 5) { target = { x: r.x + 40, y: r.y + r.height / 2 }; break } }
  return target
})
if (para) {
  await p.mouse.click(para.x, para.y)
  await p.waitForTimeout(300)
  const r1 = await p.evaluate(() => ({ evts: window.__evts.slice(0, 3), active: document.activeElement?.tagName }))
  console.log('点击普通段落:', JSON.stringify(r1))
}
// 2) 点击表格下方 300px 处（空白/段落）
const below = await p.evaluate(() => {
  const table = document.querySelector('table')
  const r = table.getBoundingClientRect()
  return { x: r.x + 100, y: r.y + r.height + 100 }
})
await p.mouse.click(below.x, below.y)
await p.waitForTimeout(300)
const r2 = await p.evaluate(() => ({ evts: window.__evts.slice(-3), active: document.activeElement?.tagName }))
console.log('点击表格下方:', JSON.stringify(r2))
// 3) 再点表格 cell
const cell = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[20]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(cell.x, cell.y)
await p.waitForTimeout(300)
const r3 = await p.evaluate(() => ({ evts: window.__evts.slice(-3), active: document.activeElement?.tagName }))
console.log('点击表格 cell:', JSON.stringify(r3))
await b.close()
