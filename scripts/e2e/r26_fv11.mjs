// RO 无罪！纯层+RO 全活。正式 proxy 与手工层的差异清单收尾：
// 1) mousedown 处理内容（preventDefault/setTimeout/cellAtPoint）
// 2) mouseup preventDefault
// 3) scroll listener on scroller
// 4) 创建时间点（NodeView+2.5s vs setDoc+3.5s —— 相近）
// 5) className 有值 vs 无
// 逐项给手工层加，找到毒药：
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
await p.waitForTimeout(3500)
const mk = async (variant) => {
  const box = await p.evaluate((v) => {
    document.querySelectorAll('[data-vtest]').forEach(e => e.remove())
    const host = window.__pmView.dom.parentElement
    const w = document.querySelector('.tableWrapper')
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.vtest = v
    if (v === 'with-class') d.className = 'pm-table-clickproxy'
    d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:6;background:rgba(0,0,0,0.003)`
    window.__vh = ''
    if (v === 'plain' || v === 'with-class') d.addEventListener('mousedown', () => { window.__vh = v })
    if (v === 'pd-handler') d.addEventListener('mousedown', (e) => { e.preventDefault(); window.__vh = v })
    if (v === 'full-handler') {
      d.addEventListener('mousedown', (e) => { e.preventDefault(); window.__vh = v; setTimeout(() => { window.__vh = v + '-applied' }, 0) })
      d.addEventListener('mouseup', (e) => e.preventDefault())
    }
    if (v === 'scroll-listener') {
      d.addEventListener('mousedown', () => { window.__vh = v })
      window.__pmView.dom.closest('.overflow-auto')?.addEventListener('scroll', () => {}, { passive: true })
    }
    host.appendChild(d)
    const r = w.getBoundingClientRect()
    return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
  }, variant)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(300)
  return await p.evaluate(() => window.__vh)
}
console.log('plain:', await mk('plain'))
console.log('with-class:', await mk('with-class'))
console.log('pd-handler:', await mk('pd-handler'))
console.log('full-handler:', await mk('full-handler'))
console.log('scroll-listener:', await mk('scroll-listener'))
await b.close()
