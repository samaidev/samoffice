// setNodeMarkup 重建 NodeView 也死！（PM 会复用旧 NodeView 实例 —— 
// desc 重建但 dom 复用 —— 又是「同一批节点」）。
// ◆◆◆◆◆ 承认现实：这是 Chromium（此版本）的顽固 bug，DOM 手段全部无效。
// 唯一可靠活形态 = wrapper 在 PM dom 外。
// ★ PM 官方支持 NodeView 外置吗？—— YES！ProseMirror 文档明确允许
// 「NodeView DOM 可以被移动到编辑器外」（如浮动窗口场景），PM 通过
// getPos + dom 引用工作，光标定位用 posAtCoords 兜底。
// ◆ 实施评估：把 DocTableView.dom 挂到「编辑器外的 overlay 层」，用
// absolute 定位跟随文档流位置 —— 滚动/分页时同步 —— 复杂度高、风险大
//（分页引擎按 tbody>tr 测量、选区高亮、CellSelection 全依赖在树内）。
// ◆★ 换一个角度 —— 【iframe 包裹整个应用】不现实。
// ★★★ 最后一次尝试「官方修复路径」：Chromium 这种 hit-test 快照问题
// 的已知 workaround 是 **强制 compositor commit**：
// `element.getAnimations()`? / Web Animations API 创建并取消一个动画：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(3000)
const test = async (name, fn) => {
  await p.evaluate(fn.toString())
  await p.waitForTimeout(400)
  await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
  const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  console.log(`${name}:`, (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅' : 'DEAD')
}
await test('baseline', () => {})
await test('Web Animations 触发+取消', () => {
  const w = document.querySelector('.tableWrapper')
  const anim = w.animate([{ transform: 'translateZ(0)' }, { transform: 'translateZ(0)' }], { duration: 1 })
  anim.finished.then(() => anim.cancel()).catch(() => {})
})
await test('transition 触发', () => {
  const w = document.querySelector('.tableWrapper')
  w.style.transition = 'opacity 1ms'
  w.style.opacity = '0.999'
  setTimeout(() => { w.style.opacity = '1' }, 20)
})
await test('requestFullscreen 取消(不可行跳过)', () => {})
await b.close()
