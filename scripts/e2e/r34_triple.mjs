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
const spot = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[9]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (c.textContent || '').slice(0, 12) }
})
// 三连击（每击间隔 ~80ms —— 在 500ms 窗口内）
for (let i = 0; i < 3; i++) {
  await p.mouse.click(spot.x, spot.y, { delay: 20 })
  await p.waitForTimeout(60)
  const drift = await p.evaluate(() => {
    const sc = document.querySelector('.overflow-auto')
    const td = document.querySelectorAll('table td, table th')[9]
    const r = td.getBoundingClientRect()
    return { scrollTop: Math.round(sc.scrollTop), cellY: Math.round(r.y) }
  })
  console.log(`击${i + 1}后:`, JSON.stringify(drift))
}
await p.waitForTimeout(500)
const tri = await p.evaluate(() => {
  const sel = window.getSelection()
  return { text: JSON.stringify(sel?.toString() || '').slice(0, 40), collapsed: sel?.isCollapsed }
})
console.log('三击选格:', JSON.stringify(tri), '（期望:', JSON.stringify(spot.text), '）')
const blog = await p.evaluate(() => (window).__bridgeLog || [])
console.log('bridge 日志:')
for (const l of blog) console.log(' ', l)
await b.close()
