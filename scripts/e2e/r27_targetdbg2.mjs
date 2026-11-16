// 行3 mid=505。mousemove 到 505：i=0: 505<401? no; i=1: 505<453? no;
// i=2: 505 < 505? NO（等号不满足）→ i=3: 505<557 YES → target=3！
// target=3 = 插到行3 后 = R2 R3 R1 R4？不对 —— 期望插到行3 前 = target 2。
// 实测 R2R3R4R1 = insert 后末尾 —— target=3 时 insertAt：
// target(3) > toRow+1(1) → insertAt = 3 - 1 = 2 → rest=[R2,R3,R4] →
// [R2,R3] + [R1] + [R4] = R2 R3 R1 R4 —— 但实测 R2R3R4R1（insert 3）！
// 矛盾 → mouseup 时 target 又变了（最后 mousemove 在 up 前 ——
// steps=10 的终点 505 —— 但 mouseup 的 clientY 也许越过 —— 
// Playwright mouse.up 不带坐标 —— 最后位置 505 —— target=3 → 
// 应得 R2R3R1R4。实测 R2R3R4R1 —— insertAt=3。
// 那 target=4（>= 全部 mid）→ insertAt=4-1=3 → R2R3R4+R1 ✓ 吻合！
// 即 mouseup 前最后的 target=4 —— 最后 mousemove y > 557？
// steps=10 均匀插值 401→505 —— 终点 505。但「armed」在第一步就 true，
// 后续 mousemove 连续触发 —— 最后一次 505 —— target=3。
// ★ 除非中间某次 mousemove 的 y 超出（steps 插值不会）—— 
// 或者 **mouseup 触发时 targetRow 用了【初始 -1】→ 无效 return** 
// —— 不 —— 结果变了（R1 到末尾）。
// ◆ 唯一确定路径：target=4 → y≥557 —— 但实际 505……
// ★★★ 除非 wrap.querySelectorAll('tr') 返回的【不是 4 行】—— 
// 分页装饰把表格拆了？此处单页无分页 —— 4 行。
// ◆ 再想 —— target=3: insertAt=3-1=2 —— R2R3R1R4；
//    target=4: insertAt=3 —— R2R3R4R1 ✓ 实测！
//    所以 mouseup 时刻 target=4 —— y ≥ 557（行4 mid）。
//    也许 Playwright 的 mouse.move steps 的【移动轨迹】会先超出后回落？
//    不会。但 mouse.up() 前浏览器还派发最后一次 move（同坐标 505）。
// ◆◆ 用真实读取验证：在会话里记 targetRow 历史（产品代码无钩子 —— 
// 拦截 indicator.style.top 写入）—— 简单法：indicator 最终 top：
// top=479（行2 底=行3 顶）对应 target=2；531 对应 3；583 对应 4。
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
  const rowNode = v.state.doc.nodeAt(pos).child(0)
  let lastCell = pos + 2
  rowNode.forEach((c, off) => { lastCell = Math.max(lastCell, pos + 2 + off) })
  v.dispatch(v.state.tr.setSelection(pt.CellSelection.create(v.state.doc, pos + 2, lastCell)))
})
await p.waitForTimeout(400)
// 劫持 indicator 的 style 写入记录 top 序列
await p.evaluate(() => {
  window.__tops = []
  const origSet = CSSStyleDeclaration.prototype.setProperty
  // 拦截 appendChild 的 indicator 即可 —— 改为轮询 style.top
  const iv = setInterval(() => {
    const el = document.querySelector('.pm-row-move-indicator')
    if (el && el.style.display !== 'none') window.__tops.push(el.style.top)
  }, 16)
  setTimeout(() => clearInterval(iv), 4000)
})
const g = await p.evaluate(() => { const trs = [...document.querySelectorAll('.ProseMirror tr')]; const r0 = trs[0].getBoundingClientRect(); const r2 = trs[2].getBoundingClientRect(); return { sx: r0.x + r0.width * 0.5, sy: r0.y + r0.height * 0.5, ty: r2.y + r2.height * 0.5 } })
await p.mouse.move(g.sx, g.sy)
await p.mouse.down()
await p.waitForTimeout(150)
await p.mouse.move(g.sx, g.ty, { steps: 10 })
await p.waitForTimeout(400)
const tops = await p.evaluate(() => [...window.__tops])
await p.mouse.up()
await p.waitForTimeout(700)
console.log('指示线 top 序列:', JSON.stringify(tops))
console.log('行序:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.ProseMirror tr')].map(tr => tr.textContent))))
await b.close()
