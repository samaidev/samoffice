// HMR 未刷新（刚改完 tsc → vite 重编译需要时序）。等更久再测：
import { execSync } from 'child_process'
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
// 确认服务端有 row-range 代码
const served = execSync('curl -s http://localhost:18400/src/editors/document/DocumentEditor.tsx', { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
console.log('served ok:', served.includes('inCellSel = at.pos >= cellSelFrom'))
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
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r0 = trs[0].getBoundingClientRect(); const r2 = trs[2].getBoundingClientRect(); return { sx: r0.x + r0.width * 0.5, sy: r0.y + r0.height * 0.5, ty: r2.bottom - 4 } })
await p.mouse.move(g.sx, g.sy)
await p.mouse.down()
await p.waitForTimeout(150)
await p.mouse.move(g.sx, g.ty, { steps: 10 })
await p.waitForTimeout(400)
const ind = await p.evaluate(() => { const els = document.querySelectorAll('.pm-row-move-indicator'); return els.length })
await p.mouse.up()
await p.waitForTimeout(800)
console.log('指示线元素:', ind)
const rows = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))
console.log('行序:', JSON.stringify(rows))
await b.close()
