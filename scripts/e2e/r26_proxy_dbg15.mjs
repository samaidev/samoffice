// ★★★★★ 纯 evaluate 路径：SEL→25 保持、from=25、focus=true、
// 输入 Q → "QA1" ✅✅✅ 完美！
// 说明：dispatch 逻辑完全正确；之前的 52 覆盖来自【真实鼠标点击路径】
// —— mousedown 在 proxy 上时，Chromium 的【原生文本交互】（proxy 区域
// 恰好盖着 CE 文本 —— Chromium 跨层 caret placement bug 的另一面）
// 在 mouseup/click 后把 selection 挪到词尾 52。
// ◆ 修复：mousedown 的 dispatch 放到【mouseup 后】执行（setTimeout 0）
// —— 原生行为先发生，我们的 selection 最后生效：
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
  document.querySelector('.pm-table-clickproxy')?.remove()
  const proxy = document.createElement('div')
  proxy.className = 'pm-table-clickproxy'
  const w = document.querySelector('.tableWrapper')
  const wr = w.getBoundingClientRect(), hr = host.getBoundingClientRect()
  proxy.style.cssText = `position:absolute;z-index:6;left:${wr.left - hr.left + 6}px;top:${wr.top - hr.top}px;width:${wr.width - 12}px;height:${wr.height}px;background:transparent`
  proxy.addEventListener('mousedown', (e) => {
    e.preventDefault()
    // 记录目标，mouseup 后统一应用
    const tds = [...document.querySelectorAll('td')]
    const hit = tds.find(td => { const tr = td.getBoundingClientRect(); return e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom })
    if (!hit) return
    const apply = () => {
      const v = window.__pmView
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
    }
    // 延迟到原生行为之后
    setTimeout(apply, 0)
  })
  proxy.addEventListener('mouseup', (e) => e.preventDefault())
  host.appendChild(proxy)
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(450)
console.log('延时 apply 后:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus() }))))
await p.keyboard.type('Q5', { delay: 70 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
// 第二格
const box2 = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[1].getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box2.x, box2.y)
await p.waitForTimeout(450)
await p.keyboard.type('W7', { delay: 70 })
await p.waitForTimeout(400)
console.log('td[1]:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('td')][1]?.textContent)))
await b.close()
