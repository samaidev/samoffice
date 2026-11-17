import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('PAGEERR: ' + e.message.slice(0, 250)))
p.on('console', (m) => { if (m.type() === 'error') console.log('CERR: ' + m.text().slice(0, 250)) })
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
// 滚动到表格
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(600)
const results = []
for (const idx of [0, 1, 4, 9, 20, 30]) {
  const st = await p.evaluate((i) => {
    const cell = document.querySelectorAll('table td, table th')[i]
    if (!cell) return null
    const r = cell.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (cell.textContent || '').slice(0, 10) }
  }, idx)
  if (!st) continue
  await p.mouse.click(st.x, st.y)
  await p.waitForTimeout(400)
  const focus = await p.evaluate(() => {
    const pm = document.querySelector('.ProseMirror')
    const sel = window.getSelection()
    return {
      pmFocused: pm?.classList.contains('ProseMirror-focused') || document.activeElement === pm,
      selInTable: !!sel?.focusNode?.parentElement?.closest('table'),
      selText: (sel?.focusNode?.textContent || '').slice(0, 15),
      activeEl: document.activeElement?.tagName + '.' + (document.activeElement?.className || '').toString().slice(0, 30),
    }
  })
  results.push({ idx, cell: st.text, ...focus })
}
console.log(JSON.stringify(results, null, 1))
await b.close()
console.log('DONE')
