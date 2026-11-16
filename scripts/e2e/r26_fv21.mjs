// 原生 handler 也没跑（from=1）。正式 proxy 真死。
// fv17 twin 唯一没复刻的一点 —— 让我逐字节对比两个 DOM：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 同 fv17：setDoc 后立即排 twin 4s
await p.evaluate(() => window.__setDocForTest({ meta: { title: 't' }, blocks: [
  { type: 'p', inline: [{ content: '段落内容一' }] },
  { type: 'table', rows: [
    [{ inline: [{ content: 'A1' }] }, { inline: [{ content: 'B1' }] }],
    [{ inline: [{ content: 'A2' }] }, { inline: [{ content: 'B2' }] }],
  ] },
] }))
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
  }, 4000)
})
await p.waitForTimeout(5000)
const cmp = await p.evaluate(() => {
  const proxy = document.querySelector('.pm-table-clickproxy')
  const twin = document.querySelector('[data-twin]')
  const dump = (el) => ({
    outer: el?.outerHTML.slice(0, 220),
    parent: el?.parentElement === twin?.parentElement,
    rect: el ? (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })() : null,
    z: el ? getComputedStyle(el).zIndex : null,
    // DOM 顺序
    idx: el ? [...el.parentElement.children].indexOf(el) : -1,
  })
  return { proxy: dump(proxy), twin: dump(twin) }
})
console.log(JSON.stringify(cmp, null, 1))
await b.close()
