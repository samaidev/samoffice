// proxy 建了、几何盖住 td、elementFromPoint=proxy —— 但事件仍不到！
// 「首次交互后建的层」也死？！但 fv22 同名新层活……
// fv22 的新层建在【页面存活 5s+ 且用户点击过一次后】。
// 现在 proxy 建在【首次点击后 60ms】—— 也许仍然太早（同一交互序列内）。
// ◆ 系统性重测「何时建的层能活」：
// 建层时机 = 首次点击后 [60ms, 500ms, 1s, 2s] + 无交互直接建 —— 
// 每种测一个 twin：
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
// 用户点击正文
const paraBox = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(paraBox.x, paraBox.y)
// 立即安排不同延迟的 twin
await p.evaluate(() => {
  window.__twins = {}
  const host = window.__pmView.dom.parentElement
  const mk = (delay) => setTimeout(() => {
    const w = document.querySelector('.tableWrapper')
    if (!w) return
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const d = document.createElement('div')
    d.dataset.td = String(delay)
    d.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:8;background:rgba(0,0,0,0.003)`
    d.addEventListener('mousedown', () => { window.__twins[delay] = 'hit' })
    host.appendChild(d)
  }, delay)
  ;[100, 600, 1500, 3000].forEach(mk)
})
await p.waitForTimeout(4000)
// 逐个测：点每个 twin 的左上角（按 delay 偏移 y 避免重叠 —— 它们同位，
// z 相同 —— 后建在上。按序从上往下点不可靠。改为：逐个只留一个）
// 简化：把 twins 全删，只测一个 —— 用 delay 维度轮询：
for (const delay of [100, 600, 1500, 3000]) {
  await p.evaluate(() => { document.querySelectorAll('[data-td]').forEach(e => e.remove()) })
  // 重放：等 delay 后建（此刻页面已交互过很久 —— 都该活）
  const box = await p.evaluate((d) => {
    const host = window.__pmView.dom.parentElement
    const w = document.querySelector('.tableWrapper')
    const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const dv = document.createElement('div')
    dv.dataset.td = String(d)
    dv.style.cssText = `position:absolute;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;z-index:8;background:rgba(0,0,0,0.003)`
    window.__cur = ''
    dv.addEventListener('mousedown', () => { window.__cur = 'hit' })
    host.appendChild(dv)
    const r = w.getBoundingClientRect()
    return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }
  }, delay)
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(220)
  console.log(`交互后任意时刻建层(twin):`, (await p.evaluate(() => window.__cur)) === 'hit' ? 'ALIVE ✅' : 'DEAD')
}
await b.close()
