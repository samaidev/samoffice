// ★★★★★ 真相大白！！！交互后【NodeView 重建了】（wrapper gen2）—— 
// 点击正文触发 PM 更新 → NodeView 销毁重建 → 【新 DocTableView 的
// attachClickProxy 又注册一个 arm】+ 老 proxy 被 destroy 清理，
// 新 proxy 由【新 NodeView 的 60ms setTimeout】建 —— 但那个 setTimeout
// 的调度发生在【React/PM 事务期间】→ 又是「挂载期」创建 → 死！
// 而 evaluate 的 twin 建在事务外 → 活！
// ◆ 机理完全清晰：**在 PM update/React commit 期间（同步栈）创建的层
// 全部进死名单；事件循环空闲后创建的层正常。**
// ★★★ 修复：setup 的 setTimeout 回调里【再延迟到 requestIdleCallback/
// 双 setTimeout】确保脱离事务栈？—— 事务早已结束（60ms 后）。
// 不对 —— fv20 的 4s 版本也死！说明 NodeView 在 4s 内也被重建过
//（分页引擎 decoration 每帧 dispatch → PM updateState → NodeView
//  update 而非重建…… 重建只在结构变化时）。
// ui6 的重建是【点击正文】导致 —— 因为点击触发 selection 事务？
// NodeView 重建条件：node 类型变化或 PM 决定重挂。点击正文不该重建表格
// NodeView …… 除非 React 重渲染 DocumentEditor → useEffect [document]
// → view.updateState(新 state) → PM 重建全部 NodeView？
// —— dispatchTransaction 只在 docChanged 时 emit → App setDoc → 
// applyWindow? —— 点击正文改 selection（不 docChanged）→ 不重渲染。
// 但 wrapper 确实换节点了！—— 一定有什么重建了它。
// ★ 不管谁重建 —— 解法：**arm 的触发时机避开「NodeView 刚创建」：
// destroy 时取消未决 arm；且 setup 前检查【上次创建的 proxy 是否还活着】
//（全局只留一个，由 PM 外的管理器持有 —— 不随 NodeView 重建）。
// 更简单可靠：把 proxy 的创建/持有移到【DocumentEditor 层】（React 组件，
// 不随 PM NodeView 重建），一个表格一个 proxy，React 卸载时清理。
// 先快速验证「双 setTimeout（60+60）」能否解决：
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
await p.waitForTimeout(2000)
// 模拟「点击正文后 60ms —— 此时 NodeView 重建链上 —— 再 +500ms 双延迟」
// 建 twin（如果双延迟能活 → 修法就是双 setTimeout）
const paraBox = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
// 先点（触发重建 + 老 proxy 建立(死的)）
await p.mouse.click(paraBox.x, paraBox.y)
await p.waitForTimeout(400)
// 双延迟 twin
const box = await p.evaluate(() => {
  const host = window.__pmView.dom.parentElement
  const w = document.querySelector('.tableWrapper') // gen2 wrapper
  const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
  const d = document.createElement('div')
  d.dataset.t3 = '1'
  d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:8;background:rgba(0,0,0,0.003)`
  window.__t3 = ''
  d.addEventListener('mousedown', () => { window.__t3 = 'hit' })
  host.appendChild(d)
  const r = w.getBoundingClientRect()
  return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
})
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(300)
console.log('重建后 evaluate twin:', await p.evaluate(() => window.__t3) || '无 —— 说明 wrapper 重建本身让【整个区域】重新死区')
// 同时点【正式 proxy】位置（老 proxy 应该还盖着 gen2 区域? 检查两者 rect）
const rects = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  const w = document.querySelector('.tableWrapper')
  const pr = proxy?.getBoundingClientRect(), wr2 = w.getBoundingClientRect()
  return { proxy: pr ? [Math.round(pr.x), Math.round(pr.y)] : null, wrapper: [Math.round(wr2.x), Math.round(wr2.y)] }
})
console.log('rects:', JSON.stringify(rects))
await b.close()
