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
  window.__md = null
  document.addEventListener('mousedown', (e) => { window.__md = 'got@' + e.target.tagName + '/' + (e.target.nodeName === '#text' ? 'TEXT' : (e.target.firstChild?.nodeName || '-')) }, true)
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 取 idx20 cell 的【文字 span 精确位置】与【cell 右侧空白区】
const spots = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[20]
  const cr = cell.getBoundingClientRect()
  // 文字节点位置
  const pEl = cell.querySelector('p') || cell
  const range = document.createRange()
  const tn = (function findText(el) { for (const n of el.childNodes) { if (n.nodeType === 3 && n.textContent.trim()) return n; const r = findText(n); if (r) return r } return null })(pEl)
  let textSpot = null
  if (tn) { range.selectNodeContents(tn); const tr = range.getBoundingClientRect(); textSpot = { x: tr.x + Math.min(5, tr.width / 2), y: tr.y + tr.height / 2 } }
  return {
    text: textSpot,
    padding: { x: cr.right - 5, y: cr.y + cr.height / 2 },
    cellRect: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) },
    hasText: !!tn,
  }
})
console.log('文字点:', JSON.stringify(spots.text), '空白点:', JSON.stringify(spots.padding))
await p.evaluate(() => { window.__md = null })
if (spots.text) {
  await p.mouse.click(spots.text.x, spots.text.y)
  await p.waitForTimeout(300)
  const r1 = await p.evaluate(() => ({ md: window.__md, sel: window.getSelection()?.rangeCount ? (window.getSelection().focusNode?.textContent || '').slice(0, 6) : '无' }))
  console.log('点【文字】:', JSON.stringify(r1))
}
await p.evaluate(() => { window.__md = null })
await p.mouse.click(spots.padding.x, spots.padding.y)
await p.waitForTimeout(300)
const r2 = await p.evaluate(() => ({ md: window.__md }))
console.log('点【空白】:', JSON.stringify(r2))
await b.close()
