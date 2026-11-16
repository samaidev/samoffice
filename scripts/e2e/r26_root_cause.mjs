// 先搞清 40 次重建的根因 —— dispatch 循环。看 PM update 频率与
// NodeView 重建的关系：dispatch（即使同 doc）会重建 NodeView 吗？
// PM 只在 doc 结构变化时重建 NodeView —— decoration dispatch 不改 doc
// —— 不该重建！但实测 40 次。
// 可能性：React StrictMode 双效应导致【两个 PM view】交替？不 —— 单 pm dom。
// 或者 wrapper 的【父层 React 重渲染】把 pm-host innerHTML 重写？
// —— React 不会动 pm-host 内部。但 wrapper 是 PM 的 —— React 不碰。
// ★ 谁在每 100ms 重建 wrapper？插桩 MutationObserver 看移除/添加：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.on('console', m => { const t = m.text(); if (t.includes('PAGINATION') || t.includes('DECO')) console.log('LOG:', t.slice(0, 150)) })
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
const res = await p.evaluate(() => new Promise(resolve => {
  const pm = window.__pmView.dom
  const log = { removed: 0, added: 0, styleRewrites: 0 }
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') {
        log.removed += m.removedNodes.length
        log.added += m.addedNodes.length
      }
    }
  })
  mo.observe(pm, { childList: true })
  // PM dispatch 频率
  const v = window.__pmView
  const orig = v.dispatch.bind(v)
  let dispatches = 0
  v.dispatch = (tr) => { dispatches++; return orig(tr) }
  setTimeout(() => { mo.disconnect(); v.dispatch = orig; resolve({ ...log, dispatches3s: dispatches }) }, 3000)
}))
console.log('PM 3s:', JSON.stringify(res))
await b.close()
