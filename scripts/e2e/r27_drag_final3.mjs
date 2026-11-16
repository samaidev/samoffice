// 最终矩阵（拖点取【拖拽实时几何】—— 按住后先读行位置再拖）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const mkPage = async () => {
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
  return p
}
const selectRow = async (p, i) => {
  await p.evaluate(async (rowIdx) => {
    const pt = await import('/node_modules/.vite/deps/prosemirror-tables.js?v=c6389b72')
    const v = window.__pmView
    let pos = -1
    v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
    const table = v.state.doc.nodeAt(pos)
    const rows = []
    table.forEach((r, off) => rows.push(off))
    const rowStart = pos + 1 + rows[rowIdx]
    const rowNode = table.child(rowIdx)
    let lastCell = rowStart + 1
    rowNode.forEach((c, off) => { lastCell = Math.max(lastCell, rowStart + 1 + off) })
    v.dispatch(v.state.tr.setSelection(pt.CellSelection.create(v.state.doc, rowStart + 1, lastCell)))
  }, i)
  await p.waitForTimeout(450) // 等装饰渲染稳定
}
// 拖拽：按住后重读几何再移动（所见即所得）
const dragTo = async (p, fromRow, targetRowMidIdx) => {
  const g = await p.evaluate((fr) => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[fr].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } }, fromRow)
  await p.mouse.move(g.x, g.y)
  await p.mouse.down()
  await p.waitForTimeout(200) // 装饰稳定后的行位置
  const t = await p.evaluate((ti) => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[ti].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.4 } }, targetRowMidIdx)
  await p.mouse.move(t.x, t.y, { steps: 8 })
  await p.waitForTimeout(400)
  await p.mouse.up()
  await p.waitForTimeout(700)
}
const rows = (p) => p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))

// A) 行1 → 行3 的40%处（target=2 → R2 R1 R3 R4）
let p = await mkPage()
await selectRow(p, 0)
await dragTo(p, 0, 2)
console.log('A（期望 R2,R1,R3,R4）:', JSON.stringify(await rows(p)))
await p.close()

// B) 行4 → 行1 的40%处（target=0 → R4 R1 R2 R3）
p = await mkPage()
await selectRow(p, 3)
await dragTo(p, 3, 0)
console.log('B（期望 R4,R1,R2,R3）:', JSON.stringify(await rows(p)))
await p.close()

// C) 行1+行2 多行选 → 行4 前（target=3 → R3 R4 R1 R2）
p = await mkPage()
await p.evaluate(async () => {
  const pt = await import('/node_modules/.vite/deps/prosemirror-tables.js?v=c6389b72')
  const v = window.__pmView
  let pos = -1
  v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
  // anchor=行1首格 head=行2末格
  const r0 = v.state.doc.nodeAt(pos).child(0)
  const r1 = v.state.doc.nodeAt(pos).child(1)
  let last0 = pos + 2
  r0.forEach((c, off) => { last0 = Math.max(last0, pos + 2 + off) })
  const row1Start = pos + 1 + r0.nodeSize
  let last1 = row1Start + 1
  r1.forEach((c, off) => { last1 = Math.max(last1, row1Start + 1 + off) })
  v.dispatch(v.state.tr.setSelection(pt.CellSelection.create(v.state.doc, pos + 2, last1)))
})
await p.waitForTimeout(450)
await dragTo(p, 0, 3)
console.log('C 双行（期望 R3,R4,R1,R2）:', JSON.stringify(await rows(p)))
const docOk = await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })
console.log('C doc 完整:', JSON.stringify(docOk))
await p.close()
await b.close()
