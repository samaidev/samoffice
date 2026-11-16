// alpha 背景也不行！dbg7 朴素层能收 —— 差异只剩 z-index（9 vs 6）和
// 「朴素层挂在 proxy.parentElement（pm-host）的后面 append（DOM 顺序在
// proxy 之后）」。z-index 相同时 DOM 顺序决定 —— 朴素层 z-index:9 更高。
// ★ 也许 z-index:6 被 pm-host 里的什么压住了？pm-host 层级：
// L1(flex) L2(z-index:1!) —— z:1 的层在 pm-host 祖先链上 —— 不影响。
// 纸页层 zIndex:0（在 scaler 内）。pm-host 内的行号层 zIndex:2。
// proxy z:6 应该最高…… 但「行号层」在 pm-host 里 zIndex:2 —— proxy 6>2。
// ◆ 直接实验矩阵：z-index 6/9/999 + DOM 位置（host 内 vs host 外）：
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
await p.waitForTimeout(3000)
const mkTest = async (name, setupSrc) => {
  const pt = await p.evaluate((src) => {
    document.querySelectorAll('[data-ztest]').forEach(e => e.remove())
    new Function(src)()
    const el = document.querySelector('[data-ztest]')
    if (!el) return null
    el.addEventListener('mousedown', () => { window.__zhit = el.dataset.ztest })
    window.__zhit = ''
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 }
  }, setupSrc)
  if (!pt) { console.log(`${name}: setup 失败`); return }
  await p.mouse.click(pt.x, pt.y)
  await p.waitForTimeout(220)
  console.log(`${name}:`, (await p.evaluate(() => window.__zhit)) || '无事件')
}
const tdGeo = await p.evaluate(() => { const r = document.querySelector('.tableWrapper').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } })
await mkTest('pm-host 内 z:6 无背景', `(() => {
  const host = window.__pmView.dom.parentElement
  const d = document.createElement('div'); d.dataset.ztest = 'z6'
  d.style.cssText = 'position:absolute;left:${tdGeo.l}px;top:${tdGeo.t}px;width:${tdGeo.w}px;height:${tdGeo.h}px;z-index:6'
  host.appendChild(d)
})()`)
await mkTest('pm-host 内 z:9 无背景', `(() => {
  const host = window.__pmView.dom.parentElement
  const d = document.createElement('div'); d.dataset.ztest = 'z9'
  d.style.cssText = 'position:absolute;left:${tdGeo.l}px;top:${tdGeo.t}px;width:${tdGeo.w}px;height:${tdGeo.h}px;z-index:9'
  host.appendChild(d)
})()`)
await mkTest('pm-host 内 z:6 + rgba 背景同位置(重现dbg2)', `(() => {
  const host = window.__pmView.dom.parentElement
  const d = document.createElement('div'); d.dataset.ztest = 'rgba6'
  d.style.cssText = 'position:absolute;left:${tdGeo.l}px;top:${tdGeo.t}px;width:${tdGeo.w}px;height:${tdGeo.h}px;z-index:6;background:rgba(255,0,0,0.08)'
  host.appendChild(d)
})()`)
await b.close()
