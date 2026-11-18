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
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 放一个全屏 catcher（fixed, inset 0, z 99999）监听 mousedown
await p.evaluate(() => {
  window.__catch = []
  const d = document.createElement('div')
  d.id = 'r34-catcher'
  d.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:auto'
  d.addEventListener('mousedown', (e) => { window.__catch.push('catcher@' + e.clientX + ',' + e.clientY) })
  document.body.appendChild(d)
})
const cell = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[20]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(cell.x, cell.y)
await p.waitForTimeout(300)
const r1 = await p.evaluate(() => window.__catch.slice(0, 3))
console.log('catcher 收到:', JSON.stringify(r1), r1.length ? '→ 输入管线活着，表格区命中被劫持' : '→ 视口级输入死亡')
await p.evaluate(() => document.getElementById('r34-catcher').remove())
await b.close()
