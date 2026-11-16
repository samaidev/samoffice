import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.on('console', m => { if (m.text().startsWith('R27DRAG') || m.text().startsWith('R27MD')) console.log('LOG:', m.text()) })
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
// B：选行4 拖到行1 40%
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
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r3 = trs[3].getBoundingClientRect(); const r0 = trs[0].getBoundingClientRect(); return { sx: r3.x + r3.width * 0.5, sy: r3.y + r3.height * 0.5, ty0: r0.y + r0.height * 0.4 } })
await p.mouse.move(g.sx, g.sy)
await p.mouse.down()
await p.waitForTimeout(250)
const g2 = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r0 = trs[0].getBoundingClientRect(); return { y: r0.y + r0.height * 0.4 } })
console.log('校准终点:', Math.round(g2.y), '(原始', Math.round(g.ty0), ')')
await p.mouse.move(g.sx, g2.y, { steps: 8 })
await p.waitForTimeout(400)
await p.mouse.up()
await p.waitForTimeout(700)
console.log('B 行序（期望 R4,R1,R2,R3）:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))))
await b.close()
