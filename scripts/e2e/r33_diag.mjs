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
const diag = await p.evaluate(() => {
  const out = { zoom: window.__docZoom }
  const table = document.querySelector('table')
  const tr = table.querySelector('tr')
  const cells = [...tr.children]
  // 1) 表格跨页装饰状态
  out.hasPgBrkTable = !!table.closest('.pg-brk-table') || table.classList.contains('pg-brk-table')
  out.pgBrkRows = table.querySelectorAll('.pg-brk-row').length
  out.pgBrkCells = table.querySelectorAll('.pg-brk-cell').length
  // wrapper 相对定位
  const wrapper = table.closest('.tableWrapper')
  out.wrapperStyle = (wrapper?.getAttribute('style') || 'none').slice(0, 80)
  // 2) 单元格视觉位置 vs DOM 顺序（首行各格的 x 坐标）
  out.firstRowX = cells.map((c) => Math.round(c.getBoundingClientRect().x))
  // 3) td 内是否有多余的层级/位移
  const c0 = cells[0]
  out.c0offsetTop = c0.offsetTop, out.c0transform = getComputedStyle(c0).transform
  // 4) 行的位移（pg-brk-row translateY 会打乱 hit-test）
  out.rowTransforms = [...table.rows].slice(0, 12).map((r, i) => (r.getAttribute('style') || '').slice(0, 40) || (getComputedStyle(r).transform !== 'none' ? getComputedStyle(r).transform.slice(0, 30) : '-'))
  // 5) 表格在视口中的绝对位置
  const r = table.getBoundingClientRect()
  out.tableRect = { y: Math.round(r.y), h: Math.round(r.height) }
  // 视口高
  out.vh = window.innerHeight
  return out
})
console.log(JSON.stringify(diag, null, 1))
await b.close()
