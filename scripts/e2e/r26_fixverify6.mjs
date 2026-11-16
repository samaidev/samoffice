// ★★ PM doc: paragraph[unsupported] + paragraph[] —— 没有 table 节点！
// 表格的 DOM 是 NodeView 建的（内容 A1/B1 正常），但 PM doc 里表格变成
// [unsupported block] 段落 —— 外置破坏了 PM 的 DOM→doc 同步！
// PM 的 DOMObserver 看到「NodeView dom 被移走」→ 解读为删除 → 重建 doc
// 时把表格内容丢了 → doc 里表格变 [unsupported]（从 UDM 再转时）。
// → 外置方案与 PM 文档模型冲突 —— PM 不支持 dom 移出 view.dom！
// （官方「移动 NodeView 到编辑器外」只适用于【无 contentDOM 的原子节点】，
//  表格有 contentDOM —— 移出后 PM 无法同步内容！）
// ◆◆◆ 外置方案死刑。回到唯一可行解 —— **td 级外置**不行……
// ★★★ 最后一击（真正可行）：**iframe 隔离编辑器**不可行。
// 换【降维方案】：把整棵 .ProseMirror 移出 pm-host？等价重写 —— 
// PM 的 view.dom 本身可以 reparent（view 保持功能）！
// 验证：把 view.dom（.ProseMirror）整体移到 pm-host 的兄弟/新容器 → 
// PM 依然工作（dom 引用不变）→ 死区是否消失！
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
// 等外置 NodeView 稳定后，把 view.dom 整体 reparent 到新 div（在 pm-host 内）
const moved = await p.evaluate(() => {
  const v = window.__pmView
  const pmDom = v.dom
  const host = pmDom.parentElement
  const wrap = document.createElement('div')
  wrap.style.cssText = 'width:100%'
  host.appendChild(wrap)
  wrap.appendChild(pmDom)
  return { wrapped: pmDom.parentElement === wrap }
})
console.log('view.dom 换父:', JSON.stringify(moved))
await p.waitForTimeout(800)
// 表格 wrapper 现在在哪？（外置逻辑把它挂在旧 pm-host —— NodeView 重建了吗）
const st = await p.evaluate(() => {
  const v = window.__pmView
  const w = document.querySelector('.tableWrapper')
  return {
    docTop: (() => { const a = []; v.state.doc.forEach((n, off) => a.push(off + ':' + n.type.name)); return a })(),
    wInPM: w ? v.dom.contains(w) : null,
    wParent: w?.parentElement?.className?.toString().slice(0, 20) || w?.parentElement?.tagName,
    tdText: document.querySelector('td')?.textContent,
  }
})
console.log('reparent 后状态:', JSON.stringify(st))
// 点击
await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
const box = await p.evaluate(() => { const td = document.querySelector('td'); if (!td) return null; const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
if (box) {
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(300)
  console.log('点击:', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
  await p.keyboard.type('Q5', { delay: 60 })
  await p.waitForTimeout(400)
  console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
} 
await b.close()
