// 2500ms 也死！但 fv3 同页面 400ms 延迟层活 —— 矛盾的唯一解释：
// fv3 的测试层【晚于某个关键事件】创建。正式 proxy 与 fv3 层的本质差异：
// 正式 proxy 由【DocTableView 实例】持有（闭包引用 NodeView 对象），
// fv3 层是裸 DOM。JS 引用不该影响…… 除非 —— React StrictMode！
// DocumentEditor 双挂载：第一个 DocTableView 被销毁（destroy 清理 proxy）
// 但【destroy 时 proxy 可能还没创建】（400ms 未到，setup 的 setTimeout
// 仍在队列）→ 第一实例的 setTimeout 回调继续执行 → 建了个【孤儿 proxy】
// 然后第二实例也建 → 两个 proxy 重叠，孤儿在下面/或清理混乱！
// fv2 里 count=1 —— 只有一个……但哪个实例的？而且 destroy 后
// this.view 已废 —— syncProxyGeometry 引用旧 dom —— 或 mousedown 的
// cellPosMap 用旧 view（state 陈旧）→ dispatch 到【已销毁的 view】→
// 无效 → from=1！
// ★ 修：setup 里检查实例还活着（this.proxyEl === null 判定）+
// destroy 时取消 pending setTimeout。先验证假设：数 StrictMode 实例：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 计数 NodeView 构造/销毁：挂 window 计数器（通过 proxy 出现次数推断）
await p.evaluate(() => {
  window.__proxyCount = 0
  const origAppend = Element.prototype.appendChild
  // 简单法：MutationObserver 监听 pm-host 里 .pm-table-clickproxy 的增减
  const host = document.querySelector('.flex-1.overflow-auto')
  const mo = new MutationObserver(() => {
    window.__proxyCount = document.querySelectorAll('.pm-table-clickproxy').length
  })
  // host 可能还没建 —— 延迟到 setDoc 后再挂
  setTimeout(() => {
    const h2 = window.__pmView?.dom?.parentElement
    if (h2) mo.observe(h2, { childList: true })
    window.__moReady = true
  }, 100)
})
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
await p.waitForTimeout(4000)
const cnt = await p.evaluate(() => ({ proxies: document.querySelectorAll('.pm-table-clickproxy').length, wrappers: document.querySelectorAll('.tableWrapper').length }))
console.log('实例计数:', JSON.stringify(cnt))
// 两个 proxy 都收事件吗？
const evs = await p.evaluate(() => {
  const proxys = [...document.querySelectorAll('.pm-table-clickproxy')]
  window.__pe = []
  proxys.forEach((pr, i) => pr.addEventListener('mousedown', () => window.__pe.push(i), true))
  const rects = proxys.map(pr => pr.getBoundingClientRect())
  return rects.map(r => ({ x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }))
})
if (evs.length) {
  await p.mouse.click(evs[0].x, evs[0].y)
  await p.waitForTimeout(250)
  console.log('proxy[0] 收到:', JSON.stringify(await p.evaluate(() => window.__pe)))
}
await b.close()
