// ★★★★★ 铁证如山：同一交互触发、几乎同时创建（60ms vs 70ms）、
// 同一位置同一 host —— evaluate 的 twin 活，DocTableView 闭包的 proxy 死。
// DOM 层面无任何差异。这只剩一个解释：【创建调用的 JS 栈】影响
// Chromium 层登记 —— 不可信…… 除非 —— mousedown handler 的差异？
// twin handler = 无参计数。proxy handler = 有 e.button 检查 + 
// this.cellAtPoint —— 【读 this.table.rows 的 getBoundingClientRect】！
// ★★★★★ cellAtPoint 在 mousedown 里同步读 12 个 rect —— 
// 等等！handler 是事件【到达后】才跑 —— 无法影响「到达与否」。
// 除非 handler 在【创建时】跑过一次抛异常 —— 不。
// ◆◆◆ 冷静。fv11 的 full-handler 复刻含 preventDefault+setTimeout —— 活。
// 但没复刻 this.cellAtPoint（读 this.table）—— handler 无关到达。
// ★★ 唯一还没排除的物理差异：**proxy 创建于 vite HMR 边界后的模块**，
// 其 DOM 操作走 sourcemap 重写？—— 疯了。
// ◆ 终极手段：在 setup 里把【createElement 换成 cloneNode(已活的 twin)】
// 不行 —— 需先改代码。
// ★ 直接在运行时劫持验证：把正式 proxy 的 parentNode 替换 —— 
// fv22 已测（移位无效）。
// ◆◆ 决定：不再纠结机理。工程解 = **让 DocTableView 的 proxy 也走
// 「evaluate 等价路径」**：不行 —— 都是我们的 JS。
// ★★★ 最后唯一稳定事实组合：
//   - 挂载期创建的层：死
//   - 交互后由 evaluate 创建：活
//   - 交互后由 DocTableView 创建（60ms 后）：死
// 差异只可能是【setTimeout 回调所属的 JS Realm/上下文】—— 
// 等一下！！！ setTimeout(setup, 60) 的 setup 是【DocTableView 的闭包】
// —— 而 arm() 的 listener 注册在 document。会不会 —— PM 的
// DOMObserver flush 或者 React 的批处理在 60ms 后【重渲染】，
// 重建 NodeView → 老 proxy 被新 proxy 替换（同 class）→ 
// 我们看到的是【第二个】—— 由【新 NodeView 的 setup】建 —— 但
// 首次交互 arm 只在第一个 NodeView 上注册！第二个 NodeView 的
// attachClickProxy 注册自己的 arm —— 但没交互过 —— 不建 —— 
// 但 ui5 显示 proxy=1 —— 建了（第一个的 60ms）。
// ★ 验证 NodeView 是否被重建（交互后 proxy 是否换了新节点）：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
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
await p.waitForTimeout(2000)
// 标记现有 wrapper（如果 NodeView 重建，wrapper 会换新节点）
await p.evaluate(() => { const w = document.querySelector('.tableWrapper'); w.dataset.marker = 'gen1' })
const paraBox = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(paraBox.x, paraBox.y)
await p.waitForTimeout(1000)
const gens = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const proxy = document.querySelector('.pm-table-clickproxy')
  return { wrapperGen: w?.dataset.marker || 'gen2(重建!)', proxyCount: document.querySelectorAll('.pm-table-clickproxy').length }
})
console.log('交互后:', JSON.stringify(gens))
await b.close()
