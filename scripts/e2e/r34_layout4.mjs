import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 200)))
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
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
await p.evaluate(() => {
  window.__ev = []
  const sc = document.querySelector('.overflow-auto')
  sc.addEventListener('scroll', () => {
    window.__ev.push({ t: Date.now() % 100000, kind: 'scroll', top: Math.round(sc.scrollTop) })
  }, { passive: true, capture: true })
  // 捕获各关键事件
  for (const k of ['mousedown', 'focusin', 'focus', 'selectionchange']) {
    window.addEventListener(k, () => {
      window.__ev.push({ t: Date.now() % 100000, kind: k, active: document.activeElement?.tagName + '.' + (typeof document.activeElement.className === 'string' ? document.activeElement.className.split(' ')[0] : '') })
    }, k === 'focus' || k === 'selectionchange' ? true : true)
  }
})
const spot = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[9]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(spot.x, spot.y)
await p.waitForTimeout(1200)
const ev = await p.evaluate(() => window.__ev.slice(0, 25))
console.log('事件序列:')
for (const e of ev) console.log(' ', JSON.stringify(e))
await b.close()
