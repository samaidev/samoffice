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
// 观察：PM class 变化（pg-measuring 挂载）+ wrap 位移时间线
await p.evaluate(() => {
  window.__cls = []
  const pm = document.querySelector('.ProseMirror')
  new MutationObserver(() => {
    window.__cls.push({ t: Date.now() % 100000, cls: pm.className })
  }).observe(pm, { attributes: true, attributeFilter: ['class'] })
  window.__wrapY = []
  const wrap = document.querySelector('.tableWrapper')
  window.__lastY = Math.round(wrap.getBoundingClientRect().y)
  setInterval(() => {
    const y = Math.round(wrap.getBoundingClientRect().y)
    if (y !== window.__lastY) { window.__lastY = y; window.__wrapY.push({ t: Date.now() % 100000, y }) }
  }, 8)
})
const spot = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[9]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(spot.x, spot.y)
await p.waitForTimeout(1500)
const out = await p.evaluate(() => ({ cls: window.__cls.slice(0, 10), wrapY: window.__wrapY.slice(0, 20) }))
console.log('PM class 变化:', JSON.stringify(out.cls))
console.log('wrapper Y 轨迹:', JSON.stringify(out.wrapY))
await b.close()
