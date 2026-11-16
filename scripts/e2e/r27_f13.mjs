// noHit=true —— 坐标→td 匹配失败！点击点（td*0.6）不在任何 td rect 内？
// wrapper.querySelectorAll('tr') —— wrapper 是【闭包里的 wrapper】
//（ensureProxy 参数）—— 若【NodeView 重建后 wrapper 换新节点】而 proxy
// 闭包还是旧 wrapper —— 旧 wrapper 已不在 DOM → querySelectorAll 空！
// ★★★ 这就是根因！点击正文触发 PM 更新 → NodeView 重建 → 新 wrapper
// —— 管理器的 MutationObserver 应该 scheduleSync → 清理旧 proxy
//（!w.isConnected → remove）+ 为新 wrapper 建 proxy —— 但【新 proxy
// 的 mousedown handler 闭包是新 wrapper】—— 屏上的 proxy 是新的吗？
// 探针屏上 proxy 对应的 wrapper 是否在 DOM：
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
await p.waitForTimeout(3000)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(5000)
// 屏上 proxy 与 wrapper 的关联检查
const st = await p.evaluate(() => {
  const pm = window.__pmView.dom
  const wrapper = pm.querySelector('.tableWrapper')
  const proxy = document.querySelector('.pm-table-clickproxy')
  // wrapper 在点击后是否被重建（标记法已来不及 —— 直接查 proxy 的 tr 数）：
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;z-index:8;background:rgba(0,0,0,0.003)'
  // 模拟 handler 的匹配逻辑（用【此刻的 wrapper】）：
  const rows = wrapper.querySelectorAll('tr')
  const box = document.querySelector('td').getBoundingClientRect()
  let hit = null
  rows.forEach((tr, r) => { if (hit) return; tr.querySelectorAll('td,th').forEach((td, c) => { if (hit) return; const rect = td.getBoundingClientRect(); if (box.x + 1 >= rect.left && box.x + 1 <= rect.right && box.y + 1 >= rect.top && box.y + 1 <= rect.bottom) hit = { r, c } }) })
  return { rowsNow: rows.length, liveMatch: hit, wrapperIsConnected: wrapper.isConnected }
})
console.log('此刻匹配测试:', JSON.stringify(st))
// 再点一次看 dbg（此刻 wrapper 肯定新鲜）
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(600)
console.log('再点 dbg:', JSON.stringify(await p.evaluate(() => window.__r27dbg)))
await b.close()
