// 同栈 twin 死 —— 栈是因子！PM/React 的 setTimeout？不可能 —— 
// setTimeout 是全局的。除非 vite/React 的【并发调度】…… 
// ◆ 唯一物理差异：DocTableView 回调执行时【页面处于某种状态】
//（如 React 更新批处理未完/PM flush 中），evaluate 执行时干净。
// ★ 但 60ms/4000ms 后仍死 —— 那状态不可能持续 4s。
// ◆◆◆ 除非每次都死循环重建：ui6 发现点击正文【重建 NodeView】！
// 分页引擎每帧 dispatch → 每帧 NodeView 重建？→ 每次重建都注册新 arm
// → 交互触发【所有积累的 arm】→ 最后一个 arm 的 setTimeout 建的 proxy
// 在「又一次 PM 事务」后 —— 死循环。
// ★ 直接验证 NodeView 重建频率（数 marker 变化）：
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
// 4s 内统计 wrapper 重建次数 + proxy 数量变化
const res = await p.evaluate(() => new Promise(resolve => {
  let rebuilds = 0
  let proxiesSeen = 0
  let last = document.querySelector('.tableWrapper')
  last?.setAttribute('data-gen', '0')
  const id = setInterval(() => {
    const w = document.querySelector('.tableWrapper')
    if (w && w !== last) { rebuilds++; w.setAttribute('data-gen', String(rebuilds)); last = w }
    proxiesSeen = Math.max(proxiesSeen, document.querySelectorAll('.pm-table-clickproxy').length)
  }, 100)
  setTimeout(() => { clearInterval(id); resolve({ rebuilds4s: rebuilds, proxiesSeen }) }, 4000)
}))
console.log('静置 4s:', JSON.stringify(res))
await b.close()
