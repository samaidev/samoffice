// 加回监听全活！那「重写 DOM 后 ALIVE」的真正原因不是监听器丢失，
// 而是【重写这个动作本身】（DOM 重建 → 层树重建 → hit-test 修复）。
// 与 factor15 原位重插 DEAD 矛盾 —— 重写=所有节点新建；重插=老节点。
// ◆◆◆ 全部证据收敛成一句话：
//   【应用启动时创建的表格 NodeView DOM 从未进入合成器 hit-test 树】
//   后来新建的（重写后/克隆）都正常。原位重插不新建节点 → 仍死。
//   → 这是「层从未登记」而非「登记后失效」！
//   为什么表格会从未登记？—— 表格 NodeView 是在【编辑器初始布局之后】
//   才插入 DOM 的（PM updateChildren 分帧/微任务时序） → Chromium 把它
//   归入「后续增量」—— 而这个页面的增量层提交存在 bug。
//   段落为何活？段落可能也在增量里但被文本渲染层覆盖……
// ★★★ 修复思路定型（工程务实）：让 wrapper 在创建后【强制一次性重建】——
//   DocTableView constructor 里 rAF 后把 this.dom 原样 outerHTML 替换？——
//   会与 PM 冲突。更稳：constructor 里 rAF 双帧后 appendChild 自身
//   （自引用 move 触发层登记）—— factor15 重插无效…… 但那是【PM 内】。
//   终极方案：**NodeView 的 dom 初始 display:none → 双帧后 display:block**
//   （display 切换强制新建层 —— 等价于「重写」的效果且 PM 兼容）。
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
// 模拟修复：wrapper display:none → 双 rAF → 恢复
await p.evaluate(() => new Promise(resolve => {
  const w = document.querySelector('.tableWrapper')
  w.style.display = 'none'
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      w.style.display = ''
      void w.offsetHeight
      setTimeout(resolve, 300)
    })
  })
}))
await p.evaluate(() => { window.__ev = 0; window.addEventListener('pointerdown', () => window.__ev++, { capture: true, passive: true }) })
const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(250)
console.log('display:none→双帧→恢复:', (await p.evaluate(() => window.__ev)) > 0 ? 'ALIVE ✅✅✅' : 'DEAD')
await b.close()
