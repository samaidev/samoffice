// 新代码已服务（at.pos 判定）但仍无指示线。mousedown 到 proxy ——
// inCellSel 现在应为 true（pos 22 ∈ [22,31]）—— startRowDragSession
// 内部 return false？其内部查找 tablePos 用 selAnchorPos——nodeDOM(-1)？
// 会话函数里 anchor 查找有 bug。直接单测 startRowDragSession：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.on('console', m => { if (m.text().startsWith('R27S')) console.log('LOG:', m.text().slice(0, 200)) })
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
// 直接调用模块内的 startRowDragSession（从 vite 模块图拿）
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[0].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
// 通过源模块 import（vite 源码路径）
const res = await p.evaluate(async (pt) => {
  const mod = await import('/src/editors/document/tablePlugins.ts')
  if (typeof mod.startRowDragSession !== 'function') return { err: 'no export', keys: Object.keys(mod).slice(0, 10) }
  const started = mod.startRowDragSession(window.__pmView, pt.x, pt.y)
  return { started }
}, g)
console.log('直接调用会话:', JSON.stringify(res))
if (res.started) {
  await p.mouse.move(g.x, g.y + 60, { steps: 5 })
  await p.waitForTimeout(300)
  console.log('指示线:', await p.evaluate(() => document.querySelectorAll('.pm-row-move-indicator').length))
  // mouseup 在 evaluate 外派发（真实鼠标事件）
}
await b.close()
