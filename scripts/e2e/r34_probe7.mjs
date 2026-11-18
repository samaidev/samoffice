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
  document.addEventListener('mousedown', (e) => window.__evts.push('md@' + e.target.tagName), true)
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
// 实验 A：点击前强制 1px 滚动再回（触发新合成帧）
await p.evaluate(() => {
  const sc = document.querySelector('.overflow-auto')
  sc.scrollTop += 1
  return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => { sc.scrollTop -= 1; res() })))
})
await p.waitForTimeout(300)
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
const a = await p.evaluate(() => ({ evts: window.__evts.slice(0, 4), active: document.activeElement?.tagName, scrollDrift: null }))
console.log('A force-frame+click:', JSON.stringify(a))
await b.close()
