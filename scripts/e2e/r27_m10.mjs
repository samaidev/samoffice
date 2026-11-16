// 还是 48 —— HMR 未刷新（tsc 后页面拿的还是旧模块）。等更久 + bust：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
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
const verdict = await p.evaluate(() => {
  const v = window.__pmView
  const sel = v.state.selection
  const a = sel.$anchorCell
  const out = { anchorPos: a.pos, depth: a.depth }
  for (let d = a.depth; d >= 2; d--) {
    out['n' + d] = a.node(d).type.name
    if (a.node(d).type.name === 'table_row') {
      out.rowDocPos = a.before(d)
      out.tableStart = a.before(d - 1)
      out.rowIdx = a.before(d) - a.before(d - 1) - 1
    }
  }
  return out
})
console.log('锚点链:', JSON.stringify(verdict))
await b.close()
