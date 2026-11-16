// A ✓ B/C 仍无 log —— B 会话仍未启动。直接检查 mousedown 后 inCellSel：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.on('console', m => { if (m.text().startsWith('R27')) console.log('LOG:', m.text()) })
p.setDefaultTimeout(30000)
await p.goto(BASE + '/?r=' + Date.now(), { waitUntil: 'networkidle' })
await p.waitForTimeout(2000)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'R1A' }] }, { inline: [{ content: 'R1B' }] }],
    [{ inline: [{ content: 'R2A' }] }, { inline: [{ content: 'R2B' }] }],
    [{ inline: [{ content: 'R3A' }] }, { inline: [{ content: 'R3B' }] }],
    [{ inline: [{ content: 'R4A' }] }, { inline: [{ content: 'R4B' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2600)
await p.evaluate(async () => {
  const pt = await import('/node_modules/.vite/deps/prosemirror-tables.js?v=c6389b72')
  const v = window.__pmView
  let pos = -1
  v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
  const table = v.state.doc.nodeAt(pos)
  const rows = []
  table.forEach((r, off) => rows.push(off))
  const rowStart = pos + 1 + rows[3]
  const rowNode = table.child(3)
  let lastCell = rowStart + 1
  rowNode.forEach((c, off) => { lastCell = Math.max(lastCell, rowStart + 1 + off) })
  v.dispatch(v.state.tr.setSelection(pt.CellSelection.create(v.state.doc, rowStart + 1, lastCell)))
})
await p.waitForTimeout(450)
// 模拟产品逻辑：mousedown 在行4 中心 —— 几何扫描应命中行4 → inCellSel
const verdict = await p.evaluate(() => {
  const v = window.__pmView
  const sel = v.state.selection
  const rowIndexOf = ($cell) => {
    try {
      for (let d = $cell.depth; d >= 2; d--) {
        if ($cell.node(d).type.name === 'table_row') {
          const rowDocPos = $cell.before(d)
          const tableStart = $cell.before(d - 1)
          return rowDocPos - tableStart - 1
        }
      }
    } catch (e) {}
    return -1
  }
  const selFromRow = Math.min(rowIndexOf(sel.$anchorCell), rowIndexOf(sel.$headCell))
  const selToRow = Math.max(rowIndexOf(sel.$anchorCell), rowIndexOf(sel.$headCell))
  // 点击点（行4 中心）
  const trs4 = [...document.querySelectorAll('.ProseMirror tr')]
  const r4 = trs4[3].getBoundingClientRect()
  const cx = r4.x + r4.width * 0.5, cy = r4.y + r4.height * 0.5
  let inCellSel = false
  v.dom.querySelectorAll('.tableWrapper').forEach(w => {
    if (inCellSel) return
    w.querySelectorAll('tr').forEach((tr, ri) => {
      if (inCellSel) return
      tr.querySelectorAll('td,th').forEach(td => {
        if (inCellSel) return
        const rect = td.getBoundingClientRect()
        if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
          if (ri >= selFromRow && ri <= selToRow) inCellSel = true
        }
      })
    })
  })
  return { selFromRow, selToRow, cx: Math.round(cx), cy: Math.round(cy), inCellSel }
})
console.log('B 判定复算:', JSON.stringify(verdict))
await b.close()
