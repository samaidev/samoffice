// 干净 vite 仍 SEL:52 无 25。viewRef 假设被否（或 HMR 无关）。
// 但 f5 的探针 HIT —— 现在干净环境再验证探针是否还 HIT（如果探针
// 也不 HIT 了，说明 f5 的 HIT 是上一轮 HMR 残留状态的侥幸）：
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
await p.waitForTimeout(3000)
const pb = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(pb.x, pb.y)
await p.waitForTimeout(2600)
await p.evaluate(() => { window.__h = ''; const pr = document.querySelector('.pm-table-clickproxy'); if (pr) { pr.addEventListener('mousedown', () => { window.__h = 'CAPTURE-HIT' }, true); pr.addEventListener('mousedown', () => { window.__h += '+BUBBLE-HIT' }, false) } })
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(500)
console.log('探针:', JSON.stringify(await p.evaluate(() => window.__h || '无')))
console.log('from:', await p.evaluate(() => window.__pmView.state.selection.from))
await b.close()
