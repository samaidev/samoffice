// 仍未变。逐步定位：mousedown 时 inCellSel 判定是否通过、
// startRowDragSession 是否启动、armed 是否激活：
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
  window.__tblPos = pos
})
await p.waitForTimeout(400)
// posAtCoords 在死区坐标上的返回值检查
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[0].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
const at = await p.evaluate((pt) => window.__pmView.posAtCoords({ left: pt.x, top: pt.y }), g)
console.log('posAtCoords(行1中心):', JSON.stringify(at))
// anchor/head 范围
const rng = await p.evaluate(() => { const s = window.__pmView.state.selection; return { anchor: s.$anchorCell?.pos, head: s.$headCell?.pos, tblPos: window.__tblPos } })
console.log('CellSelection 范围:', JSON.stringify(rng))
await b.close()
