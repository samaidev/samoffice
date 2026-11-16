// PM 零 dispatch、零 childList —— 那 ui12 的 40 次「重建」是假象：
// 每 100ms querySelector('.tableWrapper') 返回不同节点？不 —— 
// removed/added=0，节点从未变！ui12 的 rebuilds 统计有 bug：
// setInterval 里 `w !== last` —— 第一次 last=初始 w，若 w 恒同则 0。
// 但测出 40 —— 即每 100ms 都不同？！与 MO=0 矛盾 —— 
// 除非 MO observe 的 pm 不是 wrapper 的父（wrapper 在 pm 内？—— 
// 是。除非 PM dom 本身被换 —— view 重建！两次 setDoc? 只 setDoc 一次。
// ★ 重测 ui12（相同代码）确认可复现性：
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
await p.waitForTimeout(2000)
const res = await p.evaluate(() => new Promise(resolve => {
  let rebuilds = 0
  let last = document.querySelector('.tableWrapper')
  const id = setInterval(() => {
    const w = document.querySelector('.tableWrapper')
    if (w && w !== last) { rebuilds++; last = w }
  }, 100)
  setTimeout(() => { clearInterval(id); resolve({ rebuilds4s: rebuilds }) }, 4000)
}))
console.log('重测 rebuilds:', JSON.stringify(res))
// 同时验证 view 是否在换（pm dom 节点身份）
const pm = await p.evaluate(() => {
  let last = window.__pmView.dom
  let changes = 0
  return new Promise(resolve => {
    const id = setInterval(() => { if (window.__pmView.dom !== last) { changes++; last = window.__pmView.dom } }, 100)
    setTimeout(() => { clearInterval(id); resolve({ pmDomChanges: changes }) }, 3000)
  })
})
console.log('pm dom 更换:', JSON.stringify(pm))
await b.close()
