import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('console', (m) => { const t = m.text(); if (t.includes('TRACE')) console.log(t.slice(0, 600)) })
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
// monkeypatch：dispatch + removeAllRanges + PM selection setter
await p.evaluate(() => {
  const v = window.__pmView
  if (v) {
    const origDispatch = v.dispatch.bind(v)
    v.dispatch = (tr) => {
      const pos = tr.selectionSet ? tr.selection.$anchor?.pos : -1
      if (typeof pos === 'number' && pos > 9000) {
        console.log('TRACE PM dispatch pos=' + pos + ' stack=' + (new Error().stack || '').split('\n').slice(1, 5).join(' << '))
      }
      origDispatch(tr)
    }
  }
  const selProto = Selection.prototype
  const origRemove = selProto.removeAllRanges
  selProto.removeAllRanges = function (...a) {
    const info = this.focusNode?.textContent?.slice(0, 8) || String(this.focusNode)
    console.log('TRACE removeAllRanges (focus was: ' + info + ') stack=' + (new Error().stack || '').split('\n').slice(1, 4).join(' << '))
    return origRemove.apply(this, a)
  }
})
const box = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(700)
const fin = await p.evaluate(() => {
  const sel = window.getSelection()
  const td = sel?.focusNode?.parentElement?.closest('td, th')
  return { cell: (td?.textContent || '【表格外】').slice(0, 8) }
})
console.log('结果:', JSON.stringify(fin))
await b.close()
