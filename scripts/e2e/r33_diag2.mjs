import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('PAGEERR: ' + e.message.slice(0, 250)))
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
await p.waitForTimeout(800)
const results = []
for (const idx of [0, 4, 9, 20, 30]) {
  // 每次点击前重新定位（模拟真实用户视线跟随）
  const box = await p.evaluate((i) => {
    const cell = document.querySelectorAll('table td, table th')[i]
    const r = cell.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top }
  }, idx)
  // 点击前：表格当前顶部位置（检测位移）
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(400)
  const focus = await p.evaluate(() => {
    const sel = window.getSelection()
    const td = sel?.focusNode?.parentElement?.closest('td, th')
    return {
      selCellText: (td?.textContent || '【表格外】').slice(0, 12),
      caretOffset: sel?.focusOffset,
    }
  })
  results.push({ idx, clickY: Math.round(box.y), ...focus })
}
console.log(JSON.stringify(results, null, 1))
await b.close()
