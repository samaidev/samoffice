// 字体无关。line-height 1.79 也死（此前真实文档里 1.2 活 —— 差异！）
// 之前「活」的实验都是【大文档】；小文档可能怎么都不活？对照：大文档
// line-height 改 1.2 → 活。也就是说 bug 严重度依赖文档形态。
// ★ 抓住一个此前没注意的对照：probe36（最小结构+真实CSS）在小尺寸 ALIVE，
// 且没带 <p> 前缀段落、没带 show-marks 等类。r26_factor2 回放也 ALIVE ——
// 它带了完整类。两轮回放都活 → 【应用运行时】因子。React 在跑 = 
// 每帧都可能重渲染。给应用页面【冻结 React】试试：把 App 的 setState 
// 全废 —— 难。更实用：确认 React 是否在持续重渲染（rAF 循环里 setState）
// —— observe 页面某节点属性是否高频变化。之前 TD 重建 31 次是在大文档。
// 小文档静置时检查 DOM churn：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ text: '段落' }] },
  { type: 'table', rows: [[{ inline: [{ text: 'A1' }] }, { inline: [{ text: 'B1' }] }]] },
] }))
await p.waitForTimeout(2500)
const churn = await p.evaluate(() => new Promise(resolve => {
  let muts = 0
  const mo = new MutationObserver(list => { muts += list.length })
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  setTimeout(() => { mo.disconnect(); resolve(muts) }, 2000)
}))
console.log('DOM mutations in 2s (静置):', churn)
// rAF 期间 React 是否渲染：检查 __pmView.dom 是否被替换
const stab = await p.evaluate(() => new Promise(resolve => {
  const d0 = window.__pmView.dom
  let replaced = 0
  const id = setInterval(() => { if (document.querySelector('.ProseMirror') !== d0) replaced++ }, 100)
  setTimeout(() => { clearInterval(id); resolve(replaced) }, 2000)
}))
console.log('.ProseMirror 替换次数 2s:', stab)
await b.close()
