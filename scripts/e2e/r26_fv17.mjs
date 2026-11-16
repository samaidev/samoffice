// 源码顺序正确。fv14 出生即死 vs fv15 复刻活 —— 复刻是在
// 【页面活了 4.5s 之后】由 evaluate 建。正式 proxy 在 4.0s 由
// DocTableView 的 setTimeout 建。差 0.5s + 创建者。
// ★★★ 终极 A/B：同一页面，让【DocTableView 的 setTimeout(4000)】和
// 【evaluate 的 setTimeout(4000)】同时各自建层，对比：
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
// 立刻安排 evaluate 侧 4s 后建 twin（与正式同时刻）
await p.evaluate(() => {
  window.__twinHit = ''
  setTimeout(() => {
    const host = window.__pmView.dom.parentElement
    const w = document.querySelector('.tableWrapper')
    if (!w) return
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.twin = '1'
    d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:6;background:rgba(0,0,0,0.003)`
    d.addEventListener('mousedown', () => { window.__twinHit = 'twin' })
    host.appendChild(d)
    window.__twinBorn = Date.now()
  }, 4000)
})
await p.waitForTimeout(5000)
// 检查两者
const state = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  const twin = document.querySelector('[data-twin]')
  // 给正式 proxy 也插桩
  window.__proxyHit = ''
  proxy?.addEventListener('mousedown', () => { window.__proxyHit = 'proxy' }, true)
  return {
    proxy: proxy ? { x: proxy.getBoundingClientRect().x, w: proxy.getBoundingClientRect().width } : null,
    twin: twin ? { x: twin.getBoundingClientRect().x, w: twin.getBoundingClientRect().width, born: window.__twinBorn ? Date.now() - window.__twinBorn : -1 } : null,
  }
})
console.log('两者状态:', JSON.stringify(state))
// 点击：先点 proxy 区域中心
const wBox = await p.evaluate(() => { const r = document.querySelector('.tableWrapper').getBoundingClientRect(); return { x: r.x + r.width * 0.35, y: r.y + r.height * 0.5, x2: r.x + r.width * 0.75 } })
await p.mouse.click(wBox.x, wBox.y)
await p.waitForTimeout(250)
console.log('点击左半(proxy应盖):', JSON.stringify(await p.evaluate(() => ({ proxy: window.__proxyHit, twin: window.__twinHit }))))
await p.mouse.click(wBox.x2, wBox.y)
await p.waitForTimeout(250)
console.log('点击右半:', JSON.stringify(await p.evaluate(() => ({ proxy: window.__proxyHit, twin: window.__twinHit }))))
await b.close()
