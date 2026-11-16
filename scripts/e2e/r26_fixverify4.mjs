// mousedown 里 dispatch 后 from 仍是 1 —— dispatch 没生效或 selection 被立即
// 改回。可能：点击默认行为（focus 转移）后 PM DOMObserver 把 selection
// 重置到文档头。需要 preventDefault。再试：mousedown preventDefault + 手动。
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 120)))
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
await p.evaluate(() => {
  const v = window.__pmView
  const w = document.querySelector('.tableWrapper')
  w.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td, th')
    if (!td) return
    e.preventDefault()
    const tr = td.parentElement
    const rowIdx = [...tr.parentElement.children].indexOf(tr)
    const cellIdx = [...tr.children].indexOf(td)
    let tablePos = -1
    v.state.doc.forEach((n, off) => { if (tablePos < 0 && n.type.name === 'table') tablePos = off })
    const table = v.state.doc.nodeAt(tablePos)
    const rows = []
    table.forEach((r, off) => rows.push({ r, off }))
    const rowStart = tablePos + 1 + rows[rowIdx].off
    const cells = []
    rows[rowIdx].r.forEach((c, off) => cells.push({ c, off }))
    const cellStart = rowStart + 1 + cells[cellIdx].off
    const target = cellStart + cells[cellIdx].c.content.size
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(target))))
    v.focus()
  })
})
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
console.log('preventDefault+dispatch 后:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
