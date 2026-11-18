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
  for (const type of ['mousedown', 'mouseup', 'click', 'pointerdown']) {
    document.addEventListener(type, (e) => {
      window.__evts.push(type + '@' + e.target.tagName + (e.defaultPrevented ? '[PD]' : ''))
    }, true)
  }
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
})
console.log('click box:', JSON.stringify(box))
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
const r1 = await p.evaluate(() => ({ evts: window.__evts, active: document.activeElement?.tagName }))
console.log('after mouse.click:', JSON.stringify(r1))
// 若事件到了但被 preventDefault —— 用 CDP 绕过 Playwright 层试试
if (r1.evts.length === 0) {
  const cdp = await p.context().newCDPSession(p)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await p.waitForTimeout(400)
  const r2 = await p.evaluate(() => ({ evts: window.__evts, active: document.activeElement?.tagName }))
  console.log('after CDP click:', JSON.stringify(r2))
}
await b.close()
