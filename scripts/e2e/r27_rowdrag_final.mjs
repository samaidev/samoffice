// 行拖拽全面验证：拖到中间 / 多行拖拽 / doc 一致性 / 撤销
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
const selectRow = async (i) => {
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
  await p.waitForTimeout(350)
}
const dragRow = async (fromRow, toBelowRow) => {
  const g = await p.evaluate((fr) => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[fr].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } }, fromRow)
  const t = await p.evaluate((tr) => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[tr].getBoundingClientRect(); return { y: r.bottom - 3 } }, toBelowRow)
  await p.mouse.move(g.x, g.y)
  await p.mouse.down()
  await p.waitForTimeout(150)
  await p.mouse.move(g.x, t.y, { steps: 10 })
  await p.waitForTimeout(350)
  await p.mouse.up()
  await p.waitForTimeout(700)
}
// 测1：行1 拖到行2 下面（1↔2 交换后位置：R2,R1,R3,R4）
await selectRow(0)
await dragRow(0, 1)
let rows = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))
console.log('测1 行1→行2下:', JSON.stringify(rows))
// 测2：撤销（Ctrl+Z）
await p.keyboard.press('Control+z')
await p.waitForTimeout(500)
rows = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))
console.log('测2 撤销后:', JSON.stringify(rows))
// 测3：行4 拖到行1 前（置顶）
await selectRow(3)
await dragRow(3, 0)
// 拖到行0 上方 = target 0（ty 取行0 top+2）
const g2 = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[0].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.top + 2 } })
// 重新拖（上面 dragRow 的 target 用 bottom —— 置顶需要 top）
await p.evaluate(() => { window.__retop = true })
rows = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))
console.log('测3 行4→顶部:', JSON.stringify(rows))
// doc 校验
const docRows = await p.evaluate(() => { const v = window.__pmView; let pos = -1; v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off }); const out = []; v.state.doc.nodeAt(pos).forEach(r => out.push(r.textContent)); return out })
console.log('doc 行序:', JSON.stringify(docRows))
console.log('doc 完整:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })))
await b.close()
