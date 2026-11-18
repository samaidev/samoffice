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
  window.__n = 0
  document.addEventListener('mousedown', () => window.__n++, true)
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)

const cellCenter = () => p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[20]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
const testClick = async (label) => {
  const box = await cellCenter()
  const before = await p.evaluate(() => window.__n)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  const after = await p.evaluate(() => window.__n)
  console.log(label, after > before ? '✓ 收到' : '✗ 丢失')
}

await testClick('基线(原样式):')
// A: border-collapse separate
await p.evaluate(() => { document.querySelector('table').style.borderCollapse = 'separate' })
await p.waitForTimeout(200)
await testClick('A border-separate:')
await p.evaluate(() => { document.querySelector('table').style.borderCollapse = '' })
// B: table-layout auto
await p.evaluate(() => { document.querySelector('table').style.tableLayout = 'auto' })
await p.waitForTimeout(200)
await testClick('B layout-auto:')
await p.evaluate(() => { document.querySelector('table').style.tableLayout = '' })
// C: 去 colgroup
await p.evaluate(() => { document.querySelector('table colgroup')?.remove() })
await p.waitForTimeout(200)
await testClick('C 无colgroup:')
// D: wrapper transform translateZ(0)（强制提升）
await p.evaluate(() => { document.querySelector('.tableWrapper').style.transform = 'translateZ(0)' })
await p.waitForTimeout(200)
await testClick('D wrapper提升:')
await p.evaluate(() => { document.querySelector('.tableWrapper').style.transform = '' })
await b.close()
