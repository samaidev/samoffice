// CSS 全灭。物理事实：节点在 PM dom 内 = 死；移出 = 活。
// 那么修复可以是【结构性的】：让表格 wrapper 不在 .ProseMirror dom 内！
// ProseMirror 官方支持「external node view DOM」：NodeView 的 dom 可以
// 挂在编辑器外（PM 文档允许 NodeView constructor 返回 dom 不插入 contentDOM），
// 但 PM 要求 NodeView dom 在编辑器 DOM 树内用于光标定位 —— 实际上 PM 的
// posAtCoords 支持任意 DOM —— 不行，PM updateChildren 会把 NodeView dom
// append 到正确位置。
// ◆ 换个思路验证一个惊天嫌疑：**.ProseMirror dom 上的
// 【CSS ::selection / caret】？** 不。
// ★★ 回到「事件没派发」最本质的解释：Chromium 只在两种情况下吞鼠标事件：
//   1. devtools 协议禁用输入 —— 无
//   2. **pointer-events 的「表格式」UA 样式**：表格 <table> 在 contenteditable
//      里有 UA 规则 -webkit-user-select 等，但不会吞事件
//   3. ★ **pending compositor commit**：层树有未提交的 invalidation 时
//      hit-test 用旧树 —— 若「永远 pending」则永远旧树！
//      什么会让 commit 永远 pending？—— 【rAF 循环里持续改样式】！
//      分页引擎 recompute 有 rAF 循环！之前测「静置 rAF=0」（verify39：
//      rafIn500ms=0）—— 但那是在大文档静置后。
//      ★★ 小文档呢？立即测小文档 rAF 频率 + PM update 频率：
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
const act = await p.evaluate(() => new Promise(resolve => {
  const o = { raf: 0, pmDispatch: 0, muts: 0, styles: 0 }
  const origRaf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = cb => origRaf(() => { o.raf++; cb() })
  const v = window.__pmView
  const origDispatch = v.dispatch.bind(v)
  v.dispatch = tr => { o.pmDispatch++; return origDispatch(tr) }
  const mo = new MutationObserver(l => { o.muts += l.length })
  mo.observe(v.dom, { subtree: true, childList: true, attributes: true, attributeStyle: true })
  setTimeout(() => {
    window.requestAnimationFrame = origRaf
    v.dispatch = origDispatch
    mo.disconnect()
    resolve(o)
  }, 1500)
}))
console.log('小文档 1.5s 活动:', JSON.stringify(act))
await b.close()
