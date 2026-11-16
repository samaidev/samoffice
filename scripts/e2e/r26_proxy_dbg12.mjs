// ★★★★★ 立即重建（同代码）→ mousedown 到达、from=52、focus=true！
// 确认：**rAF 时机创建的 proxy 死；之后创建的活**。
// 但打字仍没进 td（td[0]=A1 无 Q5）—— focus=true 且 from=52（cell 末尾）
// —— scheme5 相同状态能输入（QA1）！差异：scheme5 的 selection 是
// near(resolve(25))=开头？scheme5 用 target=tablePos+3=cell 开头。
// 我们是 cell 末尾（52）。末尾光标输入应插入 …… 
// 也许 beforeinput 需要 DOM selection 同步（PM 的 DOMObserver 在
// selectionchange 后把 DOM selection 同步到 td —— 但死区阻止了
// Chromium 对 td 区域的 selection 渲染？—— 不管，试从「点击后再补一次
// dispatch」或「PM 的 domObserver.flush()」…… 最直接：点击后把
// selection 设到【cell 开头】试试（scheme5 等价形态）：
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
await p.waitForTimeout(3000)
// dbg11 的 proxy 还在。清掉重建成「末尾光标+双保险」：
await p.evaluate(() => {
  document.querySelector('.pm-table-clickproxy')?.remove()
  document.querySelectorAll('[data-ztest]').forEach(e => e.remove())
  const host = window.__pmView.dom.parentElement
  const proxy = document.createElement('div')
  proxy.className = 'pm-table-clickproxy'
  const w = document.querySelector('.tableWrapper')
  const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
  proxy.style.cssText = `position:absolute;z-index:6;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;background:transparent`
  proxy.addEventListener('mousedown', (e) => {
    e.preventDefault()
    const v = window.__pmView
    const tds = [...document.querySelectorAll('td')]
    const hit = tds.find(td => { const tr = td.getBoundingClientRect(); return e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom })
    if (!hit) return
    const tr = hit.parentElement
    const rowIdx = [...tr.parentElement.children].indexOf(tr)
    const cellIdx = [...tr.children].indexOf(hit)
    let tablePos = -1
    v.state.doc.forEach((n, off) => { if (tablePos < 0 && n.type.name === 'table') tablePos = off })
    const rows = []
    v.state.doc.nodeAt(tablePos).forEach((rw, off) => rows.push({ rw, off }))
    const rowStart = tablePos + 1 + rows[rowIdx].off
    const cells = []
    rows[rowIdx].rw.forEach((c, off) => cells.push({ c, off }))
    const cellStart = rowStart + 1 + cells[cellIdx].off
    // scheme5 等价：光标到 cell 内容【开头】
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(cellStart + 1), 1)))
    v.focus()
  })
  host.appendChild(proxy)
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(350)
console.log('cell开头光标:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 70 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
console.log('doc:', JSON.stringify(await p.evaluate(() => { const a = []; window.__pmView.state.doc.forEach(n => a.push(n.type.name)); return a })))
await b.close()
