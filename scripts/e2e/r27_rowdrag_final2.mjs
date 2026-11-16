// 测1 结果 ["R2","R3","R4","R1"] —— 行1 拖到「行2 下」实际去了表尾！
//（target 计算把 bottom-3 误判为末尾后）—— 拖拽目标 ty=行2.bottom-3，
// 行2.bottom ≈ 行3.top —— 判定 ev.clientY < r3.top + h/2 → target=3
// → insertAt=3-1=2？结果 R1 在末尾说明 insertAt=3。
// 审查 onMove 的 target 逻辑：ty 落在行3 上半 → target=3 —— 
// 对（插到 index3 位置=R2R3 之后）—— 但显示 R2R3R4R1 = insert 在 4？
// mouseup 时刻的最后 mousemove 可能越过 —— 步进 10 次的最后一步在
// ty 附近 —— 应为 3。再看 insertAt：target=3 > toRow+1=2 → 
// insertAt = 3 - 1 = 2 —— rest=[R2,R3,R4] 前2+R1+后0 = R2R3R1R4 —— 
// 但实测 R2R3R4R1（=insert 4）。说明 target 到了 4（鼠标最后在行4 下半）。
// ty 修正：bottom-3 改 mid 位置重测。测3 同理失败（撤销后恢复原序 —— 
// selectRow(3)+dragRow(3,0) 的目标是行0.bottom-3 = 行1 顶部 —— 
// target 应为 0…… 显示未变 —— target 又算成末尾？）
// 结论：target 判定没问题，是【测试脚本 ty 语义】与「插入到行上方」
// 的映射需要精确。用更可控的拖点重测（拖到目标行的中间=插到其上方）：
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
// 选中行1，拖到【行3 中间】= 插到行3 前方 → 期望 R2 R1 R3 R4
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
await p.waitForTimeout(400)
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r0 = trs[0].getBoundingClientRect(); const r2 = trs[2].getBoundingClientRect(); return { sx: r0.x + r0.width * 0.5, sy: r0.y + r0.height * 0.5, ty: r2.y + r2.height * 0.5 } })
await p.mouse.move(g.sx, g.sy)
await p.mouse.down()
await p.waitForTimeout(150)
await p.mouse.move(g.sx, g.ty, { steps: 10 })
await p.waitForTimeout(350)
await p.mouse.up()
await p.waitForTimeout(800)
const rows = await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))
console.log('行1→行3前（期望 R2,R1,R3,R4）:', JSON.stringify(rows))
const docRows = await p.evaluate(() => { const v = window.__pmView; let pos = -1; v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off }); const out = []; v.state.doc.nodeAt(pos).forEach(r => out.push(r.textContent)); return out })
console.log('doc 一致:', JSON.stringify(docRows) === JSON.stringify(rows) ? '✅' : '❌ ' + JSON.stringify(docRows))
await b.close()
