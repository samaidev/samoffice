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
const out = await p.evaluate(() => {
  const pmEl = document.querySelector('.ProseMirror')
  const view = window.__pmView || pmEl?.pmViewDesc?.view
  if (!view) return { err: 'no view' }
  // pos 5085 附近内容
  const node5085 = view.state.doc.resolve(5085)
  const ctx = []
  for (let d = node5085.depth; d > 0; d--) {
    const n = node5085.node(d)
    ctx.push(n.type.name + ':' + (n.textContent || '').slice(0, 8))
  }
  // 表格 node 的位置范围
  let tableInfo = null
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'table' && !tableInfo) tableInfo = { pos, nodeSize: n.nodeSize, rows: n.childCount }
  })
  // elementFromPoint at idx0
  const cell = document.querySelectorAll('table td, table th')[0]
  const r = cell.getBoundingClientRect()
  const x = r.x + r.width / 2, y = r.y + r.height / 2
  const hit = document.elementFromPoint(x, y)
  // cell 的 DOM → PM pos（domAtPos 反向）
  const tableEl = document.querySelector('table')
  // posAtCoords 内部用的 dom 结点链
  let hitChain = []
  let cur = hit
  for (let i = 0; i < 6 && cur; i++) { hitChain.push(cur.tagName + (cur.className && typeof cur.className === 'string' ? '.' + cur.className.split(' ')[0] : '')); cur = cur.parentElement }
  return {
    pos5085context: ctx,
    tableInfo,
    hitTag: hit?.tagName, hitChain,
    hitClosestTd: !!hit?.closest?.('td,th'),
    cellText: (hit?.closest?.('td,th')?.textContent || '').slice(0, 10),
  }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
