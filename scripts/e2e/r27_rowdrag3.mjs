// CellSelection ✅ 但拖拽没生效（行序未变）。可能：
// 1) mousedown 事件被【点击代理层】拦截（proxy 盖住 td → PM 收不到
//    mousedown → 插件的 handleDOMEvents 不触发）！
// ★ 对 —— proxy 在 td 之上！选中状态下点击 → proxy mousedown →
//   我们 handler hit 匹配 → preventDefault + setSelection（把
//   CellSelection 替换成光标！）→ 行拖拽插件根本没机会。
// 修：proxy handler 里【保留 CellSelection】：若当前已是 CellSelection
// 且点击在选区内 → 不 preventDefault、不 setSelection（放行给 PM/插件）。
// 先验证假设：CellSelection 下点击行1 是否被 proxy 吞掉：
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
// CellSelection 行1
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
// 点击行1 中心（模拟拖拽起点 mouse.down）
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[0].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.move(g.x, g.y)
await p.mouse.down()
await p.waitForTimeout(300)
const afterDown = await p.evaluate(() => { const s = window.__pmView.state.selection; return { stillCell: !!(s && s.$anchorCell), from: s.from } })
await p.mouse.up()
await p.waitForTimeout(200)
console.log('按下后选区:', JSON.stringify(afterDown))
await b.close()
