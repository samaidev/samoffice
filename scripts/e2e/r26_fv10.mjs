// ★ 顶层=proxy（elementFromPoint 命中 proxy）但事件 []！
// fv8 的手工层（同样 alpha）能收到 —— 正式 proxy 收不到。
// 剩余差异：正式 proxy 有【ResizeObserver 在 observe(this.dom) 和 pmDom】！
// fv8 层无 RO。RO 的持续回调（若有）会改 style…… 但 fv6 测过 0 变化。
// 但 RO observe 本身让 Chromium 把该层标记为【需要持续监控】？
// ◆ 快速二分：手工层 + RO observe → 死不死：
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
// 变体矩阵：A 纯层（对照，应活）B 层+RO observe 自身 C 层+RO observe wrapper+pmDom
const mk = async (variant) => {
  const box = await p.evaluate((v) => {
    document.querySelectorAll('[data-vtest]').forEach(e => e.remove())
    const host = window.__pmView.dom.parentElement
    const w = document.querySelector('.tableWrapper')
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.vtest = v
    d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:6;background:rgba(0,0,0,0.003)`
    window.__vh = ''
    d.addEventListener('mousedown', () => { window.__vh = v })
    host.appendChild(d)
    if (v === 'ro-self') { const ro = new ResizeObserver(() => {}); ro.observe(d) }
    if (v === 'ro-full') {
      const ro = new ResizeObserver(() => { /* 模拟 syncProxyGeometry：读 rect 写 style */ })
      ro.observe(w); ro.observe(window.__pmView.dom)
    }
    const r = w.getBoundingClientRect()
    return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
  }, variant)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(250)
  return (await p.evaluate(() => window.__vh)) === variant
}
console.log('A 纯层:', await mk('plain') ? 'ALIVE ✅' : 'DEAD')
console.log('B 层+RO(self):', await mk('ro-self') ? 'ALIVE ✅' : 'DEAD')
console.log('C 层+RO(w+pm):', await mk('ro-full') ? 'ALIVE ✅' : 'DEAD')
await b.close()
