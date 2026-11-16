// 2s/4s 也死。产品代码建的层【无论何时】都死；evaluate 建的【无论何时】都活。
// ◆◆◆ 这已经不是时序 —— 是【执行上下文的本质差异】。最后一个没排除的
// 物理差异：**产品代码的 script type=module（ESM），evaluate 是 ClassicScript**。
// Chromium 对 module 脚本创建的 DOM 元素有 hit-test 差异？？—— 
// 从未听说，但这是仅剩的解释。验证：在 module 里 import 一个新 module，
// 由它建层 —— 还是 module。反之在页面里用 <script>（classic）注入建层代码：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 150)))
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
// 首次交互
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(1000)
// ★ 用【动态 import 的 module】建层（module 环境但独立于 React）
const pt = await p.evaluate(async () => {
  const blob = new Blob([`
    window.__modHit = ''
    const host = window.__pmView.dom.parentElement
    const w = host.querySelector('.tableWrapper')
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.modtwin = '1'
    d.style.cssText = 'position:absolute;left:' + (wr.left - hr.left + 6) + 'px;top:' + (wr.top - hr.top) + 'px;width:' + (wr.width - 12) + 'px;height:' + wr.height + 'px;z-index:7;background:rgba(0,0,0,0.003)'
    d.addEventListener('mousedown', () => { window.__modHit = 'module' })
    host.appendChild(d)
  `], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  await import(url) // module 执行
  const w = window.__pmView.dom.parentElement.querySelector('.tableWrapper')
  const rect = w.getBoundingClientRect()
  return { x: rect.x + rect.width * 0.6, y: rect.y + rect.height * 0.5 }
})
await p.mouse.click(pt.x, pt.y)
await p.waitForTimeout(300)
console.log('动态 module 建层:', await p.evaluate(() => window.__modHit) || '无')
await b.close()
