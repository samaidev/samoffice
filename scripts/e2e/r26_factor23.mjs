// document 有 3 个 selectionchange + 1 个 mousemove！PM 挂 selectionchange。
// 静态回放页没有这些 —— 这是最后的差异候选！
// 但 selectionchange 不吞事件…… 除非处理器里有焦点操作！
// ★★★★★ PM 的 selectionchange 处理器（input.ts: selectionToDOM）会在
// 处理时【读取 selection 并同步 DOM Selection】。而 Chromium bug 组合：
// contenteditable + 表格 + DOM Selection 同步 —— selectionchange 在
// 点击后触发，PM 重设 selection → Chromium 取消后续 mousedown 派发？不。
// 事件顺序：pointerdown → mousedown → (focus) → selectionchange。
// 我们的 window capture 连 pointerdown 都没收到 —— 更早。
// mousemove on document！谁挂的？—— 拖拽插件/表格插件 mousemove？
// factor2 提取的 DOM 一样但静态无 mousemove 监听。它每秒都在跑
//（mousemove 高频）—— 不可能吞。
// ◆ 只剩一个实验能一锤定音：**移除全部 document/window 监听 → 点击**：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
// 劫持 EventTarget.prototype.addEventListener 先看，然后暴力移除：
// 无法移除已有匿名监听器 —— 但可以用「重派 DOM」法：
// 把整个 body 的 outerHTML 重新写一遍（同 HTML，新监听器丢失，
// React/PM 全废 —— 只为验证事件管线）→ 点击。
const res = await p.evaluate(() => {
  const html = document.body.innerHTML
  document.body.innerHTML = html
  window.__ev = 0
  window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true })
  const td = document.querySelector('.ProseMirror td')
  if (!td) return { err: 'no td after rewrite' }
  const r = td.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (res.err) { console.log(res.err); await b.close(); process.exit(0) }
await p.waitForTimeout(500)
await p.mouse.click(res.x, res.y)
await p.waitForTimeout(250)
console.log('DOM 重写后(监听全失):', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
await b.close()
