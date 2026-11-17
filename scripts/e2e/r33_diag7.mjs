import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('PAGEERR: ' + e.message.slice(0, 250)))
p.on('console', (m) => { const t = m.text(); if (t.includes('PAGINATION_SKIP') || t.includes('dispatch')) console.log('LOG: ' + t.slice(0, 120)) })
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
// 追踪点击时序：instrument PM dispatch + 表格 DOM 重建
await p.evaluate(() => {
  window.__evts = []
  const view = window.__pmView
  if (view) {
    const origDispatch = view.dispatch.bind(view)
    view.dispatch = (tr) => {
      window.__evts.push({ t: 'dispatch', step: tr.docChanged ? 'doc' : 'meta', sel: tr.selectionSet ? JSON.stringify(tr.selection.$anchor.pos) : '' })
      origDispatch(tr)
    }
  }
  // 监听表格 tbody 子树变化（重建检测）
  const tb = document.querySelector('table tbody')
  if (tb) {
    new MutationObserver((muts) => {
      window.__evts.push({ t: 'tbodyMut', adds: muts.filter(m => m.addedNodes.length).length, removes: muts.filter(m => m.removedNodes.length).length, ts: Date.now() % 100000 })
    }).observe(tb, { childList: true, subtree: true })
  }
  const w = document.querySelector('table')
  if (w) {
    new MutationObserver(() => { window.__evts.push({ t: 'tblAttr', ts: Date.now() % 100000 }) }).observe(w, { attributes: true, attributeFilter: ['style', 'class'] })
  }
})
// 点击 idx20（行5 "a"）
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (cell.textContent || '').slice(0, 6) }
})
console.log('点击 idx20:', JSON.stringify(box))
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(800)
const out = await p.evaluate(() => {
  const sel = window.getSelection()
  const td = sel?.focusNode?.parentElement?.closest('td, th')
  return {
    finalCell: (td?.textContent || '【表格外】').slice(0, 10),
    events: window.__evts.slice(0, 25),
  }
})
console.log('最终光标格:', out.finalCell)
console.log('事件序列:')
for (const e of out.events) console.log(' ', JSON.stringify(e))
await b.close()
