// B 仍不动且无 R27DRAG log —— mousedown 的 CellSelection 分支没进。
// 新 verdict 用 elementFromPoint —— 在死区上它返回什么？之前 fv9 显示
// elementFromPoint 返回 proxy！tdEl = proxy.closest('td') = null → 
// inCellSel=false！
// ★★★ 死区上 elementFromPoint 拿到的是【proxy】不是 td！
// 修：判定改为「proxy mousedown 的坐标 → 手动几何查 td」（与
// hit 匹配一样的逻辑）。proxy handler 里已有几何匹配代码 —— 
// 复用：先几何找 td → 行索引判定。
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
// 死区坐标 elementFromPoint 验证
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r3 = trs[3].getBoundingClientRect(); return { x: r3.x + r3.width * 0.5, y: r3.y + r3.height * 0.5 } })
const hit = await p.evaluate((pt) => { const el = document.elementFromPoint(pt.x, pt.y); return (el?.className || el?.tagName || '').toString().slice(0, 40) }, g)
console.log('行4中心 elementFromPoint:', hit)
await b.close()
