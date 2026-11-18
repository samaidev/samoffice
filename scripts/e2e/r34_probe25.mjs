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
  document.addEventListener('mousedown', (e) => { window.__md = 'got@' + e.target.tagName }, true)
})
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 方案：table contentEditable=false + 每个 td/th contentEditable=true
await p.evaluate(() => {
  const t = document.querySelector('table')
  t.contentEditable = 'false'
  t.querySelectorAll('td, th').forEach(td => { td.contentEditable = 'true' })
})
await p.waitForTimeout(500)
const box = await p.evaluate(() => {
  const c = document.querySelectorAll('table td, table th')[20]
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
const r1 = await p.evaluate(() => {
  const sel = window.getSelection()
  const td = sel?.focusNode?.parentElement?.closest('td')
  return {
    md: window.__md || '✗丢失',
    activeEl: document.activeElement?.tagName,
    selCell: td ? td.textContent.slice(0, 6) : '【无selection】',
    rangeCount: sel?.rangeCount,
  }
})
console.log('嵌套editable点击:', JSON.stringify(r1))
// 若活 → 直接打字测试
if (r1.md !== '✗丢失') {
  await p.keyboard.type('Z')
  await p.waitForTimeout(400)
  const after = await p.evaluate(() => {
    const sel = window.getSelection()
    const td = sel?.focusNode?.parentElement?.closest('td')
    return { selCell: td ? td.textContent.slice(0, 8) : '【无】' }
  })
  console.log('打字后:', JSON.stringify(after))
}
await b.close()
