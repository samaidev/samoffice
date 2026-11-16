// 行拖拽最终矩阵（用无歧义的位置）：
// A) 行1 → 行3 中心偏上（R2 R1 R3 R4）
// B) 行4 → 行1 中心（R4 R1 R2 R3）
// C) 原地（行1 → 行1/行2 边界不动）
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const run = async () => {
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
  await p.waitForTimeout(350)
}
const drag = async (p, fromRow, targetY) => {
  const g = await p.evaluate((fr) => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r = trs[fr].getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } }, fromRow)
  await p.mouse.move(g.x, g.y)
  await p.mouse.down()
  await p.waitForTimeout(150)
  await p.mouse.move(g.x, targetY, { steps: 8 })
  await p.waitForTimeout(350)
  await p.mouse.up()
  await p.waitForTimeout(700)
}
const rowText = (p) => p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))

// A) 行1 → 行3 上半（479+13=492）：i=2: 492<505 yes → target=2 → insertAt=1 → R2 R1 R3 R4
let p = await run()
await selectRow(p, 0)
let ty = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; return trs[2].getBoundingClientRect().top + 13 })
await drag(p, 0, ty)
console.log('A 行1→行3上方（期望 R2,R1,R3,R4）:', JSON.stringify(await rowText(p)))
await p.close()

// B) 行4 → 行1 上半（388）：target=0 → insertAt=0 → R4 R1 R2 R3
p = await run()
await selectRow(p, 3)
ty = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; return trs[0].getBoundingClientRect().top + 13 })
await drag(p, 3, ty)
console.log('B 行4→行1上方（期望 R4,R1,R2,R3）:', JSON.stringify(await rowText(p)))
await p.close()

// C) 行1 → 行1/行2 边界（427+5）：i=1: 432<453 yes → target=1 → 原地不动
p = await run()
await selectRow(p, 0)
ty = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; return trs[0].getBoundingClientRect().bottom + 5 })
await drag(p, 0, ty)
console.log('C 原地（期望不变）:', JSON.stringify(await rowText(p)))
const docOk = await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })
console.log('C doc 完整:', JSON.stringify(docOk))
await p.close()
await b.close()
