import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 200)))
p.on('console', (m) => { if (m.text().includes('[bridge]')) console.log(m.text().slice(0, 150)) })
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
  window.__rebuilds = 0
  const tb = document.querySelector('table tbody')
  new MutationObserver((muts) => { for (const m of muts) if (m.addedNodes.length > 2 || m.removedNodes.length > 2) window.__rebuilds++ }).observe(tb, { childList: true, subtree: true })
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(1000)
const cellBox = (i) => p.evaluate((idx) => {
  const c = document.querySelectorAll('table td, table th')[idx]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, i)

// 1) 拖选：idx1 中心 → idx6 中心（跨两行）
const a = await cellBox(1), c = await cellBox(6)
await p.mouse.move(a.x, a.y)
await p.mouse.down()
await p.mouse.move(c.x, c.y, { steps: 8 })
await p.mouse.up()
await p.waitForTimeout(400)
const drag = await p.evaluate(() => {
  const sel = window.getSelection()
  return { text: (sel?.toString() || '').slice(0, 30), collapsed: sel?.isCollapsed }
})
console.log('拖选:', JSON.stringify(drag))

// 2) 双击选词：idx9（"[10 000, 20 000]" 内数字）
const b9 = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[9]
  const r = c.getBoundingClientRect()
  return { x: r.x + 14, y: r.y + r.height / 2 }
})
await p.mouse.click(b9.x, b9.y)
await p.waitForTimeout(100)
await p.mouse.click(b9.x, b9.y)
await p.waitForTimeout(400)
const dbl = await p.evaluate(() => {
  const sel = window.getSelection()
  return { text: (sel?.toString() || '').slice(0, 20) }
})
console.log('双击选词:', JSON.stringify(dbl))

// 3) 三击选格
await p.mouse.click(b9.x, b9.y, { delay: 30 })
await p.mouse.click(b9.x, b9.y, { delay: 30 })
await p.mouse.click(b9.x, b9.y, { delay: 30 })
await p.waitForTimeout(400)
const tri = await p.evaluate(() => {
  const sel = window.getSelection()
  return { text: (sel?.toString() || '').slice(0, 20) }
})
console.log('三击选格:', JSON.stringify(tri))

// 4) 点击后打字（先单击清选区）
const t = await cellBox(20)
await p.mouse.click(t.x, t.y)
await p.waitForTimeout(300)
await p.keyboard.type('XY')
await p.waitForTimeout(400)
const typed = await p.evaluate(() => (document.querySelectorAll('table td, table th')[20].textContent || '').slice(0, 10))
console.log('点击+打字:', typed)

// 5) 零重建
const rb = await p.evaluate(() => window.__rebuilds)
console.log('tbody 大突变(全表刷新):', rb, '次')
await b.close()
