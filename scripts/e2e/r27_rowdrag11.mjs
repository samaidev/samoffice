// started:false —— 会话函数内部被某个 guard 挡了。逐 guard 排查：
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
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[0].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
const diag = await p.evaluate(async (pt) => {
  const v = window.__pmView
  const sel = v.state.selection
  const out = {}
  out.hasCellSel = !!(sel && sel.$anchorCell && sel.$headCell)
  // selAnchorPos 逻辑: $anchorCell.pos - 1
  const anchorDocPos = sel.$anchorCell.pos - 1
  out.anchorDocPos = anchorDocPos
  out.nodeDOM_anchor = !!v.nodeDOM(anchorDocPos)
  out.nodeDOM_anchor_dom = v.nodeDOM(anchorDocPos)?.nodeName
  // 会话里的 tablePos 查找复刻
  let tablePos = -1
  v.state.doc.forEach((n, off) => {
    if (tablePos < 0 && n.type.name === 'table') {
      const d = v.nodeDOM(off)
      if (d) {
        const ad = v.nodeDOM(anchorDocPos)
        if (ad && (d === ad.closest('.tableWrapper') || d.contains(ad.closest('.tableWrapper')))) tablePos = off
      }
    }
  })
  out.tablePos = tablePos
  if (tablePos >= 0) {
    const table = v.state.doc.nodeAt(tablePos)
    out.childCount = table.childCount
    // rowOf 复刻
    const rowOf = ($cell) => {
      for (let d = $cell.depth; d > 0; d--) {
        if ($cell.node(d).type.name === 'table_row') {
          let off = 0
          $cell.node(d - 1).forEach((rw, o) => { if (rw === $cell.node(d)) off = o })
          return off
        }
      }
      return -1
    }
    out.rowA = rowOf(sel.$anchorCell)
    out.rowH = rowOf(sel.$headCell)
    const wrap = v.nodeDOM(tablePos)?.querySelector?.('.tableWrapper')
    out.wrap = !!wrap
    out.host = !!v.dom.parentElement
  }
  return out
}, g)
console.log('诊断:', JSON.stringify(diag))
await b.close()
