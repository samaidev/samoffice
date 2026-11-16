// rowIdx = 70 - 21 - 1 = 48 —— 数学暴露真相：before(d-1) 给的不是
// table 的 start！$anchorCell 的 depth=2 —— node(2)=table_row、
// node(1)=table？—— depth 链：resolve(71) 的深度 2 —— node(2)=row
// 意味着 node(1)=table、node(0)=doc。before(1)=table 的位置=22？
// 实测 tableStart=21 —— before(1) 返回 21（table 前边界=21 —— 对，
// table 在 pos21）。rowDocPos=before(2)=70 —— 但行4 的位置应是
// 21+1+行1节点+行2+行3 = 22+9*3=49 —— 70 ≠ 49！
// ★★★ anchor pos=71 —— 但 CellSelection.create 的 anchor 我们传的
// 是 rowStart+1=71 —— 这是【cell 的位置】—— resolve(71) 深度 2 =
// 在 cell 内容内？cell(71) → node(2)=? 应该 cell —— 显示 table_row！
// —— 行4 的 cell pos 不是 71！selectRow(3) 里 rowStart=pos+1+rows[3]：
// rows[3] 是行4 相对 table 的 offset=30 —— rowStart=21+1+30=52 —— 
// cell=53。但 anchor=71 —— 71-52=19？—— 71 是【最后一行 lastCell】——
// 我们脚本传的 head=lastCell=71?（行4 末格 pos）。anchor 也是 71？
// CellSelection.create(doc, anchor=71, head=71)？—— 脚本传的
// anchor=rowStart+1=53，head=lastCell——71。res 的 $anchorCell.pos=71
// —— 说明 $anchorCell 是【head 侧】或 create 把大的放 anchor。
// 71 resolve → 深度 2，node(2)=table_row —— 71 在【行4 的某 cell 内容】
// —— resolve(71) 落在 cell 里的 text —— depth 应 3+。显示 2 —— 
// 71 = 行4 的 cell 开头（cell 内容为空时 depth=2: cell>row？—— 
// node(2)=table_row 说明 71 是【row 内容起点】= 第一个 cell 的位置。
// ★ before(2)=70 —— 但行4 doc 位置=52！70≠52 —— 除非 CellSelection 
// 的 $anchorCell 被规范化到了【最后一个 cell】—— lastCell=71 —— 
// resolve(71)：71 是 row 的内容起点 —— 说明 lastCell 算成了 71 而
// 行4 内容在 52-61 —— 71 超出行4！我们脚本的 lastCell 计算 bug：
// rowNode.forEach((c, off) => lastCell = max(..., rowStart+1+off)) —— 
// off 是相对 row 的 —— lastCell = 52+1+off —— 应该在 53-60 —— 71 哪来的？
// ★★★★★ 71 - 52 = 19 —— 【上一个测试残留的 doc】？—— 不 —— 
// setDoc 每次新文档。或者 max() 用了【旧 lastCell 初值 pos+2=23】…… 
// 71 ≈ 22+9*3+... —— 是【行4 之后】的位置！rowNode.forEach 的 off ——
// 若 rowNode 其实是【整个 table】（child(3) 返回的不是行4？）—— 
// rows[3] 的 offset=30 —— rowStart=52 —— child(3) 是第 4 子节点=行4 ✓
// —— forEach off 相对行内容 —— cell offs 0,4,8 → lastCell=61。
// 实测 anchor=71 —— 和 61 也不等。
// ◆◆ 直接 dump：行4 内所有 cell 的实际 pos：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
const dump = await p.evaluate(() => {
  const v = window.__pmView
  let pos = -1
  v.state.doc.forEach((n, off) => { if (pos < 0 && n.type.name === 'table') pos = off })
  const table = v.state.doc.nodeAt(pos)
  const rows = []
  table.forEach((r, off) => rows.push({ off, size: r.nodeSize }))
  return { tablePos: pos, rows, totalSize: table.nodeSize }
})
console.log(JSON.stringify(dump))
await b.close()
