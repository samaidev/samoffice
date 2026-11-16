// 点击 → focus=true（好事），但 selection from=1（光标在文档开头而非格内）。
// 原因：外置后 PM 的 posAtCoords 找不到表格 DOM（不在 view.dom 树内）→
// PM 无法把点击坐标映射到 cell 内位置 → 光标默认文档头。
// 修法：给 wrapper 挂 mousedown 处理，用 view.posAtCoords 的替代 —— 
// 手动映射：td 元素 → PM 位置（用 view.dom 合成: 简单方式：
// 在 DocTableView 里监听 wrapper 的 mousedown，用 cellFromEvent 算
// 目标 cell 的 PM pos，setSelection + focus。类似手柄的做法。
// 先验证手动映射可行：点击 td → 找到 td 对应 pos → 设置 TextSelection。
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
// 模拟「wrapper mousedown → 定位 cell pos → setSelection」：
await p.evaluate(() => {
  const v = window.__pmView
  const w = document.querySelector('.tableWrapper')
  w.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td, th')
    if (!td) return
    // 遍历 doc 找到与该 td 对应的 cell：用 DOM 顺序匹配（tbody 行列序）
    const tr = td.parentElement
    const rowIdx = [...tr.parentElement.children].indexOf(tr)
    const cellIdx = [...tr.children].indexOf(td)
    // PM doc：table 位置 → 行 → 格
    let tablePos = -1
    v.state.doc.forEach((n, off) => { if (tablePos < 0 && n.type.name === 'table') tablePos = off })
    if (tablePos < 0) return
    const table = v.state.doc.nodeAt(tablePos)
    let pos = tablePos + 1
    const rows = []
    table.forEach((r, off) => rows.push({ r, off }))
    if (rowIdx >= rows.length) return
    const rowStart = tablePos + 1 + rows[rowIdx].off
    const cells = []
    rows[rowIdx].r.forEach((c, off) => cells.push({ c, off }))
    if (cellIdx >= cells.length) return
    const cellStart = rowStart + 1 + cells[cellIdx].off
    // 光标放 cell 内容末尾（或按点击 x 预估 —— 简化：末尾）
    const cellNode = cells[cellIdx].c
    const target = cellStart + cellNode.content.size
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(target))))
    v.focus()
  })
})
const box = await p.evaluate(() => { const r = document.querySelector('td').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(400)
const st = await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))
console.log('mousedown 定位后:', JSON.stringify(st))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0] 文本:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
// 第二格
const box2 = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[1].getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box2.x, box2.y)
await p.waitForTimeout(300)
await p.keyboard.type('W7', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[1] 文本:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('td')][1]?.textContent)))
await b.close()
