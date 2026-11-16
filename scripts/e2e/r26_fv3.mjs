// proxy 存在但 mousedown 不到达 —— 400ms 后创建的 proxy 也死！
// dbg15 成功的 proxy 是「5 秒后创建」或「更晚」。二分创建延迟：
// 0.4s / 1s / 2s / 3s —— 找到最小可用延迟。
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
// 逐延迟测：删掉现有 proxy，等 N 秒后建一个新的朴素层（与正式代码同形态），点击
const testDelay = async (delayMs) => {
  await p.evaluate((ms) => { window.__delayMs = ms }, delayMs)
  const pt2 = await p.evaluate(() => {
    document.querySelectorAll('[data-dtest]').forEach(e => e.remove())
    document.querySelector('.pm-table-clickproxy')?.remove()
    const host = window.__pmView.dom.parentElement
    const w = document.querySelector('.tableWrapper')
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.dtest = '1'
    d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:6;background:transparent`
    window.__dh = ''
    d.addEventListener('mousedown', () => { window.__dh = 'hit' })
    setTimeout(() => host.appendChild(d), window.__delayMs)
    const r = w.getBoundingClientRect()
    return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
  })
  await p.waitForTimeout(delayMs + 600)
  await p.mouse.click(pt2.x, pt2.y)
  await p.waitForTimeout(250)
  return (await p.evaluate(() => window.__dh)) === 'hit'
}
for (const d of [400, 1000, 2000, 3000]) {
  console.log(`延迟 ${d}ms 创建:`, await testDelay(d) ? 'ALIVE ✅' : 'DEAD')
}
await b.close()
