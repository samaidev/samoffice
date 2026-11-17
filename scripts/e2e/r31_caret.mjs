import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.on('console', m => { if (m.text().startsWith('R31')) console.log(m.text()) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)
await p.evaluate(async () => {
  const r = await fetch('/test31.docx')
  const buf = await r.arrayBuffer()
  const file = new File([buf], 'test31.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const dt = new DataTransfer()
  dt.items.add(file)
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
})
await p.waitForTimeout(8000)
await p.evaluate(() => { document.querySelector('.ProseMirror table')?.scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 找多字格 + 点击其中部（x 70% 处）
const cell = await p.evaluate(() => {
  const tbl = document.querySelector('.ProseMirror table')
  let best = null
  tbl.querySelectorAll('tr').forEach((tr, ri) => {
    tr.querySelectorAll('td,th').forEach((td, ci) => {
      const txt = (td.textContent || '').trim()
      if (txt.length > 6 && (!best || txt.length > best.txt.length)) {
        const r = td.getBoundingClientRect()
        best = { x: Math.round(r.x + r.width * 0.7), y: Math.round(r.y + Math.min(r.height * 0.5, 30)), ri, ci, txt: txt.slice(0, 20) }
      }
    })
  })
  return best
})
console.log('cell:', JSON.stringify(cell))
// 先手动验证 caretRangeFromPoint 行为
const cr = await p.evaluate((c) => {
  const r = document.caretRangeFromPoint(c.x, c.y)
  return r ? { node: (r.startContainer.textContent || '').slice(0, 15), off: r.startOffset } : null
}, cell)
console.log('caretRangeFromPoint 预期:', JSON.stringify(cr))
await p.mouse.click(cell.x, cell.y)
await p.waitForTimeout(1000)
const after = await p.evaluate(() => {
  const sel = window.getSelection()
  const r = sel?.rangeCount ? sel.getRangeAt(0) : null
  return r ? { off: r.startOffset, nodeTxt: (r.startContainer.textContent || '').slice(0, 15) } : null
})
console.log('点击后 DOM selection:', JSON.stringify(after))
await b.close()
