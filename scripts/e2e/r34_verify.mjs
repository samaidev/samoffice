import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
p.on('pageerror', (e) => console.log('PAGEERR: ' + e.message.slice(0, 200)))
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
// 桥层状态
const bridge = await p.evaluate(() => {
  const layers = document.querySelectorAll('.pm-table-clickbridge')
  const table = document.querySelector('table')
  const tr = table.getBoundingClientRect()
  return {
    layerCount: layers.length,
    layerRect: layers[0] ? { x: Math.round(layers[0].getBoundingClientRect().x), y: Math.round(layers[0].getBoundingClientRect().y), w: Math.round(layers[0].getBoundingClientRect().width), h: Math.round(layers[0].getBoundingClientRect().height) } : null,
    tableRect: { x: Math.round(tr.x), y: Math.round(tr.y), w: Math.round(tr.width), h: Math.round(tr.height) },
  }
})
console.log('桥层:', JSON.stringify(bridge))
// 点击 idx0
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
  return { cell: (td?.textContent || '【表格外】').slice(0, 10), text: (sel?.focusNode?.textContent || '').slice(0, 10) }
})
console.log('点击首格:', JSON.stringify(r1))
// 再点 idx4 和 idx0 二次
for (const idx of [4, 0]) {
  const bb = await p.evaluate((i) => {
    const cell = document.querySelectorAll('table td, table th')[i]
    const r = cell.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, idx)
  await p.mouse.click(bb.x, bb.y)
  await p.waitForTimeout(400)
  const rr = await p.evaluate(() => {
    const sel = window.getSelection()
    const td = sel?.focusNode?.parentElement?.closest('td, th')
    return (td?.textContent || '【表格外】').slice(0, 10)
  })
  console.log(`点击 idx${idx}:`, rr)
}
await b.close()
