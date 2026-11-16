import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 监控 proxy 的创建/移除时间线（MutationObserver on pm-host）
await p.evaluate(() => {
  window.__proxyTL = []
  const t0 = performance.now()
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.className?.toString().includes('pm-table-clickproxy')) window.__proxyTL.push('+' + Math.round(performance.now() - t0))
      for (const n of m.removedNodes) if (n.className?.toString().includes('pm-table-clickproxy')) window.__proxyTL.push('-' + Math.round(performance.now() - t0))
    }
  })
  // pm-host 尚未建 —— setDoc 后开始观察
  setTimeout(() => { const h = window.__pmView?.dom?.parentElement; if (h) mo.observe(h, { childList: true }) }, 100)
})
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
await p.waitForTimeout(5000) // 覆盖 2s/4s 波次
console.log('proxy 时间线:', JSON.stringify(await p.evaluate(() => window.__proxyTL)))
// 现在屏上 proxy 的 handler 有几个监听？getEventListeners 不可用 —— 
// 用 CDP：
const cdp = await p.context().newCDPSession(p)
const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.querySelector(".pm-table-clickproxy")' })
if (result.objectId) {
  const ls = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })
  console.log('proxy 监听器:', JSON.stringify(ls.listeners.map(l => l.type + '/' + (l.capture ? 'cap' : 'bub'))))
}
await b.close()
