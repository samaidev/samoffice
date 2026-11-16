// ★★★★★ 决定性！同位置同时刻：twin 命中、proxy 不命中。
// DOM 上两者几乎相同。唯一差异只剩：
// 1) twin 的 style 一次性写全（cssText 含 left/top/w/h）
// 2) proxy 的 style 先 cssText 基础，再 syncProxyGeometry 分四次写
//    left/top/width/height + display
// 3) proxy 的 className 是 'pm-table-clickproxy' —— twin 无类名！
// ★★★ fv11 with-class 变体（className=pm-table-clickproxy）活了 —— 
// 但那层的几何是一次性写的！
// 二分：A) twin+类名 B) proxy式分步写几何（无类名）
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
const mk = async (variant) => {
  const box = await p.evaluate((v) => {
    document.querySelectorAll('[data-btest]').forEach(e => e.remove())
    const host = window.__pmView.dom.parentElement
    const w = document.querySelector('.tableWrapper')
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.btest = v
    if (v === 'with-class') d.className = 'pm-table-clickproxy'
    if (v === 'stepwise') {
      // 分步写几何（模拟 syncProxyGeometry）
      d.style.cssText = 'position:absolute;z-index:6;background:rgba(0,0,0,0.003)'
      host.appendChild(d)
      d.style.display = 'block'
      d.style.left = (wr.left - hr.left + 6) + 'px'
      d.style.top = (wr.top - hr.top) + 'px'
      d.style.width = (wr.width - 12) + 'px'
      d.style.height = wr.height + 'px'
      window.__bh = ''
      d.addEventListener('mousedown', () => { window.__bh = v })
      const r = w.getBoundingClientRect()
      return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
    }
    d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:6;background:rgba(0,0,0,0.003)`
    window.__bh = ''
    d.addEventListener('mousedown', () => { window.__bh = v })
    host.appendChild(d)
    const r = w.getBoundingClientRect()
    return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
  }, variant)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  return (await p.evaluate(() => window.__bh)) === variant
}
console.log('with-class(一次性几何):', await mk('with-class') ? 'ALIVE ✅' : 'DEAD')
console.log('stepwise(分步几何,无类名):', await mk('stepwise') ? 'ALIVE ✅' : 'DEAD')
await b.close()
