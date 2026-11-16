// A ✓ B ✓ ！C 双行得到 R3,R1,R2,R4（期望 R3,R4,R1,R2）—— 
// 双行选（行1+行2 → 行4 前）：target=3 → insertAt = 3 - 2 = 1 →
// rest=[R3,R4] idx1 → R3 + [R1,R2] + R4 = R3 R1 R2 R4 —— 
// 【行为正确】！期望值又算错了（我的期望 R3R4R1R2 是插到 R4 后）。
// 拖到行4 的 40% = 插到行4 前 = R3 [R1R2] R4 ✓。
// 全部语义正确！最后跑一遍完整回归（点击+打字+拖拽）后提交：
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
  ] },
] }))
await p.waitForTimeout(3000)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2600)
// 1) 点击进格 + 打字（回归）
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(600)
await p.keyboard.type('Q5', { delay: 70 })
await p.waitForTimeout(400)
console.log('回归1 点击+打字:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
// 2) 行拖拽（行1 → 行3 前）
await p.evaluate(async () => {
  const pt = await import('/node_modules/.vite/deps/prosemirror-tables.js?v=c6389b72')
  const v = window.__pmView
  let pos = -1
  v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
  const rowNode = v.state.doc.nodeAt(pos).child(0)
  let lastCell = pos + 2
  rowNode.forEach((c, off) => { lastCell = Math.max(lastCell, pos + 2 + off) })
  v.dispatch(v.state.tr.setSelection(pt.CellSelection.create(v.state.doc, pos + 2, lastCell)))
})
await p.waitForTimeout(450)
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r0 = trs[0].getBoundingClientRect(); return { sx: r0.x + r0.width * 0.5, sy: r0.y + r0.height * 0.5 } })
await p.mouse.move(g.sx, g.sy)
await p.mouse.down()
await p.waitForTimeout(250)
const t = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r2 = trs[2].getBoundingClientRect(); return { y: r2.y + r2.height * 0.4 } })
await p.mouse.move(g.sx, t.y, { steps: 8 })
await p.waitForTimeout(400)
await p.mouse.up()
await p.waitForTimeout(700)
console.log('回归2 行拖拽:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))))
console.log('doc 完整:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })))
await b.close()
