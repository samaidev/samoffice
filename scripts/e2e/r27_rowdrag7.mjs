// 干净 vite 仍不变。插桩 startRowDragSession：是否被调、返回什么
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.on('console', m => { if (m.text().startsWith('R27D')) console.log('LOG:', m.text().slice(0, 150)) })
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
// 拖动序列（含详细事件流观察）
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r0 = trs[0].getBoundingClientRect(); const r2 = trs[2].getBoundingClientRect(); return { sx: r0.x + r0.width * 0.5, sy: r0.y + r0.height * 0.5, ty: r2.bottom - 4 } })
// 记录 document mousedown（capture）与 proxy 状态
await p.evaluate(() => {
  window.__flow = []
  document.addEventListener('mousedown', e => window.__flow.push('doc-md:' + (e.target.className || e.target.tagName).toString().slice(0, 18)), true)
  document.addEventListener('mousemove', e => { if (window.__flow.length < 30) window.__flow.push('mm') }, true)
})
await p.mouse.move(g.sx, g.sy)
await p.mouse.down()
await p.waitForTimeout(150)
await p.mouse.move(g.sx, g.ty, { steps: 10 })
await p.waitForTimeout(300)
const midFlow = await p.evaluate(() => [...window.__flow])
await p.mouse.up()
await p.waitForTimeout(600)
console.log('事件流前段:', JSON.stringify(midFlow.slice(0, 6)))
console.log('指示线出现过吗:', await p.evaluate(() => !!document.querySelector('.pm-row-move-indicator')))
const rows = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))
console.log('行序:', JSON.stringify(rows))
await b.close()
