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
// 三击（快速）
for (let i = 0; i < 3; i++) { await p.mouse.click(spot.x, spot.y, { delay: 20 }); await p.waitForTimeout(70) }
await p.waitForTimeout(400)
const tri = await p.evaluate(() => {
  const v = window.__pmView
  const sel = window.getSelection()
  const pmPos = v.state.selection.$anchor.pos
  const pmText = v.state.doc.textBetween(v.state.selection.from, v.state.selection.to) || ''
  return { domText: (sel?.toString() || '').slice(0, 14), pmText: pmText.slice(0, 14), pmPos, from: v.state.selection.from, to: v.state.selection.to }
})
console.log('三击: dom=' + JSON.stringify(tri.domText) + ' pm=' + JSON.stringify(tri.pmText) + ' (期望 ' + JSON.stringify(spot.text) + ')')
// 双击（真实 dblclick）
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(300)
const w = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[1]
  const tn = (function ft(el) { for (const n of el.childNodes) { if (n.nodeType === 3 && n.textContent.trim()) return n; const r = ft(n); if (r) return r } return null })(c)
  const range = document.createRange(); range.selectNodeContents(tn || c)
  const r = range.getBoundingClientRect()
  return { x: r.x + 8, y: r.y + r.height / 2 }
})
await p.mouse.dblclick(w.x, w.y)
await p.waitForTimeout(400)
const dbl = await p.evaluate(() => {
  const v = window.__pmView
  const sel = window.getSelection()
  return { domText: (sel?.toString() || '').slice(0, 14), pmText: (v.state.doc.textBetween(v.state.selection.from, v.state.selection.to) || '').slice(0, 14) }
})
console.log('双击: dom=' + JSON.stringify(dbl.domText) + ' pm=' + JSON.stringify(dbl.pmText))
// 连续点 5 格（不同格）后光标都在正确格（验证无跳动累积）
const results = []
for (const idx of [20, 4, 30, 1, 9]) {
  const bb = await p.evaluate((i) => {
    const c = document.querySelectorAll('table td, table th')[i]
    const r = c.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, idx)
  await p.mouse.click(bb.x, bb.y)
  await p.waitForTimeout(200)
  const cell = await p.evaluate(() => {
    const sel = window.getSelection()
    const td = sel?.focusNode?.parentElement?.closest('td, th')
    return (td?.textContent || 'X').slice(0, 8)
  })
  results.push(cell)
}
console.log('连续5格:', JSON.stringify(results))
await b.close()
