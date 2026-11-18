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
// 滚动容器是谁？.overflow-auto。用 scroller.scrollTo 而不是 scrollIntoView（排除 scrollIntoView 的副作用）
await p.evaluate(() => {
  const sc = document.querySelector('.overflow-auto')
  const t = document.querySelector('table')
  sc.scrollTop = t.getBoundingClientRect().top + sc.scrollTop - 300
})
await p.waitForTimeout(800)
const out = await p.evaluate(() => {
  const cell = document.querySelectorAll('table td, table th')[20]
  const r = cell.getBoundingClientRect()
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  const hit = document.elementFromPoint(x, y)
  // hit 链
  let chain = []
  let cur = hit
  for (let i = 0; i < 6 && cur; i++) { chain.push(cur.tagName + '.' + (typeof cur.className === 'string' ? cur.className.split(' ')[0] : '')); cur = cur.parentElement }
  // 该点所有元素（elementsFromPoint）
  const stack = document.elementsFromPoint(x, y).slice(0, 8).map(el => el.tagName + '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : ''))
  return { point: { x: Math.round(x), y: Math.round(y) }, hitChain: chain, stack, cellRect: { x: Math.round(r.x), y: Math.round(r.y) } }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
