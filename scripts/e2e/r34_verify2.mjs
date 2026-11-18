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
// window 级监听所有指针事件（capture）—— 记录第一次点击丢到哪
await p.evaluate(() => {
  window.__win = []
  for (const t of ['mousedown', 'pointerdown']) {
    window.addEventListener(t, (e) => {
      window.__win.push(t + ' target=' + e.target.tagName + '.' + (typeof e.target.className === 'string' ? e.target.className : ''))
    }, true)
  }
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
const w = await p.evaluate(() => window.__win)
console.log('window 收到:', JSON.stringify(w))
await b.close()
