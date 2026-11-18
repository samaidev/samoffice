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
// 1) 桥层存在吗？
const state = await p.evaluate(() => ({
  layerCount: document.querySelectorAll('.pm-table-clickbridge').length,
  bridgeFlag: window.__samTableBridge,
  hasView: !!window.__pmView,
}))
console.log('桥状态:', JSON.stringify(state))
// 2) 手动派发合成 mousedown（页面坐标在 idx0）—— bridge 若活着会放 caret
const cell = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[0]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
const manual = await p.evaluate((pt) => {
  const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, view: window })
  document.dispatchEvent(ev)
  return { dispatched: true, defaultPrevented: ev.defaultPrevented }
}, cell)
console.log('手动 dispatch mousedown:', JSON.stringify(manual))
await p.waitForTimeout(400)
const r1 = await p.evaluate(() => {
  const sel = window.getSelection()
  const td = sel?.focusNode?.parentElement?.closest('td, th')
  return { cell: (td?.textContent || '【表格外】').slice(0, 10) }
})
console.log('手动事件后光标:', JSON.stringify(r1))
// 3) mouseup（补齐手势）再检查
await p.evaluate((pt) => {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y, button: 0, view: window }))
}, cell)
await p.waitForTimeout(300)
const r2 = await p.evaluate(() => {
  const sel = window.getSelection()
  const td = sel?.focusNode?.parentElement?.closest('td, th')
  return { cell: (td?.textContent || '【表格外】').slice(0, 10) }
})
console.log('mouseup 后光标:', JSON.stringify(r2))
await b.close()
