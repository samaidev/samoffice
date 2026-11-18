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
// 真实 dispatch（页面侧模拟 bridge 的完整单击链）+ focus + DOM selection
const res = await p.evaluate(() => {
  const v = window.__pmView
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  const layers = Array.from(document.querySelectorAll('.pm-table-clickbridge'))
  const saved = layers.map(l => l.style.pointerEvents)
  layers.forEach(l => { l.style.pointerEvents = 'none' })
  const cr = document.caretRangeFromPoint(x, y)
  layers.forEach((l, i) => { l.style.pointerEvents = saved[i] })
  if (!cr) return { err: 'no caret' }
  // PM selection
  const pmPos = v.posAtDOM(cr.startContainer, cr.startOffset)
  const before = v.state.selection.$anchor.pos
  v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(pmPos), 1)))
  const after = v.state.selection.$anchor.pos
  // DOM selection
  const range = document.createRange()
  range.setStart(cr.startContainer, cr.startOffset)
  range.collapse(true)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  v.focus()
  return { before, after, pmPos }
})
console.log('dispatch 结果:', JSON.stringify(res))
await p.waitForTimeout(300)
const after = await p.evaluate(() => {
  const sel = window.getSelection()
  const td = sel?.focusNode?.parentElement?.closest('td, th')
  const v = window.__pmView
  return { domCell: (td?.textContent || '【表格外】').slice(0, 10), pmPos: v.state.selection.$anchor.pos }
})
console.log('300ms 后状态:', JSON.stringify(after))
// 再来真实点击（桥自己跑）
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(500)
const r2 = await p.evaluate(() => {
  const sel = window.getSelection()
  const td = sel?.focusNode?.parentElement?.closest('td, th')
  return { cell: (td?.textContent || '【表格外】').slice(0, 10) }
})
console.log('桥真实点击:', JSON.stringify(r2))
await b.close()
