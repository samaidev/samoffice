// ★★★★★ 回退外置后：代理层点击 → from=52（格内！）、doc 完整
// [paragraph,table,paragraph] ✅ —— 但打字没进格（td[0]=A1 不含 Q5）。
// from=52 是 cell 内容末尾，键盘输入需要 PM focused + DOM selection 同步。
// hasFocus=true 但打字无效 —— DOM selection（浏览器层）不在表格文字上
//（表格区事件死区同样影响 DOM selection！）→ PM 收不到 beforeinput。
// 修法：dispatch 后手动同步 DOM Selection（window.getSelection().collapse
// 到目标 td 的文本节点）。
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
  const w = document.querySelector('.tableWrapper')
  const host = window.__pmView.dom.parentElement
  const proxy = document.createElement('div')
  const r = w.getBoundingClientRect()
  const hr = host.getBoundingClientRect()
  proxy.style.cssText = `position:absolute;left:${r.x - hr.x}px;top:${r.y - hr.y}px;width:${r.width}px;height:${r.height}px;z-index:6;cursor:text`
  host.appendChild(proxy)
  proxy.addEventListener('mousedown', (e) => {
    e.preventDefault()
    const tds = [...w.querySelectorAll('td')]
    const hit = tds.find(td => { const tr = td.getBoundingClientRect(); return e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom })
    if (!hit) return
    const tr = hit.parentElement
    const rowIdx = [...tr.parentElement.children].indexOf(tr)
    const cellIdx = [...tr.children].indexOf(hit)
    const v = window.__pmView
    let tablePos = -1
    v.state.doc.forEach((n, off) => { if (tablePos < 0 && n.type.name === 'table') tablePos = off })
    const table = v.state.doc.nodeAt(tablePos)
    const rows = []
    table.forEach((rw, off) => rows.push({ rw, off }))
    const rowStart = tablePos + 1 + rows[rowIdx].off
    const cells = []
    rows[rowIdx].rw.forEach((c, off) => cells.push({ c, off }))
    const cellStart = rowStart + 1 + cells[cellIdx].off
    const target = cellStart + cells[cellIdx].c.content.size
    v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(target))))
    v.focus()
    // ★ 手动同步 DOM Selection 到 td 的文本末尾
    const sel = window.getSelection()
    const textNode = (function findText(el) { for (const n of el.childNodes) { if (n.nodeType === 3) return n; const r = findText(n); if (r) return r } return null })(hit)
    if (textNode && sel) {
      const range = document.createRange()
      range.setStart(textNode, textNode.textContent.length)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  })
})
const box = await p.evaluate(() => { const td = document.querySelector('td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height * 0.5 } })
await p.mouse.click(box.x, box.y)
await p.waitForTimeout(350)
console.log('状态:', JSON.stringify(await p.evaluate(() => ({ from: window.__pmView.state.selection.from, focus: window.__pmView.hasFocus(), anchor: window.getSelection()?.anchorNode?.nodeName }))))
await p.keyboard.type('Q5', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[0]:', JSON.stringify(await p.evaluate(() => document.querySelector('td')?.textContent)))
// 第二格验证
const box2 = await p.evaluate(() => { const tds = [...document.querySelectorAll('td')]; const r = tds[1].getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 } })
await p.mouse.click(box2.x, box2.y)
await p.waitForTimeout(300)
await p.keyboard.type('W7', { delay: 60 })
await p.waitForTimeout(400)
console.log('td[1]:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('td')][1]?.textContent)))
await b.close()
