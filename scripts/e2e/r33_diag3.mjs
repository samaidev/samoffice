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
const out = await p.evaluate(() => {
  // 找 PM view（全局）
  const pmEl = document.querySelector('.ProseMirror')
  const view = (window).__pmView || pmEl?.pmViewDesc?.view || null
  if (!view) {
    // fallback：React DEV 模式下从 DOM 找
    return { err: 'no view handle', hasPmViewDesc: !!pmEl?.pmViewDesc }
  }
  const results = []
  const cells = document.querySelectorAll('table td, table th')
  for (const idx of [0, 4, 9, 20]) {
    const cell = cells[idx]
    const r = cell.getBoundingClientRect()
    const x = r.x + r.width / 2, y = r.y + r.height / 2
    const at = view.posAtCoords({ left: x, top: y })
    // pos → 所在 cell 文本
    let cellText = '【表格外】'
    if (at) {
      const $pos = view.state.doc.resolve(at.pos)
      for (let d = $pos.depth; d > 0; d--) {
        const n = $pos.node(d)
        if (n.type.name === 'table_cell' || n.type.name === 'table_header') {
          cellText = n.textContent.slice(0, 10); break
        }
      }
      if (cellText === '【表格外】') {
        // 哪个块？
        for (let d = $pos.depth; d > 0; d--) {
          const n = $pos.node(d)
          if (n.type.spec.content?.includes('block')) { cellText = '(块:' + (n.textContent || '').slice(0, 10) + ')'; break }
        }
      }
    }
    results.push({ idx, clickText: (cell.textContent || '').slice(0, 8), posAt: at?.pos, inside: at?.inside, gotCell: cellText })
  }
  return { results }
})
console.log(JSON.stringify(out, null, 1))
await b.close()
