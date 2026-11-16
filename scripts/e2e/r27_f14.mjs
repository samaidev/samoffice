// 现场 wrapper 匹配成功（r0c0）但闭包 noHit —— 【闭包 wrapper 是旧的】
// 实锤！点击正文导致 NodeView 重建，管理器没有跟着更新 proxy。
// MutationObserver scheduleSync 应该处理重建 —— 但 proxy 是按
// proxies Map<wrapper> 键控 —— 新 wrapper 需要 ensureProxy —— 
// scheduleSync 每次都跑（MO 触发）—— 为什么屏上 proxy 还是旧闭包的？
// ★ 可能：新 wrapper 建了新 proxy，但【新 proxy 不在顶部/位置错】
// —— 或者旧 proxy 没被清理（旧 wrapper 未断开？NodeView 重建后旧
// wrapper dom 被 PM 移除 —— isConnected=false → 应被清）。
// 查屏上有几个 proxy + 各自闭包 wrapper 状态（通过几何）：
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
const st = await p.evaluate(() => {
  const proxys = [...document.querySelectorAll('.pm-table-clickproxy')]
  const wrapper = document.querySelector('.ProseMirror .tableWrapper')
  const wr = wrapper.getBoundingClientRect()
  return proxys.map(pr => {
    const r = pr.getBoundingClientRect()
    return { z: pr.style.zIndex, top: Math.round(r.top), w: Math.round(r.width), covers: Math.abs(r.top - wr.top) < 3 && r.width > 100 }
  })
})
console.log('proxies:', JSON.stringify(st))
await b.close()
