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
// 记录 mousedown 的 target/坐标 + elementFromPoint
const probe = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[4] // "P" 单元格
  const r = cell.getBoundingClientRect()
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  const hit = document.elementFromPoint(x, y)
  // cell 里面有什么？
  const cellHtml = cell.innerHTML.slice(0, 200)
  // 表格的可编辑性
  const wrapper = cell.closest('.tableWrapper')
  const pmRoot = cell.closest('.ProseMirror')
  return {
    cellRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    hitTag: hit?.tagName, hitClass: (hit?.className || '').toString().slice(0, 60), hitEditable: hit?.getAttribute('contenteditable'),
    cellHtml,
    wrapperClass: wrapper?.className,
    pmRootEditable: pmRoot?.getAttribute('contenteditable'),
    // cell 与 PM 编辑器的层叠：有没有元素盖在上面
    cellZ: getComputedStyle(cell).zIndex, cellPos: getComputedStyle(cell).position,
  }
})
console.log(JSON.stringify(probe, null, 1))
await b.close()
