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
await p.evaluate(() => { document.querySelector('table').scrollIntoView({ block: 'center' }) })
await p.waitForTimeout(800)
// 关键检查：proxy 层的几何 vs 表格几何（滚动后是否同步）
const out = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  const table = document.querySelector('table')
  const wrapper = table.closest('.tableWrapper')
  if (!proxy) return { err: 'no proxy' }
  const pr = proxy.getBoundingClientRect()
  const wr = wrapper.getBoundingClientRect()
  const tr = table.getBoundingClientRect()
  // proxy 覆盖检查：表格是否在 proxy 矩形内
  const covers = pr.left <= tr.left && pr.right >= tr.right && pr.top <= tr.top + 5 && pr.bottom >= tr.bottom - 5
  return {
    proxyRect: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
    wrapperRect: { x: Math.round(wr.x), y: Math.round(wr.y), w: Math.round(wr.width), h: Math.round(wr.height) },
    tableRect: { x: Math.round(tr.x), y: Math.round(tr.y), w: Math.round(tr.width), h: Math.round(tr.height) },
    covers,
    proxyStyle: proxy.getAttribute('style'),
    // 点击 idx0 中心时 caretRangeFromPoint（禁 proxy 后）返回什么
    caretTest: (() => {
      const cell = document.querySelectorAll('table td, table th')[0]
      const r = cell.getBoundingClientRect()
      const saved = proxy.style.pointerEvents
      proxy.style.pointerEvents = 'none'
      try {
        const cr = document.caretRangeFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return { node: cr?.startContainer?.nodeName, text: (cr?.startContainer?.textContent || '').slice(0, 12), off: cr?.startOffset }
      } finally { proxy.style.pointerEvents = saved }
    })(),
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
