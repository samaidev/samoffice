// ★★★ 测试层全部正常收到事件！z6/z9/rgba 都行 —— 但 proxy 收不到！
// 测试层与 proxy 的唯一区别：proxy 是【DocTableView 代码创建】的！
// 同一位置、同样式 —— 代码建的收不到、evaluate 建的能收。
// ◆ 这指向创建【时序】：proxy 在 rAF(setup) 时创建 —— 早于 Chromium
// 的某次层快照；测试层在「之后」创建 —— 正常登记。
// 与 wrapper 本身的死区完全同构：**早期创建的层死，后期创建的活！**
// ★ 所以修复 = 【延后 proxy 创建】到「层快照稳定之后」——
// 比如 setTimeout 500ms 后创建 proxy！验证：把现有 proxy 删了，
// 500ms 后用【相同代码形态】重建：
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
// 删掉现有 proxy，立即重建一个【一样的】：
const r1 = await p.evaluate(() => {
  document.querySelector('.pm-table-clickproxy')?.remove()
  const host = window.__pmView.dom.parentElement
  const proxy = document.createElement('div')
  proxy.className = 'pm-table-clickproxy'
  proxy.style.cssText = 'position:absolute;z-index:6;background:transparent'
  // 立即定位（复制 DocTableView 逻辑）
  const w = document.querySelector('.tableWrapper')
  const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
  proxy.style.left = (wr.left - hr.left + 6) + 'px'
  proxy.style.top = (wr.top - hr.top) + 'px'
  proxy.style.width = (wr.width - 12) + 'px'
  proxy.style.height = wr.height + 'px'
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
    const target = rowStart + 1 + cells[cellIdx].off + cells[cellIdx].c.content.size
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(target))))
    v.focus()
  })
  host.appendChild(proxy)
  window.__log = []
  proxy.addEventListener('mousedown', () => window.__log.push('md'), true)
  const r = proxy.getBoundingClientRect()
  return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 }
})
await p.mouse.click(r1.x, r1.y)
await p.waitForTimeout(300)
console.log('立即重建的 proxy:', JSON.stringify(await p.evaluate(() => window.__log)), JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
await b.close()
