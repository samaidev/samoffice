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
// 轮询探针：记录 selection 每次变化（含时间戳）
await p.evaluate(() => {
  window.__log = []
  const read = () => {
    const sel = window.getSelection()
    const td = sel?.focusNode?.parentElement?.closest('td, th')
    return { t: Date.now() % 100000, cell: (td?.textContent || 'out').slice(0, 6), anchor: window.__pmView?.state?.selection?.$anchor?.pos }
  }
  window.__last = JSON.stringify(read())
  setInterval(() => {
    const now = JSON.stringify(read())
    if (now !== window.__last) { window.__last = now; window.__log.push(now) }
  }, 8)
})
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(600)
const log = await p.evaluate(() => window.__log)
console.log('selection 变化轨迹:')
for (const l of log) console.log(' ', l)
await b.close()
