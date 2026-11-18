import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('PAGEERR:', e.message.slice(0, 300)))
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
// 逐步重现 bridge 的单击逻辑（页面 evaluate 直接跑）
const steps = await p.evaluate(() => {
  const out = {}
  const v = window.__pmView
  if (!v) return { err: 'no view' }
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  // 1) 禁桥层
  const layers = Array.from(document.querySelectorAll('.pm-table-clickbridge'))
  const saved = layers.map(l => l.style.pointerEvents)
  layers.forEach(l => { l.style.pointerEvents = 'none' })
  let cr = null
  try { cr = document.caretRangeFromPoint(x, y) } catch (e) { out.caretErr = String(e).slice(0, 80) }
  layers.forEach((l, i) => { l.style.pointerEvents = saved[i] })
  out.caretNode = cr ? cr.startContainer.nodeName + ':' + (cr.startContainer.textContent || '').slice(0, 8) : 'null'
  out.caretOffset = cr?.startOffset
  // 2) posAtDOM
  if (cr) {
    try { out.pmPos = v.posAtDOM(cr.startContainer, cr.startOffset) } catch (e) { out.pmPosErr = String(e).slice(0, 100) }
  }
  // 3) PM selection 构造
  if (typeof out.pmPos === 'number') {
    try {
      const tr = v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(Math.min(out.pmPos, v.state.doc.content.size)), 1))
      out.selOk = true
    } catch (e) { out.selErr = String(e).slice(0, 100) }
  }
  return out
})
console.log('bridge 逻辑分步:', JSON.stringify(steps))
// 然后真实点击第一次
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(500)
const r1 = await p.evaluate(() => {
  const sel = window.getSelection()
  const td = sel?.focusNode?.parentElement?.closest('td, th')
  return { cell: (td?.textContent || '【表格外】').slice(0, 10) }
})
console.log('真实第一次点击:', JSON.stringify(r1))
await b.close()
