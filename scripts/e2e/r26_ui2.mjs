// from=20（正文附近）—— 点击表格没到 proxy（proxy 建了吗？）。
// 检查首次交互后 proxy 是否创建 + 事件是否到达：
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
// 首次交互：点正文
const paraBox = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(paraBox.x, paraBox.y)
await p.waitForTimeout(900)
const st1 = await p.evaluate(() => ({
  proxyCount: document.querySelectorAll('.pm-table-clickproxy').length,
  // proxy 在哪（真实几何）
  rect: (() => { const pr = document.querySelector('.pm-table-clickproxy'); if (!pr) return null; const r = pr.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
  tdRect: (() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
}))
console.log('首次交互后:', JSON.stringify(st1))
// 点击 td 中心，看谁在顶、事件到没到
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
const top = await p.evaluate(([x, y]) => (document.elementFromPoint(x, y)?.className || document.elementFromPoint(x, y)?.tagName || '').toString().slice(0, 40), [box.x, box.y])
console.log('顶层:', top)
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
console.log('点击后:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await b.close()
