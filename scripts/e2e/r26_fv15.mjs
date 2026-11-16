// 出生即死 —— 从创建的第一刻就不收事件。而 fv12 克隆（几秒后）活。
// 「创建上下文」= DocTableView 闭包的 setTimeout vs evaluate 的。
// ◆◆◆ 闪电般的洞察：**PM 的 DOMObserver！** proxy 是 pm-host 的子节点。
// pm-host 不是 PM dom —— PM 不观察。但 —— React 观察吗？不。
// ★★★★ 等等 —— 我猛然想起 syncProxyGeometry 的 ResizeObserver：
// this.proxyRo.observe(this.dom) —— observe(wrapper)！wrapper 在 PM 内
// 且有 contentDOM —— PM 的 domObserver 有 MutationObserver 但那无关。
// RO observe wrapper 不改 wrapper。
// ◆ 最后一招（保真复刻）：把正式 setup 的完整逻辑在 evaluate 里
// 一字不差重演（包括 cellAtPoint 闭包、RO observe w+pm、scroll listener）
// —— fv10 的 ro-full 变体只 observe 没写 style；完整版写 style。
// 逐步逼近直到死：
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
await p.waitForTimeout(4500)
// 复刻链：setTimeout 4s（此刻相当于已过）→ append → sync（读 rect 写 style）
const mkFull = async (doSyncWrite) => {
  const box = await p.evaluate((syncWrite) => {
    document.querySelectorAll('[data-fftest]').forEach(e => e.remove())
    document.querySelector('.pm-table-clickproxy')?.remove()
    const host = window.__pmView.dom.parentElement
    const pmDom = window.__pmView.dom
    const w = document.querySelector('.tableWrapper')
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.fftest = '1'
    d.style.cssText = 'position:absolute;z-index:6;background:rgba(0,0,0,0.003)'
    host.appendChild(d)
    // 复刻 syncProxyGeometry
    const sync = () => {
      if (!d.isConnected) return
      const w2 = w.getBoundingClientRect(), h2 = host.getBoundingClientRect()
      if (w2.width < 2) { d.style.display = 'none'; return }
      d.style.display = 'block'
      d.style.left = (w2.left - h2.left + 6) + 'px'
      d.style.top = (w2.top - h2.top) + 'px'
      d.style.width = Math.max(0, w2.width - 12) + 'px'
      d.style.height = w2.height + 'px'
    }
    if (syncWrite) sync()
    window.__fh = ''
    d.addEventListener('mousedown', () => { window.__fh = 'hit' })
    // RO + scroll
    const ro = new ResizeObserver(() => { if (syncWrite) sync() })
    ro.observe(w); ro.observe(pmDom)
    pmDom.closest('.overflow-auto')?.addEventListener('scroll', () => { if (syncWrite) sync() }, { passive: true })
    const r = w.getBoundingClientRect()
    return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
  }, doSyncWrite)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  return (await p.evaluate(() => window.__fh)) === 'hit'
}
console.log('复刻(无 sync 写):', await mkFull(false) ? 'ALIVE ✅' : 'DEAD')
console.log('复刻(含 sync 写):', await mkFull(true) ? 'ALIVE ✅' : 'DEAD')
await b.close()
