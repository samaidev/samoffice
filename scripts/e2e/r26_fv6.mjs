// 单实例、事件不到。fv3 的裸层活、DocTableView 的层死 —— 
// 最后差异猜想：**proxy 的几何同步代码（syncProxyGeometry）在
// ResizeObserver 回调里高频改 style** → 每帧改 left/top/width/height →
// 层持续「重绘中」→ Chromium 持续把它当「正在变化」→ hit-test 排除！
// fv3 层 append 后从未改样式！
// 验证：检查正式 proxy 的 style 是否被持续写入（插桩 style 赋值）：
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
await p.waitForTimeout(4000)
// 观测 proxy 的 style 变化频率
const churn = await p.evaluate(() => new Promise(resolve => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  if (!proxy) { resolve({ err: 'no proxy' }); return }
  let changes = 0
  let last = proxy.getAttribute('style')
  const id = setInterval(() => {
    const cur = proxy.getAttribute('style')
    if (cur !== last) { changes++; last = cur }
  }, 50)
  setTimeout(() => { clearInterval(id); resolve({ changesIn2s: changes }) }, 2000)
}))
console.log('proxy style 变化:', JSON.stringify(churn))
// 对照：wrapper 的 style 变化
const churn2 = await p.evaluate(() => new Promise(resolve => {
  const w = document.querySelector('.tableWrapper')
  let changes = 0
  let last = w.getAttribute('style')
  const id = setInterval(() => { const c = w.getAttribute('style'); if (c !== last) { changes++; last = c } }, 50)
  setTimeout(() => { clearInterval(id); resolve({ wrapperChanges: changes }) }, 1500)
}))
console.log('wrapper style 变化:', JSON.stringify(churn2))
await b.close()
