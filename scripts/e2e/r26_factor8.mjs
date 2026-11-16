// 应用页本身没问题，注入结构也活。→ 死区与【React 渲染出的编辑器 DOM】绑定。
// 静态回放(outerHTML)活 vs React 渲染的同结构死 —— 差异只剩：
// ★ React 给 DOM 设置的【属性细节】outerHTML 拷贝会丢的吗？—— 无（outerHTML 完整）。
// ★★ 【DOM 节点的创建方式】？无稽。
// ★★★ React 的事件委托在 #root —— 回放页我在 #root 挂了监听也活。
// ★★★★ 等等！！回放页没有 __pmView —— 没有任何代码【持有这些 DOM】。
// 应用里 PM/React 持有 → 但浏览器 hit-test 不在乎 JS 引用。
// ◆◆◆ 回到最过硬的事实重审：
//   1. 触摸 ALIVE（probe25）
//   2. 鼠标 DEAD —— 全格网格 0/184
//   3. elementFromPoint / CDP getNodeForLocation 正常
//   4. focusout(DIV→null) 出现过 —— 浏览器处理了 mousedown（挪焦点）
//     ★ 但事件没派发到 JS！
//   5. 事件 target=HTML 出现过一次（probe21 fixed clone in PM）
// ◆ Chromium 把这个区域的鼠标事件【路由给了别的消费者】：
//    —— 只有「鼠标捕获」(setPointerCapture) 或 「拖放状态」(drag) 能这样！
// ◆◆◆◆ 大胆新假设：**有个元素处于 pointer capture / 或文档处于 drag 状态**。
//    PM 的表格拖拽插件（createTableDragResizePlugin）在 mousedown 时若
//    误判「靠近边框」会 preventDefault —— 但事件仍应到达 window capture。
//    除非 —— mousedown 之前还有 pointerdown，插件或 PM 在 pointerdown 里
//    setPointerCapture 了别的元素 → 后续 mousedown 派发给捕获元素 ——
//    但捕获元素若已移除…… 捕获元素在文档里时事件 target=它。
//    而我们完全没收到 —— 因为**监听器挂在 window，事件 target 是捕获
//    元素，但 capture 冒泡仍经过 window！**
//    不对…… setPointerCapture 影响 pointer 事件，不影响 mousedown。
// ◆◆◆◆◆ 最后一种可能，也是我一直忽视的：**事件被派发到了别的 WINDOW**。
//    Playwright mouse 事件发到「焦点窗口」。页面上有 window.open 的隐藏
//    窗口/iframe？frames=0 已查。但 —— **print preview / beforeprint**？
//    应用有打印功能。查 window.open 弹窗：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } })
const p = await ctx.newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
const pages = ctx.pages()
console.log('context pages:', pages.length)
for (const pg of pages) console.log(' -', pg.url().slice(0, 60))
// 检查 window.name / opener / 弹窗
const winInfo = await p.evaluate(() => ({
  opened: !!window.open, name: window.name,
  hasOpener: !!window.opener,
  // 谁持有 pointer capture
  activeElement: document.activeElement?.tagName,
  // Element.prototype.hasPointerCapture 的活跃实例查不了 —— 但可以查
  // document 上是否有人在 drag 中
}))
console.log('win:', JSON.stringify(winInfo))
// 点击时监听 dragstart/selectstart —— 也许每次点击都触发了原生 drag！
await p.evaluate(() => {
  window.__ev2 = []
  for (const ev of ['dragstart', 'selectstart', 'pointerdown', 'mousedown', 'pointerlockchange', 'pointercancel']) {
    window.addEventListener(ev, e => window.__ev2.push(ev + ':' + (e.target?.tagName || '')), { capture: true, passive: true })
  }
})
const box = await p.evaluate(() => { const r = document.querySelector('.ProseMirror td').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
// 逐段点击：move → down → 等待 → up
await p.mouse.move(box.x, box.y)
await p.waitForTimeout(150)
await p.mouse.down()
await p.waitForTimeout(250)
const mid = await p.evaluate(() => [...window.__ev2])
await p.mouse.up()
await p.waitForTimeout(200)
console.log('按下期间事件:', JSON.stringify(mid))
console.log('全部事件:', JSON.stringify(await p.evaluate(() => window.__ev2)))
await b.close()
