// 代码已服务（2 处 startRowDragSession）。mousedown 到 proxy（doc-md:pm-table-clickprox）
// 但会话没启动 —— inCellSel=false？posAtCoords 在 mousedown 时刻返回？
// 直接在 mousedown 前后手动复算判定逻辑：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'R1A' }] }, { inline: [{ content: 'R1B' }] }],
    [{ inline: [{ content: 'R2A' }] }, { inline: [{ content: 'R2B' }] }],
    [{ inline: [{ content: 'R3A' }] }, { inline: [{ content: 'R3B' }] }],
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
  const row0 = v.state.doc.nodeAt(pos).child(0)
  let lastCell = pos + 2
  row0.forEach((c, off) => { lastCell = Math.max(lastCell, pos + 2 + off) })
  v.dispatch(v.state.tr.setSelection(pt.CellSelection.create(v.state.doc, pos + 2, lastCell)))
})
await p.waitForTimeout(400)
// 复算 inCellSel（与产品代码逐行相同）
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[0].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
const verdict = await p.evaluate((pt) => {
  const v = window.__pmView
  const curSel = v.state.selection
  if (!curSel || !curSel.$anchorCell) return { step: 'no-cellsel' }
  const cellSelFrom = Math.min(curSel.$anchorCell.pos, curSel.$headCell.pos)
  const cellSelTo = Math.max(curSel.$anchorCell.pos, curSel.$headCell.pos)
  const at = v.posAtCoords({ left: pt.x, top: pt.y })
  if (!at) return { step: 'no-at', cellSelFrom, cellSelTo }
  const $p = v.state.doc.resolve(at.pos)
  let inCellSel = false
  let cellPosFound = -1
  for (let d = $p.depth; d > 0; d--) {
    const nn = $p.node(d).type.name
    if (nn === 'table_cell' || nn === 'table_header') {
      const cellPos = $p.before(d)
      cellPosFound = cellPos
      if (cellPos >= cellSelFrom - 1 && cellPos <= cellSelTo + 1) { inCellSel = true; break }
    }
  }
  return { step: 'computed', at: at.pos, cellPosFound, cellSelFrom, cellSelTo, inCellSel, selIsCell: !!curSel.$anchorCell }
}, g)
console.log('判定复算:', JSON.stringify(verdict))
await b.close()
