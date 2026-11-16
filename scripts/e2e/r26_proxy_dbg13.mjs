// from=52 —— near() 把光标放到了 52 而非 cellStart+1=26？
// near(resolve(26),1) 应该给 26 或 27。52 = cell 末尾 —— 这不是我们设的！
// 说明 dispatch 后【又有东西改了 selection】到 52 —— 是我们 dbg11 旧 proxy
// 的监听器？已 remove。是 PM 的 selectionchange 循环 —— mousedown 后
// Chromium 的【原生文本点击行为】把 DOM selection 放在 text 末尾
//（浏览器自动!）→ PM 同步 → 52！
// 即：preventDefault 没拦住原生「点击文字 → 光标到词尾」—— 因为那不是
// 默认行为而是【双击词选择/拖拽】…… 单击文字 Chromium 不设 selection
//（除非 contenteditable 内）—— proxy 不在 CE 内。
// 52 恰是 cellTextEnd —— 会不会 dbg11 的旧 proxy 监听没删干净
//（remove 只删 DOM，监听器随 GC）—— remove 即删。但 dbg11 的 mousedown
// 是 bubbling（非 capture）…… proxy 已移除。
// ◆ 直接对照 scheme5 的差异：scheme5 无 proxy（evaluate 直设）。
// 现在【有 proxy 且点击发生】→ 猜：mouseup 阶段原生 caret placement。
// 加 mouseup preventDefault：
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
await p.evaluate(() => {
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
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(cellStart + 1), 1)))
    v.focus()
  })
  // ★ mouseup 也 preventDefault（阻止原生 caret/词选）
  proxy.addEventListener('mouseup', (e) => e.preventDefault())
  // dblclick 忽略（词选由 mousedown detail 处理）
  host.appendChild(proxy)
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(350)
console.log('状态:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 70 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
