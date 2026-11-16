// 新代码在跑（交互前 0 proxy）。但交互后建的 proxy 死、
// evaluate 建的活 —— 同一时刻！
// ◆◆◆ 剩唯一可测差异：proxy 的【父元素】！DocTableView 里
// host = pmDom.parentElement。twin 实验里 host = 同一个 —— 
// fv21 parent=true 相同…… 
// ★★★ 等等 —— 我从没验证过 DocTableView 的 setTimeout 里【真的执行了
// setup】—— arm() 的 listener 也许从未触发（因为 document pointerdown
// capture 在 React 之前？—— 无所谓，我们监听的是 document capture）。
// ui2 里交互后 proxy=1 —— 触发了。但那个 proxy 是【60ms 后】建的。
// ★ 直接对照同页：交互后 —— 「我们的 60ms proxy」vs「evaluate 立即 twin」
// —— fv17 类似但创建源相反（当时 proxy=4s 旧代码）。
// 现在做最终对照：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
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
await p.waitForTimeout(2500)
// 在点击正文的【同一时刻】预置 evaluate 的 twin 计划（点击后 70ms 建
// —— 与正式 60ms 几乎同时！）
await p.evaluate(() => {
  window.__twinHit = ''
  const onPd = () => {
    window.document.removeEventListener('pointerdown', onPd, true)
    setTimeout(() => {
      const host = window.__pmView.dom.parentElement
      const w = document.querySelector('.tableWrapper')
      if (!w) return
      const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
      const d = document.createElement('div')
      d.dataset.twin2 = '1'
      d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:8;background:rgba(0,0,0,0.003)`
      d.addEventListener('mousedown', () => { window.__twinHit = 'twin' })
      host.appendChild(d)
    }, 70)
  }
  window.document.addEventListener('pointerdown', onPd, true)
})
const paraBox = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(paraBox.x, paraBox.y)
await p.waitForTimeout(1000)
const st = await p.evaluate(() => ({
  proxy: document.querySelectorAll('.pm-table-clickproxy').length,
  twin: document.querySelectorAll('[data-twin2]').length,
}))
console.log('两者都建了:', JSON.stringify(st))
// 点击 td：z=8 的 twin 在上 —— 先移除 twin，只测 proxy；再重建 twin 测
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.evaluate(() => document.querySelector('[data-twin2]')?.remove())
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
console.log('① 仅正式 proxy:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from }))))
// 建 twin 再点
const tb = await p.evaluate(() => {
  const host = window.__pmView.dom.parentElement
  const w = document.querySelector('.tableWrapper')
  const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
  const d = document.createElement('div')
  d.dataset.twin2 = '1'
  d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:8;background:rgba(0,0,0,0.003)`
  window.__twinHit = ''
  d.addEventListener('mousedown', () => { window.__twinHit = 'twin' })
  host.appendChild(d)
  const r = w.getBoundingClientRect()
  return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
})
await p.mouse.click(tb.x, tb.y)
await p.waitForTimeout(300)
console.log('② twin(z8):', await p.evaluate(() => window.__twinHit) || '无')
await b.close()
