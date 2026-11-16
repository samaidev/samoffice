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
const paraBox = await p.evaluate(() => { const r = document.querySelector('.ProseMirror p').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 } })
await p.mouse.click(paraBox.x, paraBox.y)
await p.waitForTimeout(1200)
const st = await p.evaluate(() => ({ proxy: document.querySelectorAll('.pm-table-clickproxy').length, stackTwin: document.querySelectorAll('[data-stacktwin]').length }))
console.log('建了:', JSON.stringify(st))
// 点击（stack-twin z8 在最上 —— 移除后先测 proxy 再测 twin）
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.evaluate(() => document.querySelector('[data-stacktwin]')?.remove())
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
console.log('proxy 点击:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from }))))
// 重建 twin（此刻已是点击后 —— 但要测的是「同栈创建」的那次 —— 已删！
// 改测：不删 —— 直接点 z8 twin）
await b.close()
