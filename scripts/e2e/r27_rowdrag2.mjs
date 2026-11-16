import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.on('console', m => { if (m.text().includes('CS')) console.log('LOG:', m.text().slice(0, 120)) })
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
// 检查 vite dep 路径是否有效 + CellSelection 导入
const r = await p.evaluate(async () => {
  const paths = [
    '/node_modules/.vite/deps/prosemirror-tables.js?v=c6389b72',
    '/node_modules/.vite/deps/prosemirror-tables.js',
  ]
  for (const pth of paths) {
    try { const m = await import(pth); if (m.CellSelection) return { ok: pth } } catch (e) { /* try next */ }
  }
  return { ok: null }
})
console.log('dep path:', JSON.stringify(r))
if (!r.ok) { await b.close(); process.exit(0) }
await p.evaluate(async (pth) => {
  const pt = await import(pth)
  const v = window.__pmView
  let pos = -1
  v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
  const row0 = v.state.doc.nodeAt(pos).child(0)
  let lastCell = pos + 2
  row0.forEach((c, off) => { lastCell = Math.max(lastCell, pos + 2 + off) })
  console.log('CS', pos, lastCell)
  v.dispatch(v.state.tr.setSelection(pt.CellSelection.create(v.state.doc, pos + 2, lastCell)))
}, r.ok)
await p.waitForTimeout(500)
console.log('CellSelection:', await p.evaluate(() => { const s = window.__pmView.state.selection; return !!(s && s.$anchorCell) }))
await b.close()
