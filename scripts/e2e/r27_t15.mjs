// 不点击无 dispatch、from=20（正文点击位置）—— SEL:52 确实由点击产生！
// PM 处理了点击 mousedown（可能 posAtCoords 从 td 坐标映射失败 →
// 回退到 doc 末尾 52？不对 —— PM posAtCoords 失败不会 dispatch）。
// ◆ PM 收到 mousedown 的证据链：SEL:52 只在点击时出现。
// → mousedown【真的派发了】，target 是某个 PM 关联的节点！
// 但 window capture 收不到 + proxy 收不到 —— 
// ★★★ 除非 —— 派发的 target 是【旧的 wrapper】（已从 DOM 移除但
// PM 的 handleDOMEvents 仍挂着？—— 不可能，移除节点不接收派发）
// ◆◆◆ 另一种解释：**Playwright mouse 事件的 target 决策走合成器
// （不给 JS），但 PM 的 dispatch SEL:52 来自【click 事件的 focus 副作用】
// → document.activeElement 变化 → PM 的 focus 事件处理 → 
// selection 重算 = 52**。即：mousedown 确实没派发到 DOM 树，
// 但 Chromium 内部仍然处理了【焦点移动】，PM 通过 focus/selectionchange
// 响应 —— anchor=P 也吻合（浏览器把 caret 放在末段落 P）！
// ◆ 结论：死区完整 —— 事件从未到 DOM。那 PM 的 SEL:52 是浏览器
// caret 放置 → selectionchange → PM 同步。全是被动结果。
// ★★★★ 决战方向修正：既然【Chromium 内部仍会处理焦点与 caret】，
// 利用这点：让点击区域【没有可聚焦的 contenteditable】→ caret 无处放
// → 或者接受现实：**proxy 必须能收到事件** —— 这是唯一出路。
// fv17 twin 能收、我们的 proxy 不能 —— 最后手段：完全照抄 fv17 的
// 【evaluate 建层】到产品代码 = 不可能。
// ◆◆ 但还有一个没测的变量：**twin 的 mousedown handler 无 preventDefault**,
// 我们的 handler 有 —— 但到达与否在 handler 前（fv11 已验证过 pd 无碍）。
// ★ 最后一次系统对比：同页面同刻建【proxy(manager) vs twin(evaluate)】，
// 这一次在【t27 全新干净 vite】下做（排除一切缓存）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
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
await p.waitForTimeout(2500)
// 首交互（激活管理器 400ms 建 proxy）
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2000)
// 此时管理器 proxy 已建（400ms+1200ms 双保险）—— 再放 evaluate twin（z8）
const pt = await p.evaluate(() => {
  const host = window.__pmView.dom.parentElement
  const w = host.querySelector('.tableWrapper')
  const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
  const d = document.createElement('div')
  d.dataset.twin3 = '1'
  d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:8;background:rgba(0,0,0,0.003)`
  window.__t3hit = ''
  d.addEventListener('mousedown', () => { window.__t3hit = 'twin' })
  host.appendChild(d)
  const r = w.getBoundingClientRect()
  return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
})
// 点击：z8 twin 在最上
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(300)
console.log('twin(z8) 收到:', await p.evaluate(() => window.__t3hit) || '无')
// 移除 twin → 点 proxy 位置
await p.evaluate(() => document.querySelector('[data-twin3]')?.remove())
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(600)
console.log('proxy 点击 from:', await p.evaluate(() => window.__pmView.state.selection.from), '(20/52=没到handler; 25=到了)')
await b.close()
