// 铁证重复确认：evaluate twin 活、manager proxy 死。
// 两者此时刻唯一的【创建路径】差异。穷尽 DOM 层无差异后，唯一
// 没排除的：【manager 的 ensureProxy 从 kick.timer 的 setTimeout 调用】，
// 而 setTimeout 由【React effect 闭包】调度。
// ◆ 疯狂假设：React 18 的【时间切片】把我们的 setTimeout 回调包进了
// Scheduler 的 MessageChannel 循环 —— 回调执行时属于【Scheduler 任务】
// → Chromium 视为「脚本导致的布局变更」→ 层标记 pending —— 
// ★★ 验证法：manager 里不用 setTimeout —— 用 MessageChannel 直发
//（与 React Scheduler 不同的 channel）或 requestIdleCallback：
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
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2000)
// manager proxy 已建（死的）。现在用【MessageChannel】建一个同款层：
const pt = await p.evaluate(() => {
  window.__mcHit = ''
  const mk = () => {
    const host = window.__pmView.dom.parentElement
    const w = host.querySelector('.tableWrapper')
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.mctwin = '1'
    d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:7;background:rgba(0,0,0,0.003)`
    d.addEventListener('mousedown', () => { window.__mcHit = 'mc' })
    host.appendChild(d)
  }
  const ch = new MessageChannel()
  ch.port1.onmessage = () => mk()
  ch.port2.postMessage('go')
  return new Promise(r2 => setTimeout(() => { const w = window.__pmView.dom.parentElement.querySelector('.tableWrapper'); const rect = w.getBoundingClientRect(); r2({ x: rect.x + rect.width * 0.6, y: rect.y + rect.height * 0.5 }) }, 100))
})
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(300)
console.log('MessageChannel 建层:', await p.evaluate(() => window.__mcHit) || '无')
// 再试 requestIdleCallback 建层
const pt2 = await p.evaluate(() => new Promise(r2 => {
  window.__ricHit = ''
  requestIdleCallback ? requestIdleCallback(() => {
    const host = window.__pmView.dom.parentElement
    const w = host.querySelector('.tableWrapper')
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.rictwin = '1'
    d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:7;background:rgba(0,0,0,0.003)`
    d.addEventListener('mousedown', () => { window.__ricHit = 'ric' })
    host.appendChild(d)
    r2({ x: wr.x + wr.width * 0.6, y: wr.y + wr.height * 0.5 })
  }) : r2(null)
}))
if (pt2) {
  await p.mouse.click(pt2.x, pt2.y)
  await p.waitForTimeout(300)
  console.log('rIC 建层:', await p.evaluate(() => window.__ricHit) || '无')
}
await b.close()
