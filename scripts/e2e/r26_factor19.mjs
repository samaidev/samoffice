// 属性完全一致（clone 未连接所以 style 空）。唯一差异：原节点挂 pmViewDesc。
// 但 pmViewDesc 是 JS expando，浏览器 hit-test 不可能看见……
// ◆◆◆ 除非 —— 死的其实不是 wrapper 本身，而是**事件在 PM 的 DOMObserver
// 处理中被"预取消"**。Chromium 派发 pointerdown 前，若有 pending 的
// DOM mutations（MutationObserver 微任务）不会影响事件。
// ◆ 最后一个物理级怀疑：**wrapper 被移进 body 后，PM DOMObserver 立刻
// 把它移回去/重建**（subtree childList 监听）→ 我点击时它已不在 holder！
// factor17 的 holder 点击落空（hits 只有 clone-body）—— 也许 holder 里
// 早就空了！验证：点击时刻 holder 里有没有 wrapper：
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
const setup = await p.evaluate(() => {
  const w = document.querySelector('.tableWrapper')
  const holder = document.createElement('div')
  const r = w.getBoundingClientRect()
  holder.style.cssText = `position:fixed;left:${r.x}px;top:${r.y + 250}px;z-index:99999;background:#fff;border:2px solid #d33;width:420px;height:130px`
  document.body.appendChild(holder)
  holder.appendChild(w)
  window.__hits = []
  window.addEventListener('pointerdown', e => window.__hits.push(e.target.tagName + ':' + (e.target.className || '').toString().slice(0, 18)), { capture: true, passive: true })
  const hr = holder.getBoundingClientRect()
  return { x: hr.x + 100, y: hr.y + 30, holder }
})
await p.waitForTimeout(500)
// 点击前检查 holder 是否还有 wrapper
const check = await p.evaluate(() => {
  const h = [...document.querySelectorAll('div')].find(d => d.style.border?.includes('rgb(221'))
  const w = h ? h.querySelector('.tableWrapper') : null
  return { holderFound: !!h, hasWrapper: !!w, wInPM: w ? window.__pmView.dom.contains(w) : null }
})
console.log('点击前 holder 状态:', JSON.stringify(check))
await p.mouse.click(setup.x, setup.y)
await p.waitForTimeout(250)
console.log('hits:', JSON.stringify(await p.evaluate(() => window.__hits)))
await b.close()
