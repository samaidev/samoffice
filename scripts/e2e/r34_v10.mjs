import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('console', (m) => { if (m.text().includes('[bridge]')) console.log('PAGE:', m.text().slice(0, 120)) })
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
// 点击前后时间线采样（在页面里自采，避免 evaluate 往返延迟）
await p.evaluate(() => {
  window.__samples = []
  const read = () => {
    const sel = window.getSelection()
    const v = window.__pmView
    return {
      t: Date.now() % 100000,
      domCell: (sel?.focusNode?.parentElement?.closest?.('td, th')?.textContent || 'out').slice(0, 6),
      pmPos: v?.state?.selection?.$anchor?.pos,
      ranges: sel?.rangeCount,
    }
  }
  ;[0, 30, 80, 150, 250, 400, 600].forEach(ms => setTimeout(() => window.__samples.push(read()), ms))
})
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
const samples = await p.evaluate(() => window.__samples)
console.log('时间线采样:')
for (const s of samples) console.log(' ', JSON.stringify(s))
await b.close()
